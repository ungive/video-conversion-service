import { createTempFile, deferrable, TmpFile } from "../lib/util"
import { createWriteStream, ReadStream } from "fs"
import { ConversionKey, formatToFfmpegFormat, VideoConversionOptions } from "../lib/types"
import internal, { Readable } from "stream"
import ffmpeg from 'fluent-ffmpeg'
import { inputDefault } from './input/default'
import { inputM3u8 } from './input/m3u8'

/**
 * Converts a given video input to a GIF.
 * @param inputStream The input stream to read from
 * @param outputStream The ouput stream to write to
 * @param opts Video conversion options
 */
export async function convertVideoToGif(
  inputStream: string | Readable,
  outputStream: internal.Writable,
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
    ffmpeg()
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
      .on('error', err => {
        reject(err)
      })
      .stream(outputStream)
  })
}

/**
 * Converts a remote video to a GIF and returns the file path.
 * Ensures that the resulting GIF is no larger than the given maximum size.
 * @param url The URL to fetch the remote video from.
 * @param opts Options for video conversion.
 * @returns The path to the resulting GIF file.
 */
export async function fetchRemoteVideoToGif(
  key: ConversionKey,
  opts: VideoConversionOptions
): Promise<string> {
  return deferrable(async (defer) => {

    // Create temporary files for the video and resulting GIF
    let vid: TmpFile
    let gif: TmpFile
    try {
      [vid, gif] = await Promise.all([
        createTempFile(),
        createTempFile(),
      ])
    }
    catch (err) {
      throw new Error('failed to create temporary file', { cause: err })
    }

    // Defer deletion of the temporary files
    defer(async () => {
      vid.cleanup()
    })

    // Determine the input path, url or stream
    let input: string | ReadStream = vid.path
    if (key.ifm == 'm3u8') {
      input = await inputM3u8(key, opts)
    } else {
      input = await inputDefault(key, vid.path)
    }

    // Convert the video to a GIF
    try {
      const outputStream = createWriteStream(gif.path, { start: 0 })
      await convertVideoToGif(input, outputStream, key, opts)
    }
    catch (err) {
      throw new Error('failed to convert resource to gif', { cause: err })
    }

    return gif.path
  })
}
