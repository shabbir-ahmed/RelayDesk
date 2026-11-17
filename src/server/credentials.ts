import { createHash, timingSafeEqual } from 'node:crypto'

export function matchesSecret(value: string, secret: string) {
  const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest()
  return timingSafeEqual(digest(value), digest(secret))
}
