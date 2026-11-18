import { createHash, randomUUID } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import stringify from 'fast-json-stable-stringify'
import { z } from 'zod'
import { receiverModes } from '../shared/delivery'
import { ApiError } from './http'
import { demoScope } from './demo'

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

export const workspaceSubmissionSchema = z.strictObject({
  eventType: z.string().trim().min(1).max(80).refine(postgresText, 'Use valid text.'),
  idempotencyKey: z.string().trim().min(1).max(128).refine(postgresText, 'Use valid text.'),
  payload: z.custom<Record<string, unknown>>(
    (value) => value !== null && typeof value === 'object' && !Array.isArray(value),
    'Enter a JSON object.',
  ).refine(storableJson, 'Use finite JSON values, valid Unicode text, and at most 64 levels of nesting.'),
})

export const submissionSchema = workspaceSubmissionSchema.extend({ receiverMode: z.enum(receiverModes) })

type Submission = z.infer<typeof submissionSchema>

class DuplicateSubmission extends Error {}

export function fingerprint({ eventType, payload, receiverMode }: Omit<Submission, 'idempotencyKey'>, isTest = false) {
  return createHash('sha256').update(stringify({ eventType, payload, receiverMode, ...(isTest && { test: true }) })).digest('hex')
}

export function eventBody(event: { id: string; eventType: string; payload: unknown; createdAt: Date; isTest?: boolean }) {
  return stringify({ id: event.id, type: event.eventType, payload: event.payload, createdAt: event.createdAt.toISOString(), ...(event.isTest && { test: true }) })
}

type DestinationScope = { workspaceId: string; endpointId?: string; isTest?: boolean }

async function resolveEndpoints(tx: Prisma.TransactionClient, scope: DestinationScope, eventType: string) {
  const { workspaceId, endpointId, isTest } = scope
  const where = { workspaceId, destinationUrl: { not: null } }
  if (endpointId) {
    const endpoint = await tx.endpoint.findFirst({
      where: workspaceId === demoScope.workspaceId ? { id: endpointId, workspaceId } : { ...where, id: endpointId },
      select: { id: true },
    })
    if (!endpoint) throw new ApiError(404, 'NOT_FOUND', 'Destination not found.')
    return [endpoint]
  }
  if (isTest) {
    const endpoints = await tx.endpoint.findMany({ where, select: { id: true }, take: 2 })
    if (endpoints.length !== 1) {
      throw new ApiError(400, 'INVALID_INPUT', 'Choose an approved destination for the test event.')
    }
    return endpoints
  }
  return tx.endpoint.findMany({
    where: { ...where, eventTypes: { hasSome: ['*', eventType] } },
    select: { id: true },
  })
}

function eventReceipt(eventId: string, deliveries: { id: string; endpointId: string }[], created: boolean) {
  const deliveryIds = deliveries.sort((a, b) => a.endpointId.localeCompare(b.endpointId)).map(({ id }) => id)
  return { eventId, deliveryId: deliveryIds[0] ?? null, deliveryIds, created }
}

export function submitWorkspaceEvent(
  db: PrismaClient, workspaceId: string, input: z.infer<typeof workspaceSubmissionSchema>,
) {
  return submitEvent(db, { ...input, receiverMode: 'SUCCEED' }, { workspaceId })
}

export function submitWorkspaceTest(
  db: PrismaClient, workspaceId: string, input: z.infer<typeof workspaceSubmissionSchema>, endpointId?: string,
) {
  return submitEvent(db, { ...input, receiverMode: 'SUCCEED' }, { workspaceId, endpointId, isTest: true })
}

export async function submitEvent(db: PrismaClient, input: Submission, scope: DestinationScope, afterEventWrite?: () => void) {
  const { workspaceId, endpointId, isTest = false } = scope
  const requestFingerprint = fingerprint(input, isTest)
  try {
    return await db.$transaction(async (tx) => {
      const id = randomUUID()
      const createdAt = new Date()
      const body = eventBody({ id, eventType: input.eventType, payload: input.payload, createdAt, isTest })
      // Pass JSON as text because Prisma's object serializer drops keys such as "__proto__".
      const [event] = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO "Event" (id, "workspaceId", "eventType", payload,
          "canonicalBody", "requestFingerprint", "idempotencyKey", "createdAt", "isTest")
        VALUES (${id}::uuid, ${workspaceId}::uuid, ${input.eventType},
          ${stringify(input.payload)}::jsonb, ${body}, ${requestFingerprint}, ${input.idempotencyKey}, ${createdAt}, ${isTest})
        ON CONFLICT ("workspaceId", "idempotencyKey") DO NOTHING
        RETURNING id
      `
      if (!event) throw new DuplicateSubmission()
      afterEventWrite?.()
      const endpoints = await resolveEndpoints(tx, scope, input.eventType)
      const deliveries = endpoints.length ? await tx.delivery.createManyAndReturn({
        data: endpoints.map(({ id }) => ({ eventId: event.id, endpointId: id, receiverMode: input.receiverMode })),
        select: { id: true, endpointId: true },
      }) : []
      return eventReceipt(event.id, deliveries, true)
    })
  } catch (error) {
    if (!(error instanceof DuplicateSubmission)) throw error
    const existing = await db.event.findUnique({
      where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey: input.idempotencyKey } },
      select: { id: true, requestFingerprint: true, deliveries: { select: { id: true, endpointId: true } } },
    })
    if (!existing) throw error
    if (existing.requestFingerprint !== requestFingerprint ||
      (isTest && endpointId && existing.deliveries[0]?.endpointId !== endpointId)) {
      throw new ApiError(409, 'CONFLICT', 'This idempotency key belongs to a different submission.')
    }
    return eventReceipt(existing.id, existing.deliveries, false)
  }
}
