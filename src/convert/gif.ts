import { createTempFile, deferrable, TmpFile } from "../lib/util"
import { createReadStream, createWriteStream } from "fs"
import { fetchRemoteContent } from "../lib/fetch"
import { ConversionKey, formatToFfmpegFormat, formatToHttpContentType, VideoConversionOptions } from "../lib/types"
import internal, { Readable } from "stream"
import ffmpeg from 'fluent-ffmpeg'

/**
 * Converts a given video input to a GIF.
 * @param inputStream The input stream to read from
 * @param outputStream The ouput stream to write to
 * @param opts Video conversion options
 */
export async function convertVideoToGif(
  inputStream: string | Readable,
  outputStream: internal.Writable,
  opts: VideoConversionOptions
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // Maximum dimensions
    const s = opts.maxSize
    // Useful resources:
    // https://stackoverflow.com/a/43116993/6748004
    // https://superuser.com/a/556031
    // https://superuser.com/a/1695537
    ffmpeg()
      .input(inputStream)
      .inputFormat(opts.ffmpegInputFormat)
      .videoFilters([
        `scale=w='if(gt(dar,${s}/${s}),min(${s},iw*sar),2*trunc(iw*sar*oh/ih/2))':h='if(gt(dar,${s}/${s}),2*trunc(ih*ow/iw/sar/2),min(${s},ih))'`,
        'split[s0][s1]',
        '[s0]palettegen=max_colors=32[p]',
        '[s1][p]paletteuse=dither=bayer'
      ])
      .outputOptions([
        '-loop 0' // infinite loop
      ])
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
  opts: {
    maxSize: number
  }
): Promise<string> {
  return deferrable(async (defer) => {

    // Create two temporary files
    // One for the video file, one for the GIF
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

    // Defer deletion of the temporary files that are not needed anymore
    defer(async () => {
      vid.cleanup()
    })

    // Fetch the remote video
    try {
      await fetchRemoteContent(createWriteStream(vid.path), {
        acceptContentType: formatToHttpContentType(key.ifm),
        url: new URL(key.url)
      })
    }
    catch (err) {
      throw new Error('failed to fetch remote resource', { cause: err })
    }

    // Convert the video to a GIF
    try {
      const inputStream = createReadStream(vid.path, { start: 0 })
      const outputStream = createWriteStream(gif.path, { start: 0 })
      await convertVideoToGif(inputStream, outputStream, {
        ffmpegInputFormat: formatToFfmpegFormat(key.ifm),
        maxSize: opts.maxSize
      })
    }
    catch (err) {
      throw new Error('failed to convert resource to gif', { cause: err })
    }

    return gif.path
  })
}
