import { createReadStream, createWriteStream, PathLike, ReadStream } from "node:fs"
import { fetchRemoteContent } from "../../lib/fetch"
import { ConversionKey, formatToHttpContentType } from "../../lib/types"

export async function inputDefault(
  key: ConversionKey,
  outputFile: PathLike
): Promise<ReadStream> {
  try {
    await fetchRemoteContent(createWriteStream(outputFile), {
      acceptContentType: formatToHttpContentType(key.ifm),
      url: new URL(key.url)
    })
  }
  catch (err) {
    throw new Error('failed to fetch remote video', { cause: err })
  }
  return createReadStream(outputFile, { start: 0 })
}
