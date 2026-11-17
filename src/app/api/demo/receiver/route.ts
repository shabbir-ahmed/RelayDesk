import { matchesSecret } from '@/server/credentials'
import { webEnv } from '@/server/env'
import { json, readJson, respond, unauthorized } from '@/server/http'

export async function POST(request: Request) {
  return respond(async () => {
    const credential = request.headers.get('authorization') ?? ''
    if (!matchesSecret(credential, `Bearer ${webEnv().RECEIVER_SECRET}`)) throw unauthorized()
    await readJson(request, 96 * 1024)
    return json({ received: true })
  })
}
