import { z } from 'zod'
import { matchesDigest, matchesSecret } from '@/server/credentials'
import { db } from '@/server/db'
import { appMode, demoWebEnv, webEnv } from '@/server/env'
import { json, parse, readJson, respond, unauthorized } from '@/server/http'
import { checkLogin } from '@/server/login-limiter'
import { beginSession, requireOrigin } from '@/server/operator'
import { workspaceSlug } from '@/server/workspaces'

const credential = z.string().min(1).max(256)
const demoBody = z.strictObject({ credential })
const workspaceBody = z.strictObject({ credential, workspace: workspaceSlug })
const unusedDigest = '0'.repeat(64)

export async function POST(request: Request) {
  return respond(async () => {
    const config = webEnv()
    requireOrigin(request, config)
    const input = await readJson(request, 2 * 1024)

    if (appMode() === 'demo') {
      checkLogin(matchesSecret(parse(demoBody, input).credential, demoWebEnv().OPERATOR_CREDENTIAL))
      await beginSession(config)
    } else {
      const { credential, workspace } = parse(workspaceBody, input)
      const entry = await db().workspace.findUnique({
        where: { slug: workspace },
        select: { id: true, credentialDigest: true },
      })
      checkLogin(matchesDigest(credential, entry?.credentialDigest ?? unusedDigest) && Boolean(entry?.credentialDigest), entry?.id ?? 'unknown')
      if (!entry) throw unauthorized()
      await beginSession(config, entry.id)
    }
    return json({ operator: true })
  })
}
