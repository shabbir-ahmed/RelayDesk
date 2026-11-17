import { appMode, demoWebEnv } from '@/server/env'
import { ApiError, respond } from '@/server/http'
import { receive } from '@/server/receiver'

export async function POST(request: Request) {
  return respond(() => {
    if (appMode() !== 'demo') throw new ApiError(404, 'NOT_FOUND', 'Receiver not found.')
    return receive(request, demoWebEnv().RECEIVER_SECRET)
  })
}
