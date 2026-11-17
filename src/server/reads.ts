import { Prisma, type PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { deliveryStatuses } from '../shared/delivery'
import { maxAttempts, maxReplayCycles } from '../worker/timing'
import { invalid, parse } from './http'

const listSelect = {
  id: true, status: true, cycle: true, attemptsInCycle: true, createdAt: true, historical: true,
  event: { select: { eventType: true, isTest: true } },
} satisfies Prisma.DeliverySelect

const cursorSchema = z.tuple([z.iso.datetime(), z.uuid()])
const pageSchema = z.object({
  status: z.enum(deliveryStatuses).optional(),
  cursor: z.string().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/).optional(),
  limit: z.string().regex(/^\d{1,2}$/).transform(Number).pipe(z.number().int().min(1).max(50)).optional(),
})

function decodeCursor(cursor: string) {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')))
  } catch {
    throw invalid('Use a cursor returned by the deliveries endpoint.')
  }
}

const visible = (workspaceId: string) => ({ event: { workspaceId } } satisfies Prisma.DeliveryWhereInput)

export async function listDeliveries(db: PrismaClient, workspaceId: string, params = new URLSearchParams()) {
  const { status, cursor, limit = 25 } = parse(pageSchema, Object.fromEntries(params))
  const [time, id] = cursor ? decodeCursor(cursor) : []
  const createdAt = time ? new Date(time) : undefined
  const rows = await db.delivery.findMany({
    where: {
      ...visible(workspaceId),
      status,
      ...(createdAt ? { OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }] } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    select: listSelect,
  })
  const items = rows.slice(0, limit).map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
  const last = items.at(-1)
  const nextCursor = rows.length > limit && last
    ? Buffer.from(JSON.stringify([last.createdAt, last.id])).toString('base64url') : null
  return { items, nextCursor }
}

export async function deliveryDetail(db: PrismaClient, workspaceId: string, id: string) {
  if (!z.uuid().safeParse(id).success) return null
  const row = await db.delivery.findFirst({
    where: { ...visible(workspaceId), id },
    select: {
      ...listSelect,
      receiverMode: true, nextAttemptAt: true, leaseExpiresAt: true,
      event: { select: { id: true, eventType: true, payload: true, createdAt: true, isTest: true } },
      endpoint: { select: { name: true, destinationUrl: true } },
      attempts: {
        orderBy: [{ cycle: 'asc' }, { attemptNumber: 'asc' }],
        take: (1 + maxReplayCycles) * maxAttempts,
        select: {
          id: true, cycle: true, attemptNumber: true, receiverMode: true, status: true,
          startedAt: true, completedAt: true, httpStatus: true, durationMs: true, error: true,
        },
      },
    },
  })
  if (!row) return null
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
    event: { ...row.event, createdAt: row.event.createdAt.toISOString() },
    attempts: row.attempts.map((attempt) => ({
      ...attempt, startedAt: attempt.startedAt.toISOString(), completedAt: attempt.completedAt?.toISOString() ?? null,
    })),
  }
}

export async function deliverySummary(db: PrismaClient, workspaceId: string) {
  const [groups, latest] = await Promise.all([
    db.delivery.groupBy({ by: ['status'], where: visible(workspaceId), _count: { _all: true } }),
    db.deliveryAttempt.findFirst({
      where: { completedAt: { not: null }, delivery: visible(workspaceId) },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true },
    }),
  ])
  const counts = { PENDING: 0, PROCESSING: 0, DELIVERED: 0, FAILED: 0 }
  for (const group of groups) counts[group.status] = group._count._all
  return { counts, latestCompletionAt: latest?.completedAt?.toISOString() ?? null }
}

export type DeliveryList = Awaited<ReturnType<typeof listDeliveries>>
export type DeliveryDetail = NonNullable<Awaited<ReturnType<typeof deliveryDetail>>>
export type DeliverySummary = Awaited<ReturnType<typeof deliverySummary>>
