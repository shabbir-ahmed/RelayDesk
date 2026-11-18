import { Prisma, type PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { deliveryStatuses } from '../shared/delivery'
import { maxAttempts, maxReplayCycles } from '../worker/timing'
import { countOpenAlerts } from './alerts'
import { demoScope } from './demo'
import { parse } from './http'
import { newestFirst, pageBoundary, pageResult, pageSchema } from './paging'

const listSelect = {
  id: true, status: true, cycle: true, attemptsInCycle: true, createdAt: true, historical: true,
  event: { select: { eventType: true, isTest: true } },
  endpoint: { select: { id: true, name: true } },
} satisfies Prisma.DeliverySelect

const deliveryQuery = pageSchema.extend({
  status: z.enum(deliveryStatuses).optional(),
  destination: z.uuid().optional(),
  query: z.string().trim().max(100).refine((value) => !value.includes('\u0000') && value.isWellFormed()).optional(),
})

function search(query?: string): Prisma.DeliveryWhereInput {
  if (!query) return {}
  const eventType = query.replace(/[\\%_]/g, '\\$&')
  const uuid = z.uuid().safeParse(query)
  return {
    OR: [
      { event: { eventType: { contains: eventType, mode: 'insensitive' } } },
      ...(uuid.success ? [{ id: uuid.data }, { eventId: uuid.data }] : []),
    ],
  }
}

const visible = (workspaceId: string) => ({ event: { workspaceId } } satisfies Prisma.DeliveryWhereInput)

export async function listDeliveries(db: PrismaClient, workspaceId: string, params = new URLSearchParams()) {
  const { status, cursor, limit = 25, destination, query } = parse(deliveryQuery, Object.fromEntries(params))
  const rows = await db.delivery.findMany({
    where: { ...visible(workspaceId), status, endpointId: destination, AND: [pageBoundary(cursor), search(query)] },
    orderBy: newestFirst,
    take: limit + 1,
    select: listSelect,
  })
  return pageResult(rows, limit)
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
  const [groups, latest, openAlerts] = await Promise.all([
    db.delivery.groupBy({ by: ['status'], where: visible(workspaceId), _count: { _all: true } }),
    db.deliveryAttempt.findFirst({
      where: { completedAt: { not: null }, delivery: visible(workspaceId) },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true },
    }),
    workspaceId === demoScope.workspaceId ? 0 : countOpenAlerts(db, workspaceId),
  ])
  const counts = { PENDING: 0, PROCESSING: 0, DELIVERED: 0, FAILED: 0 }
  for (const group of groups) counts[group.status] = group._count._all
  return { counts, openAlerts, latestCompletionAt: latest?.completedAt?.toISOString() ?? null }
}

export type DeliveryList = Awaited<ReturnType<typeof listDeliveries>>
export type DeliveryDetail = NonNullable<Awaited<ReturnType<typeof deliveryDetail>>>
export type DeliverySummary = Awaited<ReturnType<typeof deliverySummary>>
