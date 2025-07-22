import { ReadStream } from "fs"
import { ConversionKey, formatToFfmpegFormat, VideoConversionOptions } from "../lib/types"
import { Readable, PassThrough, Writable } from "stream"
import ffmpeg from 'fluent-ffmpeg'
import { inputM3u8 } from './input/m3u8'
import { FastifyInstance } from "fastify"
import { asError, randomInt } from "../lib/util"
import { AsyncCounter } from "../lib/async-counter"

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
  let input: string | ReadStream = key.url
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
      await convertVideoToGif1(server, input, stream, key, opts)
    }
    catch (err) {
      stream.destroy(asError(err))
    }
  })()

  return stream
}

const ffmpegProcessCounter = new AsyncCounter()

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
