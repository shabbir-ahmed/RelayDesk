import { createAccountWorkspace, signupSchema } from '@/server/accounts'
import { db } from '@/server/db'
import { appMode, webEnv } from '@/server/env'
import { ApiError, json, parse, readJson, respond } from '@/server/http'
import { limitRegistration } from '@/server/login-limiter'
import { beginSession, requireOrigin } from '@/server/operator'

export async function POST(request: Request) {
  return respond(async () => {
    if (appMode() !== 'private') throw new ApiError(404, 'NOT_FOUND', 'Signup is available on private instances.')
    const config = webEnv()
    requireOrigin(request, config)
    const input = parse(signupSchema, await readJson(request, 2 * 1024))
    limitRegistration('signup')
    const account = await createAccountWorkspace(db(), input)
    await beginSession(config, { ...account, environment: 'TEST' })
    return json({ created: true }, 201)
  })
}
