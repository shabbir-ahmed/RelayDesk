import { setTimeout as sleep } from 'node:timers/promises'
import { z } from 'zod'
import { timing } from '../worker/timing'
import { ApiError, decodeJson, json, readBytes, unauthorized } from './http'
import { verifySignature } from './signing'

const envelope = z.object({ id: z.uuid(), type: z.string(), createdAt: z.iso.datetime(), payload: z.object({}).passthrough() })

export async function receive(request: Request, secret: string) {
  const body = await readBytes(request, 96 * 1024)
  const metadata = verifySignature(secret, request.headers, body)
  if (!metadata) throw unauthorized()
  const event = envelope.safeParse(decodeJson(body))
  if (!event.success || event.data.id !== metadata.eventId) throw unauthorized()

  if (metadata.mode === 'TIMEOUT') await sleep(timing.receiverTimeoutMs)
  if (metadata.mode === 'ALWAYS_FAIL' || (metadata.mode === 'FAIL_TWICE' && metadata.attempt < 3)) {
    throw new ApiError(503, 'UNAVAILABLE', 'The controlled receiver simulated a dependency failure.')
  }
  return json({ received: true, eventId: metadata.eventId })
}
