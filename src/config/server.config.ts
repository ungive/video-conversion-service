import { FastifyInstance } from "fastify"
import { configureAuth } from "./auth.config"
import path from "path"
import autoload from '@fastify/autoload'
import { configureCache } from "./cache.config"

export async function configureServer(server: FastifyInstance) {
  // Function to check if the given hostname is whitelisted in the environment
  server.decorate('isHostnameWhitelisted', (hostname: string) => {
    const whitelist = server.config.env.SOURCE_HOSTNAME_WHITELIST.split(',')
    return whitelist.some((value) => {
      return value.trim().toLowerCase() === hostname.trim().toLowerCase()
    })
  })
  // Register cache
  await configureCache(server)
  // Register authentication
  await configureAuth(server)
  // Register all routes
  await server.register(autoload, {
    dir: path.join(__dirname, '..', 'routes')
  })
  return server
}
