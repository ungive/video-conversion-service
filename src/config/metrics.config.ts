import { FastifyInstance } from "fastify"
import metrics from 'fastify-metrics'

export async function configureMetrics(server: FastifyInstance) {
  await server.register(metrics, {
    endpoint: '/metrics'
  })
}
