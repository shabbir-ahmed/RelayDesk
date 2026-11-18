import type { PrismaClient } from '@prisma/client'
import { setTimeout as sleep } from 'node:timers/promises'
import type { AppMode } from '../server/env'
import type { Outcome } from './outcomes'
import { claimNext, finalize, recoverExpired, type Claim } from './queue'
import { purgeExpiredPayloads } from './retention'
import { timing } from './timing'

async function workLoop(signal: AbortSignal, work: () => Promise<boolean>) {
  while (!signal.aborted) {
    try {
      if (await work()) continue
    } catch (error) {
      console.error('worker-poll-failed', error instanceof Error ? error.name : 'UnknownError')
    }
    await sleep(timing.pollMs, undefined, { signal }).catch(() => {})
  }
}

export async function runWorker(
  database: PrismaClient, mode: AppMode, deliver: (claim: Claim) => Promise<Outcome>, signal: AbortSignal,
) {
  await database.$queryRaw`SELECT 1`
  let nextHeartbeat = 0
  const housekeep = workLoop(signal, async () => {
    await recoverExpired(database, mode)
    if (Date.now() >= nextHeartbeat) {
      await database.$executeRaw`
        INSERT INTO "WorkerHeartbeat" (mode, "seenAt") VALUES (${mode}, clock_timestamp())
        ON CONFLICT (mode) DO UPDATE SET "seenAt" = GREATEST("WorkerHeartbeat"."seenAt", EXCLUDED."seenAt")
      `
      nextHeartbeat = Date.now() + timing.heartbeatMs
      if (mode === 'private') await purgeExpiredPayloads(database)
    }
    return false
  })
  const deliverNext = async () => {
    const claim = await claimNext(database, mode)
    if (!claim) return false
    const outcome = await deliver(claim)
    if (!await finalize(database, claim, outcome)) {
      console.warn('stale-completion', { deliveryId: claim.id, cycle: claim.cycle })
    }
    return true
  }
  console.info('RelayDesk worker ready')
  await Promise.all([housekeep, ...Array.from({ length: mode === 'private' ? 4 : 1 }, () => workLoop(signal, deliverNext))])
}
