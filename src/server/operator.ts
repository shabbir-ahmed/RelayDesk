import { createHash } from 'node:crypto'
import { EncryptJWT, jwtDecrypt } from 'jose'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { apiKeyWorkspace } from './api-keys'
import { db } from './db'
import { demoScope } from './demo'
import { appMode, demoWebEnv, webEnv, type AppMode } from './env'
import { ApiError, unauthorized } from './http'
import { matchesSecret } from './credentials'

const ttlSeconds = 4 * 60 * 60
const issuer = 'relaydesk'

export type WorkspaceScope = { mode: AppMode; workspaceId: string }

function sessionConfig(config: ReturnType<typeof webEnv>) {
  const secure = new URL(config.APP_ORIGIN).protocol === 'https:'
  return {
    name: secure ? '__Host-relaydesk-operator' : 'relaydesk-operator',
    key: createHash('sha256').update(config.SESSION_SECRET).digest(),
    options: { secure, httpOnly: true, sameSite: 'lax' as const, path: '/' },
  }
}

export async function operatorSession(config?: ReturnType<typeof webEnv>): Promise<WorkspaceScope | null> {
  const store = await cookies()
  const { name, key } = sessionConfig(config ?? webEnv())
  const token = store.get(name)?.value
  if (!token || token.length > 1_024) return null
  try {
    const { payload } = await jwtDecrypt(token, key, {
      issuer, audience: issuer, subject: 'operator', maxTokenAge: ttlSeconds,
      keyManagementAlgorithms: ['dir'], contentEncryptionAlgorithms: ['A256GCM'],
      requiredClaims: ['iat', 'exp'],
    })
    const mode = appMode()
    if (mode === 'demo') return payload.workspaceId === undefined ? demoScope : null
    const workspace = z.uuid().safeParse(payload.workspaceId)
    return workspace.success && workspace.data !== demoScope.workspaceId ? { mode, workspaceId: workspace.data } : null
  } catch {
    return null
  }
}

export async function beginSession(config: ReturnType<typeof webEnv>, workspaceId?: string) {
  const { name, key, options } = sessionConfig(config)
  const token = await new EncryptJWT(workspaceId ? { workspaceId } : {})
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt().setExpirationTime('4h').setIssuer(issuer).setAudience(issuer)
    .setSubject('operator').encrypt(key)
  const store = await cookies()
  store.set(name, token, { ...options, maxAge: ttlSeconds })
}

export async function destroySession() {
  const { name, options } = sessionConfig(webEnv())
  const store = await cookies()
  store.set(name, '', { ...options, maxAge: 0 })
}

export function requireOrigin(request: Request, config: ReturnType<typeof webEnv>) {
  if (request.headers.get('origin') !== config.APP_ORIGIN) {
    throw new ApiError(403, 'FORBIDDEN', 'This request must come from the configured app origin.')
  }
}

export async function deliveryReadScope() {
  if (appMode() === 'demo') return demoScope
  const scope = await operatorSession()
  if (!scope) throw unauthorized()
  return scope
}

export async function authorizeMutation(request: Request, allowApiToken = false): Promise<WorkspaceScope> {
  const config = webEnv()
  const header = request.headers.get('authorization')
  const mode = appMode()
  if (allowApiToken && header === null && mode === 'private') throw unauthorized()
  if (allowApiToken && header !== null) {
    if (header.length > 263 || !header.startsWith('Bearer ')) throw unauthorized()
    const token = header.slice(7)
    if (mode === 'demo') {
      if (!matchesSecret(token, demoWebEnv().API_TOKEN)) throw unauthorized()
      return demoScope
    }
    const workspaceId = await apiKeyWorkspace(db(), token)
    if (!workspaceId) throw unauthorized()
    return { mode: 'private', workspaceId }
  }
  const scope = await operatorSession(config)
  if (!scope) throw unauthorized()
  requireOrigin(request, config)
  return scope
}

export async function privateSession() {
  const scope = await operatorSession()
  if (scope?.mode !== 'private') throw unauthorized()
  return scope
}
