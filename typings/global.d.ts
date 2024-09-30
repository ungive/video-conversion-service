import { FastifyInstance } from 'fastify'
import { configSchema } from '../src/config/env.config'
import { Static } from '@sinclair/typebox'
import { LRUCache } from 'lru-cache'
import { ConversionKey } from '../src/routes/api.routes'
import { CacheKey } from '../src/config/cache.config'
import { StringifiedJSON } from '../src/lib/types'

declare module 'fastify' {
  interface FastifyInstance {
    config: Static<typeof configSchema>
    tokenPasswordHash: string
    isHostnameWhitelisted: (hostname: string) => boolean
    tokens: LRUCache<string, ConversionKey>
    cache: LRUCache<StringifiedJSON, string>
  }
}
