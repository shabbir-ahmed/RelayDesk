import { z } from 'zod'
import { webEnv } from '@/server/env'
import { json, parse, readJson, respond } from '@/server/http'
import { checkLogin } from '@/server/login-limiter'
import { beginSession, requireOrigin } from '@/server/operator'

const body = z.strictObject({ credential: z.string().min(1).max(256) })

export async function POST(request: Request) {
  return respond(async () => {
    const config = webEnv()
    requireOrigin(request, config)
    const { credential } = parse(body, await readJson(request, 2 * 1024))
    checkLogin(credential, config.OPERATOR_CREDENTIAL)
    await beginSession(config)
    return json({ operator: true })
  })
}
