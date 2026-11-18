import type { AuditAction, Prisma, PrismaClient } from '@prisma/client'
import { pageBoundary, pageParams, pageResult, newestFirst } from './paging'

export function recordAudit(
  tx: Prisma.TransactionClient, workspaceId: string, action: AuditAction, targetId: string, summary: string, eventTypes?: string[],
) {
  return tx.auditEntry.create({ data: { workspaceId, action, targetId, summary, eventTypes } })
}

export async function listAudit(db: PrismaClient, workspaceId: string, params: URLSearchParams) {
  const { cursor, limit } = pageParams(params)
  const rows = await db.auditEntry.findMany({
    where: { workspaceId, ...pageBoundary(cursor) },
    orderBy: newestFirst,
    take: limit + 1,
    select: { id: true, action: true, targetId: true, summary: true, eventTypes: true, createdAt: true },
  })
  return pageResult(rows, limit)
}
