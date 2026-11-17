import { json, respond } from '@/server/http'
import { authorizeMutation, destroySession } from '@/server/operator'

export async function POST(request: Request) {
  return respond(async () => {
    await authorizeMutation(request)
    await destroySession()
    return json({ operator: false })
  })
}
