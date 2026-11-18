import { randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import type { AppMode } from '../server/env'
import { retryAt, type Outcome } from './outcomes'
import { timing } from './timing'

export async function claimNext(db: PrismaClient, mode: AppMode = 'demo') {
  return db.$transaction(async (tx) => {
    const privateMode = mode === 'private'
    const [row] = await tx.$queryRaw<{ id: string; endpointId: string; now: Date }[]>`
      SELECT d.id, d."endpointId", clock_timestamp() AS now
      FROM "Delivery" d JOIN "Endpoint" e ON e.id = d."endpointId"
      WHERE d.status = 'PENDING' AND d."nextAttemptAt" <= statement_timestamp()
        AND (NOT d.historical OR d.cycle > 1)
        AND (e."destinationUrl" IS NOT NULL) = ${privateMode}
        ${privateMode ? Prisma.sql`
          AND NOT EXISTS (
            SELECT 1 FROM "Delivery" active WHERE active."endpointId" = e.id AND active.status = 'PROCESSING'
          )
        ` : Prisma.empty}
      ORDER BY d."nextAttemptAt", d.id
      ${privateMode ? Prisma.sql`FOR UPDATE OF d, e SKIP LOCKED` : Prisma.sql`FOR UPDATE OF d SKIP LOCKED`}
      LIMIT 1
    `
    if (!row) return null
    // Read again after acquiring the endpoint lock. A previous claim may have committed
    // between the candidate query taking its snapshot and acquiring that lock.
    if (privateMode && await tx.delivery.findFirst({
      where: { endpointId: row.endpointId, status: 'PROCESSING' }, select: { id: true },
    })) return null
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
        endpoint: { select: { id: true, destinationUrl: true, signingVersion: true, signingOverlapUntil: true } },
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

async function release(
  tx: Prisma.TransactionClient, id: string, now: Date, delivered: boolean, nextAttemptAt: Date | null,
  failure?: { cycle: number; reason: string },
) {
  const status = delivered ? 'DELIVERED' : nextAttemptAt ? 'PENDING' : 'FAILED'
  await tx.delivery.update({
    where: { id },
    data: { status, leaseToken: null, leaseExpiresAt: null, nextAttemptAt, updatedAt: now },
  })
  if (status === 'FAILED' && failure) {
    await tx.failureAlert.create({ data: { deliveryId: id, ...failure, createdAt: now } })
  }
}

export async function finalize(db: PrismaClient, claim: Claim, outcome: Outcome) {
  return db.$transaction(async (tx) => {
    const [lease] = await tx.$queryRaw<{ leaseExpiresAt: Date }[]>`
      SELECT "leaseExpiresAt" FROM "Delivery"
      WHERE id = ${claim.id}::uuid AND status = 'PROCESSING'
        AND cycle = ${claim.cycle} AND "leaseToken" = ${claim.leaseToken}::uuid
      FOR UPDATE
    `
    if (!lease) return false
    const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
    if (lease.leaseExpiresAt <= now) return false

    const succeeded = outcome.kind === 'success'
    await tx.deliveryAttempt.update({
      where: {
        deliveryId_cycle_attemptNumber: { deliveryId: claim.id, cycle: claim.cycle, attemptNumber: claim.attemptsInCycle },
        leaseToken: claim.leaseToken, status: 'STARTED',
      },
      data: {
        status: succeeded ? 'SUCCEEDED' : 'FAILED', completedAt: now,
        httpStatus: outcome.status, error: succeeded ? null : outcome.error,
        durationMs: Math.max(0, now.getTime() - claim.startedAt.getTime()),
      },
    })
    const next = outcome.kind === 'retry' ? retryAt(now, claim.attemptsInCycle, claim.endpoint.destinationUrl === null ? undefined : outcome.retryAfterMs ?? 0) : null
    const failure = !succeeded && claim.endpoint.destinationUrl !== null
      ? { cycle: claim.cycle, reason: outcome.error }
      : undefined
    await release(tx, claim.id, now, succeeded, next, failure)
    return true
  })
}

export async function recoverExpired(db: PrismaClient, mode: AppMode = 'demo') {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; cycle: number; attemptsInCycle: number; leaseToken: string }[]>`
      SELECT id, cycle, "attemptsInCycle", "leaseToken"
      FROM "Delivery"
      WHERE status = 'PROCESSING' AND "leaseExpiresAt" <= statement_timestamp()
        AND (NOT historical OR cycle > 1)
        AND EXISTS (
          SELECT 1 FROM "Endpoint"
          WHERE "Endpoint".id = "Delivery"."endpointId"
            AND ("destinationUrl" IS NULL) = ${mode === 'demo'}
        )
      ORDER BY "leaseExpiresAt", id
      FOR UPDATE SKIP LOCKED LIMIT ${timing.recoveryBatch}
    `
    if (!rows.length) return 0
    const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
    for (const row of rows) {
      await tx.deliveryAttempt.update({
        where: {
          deliveryId_cycle_attemptNumber: { deliveryId: row.id, cycle: row.cycle, attemptNumber: row.attemptsInCycle },
          leaseToken: row.leaseToken, status: 'STARTED',
        },
        data: {
          status: 'UNKNOWN', completedAt: now,
          error: 'Worker lease expired. The receiver may have processed this request.',
        },
      })
      const failure = mode === 'private'
        ? { cycle: row.cycle, reason: 'The worker lease expired on the last allowed attempt.' }
        : undefined
      await release(tx, row.id, now, false, retryAt(now, row.attemptsInCycle, mode === 'private' ? 0 : undefined), failure)
    }
    return rows.length
  })
}
