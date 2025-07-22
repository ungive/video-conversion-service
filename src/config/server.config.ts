import path from "node:path"
import autoload from '@fastify/autoload'
import { FastifyInstance } from "fastify"
import { configureAuth } from "./auth.config"
import { configureCache } from "./cache.config"
import { configureMetrics } from "./metrics.config"
import { configureJobs } from "./jobs.config"

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
  // Configure metrics
  await configureMetrics(server)
  // Configure jobs
  await configureJobs(server, {
    beforeConfigure: {
      clearCache: true,
      clearJobs: true
    }
  })
  // Register all routes
  await server.register(autoload, {
    dir: path.join(__dirname, '..', 'routes')
  })
  return server
}
