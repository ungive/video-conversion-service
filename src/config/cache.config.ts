import { FastifyInstance } from "fastify"
import { LRUCache } from "lru-cache"
import { ConversionKey } from "../lib/types"

export async function configureCache(server: FastifyInstance) {
  // Token cache
  server.decorate('tokens', new LRUCache<string, ConversionKey>({
    ttl: server.config.env.TOKEN_TTL,
    ttlResolution: server.config.env.TOKEN_TTL_RESOLUTION,
    ttlAutopurge: true, // always purge tokens
  }))
}
