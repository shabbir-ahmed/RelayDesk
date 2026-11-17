import { ApiError, unauthorized } from './http'
import { matchesSecret } from './credentials'

const limit = 5
const windowMs = 60_000
let blockedUntil = 0
let failures = 0

export function checkLogin(value: string, credential: string, now = Date.now()) {
  if (now >= blockedUntil) {
    failures = 0
    blockedUntil = now + windowMs
  }
  if (failures >= limit) {
    throw new ApiError(429, 'RATE_LIMITED', 'Too many sign-in attempts. Try again in a minute.')
  }
  if (!matchesSecret(value, credential)) {
    failures++
    throw unauthorized()
  }
  failures = 0
}
