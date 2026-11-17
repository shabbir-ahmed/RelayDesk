import { createHash, randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import stringify from 'fast-json-stable-stringify'
import { z } from 'zod'
import { receiverModes } from '../shared/delivery'
import { endpointId, workspaceId } from './demo'
import { ApiError } from './http'

const postgresText = (value: string) => !value.includes('\u0000') && value.isWellFormed()

function storableJson(object: Record<string, unknown>) {
  const pending: { value: unknown; depth: number }[] = [{ value: object, depth: 1 }]
  while (pending.length) {
    const { value, depth } = pending.pop()!
    if (depth > 64) return false
    if (typeof value === 'number' && !Number.isFinite(value)) return false
    if (typeof value === 'string' && !postgresText(value)) return false
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (!postgresText(key)) return false
        pending.push({ value: child, depth: depth + 1 })
      }
    }
  }
  return true
}

export const submissionSchema = z.strictObject({
  eventType: z.string().trim().min(1).max(80).refine(postgresText, 'Use valid text.'),
  idempotencyKey: z.string().trim().min(1).max(128).refine(postgresText, 'Use valid text.'),
  payload: z.record(z.string(), z.unknown()).refine(storableJson, 'Use finite JSON values, valid Unicode text, and at most 64 levels of nesting.'),
  receiverMode: z.enum(receiverModes),
})

type Submission = z.infer<typeof submissionSchema>

export function fingerprint({ eventType, payload, receiverMode }: Omit<Submission, 'idempotencyKey'>) {
  return createHash('sha256').update(stringify({ eventType, payload, receiverMode })).digest('hex')
}

export function eventBody(event: { id: string; eventType: string; payload: unknown; createdAt: Date }) {
  return stringify({ id: event.id, type: event.eventType, payload: event.payload, createdAt: event.createdAt.toISOString() })
}

export async function submitEvent(db: PrismaClient, input: Submission, afterEventWrite?: () => void) {
  const requestFingerprint = fingerprint(input)
  try {
    const result = await db.$transaction(async (tx) => {
      const id = randomUUID()
      const createdAt = new Date()
      const event = await tx.event.create({
        data: {
          id, workspaceId, endpointId, requestFingerprint, createdAt,
          eventType: input.eventType,
          idempotencyKey: input.idempotencyKey,
          canonicalBody: eventBody({ id, eventType: input.eventType, payload: input.payload, createdAt }),
          payload: input.payload as Prisma.InputJsonObject,
        },
        select: { id: true },
      })
      afterEventWrite?.()
      const delivery = await tx.delivery.create({
        data: { eventId: event.id, endpointId, receiverMode: input.receiverMode },
        select: { id: true },
      })
      return { eventId: event.id, deliveryId: delivery.id }
    })
    return { ...result, created: true }
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error
    const existing = await db.event.findUnique({
      where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey: input.idempotencyKey } },
      select: { id: true, requestFingerprint: true, deliveries: { where: { endpointId }, select: { id: true } } },
    })
    if (!existing?.deliveries[0]) throw error
    if (existing.requestFingerprint !== requestFingerprint) {
      throw new ApiError(409, 'CONFLICT', 'This idempotency key belongs to a different submission.')
    }
    return { eventId: existing.id, deliveryId: existing.deliveries[0].id, created: false }
  }
}
