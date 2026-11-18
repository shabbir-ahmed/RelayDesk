import { db } from '@/server/db'
import { appMode, webEnv } from '@/server/env'
import { ApiError, json, parse, readJson, respond } from '@/server/http'
import { joinSchema, redeemInvitation } from '@/server/invitations'
import { limitAuth } from '@/server/login-limiter'
import { beginSession, requireOrigin } from '@/server/operator'

export async function POST(request: Request) {
  return respond(async () => {
    if (appMode() !== 'private') throw new ApiError(404, 'NOT_FOUND', 'Invitations are available on private instances.')
    const config = webEnv()
    requireOrigin(request, config)
    const input = parse(joinSchema, await readJson(request, 2 * 1024))
    await limitAuth(db(), 'join', 20)
    const account = await redeemInvitation(db(), input)
    await beginSession(config, { ...account, environment: 'TEST' })
    return json({ joined: true })
  })
}
