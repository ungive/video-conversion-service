import { FastifyInstance } from 'fastify'

export const REDIS_KEYSPACE_PREFIX = '__keyspace@0__'

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
        console.log('unregistering message handler for subs')
        server.jobsSub.removeListener('message', onMessage)
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
      console.log({ channel, message })
      if (channel === keyChannel && message === 'set') {
        done()
      }
    }

    console.log('registering message handler for subs')
    server.jobsSub.on('message', onMessage)

    if (timeout !== undefined) {
      timer = setTimeout(() => {
        cleanup()
        reject(new Error('timed out'))
      }, timeout)
    }

    server.jobsConnection.exists(key).then((exists) => {
      console.debug('sub exists?', exists)
      if (exists) {
        done(true)
      }
    }).catch((err) => {
      cleanup()
      reject(err)
    })
  })
}
