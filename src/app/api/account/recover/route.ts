import { recoverAccount, recoverySchema } from '@/server/accounts'
import { db } from '@/server/db'
import { appMode, webEnv } from '@/server/env'
import { ApiError, json, parse, readJson, respond } from '@/server/http'
import { limitAuth } from '@/server/login-limiter'
import { requireOrigin } from '@/server/operator'

export async function POST(request: Request) {
  return respond(async () => {
    if (appMode() !== 'private') throw new ApiError(404, 'NOT_FOUND', 'Account recovery is available on private instances.')
    requireOrigin(request, webEnv())
    const input = parse(recoverySchema, await readJson(request, 2048))
    const database = db()
    await limitAuth(database, 'recover', 20)
    await recoverAccount(database, input)
    return json({ recovered: true })
  })
}
