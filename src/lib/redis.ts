import { FastifyInstance } from 'fastify'
import { AsyncCounter } from './async-counter'

export const REDIS_KEYSPACE_PREFIX = '__keyspace@0__'

const debugSubCounter = new AsyncCounter()

export function waitForKey(
  server: FastifyInstance,
  key: string,
  timeout?: number,
  signal?: AbortSignal
): Promise<boolean> {
  const keyChannel = `${REDIS_KEYSPACE_PREFIX}:${key}`

  return new Promise((resolve, reject) => {

    let timer: NodeJS.Timeout | undefined
    let finished = false

    const cleanup = () => {
      if (!finished) {
        finished = true
        clearTimeout(timer)
        server.jobsSub.removeListener('message', onMessage)
        if (server.config.debug) {
          debugSubCounter.decrement().then(count => {
            server.log.debug({ count }, 'removed jobsSub listener')
          })
        }
        signal?.removeEventListener('abort', onAbort)
      }
    }

    const rejectAborted = () => {
      reject(new Error('aborted'))
    }

    const onAbort = () => {
      cleanup()
      rejectAborted()
    }

    signal?.addEventListener('abort', onAbort)
    if (signal?.aborted)
      return onAbort()

    const done = (existed: boolean = false) => {
      cleanup()
      resolve(existed)
    }

    const onMessage = (channel: string, message: string) => {
      if (channel === keyChannel && message === 'set') {
        done()
      }
    }

    server.jobsSub.on('message', onMessage)
    if (server.config.debug) {
      debugSubCounter.increment().then(count => {
        server.log.debug({ count }, 'added jobsSub listener')
      })
    }

    if (timeout !== undefined) {
      timer = setTimeout(() => {
        cleanup()
        reject(new Error('timed out'))
      }, timeout)
    }

    server.jobsConnection.exists(key).then((exists) => {
      if (exists) {
        done(true)
      }
    }).catch((err) => {
      cleanup()
      reject(err)
    })
  })
}
