import { db } from '../server/db'
import { workerEnv } from '../server/env'
import { runWorker } from './run'
import { sendApproved } from './send-approved'
import { send } from './send'

async function main() {
  const config = workerEnv()
  const database = db()
  const stop = new AbortController()
  const shutdown = () => stop.abort()
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
  try {
    await runWorker(database, config.mode, (claim) => config.mode === 'demo'
      ? send(claim, config.RECEIVER_BASE_URL, config.RECEIVER_SECRET)
      : sendApproved(claim, config.DESTINATION_SIGNING_KEY), stop.signal)
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
