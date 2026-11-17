import { ApiError, unauthorized } from './http'

const limit = 5
const windowMs = 60_000
const failuresByWorkspace = new Map<string, { expires: number; attempts: number }>()

export function checkLogin(matches: boolean, scope = 'demo', now = Date.now()) {
  for (const [key, bucket] of failuresByWorkspace) {
    if (now >= bucket.expires) failuresByWorkspace.delete(key)
  }

  const previous = failuresByWorkspace.get(scope)
  if (previous && previous.attempts >= limit) {
    throw new ApiError(429, 'RATE_LIMITED', 'Too many sign-in attempts. Try again in a minute.')
  }
  if (!matches) {
    failuresByWorkspace.set(scope, {
      expires: previous?.expires ?? now + windowMs,
      attempts: (previous?.attempts ?? 0) + 1,
    })
    throw unauthorized()
  }
  failuresByWorkspace.delete(scope)
}
