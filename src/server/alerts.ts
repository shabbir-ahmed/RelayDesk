import type { Environment, PrismaClient } from '@prisma/client'
import { newestFirst, pageBoundary, pageParams, pageResult } from './paging'

const workspaceAlerts = (workspaceId: string, environment: Environment) => ({ delivery: { event: { workspaceId, environment } } })

export function countOpenAlerts(db: PrismaClient, workspaceId: string, environment: Environment = 'LIVE') {
  return db.failureAlert.count({ where: { ...workspaceAlerts(workspaceId, environment), acknowledgedAt: null } })
}

export async function listAlerts(db: PrismaClient, workspaceId: string, params: URLSearchParams, openOnly: boolean, environment: Environment = 'LIVE') {
  const { cursor, limit } = pageParams(params)
  const rows = await db.failureAlert.findMany({
    where: { ...workspaceAlerts(workspaceId, environment), ...(openOnly && { acknowledgedAt: null }), ...pageBoundary(cursor) },
    orderBy: newestFirst,
    take: limit + 1,
    select: {
      id: true, deliveryId: true, cycle: true, reason: true, createdAt: true, acknowledgedAt: true,
      delivery: {
        select: { status: true, cycle: true, event: { select: { eventType: true } }, endpoint: { select: { name: true } } },
      },
    },
  })
  return pageResult(rows.map((row) => ({ ...row, acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null })), limit)
}

export async function acknowledgeAlert(db: PrismaClient, workspaceId: string, id: string, environment: Environment = 'LIVE') {
  const where = { id, ...workspaceAlerts(workspaceId, environment) }
  const result = await db.failureAlert.updateMany({
    where: { ...where, acknowledgedAt: null },
    data: { acknowledgedAt: new Date() },
  })
  return result.count === 1 || Boolean(await db.failureAlert.findFirst({ where, select: { id: true } }))
}
