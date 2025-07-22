import { ReadStream } from "fs"
import { ConversionKey, formatToFfmpegFormat, VideoConversionOptions } from "../lib/types"
import { Readable, PassThrough, Writable } from "stream"
import ffmpeg from 'fluent-ffmpeg'
import { inputM3u8 } from './input/m3u8'
import { FastifyInstance } from "fastify"
import { asError } from "../lib/util"

/**
 * Converts a given video input to a GIF.
 * @param inputStream The input stream to read from
 * @param outputStream The ouput stream to write to
 * @param opts Video conversion options
 */
export async function convertVideoToGif(
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

    // FIXME can't stop the command? kill() does nothing,

    const command = ffmpeg()
      .input(inputStream)
      .inputFormat(formatToFfmpegFormat(key.ifm))
      .videoFilters([
        `scale=w='if(gt(dar,${size}/${size}),min(${size},iw*sar),2*trunc(iw*sar*oh/ih/2))':h='if(gt(dar,${size}/${size}),2*trunc(ih*ow/iw/sar/2),min(${size},ih))'`,
        fps ? `fps=${fps}` : null,
        'split[s0][s1]',
        `[s0]palettegen=max_colors=${colors}[p]`,
        '[s1][p]paletteuse=dither=bayer'
      ].filter(v => typeof v === 'string'))
      .outputFormat('gif')
      .on('end', () => {
        resolve()
      })
      .on('start', (command: string) => {
        server.log.debug({ command }, "ffmpeg command")
      })
      .on('progress', (progress) => {
        server.log.debug({ progress, conversionKey: key }, 'ffmpeg progress')
      })
      .on('error', err => {
        reject(err)
      })
      .stream(outputStream)
  })
}

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
      await convertVideoToGif(server, input, stream, key, opts)
    }
    catch (err) {
      stream.destroy(asError(err))
    }
  })()

  return stream
}
