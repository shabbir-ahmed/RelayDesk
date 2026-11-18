import { createHash } from 'node:crypto'
import { EncryptJWT, jwtDecrypt, type JWTPayload } from 'jose'
import { cookies } from 'next/headers'
import { cache } from 'react'
import { z } from 'zod'
import { environments, environmentHeader, type Environment } from '../shared/delivery'
import { apiKeyWorkspace } from './api-keys'
import { db } from './db'
import { demoScope } from './demo'
import { appMode, demoWebEnv, webEnv } from './env'
import { ApiError, unauthorized } from './http'
import { matchesSecret } from './credentials'

const ttlSeconds = 4 * 60 * 60
const issuer = 'relaydesk'
const environmentSchema = z.enum(environments)

type NamedAccount = { accountId: string; memberSessionId: string; sessionVersion: number }
type PrivateSession = {
  mode: 'private'; workspaceId: string; environment: Environment; role: 'OWNER' | 'MEMBER'; actor: string
} & (NamedAccount | { accountId?: undefined })
type SessionSelection = { workspaceId: string; environment: Environment } & (NamedAccount | { accountId?: undefined })
type SessionScope = typeof demoScope | PrivateSession
type SubmissionScope = typeof demoScope | Pick<PrivateSession, 'mode' | 'workspaceId' | 'environment'>

function sessionConfig(config: ReturnType<typeof webEnv>) {
  const secure = new URL(config.APP_ORIGIN).protocol === 'https:'
  return {
    name: secure ? '__Host-relaydesk-operator' : 'relaydesk-operator',
    key: createHash('sha256').update(config.SESSION_SECRET).digest(),
    options: { secure, httpOnly: true, sameSite: 'lax' as const, path: '/' },
  }
}

export const operatorSession = cache(async function operatorSession(config?: ReturnType<typeof webEnv>): Promise<SessionScope | null> {
  const store = await cookies()
  const { name, key } = sessionConfig(config ?? webEnv())
  const token = store.get(name)?.value
  if (!token || token.length > 1_024) return null
  let payload: JWTPayload
  try {
    const verified = await jwtDecrypt(token, key, {
      issuer, audience: issuer, subject: 'operator', maxTokenAge: ttlSeconds,
      keyManagementAlgorithms: ['dir'], contentEncryptionAlgorithms: ['A256GCM'],
      requiredClaims: ['iat', 'exp'],
    })
    payload = verified.payload
  } catch {
    return null
  }
  if (appMode() === 'demo') return payload.workspaceId === undefined ? demoScope : null
  const workspace = z.uuid().safeParse(payload.workspaceId)
  const selection = environmentSchema.safeParse(payload.environment ?? 'LIVE')
  if (!workspace.success || !selection.success || workspace.data === demoScope.workspaceId) return null
  const workspaceId = workspace.data
  const environment = selection.data
  if (payload.accountId === undefined) {
    const legacy = await db().workspace.findUnique({ where: { id: workspaceId }, select: { credentialDigest: true } })
    return legacy?.credentialDigest ? { mode: 'private', workspaceId, environment, role: 'OWNER', actor: 'Legacy operator' } : null
  }
  const account = z.uuid().safeParse(payload.accountId)
  if (!account.success) return null
  const accountId = account.data
  const member = await db().membership.findUnique({
    where: { workspaceId_accountId: { workspaceId, accountId } },
    select: { role: true, sessionId: true, account: { select: { username: true, sessionVersion: true } } },
  })
  if (!member || member.sessionId !== payload.memberSessionId || member.account.sessionVersion !== payload.sessionVersion) return null
  return {
    mode: 'private', workspaceId, environment, accountId, role: member.role, actor: member.account.username,
    memberSessionId: member.sessionId, sessionVersion: member.account.sessionVersion,
  }
})

export async function beginSession(
  config: ReturnType<typeof webEnv>, workspace?: SessionSelection,
) {
  const { name, key, options } = sessionConfig(config)
  const claims = workspace
    ? {
      workspaceId: workspace.workspaceId, environment: workspace.environment,
      ...(workspace.accountId !== undefined && {
        accountId: workspace.accountId, memberSessionId: workspace.memberSessionId, sessionVersion: workspace.sessionVersion,
      }),
    }
    : {}
  const token = await new EncryptJWT(claims)
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

function requireActiveEnvironment(request: Request, scope: SessionScope) {
  const requested = request.headers.get(environmentHeader)
  if (scope.mode === 'private' && requested !== null && requested !== scope.environment) {
    throw new ApiError(409, 'CONFLICT', 'The active environment changed. Reload this page before continuing.')
  }
}

export async function deliveryReadScope(request: Request) {
  if (appMode() === 'demo') return demoScope
  return privateSession(request)
}

export function authorizeMutation(request: Request): Promise<SessionScope>
export function authorizeMutation(request: Request, allowApiToken: true): Promise<SubmissionScope>
export async function authorizeMutation(request: Request, allowApiToken = false): Promise<SubmissionScope> {
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
    const scope = await apiKeyWorkspace(db(), token)
    if (!scope) throw unauthorized()
    return { mode: 'private', ...scope }
  }
  const scope = await operatorSession(config)
  if (!scope) throw unauthorized()
  requireOrigin(request, config)
  // Logout and environment selection use the current session even from an older open tab.
  const path = new URL(request.url).pathname
  if (path !== '/api/operator/logout' && path !== '/api/environment') requireActiveEnvironment(request, scope)
  return scope
}

export async function privateSession(request?: Request) {
  const scope = await operatorSession()
  if (scope?.mode !== 'private') throw unauthorized()
  if (request) requireActiveEnvironment(request, scope)
  return scope
}

export function requireOwner(scope: SessionScope): asserts scope is PrivateSession {
  if (scope.mode !== 'private' || scope.role !== 'OWNER') {
    throw new ApiError(403, 'FORBIDDEN', 'Only workspace owners can perform this action.')
  }
}
