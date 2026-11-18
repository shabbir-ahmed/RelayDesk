import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { ApiError } from './http'

const saltSize = 16
const keySize = 32
const options = { N: 2 ** 15, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }
const dummyHash = 'scrypt-v1:' + '0'.repeat(saltSize * 2) + ':' + '0'.repeat(keySize * 2)
let active = 0

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (active >= 2) throw new ApiError(429, 'RATE_LIMITED', 'Sign-in is busy. Try again shortly.')
  active++
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, keySize, options, (error, key) => error ? reject(error) : resolve(key))
    })
  } finally {
    active--
  }
}

export async function hashPassword(password: string) {
  const salt = randomBytes(saltSize)
  const key = await derive(password, salt)
  return `scrypt-v1:${salt.toString('hex')}:${key.toString('hex')}`
}

export async function verifyPassword(password: string, stored?: string | null) {
  const valid = stored && /^scrypt-v1:[0-9a-f]{32}:[0-9a-f]{64}$/.test(stored)
  const [, salt, key] = (valid ? stored : dummyHash).split(':')
  const expected = Buffer.from(key, 'hex')
  const actual = await derive(password, Buffer.from(salt, 'hex'))
  return expected.length === actual.length && timingSafeEqual(actual, expected) && Boolean(valid)
}
