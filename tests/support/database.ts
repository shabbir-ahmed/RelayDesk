import { db } from '../../src/server/db'
import { ensureDemo } from '../../src/server/demo'

export function testDb() {
  const url = process.env.DATABASE_URL
  if (process.env.RELAYDESK_TEST_RUN !== '1' || !url || !new URL(url).pathname.endsWith('_test')) {
    throw new Error('Run tests through an npm test script with a disposable database.')
  }
  return db()
}

export async function prepareDatabase() {
  const database = testDb()
  await database.$transaction([
    database.failureAlert.deleteMany(),
    database.auditEntry.deleteMany(),
    database.deliveryAttempt.deleteMany(),
    database.delivery.deleteMany(),
    database.event.deleteMany(),
    database.apiKey.deleteMany(),
    database.endpoint.deleteMany({ where: { destinationUrl: { not: null } } }),
    database.workspace.deleteMany({ where: { slug: { not: null } } }),
  ])
  await ensureDemo(database)
}
