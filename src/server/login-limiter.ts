import { ApiError, unauthorized } from './http'

const limit = 5
const windowMs = 60_000
const failuresByWorkspace = new Map<string, { expires: number; attempts: number }>()

export function assertLoginAllowed(scope = 'demo', now = Date.now()) {
  for (const [key, bucket] of failuresByWorkspace) {
    if (now >= bucket.expires) failuresByWorkspace.delete(key)
  }

  const previous = failuresByWorkspace.get(scope)
  if (previous && previous.attempts >= limit) {
    throw new ApiError(429, 'RATE_LIMITED', 'Too many sign-in attempts. Try again in a minute.')
  }
  return previous
}

export function checkLogin(matches: boolean, scope = 'demo', now = Date.now()) {
  const previous = assertLoginAllowed(scope, now)
  if (!matches) {
    failuresByWorkspace.set(scope, {
      expires: previous?.expires ?? now + windowMs,
      attempts: (previous?.attempts ?? 0) + 1,
    })
    throw unauthorized()
  }
  failuresByWorkspace.delete(scope)
}

const registration = { signup: { count: 0, until: 0 }, join: { count: 0, until: 0 } }

export function limitRegistration(kind: keyof typeof registration, now = Date.now()) {
  const bucket = registration[kind]
  if (now >= bucket.until) {
    bucket.count = 0
    bucket.until = now + 60_000
  }
  if (bucket.count >= 20) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Try again in a minute.')
  bucket.count++
}
