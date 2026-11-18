import type { PrismaClient } from '@prisma/client'

export async function purgeExpiredPayloads(db: PrismaClient) {
  return db.$transaction(async (tx) => {
    const candidates = await tx.$queryRaw<{ id: string }[]>`
      SELECT e.id FROM "Event" e JOIN "Workspace" w ON w.id = e."workspaceId"
      WHERE w.slug IS NOT NULL AND e."payloadPurgedAt" IS NULL
        AND e."createdAt" <= statement_timestamp() - interval '720 hours'
        AND NOT EXISTS (SELECT 1 FROM "Delivery" d WHERE d."eventId" = e.id AND d.status IN ('PENDING', 'PROCESSING'))
      ORDER BY e."createdAt", e.id FOR UPDATE OF e SKIP LOCKED LIMIT 100
    `
    if (!candidates.length) return 0
    // Replay also locks the event. Use a fresh snapshot before redacting locked candidates.
    const { count } = await tx.event.updateMany({
      where: { id: { in: candidates.map(({ id }) => id) }, deliveries: { none: { status: { in: ['PENDING', 'PROCESSING'] } } } },
      data: { payload: {}, canonicalBody: '', payloadPurgedAt: new Date() },
    })
    return count
  })
}
