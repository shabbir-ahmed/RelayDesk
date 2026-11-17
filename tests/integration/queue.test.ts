import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { submitEvent } from '../../src/server/events'
import { receive } from '../../src/server/receiver'
import { respond } from '../../src/server/http'
import { replay } from '../../src/server/replay'
import { signedHeaders } from '../../src/server/signing'
import type { ReceiverMode } from '../../src/shared/delivery'
import { classifyHttp } from '../../src/worker/outcomes'
import { claimNext, finalize, recoverExpired, type Claim } from '../../src/worker/queue'

import { prepareDatabase, testDb } from '../support/database'

const database = testDb()
const secret = 'integration-receiver-secret-only-for-tests'

beforeEach(prepareDatabase)
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
  await database.$executeRaw`UPDATE "Delivery" SET "nextAttemptAt" = clock_timestamp() - interval '1 second' WHERE id = ${id}::uuid`
}

async function expire(id: string) {
  await database.$executeRaw`UPDATE "Delivery" SET "leaseExpiresAt" = clock_timestamp() - interval '1 second' WHERE id = ${id}::uuid`
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
  expect(first.id).toBe(deliveryId)
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
  const result = await database.delivery.findUniqueOrThrow({ where: { id: deliveryId }, include: { attempts: { orderBy: { attemptNumber: 'asc' } } } })
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

test('T03 a fault between writes rolls back both event and delivery', async () => {
  const eventType = 'synthetic.atomic.rollback'
  const input = { eventType, idempotencyKey: randomUUID(), payload: { synthetic: true }, receiverMode: 'SUCCEED' as const }
  await expect(submitEvent(database, input, () => { throw new Error('injected write failure') })).rejects.toThrow('injected write failure')
  expect(await database.event.count({ where: { idempotencyKey: input.idempotencyKey } })).toBe(0)
  expect(await database.delivery.count({ where: { event: { eventType } } })).toBe(0)
})

test('T04 two independent clients race for a due row and skip a held row lock', async () => {
  const { deliveryId } = await create('SUCCEED')
  const second = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL })
  try {
    await database.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Delivery" WHERE id = ${deliveryId}::uuid FOR UPDATE`
      expect(await claimNext(second)).toBeNull()
    })
    const claims = (await Promise.all([claimNext(database), claimNext(second)])).filter((row) => row !== null)
    expect(claims).toHaveLength(1)
    expect(claims[0].id).toBe(deliveryId)
    expect(await database.deliveryAttempt.count({ where: { deliveryId, status: 'STARTED' } })).toBe(1)
    await finalize(database, claims[0], classifyHttp(200))
  } finally {
    await second.$disconnect()
  }
})

test('T08 pending and delivered replay conflict, concurrent replay wins once, replay limit is enforced', async () => {
  const { deliveryId } = await create('ALWAYS_FAIL')
  await expect(replay(database, deliveryId)).rejects.toMatchObject({ status: 409 })
  await finalize(database, await claim(), classifyHttp(400))
  const results = await Promise.allSettled([replay(database, deliveryId), replay(database, deliveryId)])
  expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
  expect(results.find(({ status }) => status === 'rejected')).toMatchObject({ reason: { status: 409 } })
  for (let cycle = 2; cycle <= 4; cycle++) {
    const row = await claim()
    expect(row.cycle).toBe(cycle)
    await finalize(database, row, classifyHttp(400))
    if (cycle < 4) await replay(database, deliveryId)
  }
  await expect(replay(database, deliveryId)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('all 3') })
  const success = await create('SUCCEED')
  await finalize(database, await claim(), classifyHttp(200))
  await expect(replay(database, success.deliveryId)).rejects.toMatchObject({ status: 409 })
})
