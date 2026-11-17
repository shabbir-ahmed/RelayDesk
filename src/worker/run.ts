import type { PrismaClient } from '@prisma/client'
import { setTimeout as sleep } from 'node:timers/promises'
import type { AppMode } from '../server/env'
import type { Outcome } from './outcomes'
import { claimNext, finalize, recoverExpired, type Claim } from './queue'
import { timing } from './timing'

export async function runWorker(
  database: PrismaClient, mode: AppMode, deliver: (claim: Claim) => Promise<Outcome>, signal: AbortSignal,
) {
  await database.$queryRaw`SELECT 1`
  console.info('RelayDesk worker ready')
  while (!signal.aborted) {
    try {
      await recoverExpired(database, mode)
      if (signal.aborted) break
      const claim = await claimNext(database, mode)
      if (claim) {
        const outcome = await deliver(claim)
        if (!await finalize(database, claim, outcome)) {
          console.warn('stale-completion', { deliveryId: claim.id, cycle: claim.cycle })
        }
        continue
      }
    } catch (error) {
      console.error('worker-poll-failed', error instanceof Error ? error.name : 'UnknownError')
    }
    await sleep(timing.pollMs, undefined, { signal }).catch(() => {})
  }
}
