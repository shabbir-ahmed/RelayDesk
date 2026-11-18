import type { AuditAction, Environment, Prisma, PrismaClient } from '@prisma/client'
import { pageBoundary, pageParams, pageResult, newestFirst } from './paging'

export function recordAudit(
  tx: Prisma.TransactionClient, workspaceId: string, action: AuditAction, targetId: string, summary: string,
  details?: { eventTypes?: string[]; environment?: Environment; actor?: string },
) {
  return tx.auditEntry.create({ data: { workspaceId, action, targetId, summary, ...details } })
}

export async function listAudit(db: PrismaClient, workspaceId: string, params: URLSearchParams, environment: Environment = 'LIVE') {
  const { cursor, limit } = pageParams(params)
  const rows = await db.auditEntry.findMany({
    where: { workspaceId, AND: [{ OR: [{ environment }, { environment: null }] }, pageBoundary(cursor)] },
    orderBy: newestFirst,
    take: limit + 1,
    select: { id: true, action: true, targetId: true, summary: true, eventTypes: true, actor: true, environment: true, createdAt: true },
  })
  return pageResult(rows, limit)
}
