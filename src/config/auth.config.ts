import { FastifyInstance } from "fastify"
import { hashPassword } from '../lib/util'
import basicAuth from '@fastify/basic-auth'
import bcrypt from 'bcrypt'

export async function configureAuth(server: FastifyInstance) {
  // The hashed password for the token creation endpoint
  server.decorate('tokenPasswordHash',
    await hashPassword(server.config.env.TOKEN_AUTH_PASSWORD))
  // Register the authentication handler
  await server.register(basicAuth, {
    validate: async (username, password, request, response) => {
      if (username != server.config.env.TOKEN_AUTH_USERNAME) {
        return new Error('incorrect credentials')
      }
      const passwordValid = await new Promise<boolean>((resolve, reject) => {
        bcrypt.compare(password, server.tokenPasswordHash, (err, result) => {
          if (err) {
            return reject(err)
          }
          resolve(result)
        });
      })
      if (!passwordValid) {
        return new Error('incorrect credentials')
      }
    },
    authenticate: {
      realm: 'gif-conversion-api'
    }
  })
}
