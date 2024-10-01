import { FastifyInstance } from "fastify"
import { LRUCache } from "lru-cache"
import { ConversionKey, StringifiedJSON } from "../lib/types"
import { fetchConvertedContent } from "../lib/fetch"
import fs from "fs"

export async function configureCache(server: FastifyInstance) {
  // Token cache
  server.decorate('tokens', new LRUCache<string, ConversionKey>({
    ttl: server.config.env.TOKEN_TTL,
    ttlResolution: server.config.env.TOKEN_TTL_RESOLUTION,
    ttlAutopurge: true, // always purge tokens
  }))
  // Converted files cache
  server.decorate('cache', new LRUCache<StringifiedJSON, string>({
    // The fetch method interprets the key as the remote URL
    // from which to download the video and then convert it to a GIF.
    fetchMethod: async (key: StringifiedJSON) => {
      return fetchConvertedContent(server, JSON.parse(key) as ConversionKey)
    },
    // Use the file size in bytes for cache size calculation
    sizeCalculation: (value: string) => {
      try {
        const { size } = fs.statSync(value)
        return size
      }
      catch (err) {
        server.log.warn({
          err,
          message: 'failed to get size for cache entry',
          value: value
        })
      }
      // In case of an error use the average expected size per file.
      return server.config.env.CACHE_MAX_SIZE_BYTES / server.config.env.CACHE_MAX_FILES
    },
    // Dispose images by deleting the corresponding temporary file
    dispose: (value: string, key: StringifiedJSON) => {
      try {
        fs.unlinkSync(value)
      }
      catch (err) {
        server.log.warn({
          err,
          message: 'failed to unlink cache entry'
        })
      }
    },
    // Configuration,
    max: server.config.env.CACHE_MAX_FILES,
    maxSize: server.config.env.CACHE_MAX_SIZE_BYTES,
    ttl: server.config.env.CACHE_TTL,
    ttlResolution: server.config.env.CACHE_TTL_RESOLUTION,
    ttlAutopurge: server.config.env.CACHE_TTL_AUTOPURGE,
    allowStale: server.config.env.CACHE_ALLOW_STALE,
  }))
}
