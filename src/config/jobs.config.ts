import { FastifyInstance } from 'fastify'
import { Queue, Worker, Job } from 'bullmq'
import IORedis, { Redis, RedisOptions, ReplyError } from 'ioredis'
import { once, Readable } from 'node:stream'
import { ConversionKey } from '../lib/types'
import { fetchConvertedContent } from '../lib/fetch'
import stringify from 'json-stringify-deterministic'
import { asError, stringifyError } from '../lib/util'
import { REDIS_KEYSPACE_PREFIX, waitForKey } from '../lib/redis'

const redisCachePrefix = (name: string = '') => `cache:${name}`

// FIXME This is inefficient
const cleanupJobIdFor = (conversionKey: ConversionKey) => `${stringify(conversionKey)}:cleanup`
const writeKeyFor = (conversionKey: ConversionKey) => redisCachePrefix(`${stringify(conversionKey)}:write`)
const readKeyFor = (conversionKey: ConversionKey) => redisCachePrefix(`${stringify(conversionKey)}:read`)
const dataKeyFor = (conversionKey: ConversionKey) => redisCachePrefix(`${stringify(conversionKey)}:data`)
const errorKeyFor = (conversionKey: ConversionKey) => redisCachePrefix(`${stringify(conversionKey)}:error`)
const keyspaceMessageFor = (key: string) => `${REDIS_KEYSPACE_PREFIX}:${key}`

export interface JobsOptions {
  beforeConfigure?: {
    // Whether to clear any leftovers in cache first.
    clearCache?: boolean
    // Whether to cancel and remove all jobs first.
    clearJobs?: boolean
  }
}

async function clearCache(
  connection: Redis
) {
  const BATCH_SIZE = 256
  const keys = await connection.keys(redisCachePrefix('*'))
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    await connection.del(...keys.slice(i, i + BATCH_SIZE))
  }
}

async function clearAllJobs(queue: Queue) {
  await queue.obliterate({ force: true })
}

export async function configureJobs(
  server: FastifyInstance,
  options: JobsOptions
) {
  const connection = new IORedis({
    host: server.config.env.REDIS_HOSTNAME,
    port: server.config.env.REDIS_PORT,
    maxRetriesPerRequest: null,
  })

  // Subscription connection for notifications on key creations.
  const sub = new IORedis({
    host: server.config.env.REDIS_HOSTNAME,
    port: server.config.env.REDIS_PORT
  })
  sub.on('ready', async () => {
    // Get notifications for SET commands.
    await sub.config("SET", "notify-keyspace-events", "K$s");
  })

  // Clear the cache, if needed.
  if (options?.beforeConfigure?.clearCache) {
    server.log.info({}, 'clearing existing cache')
    clearCache(connection)
  }

  // Queue for jobs that clean up conversion results.
  const cleanupQueue = new Queue('cleanup', {
    connection,
    defaultJobOptions: {
      attempts: 8,
      backoff: {
        type: 'exponential',
        delay: 30_000
      },
      removeOnComplete: true,
      removeOnFail: true,
    }
  })

  // Queue for conversions to be processed.
  const conversionQueue = new Queue('convert', {
    connection,
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: true,
      attempts: 1,
    }
  })

  // Clear all jobs, if needed.
  if (options?.beforeConfigure?.clearJobs) {
    server.log.info({}, 'clearing left-over jobs')
    clearAllJobs(conversionQueue)
    clearAllJobs(cleanupQueue)
  }

  const subscribeToKeysFor = async (conversionKey: ConversionKey) => {
    await sub.subscribe(keyspaceMessageFor(readKeyFor(conversionKey)))
    await sub.subscribe(keyspaceMessageFor(errorKeyFor(conversionKey)))
  }

  const unsubscribeFromKeysFor = async (conversionKey: ConversionKey) => {
    await sub.unsubscribe(keyspaceMessageFor(readKeyFor(conversionKey)))
    await sub.unsubscribe(keyspaceMessageFor(errorKeyFor(conversionKey)))
  }

  // Queues or re-queues a cleanup job for the given conversion key.
  // Should be called after conversion finished or whenever a conversion
  // is requested again and the existing result should be kept alive.
  const queueCleanupJobForConversionKey =
    async (conversionKey: ConversionKey) => {
      // Remove any existing cleanup job first.
      const jobId = cleanupJobIdFor(conversionKey)
      const existingJob: Job | null = await cleanupQueue.getJob(jobId)
      if (existingJob) {
        await existingJob.remove()
      }
      const removedExisting = !!existingJob
      const delay = server.config.env.CONVERSION_RESULT_TTL
      server.log.info({ delay, conversionKey },
        `${removedExisting ? 'delaying queued' : 'queueing'} cleanup job`)
      await cleanupQueue.add('cleanup', { conversionKey }, { jobId, delay })
    }

  // Each request gets on conversion job which converts a video
  // according to the specifications in the conversion key.
  // A conversion result is stored for a certain amount of time
  // and then discarded once it expires. Repeated conversion jobs
  // for the same conversion key keep an existing conversion result alive.
  const conversionWorker = new Worker('convert', async (job) => {

    // FIXME validate job data
    const conversionToken = job.data.token as string
    const conversionKey = job.data.conversionKey as ConversionKey
    const writeKey = writeKeyFor(conversionKey)
    const readKey = readKeyFor(conversionKey)
    const dataKey = dataKeyFor(conversionKey)

    // Simple defer-style fail task accumulation.
    // Tasks are run in reverse order when fail() is called.
    const failTasks: ((err: Error) => {})[] = []
    const fail = async (err: any) => {
      for (const task of failTasks.toReversed()) {
        try {
          task(asError(err))
        }
        catch (err) {
          server.log.error(err, 'error in fail task')
        }
      }
      try {
        // Make the error available for consumers.
        await connection.set(errorKeyFor(conversionKey), stringifyError(err))
      }
      catch { }
    }

    // Set the read and write key for this conversion key.
    // Using "NX" ensures that there is only one conversion job writing.
    // If it exists, then another worker is already doing the conversion.
    if (await connection.set(writeKey, 1, 'NX') !== 'OK') {
      server.log.debug({ writeKey }, 'write key already exists')
      return
    }

    // Make sure that we're not in writing state anymore on failure.
    failTasks.push(async () => {
      server.log.debug('fail task: setting write key to 0')
      await connection.set(writeKey, 0)
    })

    server.log.info({
      jobId: job.id,
      token: conversionToken,
      key: conversionKey
    }, 'converting video')

    // Subscribe to notifications for relevant cache keys.
    try {
      await subscribeToKeysFor(conversionKey)
    }
    catch (err) {
      fail('failed to subscribe to conversion cache key changes')
      throw err
    }

    // Get a readable stream for the converted content.
    let stream: Readable
    try {
      stream = await fetchConvertedContent(server, conversionKey)
    }
    catch (err) {
      fail('failed to create conversion stream')
      throw err
    }

    // Make sure the stream is destroyed on failure.
    failTasks.push(async (err) => {
      server.log.debug('fail task: destroying stream')
      stream.destroy(err)
    })

    try {
      // Wait for the stream to be readable, then set the read key.
      // That way, when an HTTP request waits for the read key to be set,
      // it is guaranteed that data is available for reading, which makes
      // any timeouts until data is available more accurate.
      await once(stream, 'readable')
      if (await connection.set(readKey, 0) !== 'OK') {
        throw new Error(`failed to set read key: ${readKey}`)
      }
    }
    catch (err) {
      fail('failed to wait for conversion stream data')
      throw err
    }

    // Stream the chunks to the database.
    const eof = async () => await connection.xadd(dataKey, '*', 'eof', '1')

    // Make sure that eof is set for the data on any errors.
    failTasks.push(async () => {
      server.log.debug('fail task: writing eof for data')
      eof()
    })

    try {
      for await (const chunk of stream) {
        await connection.xadd(dataKey, '*', 'chunk', chunk.toString('latin1'))
      }
      await eof()
    }
    catch (err) {
      if (err instanceof ReplyError && (err as any).command) {
        // This can contain chunk data, we don't want to log that.
        delete (err as any).command['args']
      }
      fail('conversion data streaming failed')
      throw err
    }

    if (await connection.set(writeKey, 0) !== 'OK') {
      throw new Error(`failed to set write key to 0: ${writeKey}`)
    }
  }, {
    connection,
    concurrency: server.config.env.CONVERSION_JOB_CONCURRENCY,
  })

  conversionWorker.on('completed', async (job) => {
    // Whenever a conversion has completed, which includes cases where
    // the conversion result already existed and the conversion job stopped.
    if (job.id !== undefined) {
      const conversionKey = job.data.conversionKey as ConversionKey
      await queueCleanupJobForConversionKey(conversionKey)
    }
  })

  conversionWorker.on('error', (err) => {
    server.log.error(err, 'conversion worker error')
  })

  conversionWorker.on('failed', (job, err) => {
    const { id: jobId, data: data } = job || {} as any
    server.log.error({ jobId, data, err }, 'conversion job failed')
  })

  // Cleans up any conversion results that are expired.
  const cleanupWorker = new Worker('cleanup', async (job) => {
    const conversionKey = job.data.conversionKey as ConversionKey

    // Only delete the conversion result when it's neither
    // being written to, nor being read by an HTTP client.
    const result = await connection.eval(`
      local write = redis.call("get", KEYS[1])
      local read = redis.call("get", KEYS[2])
      if (not write or write == "0") and (not read or read == "0") then
        redis.call("del", KEYS[3], KEYS[1], KEYS[2])
        return 1
      end
      return 0`,
      3,
      writeKeyFor(conversionKey),
      readKeyFor(conversionKey),
      dataKeyFor(conversionKey)
    )

    if (result !== 1) {
      server.log.warn({ conversionKey }, 'conversion result is still in use')
      throw new Error('conversion result is still in use')
    }
  }, {
    connection,
    concurrency: 1,
  })

  cleanupWorker.on('completed', async (job) => {
    const conversionKey = job.data.conversionKey as ConversionKey
    server.log.info({ conversionKey }, 'cleaned up conversion result')
    await unsubscribeFromKeysFor(conversionKey)
  })

  cleanupWorker.on('error', (err) => {
    server.log.error(err, 'cleanup worker error')
  })

  cleanupWorker.on('failed', (job, err) => {
    const { id: jobId, data: data } = job || {} as any
    server.log.error({ jobId, data, err }, 'cleanup job failed')
  })

  server.decorate('jobs', conversionQueue)
  server.decorate('jobsSub', sub)
  server.decorate('jobsConnection', connection)

  server.addHook('onClose', async () => {
    await Promise.all([
      conversionQueue.close(),
      conversionWorker.close(),
      cleanupQueue.close(),
      cleanupWorker.close(),
      connection.quit(),
    ])
  })
}

export async function createConversionResultStream(
  server: FastifyInstance,
  conversionKey: ConversionKey,
  options: {
    waitTimeout?: number
  }
): Promise<Readable> {
  const readKey = readKeyFor(conversionKey)
  const errorKey = errorKeyFor(conversionKey)

  // Wait for either the read key or the error key to be set.
  let waitResult
  try {
    waitResult = await Promise.race([
      waitForKey(server, readKey, options?.waitTimeout).then(() => 'read'),
      waitForKey(server, errorKey, options?.waitTimeout).then(() => 'error'),
    ]) as 'read' | 'error'
  }
  catch {
    throw new Error('timed out waiting for conversion result')
  }

  // Propagate any stored error to the caller
  if (waitResult === 'error') {
    let message: string | null
    try {
      message = await server.jobsConnection.get(errorKey)
      if (message === null) {
        throw new Error('failed to read conversion error')
      }
    }
    catch (err) {
      throw err
    }
    throw new Error(message)
  }
  console.assert(waitResult === 'read')

  // Increment the use count of the conversion result.
  const result = await server.jobsConnection.eval(`
    if redis.call("exists", KEYS[1]) == 1 then
      return redis.call("incr", KEYS[1])
    else
      return nil
    end`,
    1,
    readKey
  )
  if (result === null) {
    throw new Error("missing read key")
  }

  let lastId = '0'
  const dataKey = dataKeyFor(conversionKey)
  const stream = new Readable({
    read() { }
  })

  const poll = async () => {
    try {
      while (!stream.destroyed) {
        const res = await server.jobsConnection.xread(
          'BLOCK', 1000,
          'STREAMS', dataKey, lastId
        )

        if (!res) continue

        const [[, entries]] = res
        for (const [id, fields] of entries) {
          lastId = id

          const chunkIdx = fields.indexOf('chunk')
          const eofIdx = fields.indexOf('eof')

          if (chunkIdx !== -1) {
            const chunk = fields[chunkIdx + 1]
            await new Promise(resolve => setTimeout(resolve, 1))
            const canContinue = stream.push(Buffer.from(chunk, 'latin1'))
            if (!canContinue) {
              // FIXME This is never triggered when the stream is passed to
              // Fastify's send() response method. Should be fixed to properly
              // implement backpressure.
              // await new Promise(resolve => stream.once('drain', resolve))
            }
          }

          if (eofIdx !== -1) {
            stream.push(null)
            return
          }
        }
      }
    } catch (err: any) {
      stream.destroy(err || undefined)
    }
  }

  stream.once('close', async () => {
    await server.jobsConnection.decr(readKey)
  })

  // Destroy the stream immediately, if any error is stored in the cache.
  try {
    const message = await server.jobsConnection.get(errorKeyFor(conversionKey))
    if (message) {
      const err = new Error(message)
      server.log.error({ err, conversionKey }, 'destroying stream prematurely')
      stream.destroy(err)
    }
  }
  catch { }

  poll()

  return stream
}
