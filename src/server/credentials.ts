import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export function secretDigest(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function matchesDigest(value: string, digest: string) {
  const expected = Buffer.from(digest, 'hex')
  const actual = Buffer.from(secretDigest(value), 'hex')
  return expected.length === actual.length && timingSafeEqual(actual, expected)
}

export function matchesSecret(value: string, secret: string) {
  return matchesDigest(value, secretDigest(secret))
}

export function newSecret(prefix: string) {
  return prefix + randomBytes(32).toString('base64url')
}
