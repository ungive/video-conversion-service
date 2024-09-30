import fastify, { FastifyInstance } from 'fastify'
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox"
import { configureEnvironment } from './config/env.config'
import { configureServer } from './config/server.config'
import tmp from 'tmp'

const createServer = async (): Promise<FastifyInstance> => {
  const server = fastify({ logger: true })
    .withTypeProvider<TypeBoxTypeProvider>()
  await configureEnvironment(server)
  return server
}

const start = async () => {
  // Make sure that temporary files are deleted on exit
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
