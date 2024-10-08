import { FastifyInstance } from "fastify"
import { Type, type Static } from '@fastify/type-provider-typebox'
import { conversionKeySchema, ConversionKey, ContentFormat, outputFormatSchema } from '../lib/types'
import { retry, generateRandomToken } from "../lib/util"
import fs, { createReadStream } from 'fs'
import stringify from "json-stringify-deterministic"

export default async function routes(server: FastifyInstance) {

  // GET /token
  const tokenQuerystringSchema = Type.Composite([
    conversionKeySchema
  ])
  server.get<{
    Querystring: Static<typeof tokenQuerystringSchema>
  }>('/token', {
    schema: {
      querystring: tokenQuerystringSchema,
      response: {
        '2xx': Type.Object({
          // The url to the /convert endpoint
          url: Type.String({ format: "uri" }),
          // The token to use for the /convert endpoint
          token: Type.String(),
          // Epoch time in seconds at which the token expires
          expires: Type.Integer(),
          // The passed conversion key parameters
          key: conversionKeySchema
        })
      },
    },
    onRequest: server.basicAuth
  }, async (request, reply) => {
    const { ifm, ofm, url } = request.query

    // Make sure the input and output format are different
    if (ifm as ContentFormat === ofm as ContentFormat) {
      throw new Error('the input and output format cannot be identical')
    }

    // Make sure the hostname is whitelisted
    if (!server.isHostnameWhitelisted(new URL(url).hostname)) {
      throw new Error('the resource hostname is not whitelisted')
    }

    // Generate a token and associate the conversion key with the token
    const token = await retry(async () => {
      const value = await generateRandomToken(server.config.env.TOKEN_SIZE)
      if (server.tokens.has(value)) {
        throw new Error('unable to generate a unique token')
      }
      return value
    })
    const key = { ifm, ofm, url } as ConversionKey
    server.tokens.set(token, key)

    // Calculate how long the token is valid
    const ttl = server.tokens.getRemainingTTL(token) / 1000
    if (!isFinite(ttl)) {
      throw new Error('newly created token is not in cache')
    }
    if (!isFinite(ttl)) {
      throw new Error('remaining token cache key ttl is not finite')
    }
    const now = Math.floor(new Date().getTime() / 1000)
    const expires = now + ttl

    // Send the token
    const baseUrl = server.config.env.SERVER_BASE_URL
    return await reply.send({
      url: `${baseUrl}/convert.${key.ofm}?token=${token}`,
      token,
      expires,
      key
    })
  })

  // GET /convert
  const convertQuerystringSchema = Type.Object({
    token: Type.String()
  })
  const convertParamsSchema = Type.Object({
    ext: Type.Union([
      Type.Literal(''),
      Type.TemplateLiteral([
        Type.Literal('.'),
        outputFormatSchema
      ])
    ])
  })
  server.get<{
    Querystring: Static<typeof convertQuerystringSchema>,
    Params: Static<typeof convertParamsSchema>,
  }>('/convert:ext', {
    schema: {
      querystring: convertQuerystringSchema,
      params: convertParamsSchema
    },
    handler: async (request, reply) => {
      const token = request.query.token

      // Read the token from the cache
      const key: ConversionKey | undefined = server.tokens.get(token)
      if (typeof key === 'undefined') {
        throw new Error("invalid token")
      }

      // Ensure the extension is identical to the output format
      if (request.params.ext.length > 0
        && !request.params.ext.endsWith(key.ofm)) {
        throw new Error("the extension must be identical to the output format")
      }

      // Fetch the URL from the cache or fetch it again
      let file = await server.cache.fetch(stringify(key))
      if (typeof file === 'undefined') {
        throw new Error('cache fetch result is empty')
      }

      // Handle the case the temporary file might have been deleted
      if (!fs.existsSync(file)) {
        if (!server.cache.delete(stringify(key))) {
          throw new Error('failed to delete stale entry from cache')
        }
        file = await server.cache.fetch(stringify(key))
        if (typeof file === 'undefined') {
          throw new Error('cache fetch result is empty')
        }
      }

      // Send the response
      const filename = `video-${token.substring(0, 8)}.gif`
      return reply
        .code(200)
        .type('image/gif')
        .header('Content-Disposition', 'filename=' + filename)
        .send(createReadStream(file))
    }
  })
}
