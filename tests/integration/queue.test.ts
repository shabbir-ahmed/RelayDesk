import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { db } from '../../src/server/db'
import { ensureDemo } from '../../src/server/demo'
import { submitEvent } from '../../src/server/events'
import { receive } from '../../src/server/receiver'
import { respond } from '../../src/server/http'
import { replay } from '../../src/server/replay'
import { signedHeaders } from '../../src/server/signing'
import type { ReceiverMode } from '../../src/shared/delivery'
import { classifyHttp } from '../../src/worker/outcomes'
import { claimNext, finalize, recoverExpired, type Claim } from '../../src/worker/queue'

if (process.env.RELAYDESK_TEST_RUN !== '1') throw new Error('Run via npm run test:integration.')
const database = db()
const secret = 'integration-receiver-secret-only-for-tests'

async function reset() {
  await database.deliveryAttempt.deleteMany()
  await database.delivery.deleteMany()
  await database.event.deleteMany()
}

beforeAll(async () => {
  await reset()
  await ensureDemo(database)
})
afterAll(() => database.$disconnect())

async function create(mode: ReceiverMode) {
  return submitEvent(database, { eventType: 'synthetic.integration', idempotencyKey: randomUUID(), payload: { synthetic: true }, receiverMode: mode })
}

async function claim() {
  const row = await claimNext(database)
  expect(row).not.toBeNull()
  return row!
}

async function makeDue(id: string) {
  await database.$executeRaw`UPDATE "Delivery" SET "nextAttemptAt" = clock_timestamp() WHERE id = ${id}::uuid`
}

async function expire(id: string) {
  await database.$executeRaw`UPDATE "Delivery" SET "leaseExpiresAt" = clock_timestamp() WHERE id = ${id}::uuid`
}

async function signedResponse(row: Claim) {
  const body = row.event.canonicalBody
  const headers = signedHeaders(secret, {
    eventId: row.event.id, deliveryId: row.id, cycle: row.cycle, attempt: row.attemptsInCycle,
    mode: row.receiverMode, timestamp: Math.floor(Date.now() / 1_000),
  }, body)
  const request = new Request('http://localhost/api/demo/receiver', { method: 'POST', headers, body })
  return respond(() => receive(request, secret))
}

test('T06 flaky delivery succeeds on attempt three and persistent failure exhausts its budget', async () => {
  for (const mode of ['FAIL_TWICE', 'ALWAYS_FAIL'] as const) {
    const { deliveryId } = await create(mode)
    for (let n = 1; n <= 3; n++) {
      const row = await claim()
      expect(row).toMatchObject({ id: deliveryId, attemptsInCycle: n })
      const { status } = await signedResponse(row)
      expect(status).toBe(mode === 'FAIL_TWICE' && n === 3 ? 200 : 503)
      expect(await finalize(database, row, classifyHttp(status))).toBe(true)
      expect(await claimNext(database)).toBeNull()
      const state = await database.delivery.findUniqueOrThrow({ where: { id: deliveryId }, include: { attempts: { orderBy: { attemptNumber: 'asc' } } } })
      expect(state.attempts).toHaveLength(n)
      if (n < 3) {
        expect(state.status).toBe('PENDING')
        expect(state.nextAttemptAt!.getTime() - state.attempts[n - 1].completedAt!.getTime()).toBe(n === 1 ? 5_000 : 15_000)
        await makeDue(deliveryId)
      } else {
        expect(state.status).toBe(mode === 'FAIL_TWICE' ? 'DELIVERED' : 'FAILED')
        expect(state.nextAttemptAt).toBeNull()
      }
    }
  }
})

test('T07 expired lease is fenced, unknown history survives, and budget is consumed', async () => {
  const { deliveryId } = await create('SUCCEED')
  const first = await claim()
  await expire(deliveryId)
  expect(await finalize(database, first, classifyHttp(200))).toBe(false)
  expect(await recoverExpired(database)).toBe(1)
  expect(await recoverExpired(database)).toBe(0)
  expect(await claimNext(database)).toBeNull()
  await makeDue(deliveryId)
  const second = await claim()
  expect(second.leaseToken).not.toBe(first.leaseToken)
  expect(await finalize(database, first, classifyHttp(200))).toBe(false)
  await expire(deliveryId)
  expect(await recoverExpired(database)).toBe(1)
  await makeDue(deliveryId)
  const third = await claim()
  await expire(deliveryId)
  expect(await recoverExpired(database)).toBe(1)
  expect(await claimNext(database)).toBeNull()
  expect(await finalize(database, third, classifyHttp(200))).toBe(false)
  const result = await database.delivery.findUniqueOrThrow({ where: { id: deliveryId }, include: { attempts: true } })
  expect(result).toMatchObject({ status: 'FAILED', leaseToken: null, leaseExpiresAt: null, attemptsInCycle: 3 })
  expect(result.attempts.map(({ status }) => status)).toEqual(['UNKNOWN', 'UNKNOWN', 'UNKNOWN'])
})

test('T08 replay preserves attempts and replaces mode on the next cycle', async () => {
  const { eventId, deliveryId } = await create('ALWAYS_FAIL')
  const first = await claim()
  await finalize(database, first, classifyHttp(404))
  await expect(replay(database, deliveryId, 'SUCCEED')).resolves.toMatchObject({ cycle: 2, status: 'PENDING' })
  const second = await claim()
  expect(second).toMatchObject({ attemptsInCycle: 1, cycle: 2, receiverMode: 'SUCCEED', event: { id: eventId } })
  expect(second.event.canonicalBody).toBe(first.event.canonicalBody)
  expect(await finalize(database, first, classifyHttp(200))).toBe(false)
  await finalize(database, second, classifyHttp((await signedResponse(second)).status))
  const result = await database.delivery.findUniqueOrThrow({
    where: { id: deliveryId }, include: { attempts: { orderBy: { cycle: 'asc' } } },
  })
  expect(result.status).toBe('DELIVERED')
  expect(result.attempts.map(({ cycle, receiverMode, status }) => [cycle, receiverMode, status]))
    .toEqual([[1, 'ALWAYS_FAIL', 'FAILED'], [2, 'SUCCEED', 'SUCCEEDED']])
})
