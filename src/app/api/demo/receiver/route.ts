import { webEnv } from '@/server/env'
import { respond } from '@/server/http'
import { receive } from '@/server/receiver'

export async function POST(request: Request) {
  return respond(() => receive(request, webEnv().RECEIVER_SECRET))
}
