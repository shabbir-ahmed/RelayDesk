import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { timing } from './timing'

export async function claimNext(db: PrismaClient) {
  return db.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ id: string; now: Date }[]>`
      SELECT id, clock_timestamp() AS now
      FROM "Delivery"
      WHERE status = 'PENDING' AND "nextAttemptAt" <= clock_timestamp()
        AND (NOT historical OR cycle > 1)
      ORDER BY "nextAttemptAt", id
      FOR UPDATE SKIP LOCKED LIMIT 1
    `
    if (!row) return null
    const leaseToken = randomUUID()
    const claimed = await tx.delivery.update({
      where: { id: row.id },
      data: {
        status: 'PROCESSING',
        leaseToken,
        leaseExpiresAt: new Date(row.now.getTime() + timing.leaseMs),
        attemptsInCycle: { increment: 1 },
        nextAttemptAt: null,
        updatedAt: row.now,
      },
      select: {
        id: true, cycle: true, attemptsInCycle: true, receiverMode: true,
        event: { select: { id: true, canonicalBody: true } },
      },
    })
    await tx.deliveryAttempt.create({
      data: {
        deliveryId: claimed.id, cycle: claimed.cycle, leaseToken,
        attemptNumber: claimed.attemptsInCycle, receiverMode: claimed.receiverMode, startedAt: row.now,
      },
    })
    return { ...claimed, leaseToken, startedAt: row.now }
  })
}

export type Claim = NonNullable<Awaited<ReturnType<typeof claimNext>>>
export type Outcome = { ok: boolean; status?: number; error?: string }

export async function finalize(db: PrismaClient, claim: Claim, outcome: Outcome) {
  return db.$transaction(async (tx) => {
    const [lease] = await tx.$queryRaw<{ now: Date }[]>`
      SELECT clock_timestamp() AS now FROM "Delivery"
      WHERE id = ${claim.id}::uuid AND status = 'PROCESSING'
        AND cycle = ${claim.cycle} AND "leaseToken" = ${claim.leaseToken}::uuid
        AND "leaseExpiresAt" > clock_timestamp()
      FOR UPDATE
    `
    if (!lease) return false
    await tx.deliveryAttempt.update({
      where: { deliveryId_cycle_attemptNumber: { deliveryId: claim.id, cycle: claim.cycle, attemptNumber: claim.attemptsInCycle } },
      data: {
        status: outcome.ok ? 'SUCCEEDED' : 'FAILED', completedAt: lease.now,
        httpStatus: outcome.status, error: outcome.error,
        durationMs: Math.max(0, lease.now.getTime() - claim.startedAt.getTime()),
      },
    })
    await tx.delivery.update({
      where: { id: claim.id },
      data: { status: outcome.ok ? 'DELIVERED' : 'FAILED', leaseToken: null, leaseExpiresAt: null, updatedAt: lease.now },
    })
    return true
  })
}
