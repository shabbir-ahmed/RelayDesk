import { z } from 'zod'
import { usernameSchema } from '@/server/accounts'
import { matchesDigest, matchesSecret } from '@/server/credentials'
import { db } from '@/server/db'
import { appMode, demoWebEnv, webEnv } from '@/server/env'
import { json, parse, readJson, respond, unauthorized } from '@/server/http'
import { clearAuthLimit, limitAuth } from '@/server/login-limiter'
import { beginSession, requireOrigin } from '@/server/operator'
import { verifyPassword } from '@/server/password'
import { workspaceSlug } from '@/server/workspaces'

const credential = z.string().min(1).max(256)
const demoBody = z.strictObject({ credential })
const workspaceBody = z.strictObject({ credential, workspace: workspaceSlug, username: usernameSchema.optional() })
const unusedDigest = '0'.repeat(64)

export async function POST(request: Request) {
  return respond(async () => {
    const config = webEnv()
    requireOrigin(request, config)
    const input = await readJson(request, 2 * 1024)

    if (appMode() === 'demo') {
      const { credential } = parse(demoBody, input)
      const database = db()
      const windowStart = await limitAuth(database, 'demo')
      if (!matchesSecret(credential, demoWebEnv().OPERATOR_CREDENTIAL)) throw unauthorized()
      await clearAuthLimit(database, 'demo', windowStart)
      await beginSession(config)
      return json({ operator: true })
    }

    const { credential, workspace, username } = parse(workspaceBody, input)
    const database = db()
    const entry = await database.workspace.findUnique({
      where: { slug: workspace }, select: { id: true, credentialDigest: true },
    })
    if (username) {
      const membership = entry && await database.membership.findFirst({
        where: { workspaceId: entry.id, account: { username } },
        select: { accountId: true, sessionId: true, account: { select: { passwordHash: true, sessionVersion: true } } },
      })
      const bucket = 'login:' + (entry ? entry.id + ':' + (membership?.accountId ?? 'unknown') : 'unknown')
      const windowStart = await limitAuth(database, bucket)
      const valid = await verifyPassword(credential, membership?.account.passwordHash)
      if (!entry || !membership || !valid) throw unauthorized()
      await clearAuthLimit(database, bucket, windowStart)
      await beginSession(config, {
        workspaceId: entry.id, accountId: membership.accountId, environment: 'TEST',
        memberSessionId: membership.sessionId, sessionVersion: membership.account.sessionVersion,
      })
    } else {
      const bucket = 'legacy:' + (entry?.id ?? 'unknown')
      const windowStart = await limitAuth(database, bucket)
      if (!matchesDigest(credential, entry?.credentialDigest ?? unusedDigest) || !entry?.credentialDigest) throw unauthorized()
      await clearAuthLimit(database, bucket, windowStart)
      await beginSession(config, { workspaceId: entry.id, environment: 'LIVE' })
    }
    return json({ operator: true })
  })
}
