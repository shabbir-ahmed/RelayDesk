import { z } from 'zod'
import { issueRecoveryCode } from '@/server/accounts'
import { db } from '@/server/db'
import { json, parse, readJson, respond, unauthorized } from '@/server/http'
import { limitAuth } from '@/server/login-limiter'
import { authorizeMutation } from '@/server/operator'
import { verifyPassword } from '@/server/password'

const body = z.strictObject({ password: z.string().min(1).max(128) })

export async function POST(request: Request) {
  return respond(async () => {
    const scope = await authorizeMutation(request)
    if (scope.mode !== 'private' || scope.accountId === undefined) throw unauthorized()
    const { password } = parse(body, await readJson(request, 1024))
    const database = db()
    await limitAuth(database, 'recovery-code:' + scope.accountId)
    const entry = await database.account.findUnique({
      where: { id: scope.accountId }, select: { passwordHash: true },
    })
    if (!await verifyPassword(password, entry?.passwordHash)) throw unauthorized()
    return json({ code: await issueRecoveryCode(database, scope) }, 201)
  })
}
