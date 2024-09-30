import fastifyEnv from '@fastify/env'
import { Type } from '@sinclair/typebox'
import { FastifyInstance } from 'fastify'
import { isProduction } from '../lib/util'
import { envious } from '@pitininja/envious'

export const envSchema = Type.Object({
  // This server's hostname as it's used from the outside
  SERVER_BASE_URL: Type.String({ pattern: "(http|https):\/\/.+[^\/]$" }),
  // Comma-separated list of whitelisted hostnames
  SOURCE_HOSTNAME_WHITELIST: Type.String(),
  // Maximum width and height (size) of output videos in pixels
  MAXIMUM_OUTPUT_SIZE: Type.Integer(),
  // Username for creating a token
  TOKEN_AUTH_USERNAME: Type.String(),
  // Password for creating a token
  TOKEN_AUTH_PASSWORD: Type.String(),
  // Number of bytes to generate for each token
  TOKEN_SIZE: Type.Integer(),
  // Token TTL in milliseconds
  TOKEN_TTL: Type.Integer(),
  // Token TTL resolution in milliseconds (threshold for error)
  TOKEN_TTL_RESOLUTION: Type.Integer(),
  // Cache TTL in milliseconds
  CACHE_TTL: Type.Integer(),
  // Cache TTL resolution in milliseconds (threshold for error)
  CACHE_TTL_RESOLUTION: Type.Integer({ default: 1 }),
  // Whether to automatically purge stale cache items after their TTL
  CACHE_TTL_AUTOPURGE: Type.Boolean({ default: false }),
  // Maximum number of cache entries (files)
  CACHE_MAX_FILES: Type.Integer(),
  // Maximum number of bytes in the cache (calculated with file sizes)
  CACHE_MAX_SIZE_BYTES: Type.Integer(),
  // Whether to allow stale cache entries to be served
  CACHE_ALLOW_STALE: Type.Boolean({ default: false }),
})

export const configSchema = Type.Object({
  env: envSchema,
  production: Type.Boolean({
    default: false
  })
})

export async function configureEnvironment(server: FastifyInstance) {
  // For some reason we have to manually map "true" and "false" for booleans.
  await server.register(fastifyEnv, {
    confKey: 'config',
    data: {
      env: envious(envSchema),
      production: isProduction()
    },
    schema: configSchema,
    dotenv: true
  })
}
