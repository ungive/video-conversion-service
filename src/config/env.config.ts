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
  // Redis hostname
  REDIS_HOSTNAME: Type.String(),
  // Redis port
  REDIS_PORT: Type.Integer(),
  // Maximum width and height (size) of output videos in pixels
  MAXIMUM_OUTPUT_SIZE: Type.Integer(),
  // Maximum frame rate of output videos
  MAXIMUM_OUTPUT_FRAMERATE: Type.Integer(),
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
  // How many conversion jobs are allowed to run simultaneously
  CONVERSION_JOB_CONCURRENCY: Type.Integer(),
  // How long conversion results should be retained before purging
  CONVERSION_RESULT_TTL: Type.Integer(),
  // How long a conversion stream is allowed to take at a maximum
  CONVERSION_MAX_STREAM_DURATION: Type.Integer(),
  // Stream buffer size in bytes
  CONVERSION_STREAM_BUFFER_SIZE: Type.Integer({
    minimum: 1024
  }),
  // How long to wait in milliseconds for a conversion stream to start
  CONVERSION_STREAM_HTTP_TIMEOUT: Type.Integer(),
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
