import { createHash } from 'node:crypto'
import type { AttemptStatus, DeliveryStatus, ReceiverMode } from '@prisma/client'
import { db } from '../src/server/db'
import { endpointId, ensureDemo, workspaceId } from '../src/server/demo'
import { eventBody, fingerprint } from '../src/server/events'

const eventTypes = [
  'order.created', 'invoice.paid', 'shipment.dispatched', 'inventory.changed', 'payment.authorized',
  'refund.issued', 'order.fulfilled', 'subscription.renewed', 'order.updated', 'invoice.created',
]
const fixtureCount = 40
const firstFixture = Date.parse('2026-11-17T16:30:00Z')

function fixtureId(value: string) {
  const hex = createHash('sha256').update('relaydesk-fixture:' + value).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

type FixtureAttempt = { cycle: number; mode: ReceiverMode; status: AttemptStatus; offset: number }
const succeeded = (cycle: number, mode: ReceiverMode, offset: number): FixtureAttempt => ({ cycle, mode, offset, status: 'SUCCEEDED' })
const failed = (mode: ReceiverMode, offset: number): FixtureAttempt => ({ cycle: 1, mode, offset, status: 'FAILED' })
const persistentFailure = [0, 5_180, 20_360].map((offset) => failed('ALWAYS_FAIL', offset))
const histories: FixtureAttempt[][] = [
  [succeeded(1, 'SUCCEED', 0)],
  [failed('FAIL_TWICE', 0), failed('FAIL_TWICE', 5_180), succeeded(1, 'FAIL_TWICE', 20_360)],
  persistentFailure,
  [...persistentFailure, succeeded(2, 'SUCCEED', 67_500)],
  [{ cycle: 1, mode: 'SUCCEED', status: 'UNKNOWN', offset: 0 }, succeeded(1, 'SUCCEED', 35_000)],
]

function fixture(index: number) {
  const history = histories[index % histories.length]
  const eventId = fixtureId(`event-${index}`)
  const deliveryId = fixtureId(`delivery-${index}`)
  const createdAt = new Date(firstFixture - index * 11 * 60_000)
  const eventType = eventTypes[index % eventTypes.length]
  const payload = { synthetic: true, reference: `sample-${1_040 + index}`, eventType, source: 'RelayDesk seed' }
  const attempts = history.map(({ cycle, mode, status, offset }, position) => {
    const startedAt = new Date(createdAt.getTime() + 250 + offset)
    const duration = status === 'UNKNOWN' ? 30_000 : 180
    const attemptNumber = history.slice(0, position + 1).filter((entry) => entry.cycle === cycle).length
    return {
      id: fixtureId(`attempt-${index}-${position}`), deliveryId, attemptNumber, cycle, receiverMode: mode, status,
      leaseToken: fixtureId(`lease-${index}-${position}`),
      startedAt, completedAt: new Date(startedAt.getTime() + duration),
      httpStatus: status === 'UNKNOWN' ? null : status === 'SUCCEEDED' ? 200 : 503,
      durationMs: status === 'UNKNOWN' ? null : duration,
      error: status === 'UNKNOWN' ? 'Worker lease expired. The receiver may have processed this request.'
        : status === 'FAILED' ? 'Receiver returned HTTP 503.' : null,
    }
  })
  const last = attempts.at(-1)!
  const status: DeliveryStatus = last.status === 'SUCCEEDED' ? 'DELIVERED' : 'FAILED'
  return {
    event: {
      id: eventId, workspaceId, endpointId, eventType, createdAt, payload,
      idempotencyKey: `relaydesk.seed.history.${index}`,
      canonicalBody: eventBody({ id: eventId, eventType, payload, createdAt }),
      requestFingerprint: fingerprint({ eventType, payload, receiverMode: attempts[0].receiverMode }),
    },
    delivery: {
      id: deliveryId, eventId, endpointId, status, createdAt, historical: true, nextAttemptAt: null,
      updatedAt: last.completedAt, cycle: last.cycle, attemptsInCycle: last.attemptNumber, receiverMode: last.receiverMode,
    },
    attempts,
  }
}

async function seed() {
  const database = db()
  try {
    await ensureDemo(database)
    const fixtures = Array.from({ length: fixtureCount }, (_, index) => fixture(index))
    await database.$transaction([
      database.event.createMany({ data: fixtures.map(({ event }) => event), skipDuplicates: true }),
      database.delivery.createMany({ data: fixtures.map(({ delivery }) => delivery), skipDuplicates: true }),
      database.deliveryAttempt.createMany({ data: fixtures.flatMap(({ attempts }) => attempts), skipDuplicates: true }),
    ])
    console.info(`Demo workspace, receiver, and ${fixtureCount} synthetic historical deliveries are ready`)
  } finally {
    await database.$disconnect()
  }
}

seed().catch(() => {
  console.error('Could not seed the demo. Check database settings and apply migrations before seeding.')
  process.exitCode = 1
})
