import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { receiverModes, type ReceiverMode } from '../shared/delivery'
import { maxAttempts, maxReplayCycles, timing } from '../worker/timing'

type Metadata = {
  eventId: string
  deliveryId: string
  cycle: number
  attempt: number
  timestamp: number
  mode: ReceiverMode
}

const headers = {
  eventId: 'x-relaydesk-event',
  deliveryId: 'x-relaydesk-delivery',
  cycle: 'x-relaydesk-cycle',
  attempt: 'x-relaydesk-attempt',
  timestamp: 'x-relaydesk-timestamp',
  mode: 'x-relaydesk-mode',
  signature: 'x-relaydesk-signature',
}

const schema = z.object({
  eventId: z.string().length(36).pipe(z.uuid()),
  deliveryId: z.string().length(36).pipe(z.uuid()),
  cycle: z.string().regex(/^[1-9]$/).transform(Number).pipe(z.number().max(1 + maxReplayCycles)),
  attempt: z.string().regex(/^[1-9]$/).transform(Number).pipe(z.number().max(maxAttempts)),
  timestamp: z.string().regex(/^[1-9]\d{0,9}$/).transform(Number),
  mode: z.enum(receiverModes),
  signature: z.string().regex(/^v1=[0-9a-f]{64}$/),
})

function digest(secret: string, metadata: Metadata, body: Uint8Array | string) {
  const { eventId, deliveryId, cycle, attempt, timestamp, mode } = metadata
  const prefix = JSON.stringify(['relaydesk-v1', eventId, deliveryId, cycle, attempt, timestamp, mode]) + '\n'
  return createHmac('sha256', secret).update(prefix).update(body).digest()
}

export function signedHeaders(secret: string, metadata: Metadata, body: string) {
  return {
    [headers.eventId]: metadata.eventId,
    [headers.deliveryId]: metadata.deliveryId,
    [headers.cycle]: String(metadata.cycle),
    [headers.attempt]: String(metadata.attempt),
    [headers.timestamp]: String(metadata.timestamp),
    [headers.mode]: metadata.mode,
    [headers.signature]: 'v1=' + digest(secret, metadata, body).toString('hex'),
  }
}

export function verifySignature(secret: string, requestHeaders: Headers, body: Uint8Array, now = Date.now()) {
  const result = schema.safeParse(Object.fromEntries(
    Object.entries(headers).map(([key, name]) => [key, requestHeaders.get(name)]),
  ))
  if (!result.success) return null
  const { signature, ...metadata } = result.data
  if (Math.abs(Math.floor(now / 1_000) - metadata.timestamp) > timing.signatureWindowSeconds) return null
  if (!timingSafeEqual(digest(secret, metadata, body), Buffer.from(signature.slice(3), 'hex'))) return null
  return metadata
}
