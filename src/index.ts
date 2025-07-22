import fastify, { FastifyInstance } from 'fastify'
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox"
import { configureEnvironment } from './config/env.config'
import { configureServer } from './config/server.config'
import tmp from 'tmp'
import { isProduction } from './lib/util'

const createFastify = (): FastifyInstance => {
  return fastify({
    logger: {
      level: isProduction() ? 'info' : 'debug',
      transport: {
        target: 'pino-pretty',
        options: {
          translateTime: isProduction() ? 'yyyy-mm-dd HH:MM:ss.l' : 'HH:MM:ss.l',
          ignore: 'pid,hostname',
          colorize: true,
          singleLine: true,
          prettyPrint: false,
        },
      },
      serializers: {
        req(request) {
          const { authorization, cookie, ...safeHeaders } = request.headers;
          return {
            method: request.method,
            url: request.url,
            headers: safeHeaders,
          };
        },
        res(reply) {
          return {
            statusCode: reply.statusCode,
          };
        }
      }
    }
  })
}

const createServer = async (): Promise<FastifyInstance> => {
  const server = createFastify().withTypeProvider<TypeBoxTypeProvider>()
  await configureEnvironment(server)
  return server
}

const start = async () => {
  // Make sure that any temporary files are deleted on exit
  tmp.setGracefulCleanup()
  // Create and start the server
  const server = await createServer()
  await configureServer(server)
  try {
    await server.listen(
      server.config.production ? {
        host: '0.0.0.0',
        port: 80
      } : {
        port: 3000
      })
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

start()
