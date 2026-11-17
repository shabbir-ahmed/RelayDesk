import { db } from '../server/db'
import { workerEnv } from '../server/env'

async function main() {
  workerEnv()
  await db().$queryRaw`SELECT 1`
  console.info('RelayDesk worker ready')
  await new Promise<void>((resolve) => {
    process.once('SIGTERM', resolve)
    process.once('SIGINT', resolve)
  })
}

main().catch(() => {
  console.error('RelayDesk worker failed to start')
  process.exitCode = 1
}).finally(() => db().$disconnect())
