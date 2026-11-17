import { db } from '../src/server/db'
import { ensureDemo } from '../src/server/demo'

ensureDemo(db()).then(() => {
  console.info('Demo workspace and controlled receiver are ready')
}).catch(() => {
  console.error('Could not initialize the demo workspace')
  process.exitCode = 1
}).finally(() => db().$disconnect())
