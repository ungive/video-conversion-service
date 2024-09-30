import bcrypt from 'bcrypt'
import crypto from 'crypto'
import tmp from 'tmp'

const bcryptSaltRounds = 10

/**
 * Checks the environment for the NODE_ENV value
 * and returns whether the application is running in production mode.
 * @returns Whether the application is running in production mode.
 */
export function isProduction() {
  const nodeEnv = process.env.NODE_ENV || 'development'
  return nodeEnv.toLowerCase() === 'production'
}

/**
 * Hashes a password with bcrypt.
 * @param password The password to hash.
 * @returns The hashed password.
 */
export async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    bcrypt
      .genSalt(bcryptSaltRounds)
      .then(salt => {
        return bcrypt.hash(password, salt)
      })
      .then(hash => {
        resolve(hash)
      })
      .catch(err => {
        reject(err)
      })
  })
}

/**
 * Enables a function to defer any amount of statements (functions).
 * Deferred statements are executed in reverse order.
 * @param func The async function to execute.
 * @returns The return value of the passed function.
 */
export async function deferrable
  (func: (defer: (f: () => Promise<void>) => void) => Promise<any>): Promise<any> {

  let queue: (() => Promise<void>)[] = []
  const result = await func((f) => { queue.push(f) })
  // Call deferred functions in reverse order
  for (let i = queue.length - 1; i >= 0; i--) {
    await queue[i]()
  }
  return result
}

export interface TmpFile {
  path: string
  fd: number
  cleanup: () => void
}

/**
 * Creates a random temporary file on the system.
 * @returns The temporary file instance.
 */
export async function createTempFile(): Promise<TmpFile> {
  return new Promise<TmpFile>((resolve, reject) => {
    tmp.file((err, path, fd, cleanup) => {
      if (err) return reject(err)
      resolve({
        path,
        fd,
        cleanup
      })
    })
  })
}

/**
 * Generates a cryptographically random token.
 * @returns A hex-encoded random token string.
 */
export async function generateRandomToken(size: number = 48): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.randomBytes(size, (err, buf) => {
      if (err) {
        return reject(new Error('failed to generate token', { cause: err }))
      }
      resolve(buf.toString('base64url'))
    })
  })
}

/**
 * Attempts to retry calling a given generator until it does not throw.
 * If the generator throws an exception, it is called again,
 * so long as the maximum number of attempts is not exceeded.
 * If the last attempt throws an exception, that exception is rethrown.
 *
 * @param generator A function to retry calling.
 * @param maxAttempts The maximum amount of attempts.
 * @returns The returned value of the generator.
 */
export async function retry<T>(
  generator: () => Promise<NonNullable<T>>,
  maxAttempts: number = 64
): Promise<NonNullable<T>> {
  if (maxAttempts <= 0) {
    throw new Error('maximum amount of tries must be greater than zero')
  }
  for (let i = 0; ; i++) {
    try {
      return await generator()
    }
    catch (err) {
      if (i >= maxAttempts) {
        throw err
      }
    }
  }
}
