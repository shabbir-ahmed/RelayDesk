import { createHash } from 'node:crypto'
import { EncryptJWT, jwtDecrypt } from 'jose'
import { cookies } from 'next/headers'
import { webEnv } from './env'
import { ApiError, unauthorized } from './http'
import { matchesSecret } from './credentials'

const ttlSeconds = 4 * 60 * 60
const issuer = 'relaydesk'

function sessionConfig(config: ReturnType<typeof webEnv>) {
  const secure = new URL(config.APP_ORIGIN).protocol === 'https:'
  return {
    name: secure ? '__Host-relaydesk-operator' : 'relaydesk-operator',
    key: createHash('sha256').update(config.SESSION_SECRET).digest(),
    options: { secure, httpOnly: true, sameSite: 'lax' as const, path: '/' },
  }
}

export async function hasOperatorSession(config?: ReturnType<typeof webEnv>) {
  const store = await cookies()
  const { name, key } = sessionConfig(config ?? webEnv())
  const token = store.get(name)?.value
  if (!token || token.length > 1_024) return false
  try {
    const { payload } = await jwtDecrypt(token, key, {
      issuer, audience: issuer, subject: 'operator', maxTokenAge: ttlSeconds,
      keyManagementAlgorithms: ['dir'], contentEncryptionAlgorithms: ['A256GCM'],
      requiredClaims: ['iat', 'exp'],
    })
    return payload.sub === 'operator'
  } catch {
    return false
  }
}

export async function beginSession(config: ReturnType<typeof webEnv>) {
  const { name, key, options } = sessionConfig(config)
  const token = await new EncryptJWT({})
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt().setExpirationTime('4h').setIssuer(issuer).setAudience(issuer)
    .setSubject('operator').encrypt(key)
  const store = await cookies()
  store.set(name, token, { ...options, maxAge: ttlSeconds })
}

export async function destroySession(config: ReturnType<typeof webEnv>) {
  const { name, options } = sessionConfig(config)
  const store = await cookies()
  store.set(name, '', { ...options, maxAge: 0 })
}

export function requireOrigin(request: Request, config: ReturnType<typeof webEnv>) {
  if (request.headers.get('origin') !== config.APP_ORIGIN) {
    throw new ApiError(403, 'FORBIDDEN', 'This request must come from the configured app origin.')
  }
}

export async function authorizeMutation(request: Request, allowApiToken = false) {
  const config = webEnv()
  const header = request.headers.get('authorization')
  if (allowApiToken && header !== null) {
    if (header.length > 263 || !header.startsWith('Bearer ') || !matchesSecret(header.slice(7), config.API_TOKEN)) {
      throw unauthorized()
    }
    return config
  }
  if (!await hasOperatorSession(config)) throw unauthorized()
  requireOrigin(request, config)
  return config
}
