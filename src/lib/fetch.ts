import { FastifyInstance } from "fastify"
import { ConversionKey } from "./types"
import { fetchRemoteVideoToGif } from "../convert/gif"
import { finished } from "stream/promises"
import internal, { Readable } from "stream"

export interface ContentFetchOptions {
  // The url to fetch the content from
  url: URL
  // The accepted content type(s)
  acceptContentType: string
}

/**
 * Fetches a remote video to the given stream.
 * @param writeStream The stream to write the remote data to.
 * @param opts Fetching options.
 */
export async function fetchRemoteContent(
  writeStream: internal.Writable,
  opts: ContentFetchOptions
): Promise<void> {
  // Fetch the remote video
  let result: Response
  try {
    result = await fetch(opts.url, {
      headers: {
        'Accept': opts.acceptContentType
      }
    })
  }
  catch (err) {
    throw new Error('failed to fetch remote resource', { cause: err })
  }
  if (result.status != 200) {
    throw new Error(`remote responded with unexpected status code ${result.status}`)
  }
  if (result.body == null) {
    throw new Error('remote responded with an empty body')
  }

  // Pipe the video to the temporary file and create a read stream for it
  try {
    await finished(Readable.fromWeb(result.body).pipe(writeStream))
  }
  catch (err) {
    throw new Error('failed to write response to temporary file', { cause: err })
  }
}

/**
 * Fetches and converts a remote video to a GIF file and returns the path.
 *
 * @param server The server instance to work on.
 * @param url The url to fetch the video from.
 * @returns The path to the resulting GIF file.
 */
export async function fetchConvertedContent(
  server: FastifyInstance,
  key: ConversionKey
) {
  const url = new URL(key.url)
  // Check if the hostname of the URL is whitelisted
  if (!server.isHostnameWhitelisted(url.hostname)) {
    throw new Error("resource hostname is not whitelisted")
  }
  switch (key.ofm) {
    case "gif": return fetchRemoteVideoToGif(key, {
      maxSize: server.config.env.MAXIMUM_OUTPUT_SIZE
    })
  }
}
