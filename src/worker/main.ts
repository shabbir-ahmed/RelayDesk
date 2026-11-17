import { setTimeout as sleep } from 'node:timers/promises'
import { db } from '../server/db'
import { workerEnv } from '../server/env'
import { claimNext, finalize } from './queue'
import { send } from './send'
import { timing } from './timing'

async function main() {
  const config = workerEnv()
  const database = db()
  const stop = new AbortController()
  const shutdown = () => stop.abort()
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
  try {
    await database.$queryRaw`SELECT 1`
    console.info('RelayDesk worker ready')
    while (!stop.signal.aborted) {
      try {
        const claim = await claimNext(database)
        if (claim) {
          if (stop.signal.aborted) break
          const outcome = await send(claim, config.RECEIVER_BASE_URL, config.RECEIVER_SECRET)
          if (!await finalize(database, claim, outcome)) {
            console.warn('stale-completion', { deliveryId: claim.id, cycle: claim.cycle })
          }
          continue
        }
      } catch (error) {
        console.error('worker-poll-failed', error instanceof Error ? error.name : 'UnknownError')
      }
      await sleep(timing.pollMs, undefined, { signal: stop.signal }).catch(() => {})
    }
  } finally {
    process.off('SIGTERM', shutdown)
    process.off('SIGINT', shutdown)
    await database.$disconnect()
  }
}

main().catch(() => {
  console.error('RelayDesk worker failed to start')
  process.exitCode = 1
})
