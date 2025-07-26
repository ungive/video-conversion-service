import { ConversionKey, formatToFfmpegFormat, VideoConversionOptions } from "../lib/types"
import { Readable, PassThrough, Writable } from "stream"
import ffmpeg, { FfmpegCommand } from 'fluent-ffmpeg'
import { inputM3u8 } from './input/m3u8'
import { FastifyInstance } from "fastify"
import { asError, bufferToStream, createTempFile, deferrable, randomInt } from "../lib/util"
import { AsyncCounter } from "../lib/async-counter"
import { AsyncValue } from "../lib/async-value"
import concat from 'concat-stream'

/**
 * Converts a remote video to a GIF and streams the conversion result.
 *
 * @param url The URL to fetch the remote video from.
 * @param opts Options for video conversion.
 * @returns The path to the resulting GIF file.
 */
export async function fetchRemoteVideoToGif(
  server: FastifyInstance,
  key: ConversionKey,
  opts: VideoConversionOptions
): Promise<Readable> {

  // Determine the input path, url or stream
  let input: string = key.url
  if (key.ifm == 'm3u8') {
    input = await inputM3u8(key, opts)
  }
  if (input === undefined) {
    throw new Error('missing input')
  }

  const stream = new PassThrough({
    highWaterMark: server.config.env.CONVERSION_STREAM_BUFFER_SIZE
  });

  // Write to the stream in the background and propagate any errors.
  (async () => {
    try {
      await convertVideoToGif2(server, input, stream, key, opts)
    }
    catch (err) {
      stream.destroy(asError(err))
    }
  })()

  return stream
}

const ffmpegProcessCounter = new AsyncCounter()

const scaleFilter = (size: number) => {
  return `scale=w='if(gt(dar,${size}/${size}),min(${size},iw*sar),2*trunc(iw*sar*oh/ih/2))':h='if(gt(dar,${size}/${size}),2*trunc(ih*ow/iw/sar/2),min(${size},ih))'`
}

/**
 * Converts a video input stream to a GIF in multiple ffmpeg passes
 * and optionally with real-time streaming limited to the video framerate.
 *
 * Pros: Streams at video framerate. Therefore much lower CPU usage.
 * Possibly faster first-frame generation due to multi-pass conversion.
 * Cons: Slow for large video files, these are downloaded before conversion.
 */
export async function convertVideoToGif2(
  server: FastifyInstance,
  input: string,
  outputStream: Writable,
  key: ConversionKey,
  opts: VideoConversionOptions,
): Promise<void> {

  const threads = Math.max(1, Math.min(128, server.config.env.CONVERSION_FFMPEG_THREADS))
  const size = Math.max(1, Math.min(key.osz || opts.maxSize, opts.maxSize))
  const fps = key.ofr && Math.max(1, Math.min(key.ofr, opts.maxFramerate))
  const colors = key.out_gif_colors || 32

  return await deferrable(async (defer) => {

    const video = await createTempFile()
    defer(async () => {
      video.cleanup()
    })

    // Log how many ffmpeg processes were running before and after conversion.
    const instanceLabel = randomInt(1024 * 64, 1)
    server.log.info({
      instanceLabel,
      runningProcesses: await ffmpegProcessCounter.read()
    }, 'beginning multi-stage ffmpeg conversion')
    defer(async () => {
      const runningProcesses = await ffmpegProcessCounter.read()
      server.log.info({
        instanceLabel,
        runningProcesses
      }, 'completed multi-stage ffmpeg conversion')
      if (runningProcesses < 0) {
        server.log.warn({
          value: runningProcesses
        }, 'ffmpeg process counter is negative')
      }
    })

    const state = new AsyncValue<{
      command?: FfmpegCommand,
      closed: boolean
    }>({ closed: false });

    // Kill the current ffmpeg command when output stream closes
    // and cancel any further processing
    const onOutputStreamClose = async () => {
      server.log.debug({ instanceLabel }, 'stopping multi-stage ffmpeg conversion')
      state.exchange({ closed: true })
        .then(value => {
          server.log.debug({ instanceLabel }, 'killing any multi-stage ffmpeg command')
          value.command?.kill('SIGKILL')
        })
    }
    outputStream.once('error', onOutputStreamClose)
    defer(async () => {
      outputStream.removeListener('error', onOutputStreamClose)
    })

    // Pass 1: Download remote video and convert to mp4
    // with desired dimensions and framerate.
    await new Promise<void>((resolve, reject) => {
      const command = ffmpeg(input)
        .videoFilters([
          fps && `fps=${fps}`,
          scaleFilter(2 * Math.floor(size / 2)) // needed for H.264
        ].filter(v => typeof v === 'string'))
        .format('mp4')
        .output(video.path)
        .outputOptions('-threads', String(threads))
        .on('start', async command => {
          await ffmpegProcessCounter.increment()
          server.log.debug({ instanceLabel, command }, 'ffmpeg multi-stage #1')
        })
        .on('end', async () => {
          await ffmpegProcessCounter.decrement()
          server.log.debug({ instanceLabel }, 'ffmpeg multi-stage #1 end')
          resolve()
        })
        .on('error', (err) => {
          reject(err)
        })
      state.exchange({ command, closed: false })
        .then(value => {
          if (value.closed) {
            server.log.debug({ instanceLabel }, 'not running ffmpeg multi-stage #1')
            reject()
          } else {
            command.run()
          }
        })
    })

    // Pass 2: Determine the color palette.
    const palettePassThrough = new PassThrough()
    await new Promise<void>((resolve, reject) => {
      const command = ffmpeg(video.path)
        .videoFilters(`fps=2,palettegen=max_colors=${colors}`)
        .format('image2pipe')
        .videoCodec('png')
        .on('start', async command => {
          await ffmpegProcessCounter.increment()
          server.log.debug({ instanceLabel, command }, 'ffmpeg multi-stage #2')
        })
        .on('end', async () => {
          await ffmpegProcessCounter.decrement()
          server.log.debug({ instanceLabel }, 'ffmpeg multi-stage #2 end')
          resolve()
        })
        .on('error', (err) => {
          reject(err)
        })
      state.exchange({ command, closed: false })
        .then(value => {
          if (value.closed) {
            server.log.debug({ instanceLabel }, 'not running ffmpeg multi-stage #2')
            reject()
          } else {
            command.stream(palettePassThrough)
          }
        })
    })
    const paletteBuffer = await new Promise<Buffer>(resolve => {
      palettePassThrough.pipe(concat(buffer => {
        resolve(buffer)
      }))
    })
    const paletteReadable = bufferToStream(paletteBuffer);

    // Pass 3: Convert the stored video to GIF using the generated palette.
    await new Promise<void>((resolve, reject) => {
      const command = ffmpeg()
        .input(video.path)
        .addInputOptions([
          key.rts && '-re'
        ].filter(v => typeof v === 'string'))
        .input(paletteReadable)
        .inputFormat('image2pipe')
        .inputOptions('-vcodec', 'png')
        .complexFilter([
          [
            fps && `fps=${fps}`,
            `${scaleFilter(size)}[p]`
          ].filter(v => typeof v === 'string').join(','),
          `[p][1:v]paletteuse=dither=bayer`
        ])
        .outputFormat('gif')
        .on('start', async command => {
          await ffmpegProcessCounter.increment()
          server.log.debug({ instanceLabel, command }, 'ffmpeg multi-stage #3')
        })
        .on('end', async () => {
          await ffmpegProcessCounter.decrement()
          server.log.debug({ instanceLabel }, 'ffmpeg multi-stage #3 end')
          resolve()
        })
        .on('error', (err) => {
          reject(err)
        })
      state.exchange({ command, closed: false })
        .then(value => {
          if (value.closed) {
            server.log.debug({ instanceLabel }, 'not running ffmpeg multi-stage #3')
            reject()
          } else {
            command.stream(outputStream)
          }
        })
    });
  })
}

/**
 * Converts a video input stream to a GIF in a single ffmpeg pass.
 *
 * Pros: Fast. Good when the video is large and streaming conversion is desired.
 * Cons: Uncapped/high CPU usage. Only fast, no real-time streaming.
 *
 * @param inputStream The input stream to read from
 * @param outputStream The ouput stream to write to
 * @param opts Video conversion options
 */
export async function convertVideoToGif1(
  server: FastifyInstance,
  inputStream: string | Readable,
  outputStream: Writable,
  key: ConversionKey,
  opts: VideoConversionOptions,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {

    const size = Math.max(1, Math.min(key.osz || opts.maxSize, opts.maxSize))
    const fps = Math.max(1, Math.min(key.ofr || opts.maxFramerate, opts.maxFramerate))
    const colors = key.out_gif_colors || 32

    // Useful resources:
    // https://stackoverflow.com/a/43116993/6748004
    // https://superuser.com/a/556031
    // https://superuser.com/a/1695537
    // FIXME High CPU usage, but using the "-re" input flag slows down
    // first frame generation immensely. we have to separate this into
    // multiple commands, most likely

    const instanceLabel = randomInt(1024 * 64, 1)
    const command = ffmpeg()
      .input(inputStream)
      .inputFormat(formatToFfmpegFormat(key.ifm))
      .videoFilters([
        `scale=w='if(gt(dar,${size}/${size}),min(${size},iw*sar),2*trunc(iw*sar*oh/ih/2))':h='if(gt(dar,${size}/${size}),2*trunc(ih*ow/iw/sar/2),min(${size},ih))'`,
        fps ? `fps=${fps}` : null,
        'split[s0][s1]',
        `[s0]fps=3,palettegen=max_colors=${colors}[p]`,
        '[s1][p]paletteuse=dither=bayer'
      ].filter(v => typeof v === 'string'))
      .outputFormat('gif')
      .on('start', async (command: string) => {
        const processCount = await ffmpegProcessCounter.increment()
        server.log.info({
          instanceLabel,
          totalProcesses: processCount,
          conversionKey: key,
          command
        }, "ffmpeg spawned")
      })
      .on('end', async () => {
        const processCount = await ffmpegProcessCounter.decrement()
        server.log.info({
          instanceLabel,
          totalProcesses: processCount
        }, 'ffmpeg process terminated')
        if (processCount < 0) {
          server.log.warn({
            value: processCount
          }, 'ffmpeg process counter is negative')
        }
      })
      .on('progress', (progress) => {
        server.log.debug({ progress, conversionKey: key }, 'ffmpeg progress')
      })

    // Kill the ffmpeg process when the output stream is closed.
    // Note that this does not work on Windows.
    const onOutputStreamClose = () => {
      server.log.debug('killing ffmpeg process')
      command.kill('SIGKILL')
    }
    outputStream.once('error', onOutputStreamClose)

    // Make sure that the process is not unnecessarily killed after completion.
    command
      .on('end', () => {
        outputStream.removeListener('error', onOutputStreamClose)
        resolve()
      })
      .on('error', err => {
        outputStream.removeListener('error', onOutputStreamClose)
        reject(err)
      })

    // Stream the incoming conversion result.
    command.stream(outputStream)
  })
}
