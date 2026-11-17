import { json, respond } from '@/server/http'
import { authorizeMutation, destroySession } from '@/server/operator'

export async function POST(request: Request) {
  return respond(async () => {
    const config = await authorizeMutation(request)
    await destroySession(config)
    return json({ operator: false })
  })
}
