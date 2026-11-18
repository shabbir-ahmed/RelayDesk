import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { limitAuth } from '../../src/server/login-limiter'
import { submitWorkspaceEvent } from '../../src/server/events'
import { deliveryDetail } from '../../src/server/reads'
import { metrics } from '../../src/server/metrics'
import { replay } from '../../src/server/replay'
import { dailyDeliveryLimits } from '../../src/server/usage'
import { approveDestination, destinationSecret, provisionWorkspace, rotateDestinationKey, updateSubscriptions } from '../../src/server/workspaces'
import { claimNext, finalize, recoverExpired } from '../../src/worker/queue'
import { purgeExpiredPayloads } from '../../src/worker/retention'
import { runWorker } from '../../src/worker/run'
import { sendApproved } from '../../src/worker/send-approved'
import { betaReceiver } from '../support/beta-receiver'
import { prepareDatabase, testDb } from '../support/database'

const database = testDb()
const replica = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL })
const signingRoot = 'a'.repeat(64)

beforeEach(prepareDatabase)
afterAll(() => Promise.all([database.$disconnect(), replica.$disconnect()]))

function workspace(slug: string) {
  return provisionWorkspace(database, { slug, name: slug, url: `https://alpha.receiver.test/${slug}` })
}
function event() {
  return { eventType: 'pilot.fixture', idempotencyKey: randomUUID(), payload: { note: 'purge-me' } }
}
const success = { kind: 'success', status: 200 } as const
const failure = { kind: 'permanent', status: 422, error: 'Receiver refused payload.' } as const
const ago = (ms: number) => new Date(Date.now() - ms)

test('independent replicas share an atomic sign-in budget', async () => {
  const key = randomUUID()
  const results = await Promise.allSettled(
    Array.from({ length: 9 }, (_, i) => limitAuth(i % 2 ? replica : database, key)),
  )
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(5)
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(4)
  expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { status: 429 } })
  await database.authLimit.update({ where: { key }, data: { windowStart: ago(120_000) } })
  await expect(limitAuth(replica, key)).resolves.toBeInstanceOf(Date)
})

test('fan-out and manual replays share a transactional delivery quota', async () => {
  const alpha = await workspace('alpha')
  const another = await approveDestination(database, { slug: 'alpha', name: 'Extra', url: 'https://alpha.receiver.test/extra' })
  await updateSubscriptions(database, alpha.id, another.id, ['*'])
  const day = new Date(new Date().toISOString().slice(0, 10))
  const key = { workspaceId: alpha.id, environment: 'LIVE' as const, day }
  await database.dailyUsage.create({ data: { ...key, count: 0, deliveries: dailyDeliveryLimits.LIVE - 2 } })
  const input = event()
  const results = await Promise.allSettled([
    submitWorkspaceEvent(database, alpha.id, input), submitWorkspaceEvent(replica, alpha.id, event()),
  ])
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { status: 429 } })
  const claim = (await claimNext(database, 'private'))!
  await finalize(database, claim, failure)
  await expect(replay(database, alpha.id, claim.id)).rejects.toMatchObject({ status: 429 })
  expect(await database.delivery.findUnique({ where: { id: claim.id } })).toMatchObject({ status: 'FAILED', cycle: 1 })
  expect(await database.dailyUsage.findUnique({ where: { workspaceId_environment_day: key } }))
    .toMatchObject({ count: 1, deliveries: dailyDeliveryLimits.LIVE })
  await database.dailyUsage.update({ where: { workspaceId_environment_day: key }, data: { deliveries: { decrement: 1 } } })
  await expect(replay(database, alpha.id, claim.id)).resolves.toMatchObject({ status: 'PENDING', cycle: 2 })
})

test('two queue clients claim only one attempt per destination and recover a stopped lease', async () => {
  const slow = await workspace('slow')
  const healthy = await workspace('healthy')
  const backlog = await Promise.all(Array.from({ length: 6 }, () => submitWorkspaceEvent(database, slow.id, event())))
  const other = await submitWorkspaceEvent(database, healthy.id, event())
  const claims = await Promise.all(Array.from({ length: 6 }, (_, i) => claimNext(i % 2 ? replica : database, 'private')))
  const active = claims.filter((claim) => claim !== null)
  expect(active.map((claim) => claim.endpoint.id).sort()).toEqual([slow.endpoint.id, healthy.endpoint.id].sort())
  const slowClaim = active.find((claim) => claim.endpoint.id === slow.endpoint.id)!
  expect(backlog.map(({ deliveryId }) => deliveryId)).toContain(slowClaim.id)
  const healthyClaim = active.find((claim) => claim.id === other.deliveryId)!
  await finalize(replica, healthyClaim, success)
  expect(await claimNext(replica, 'private')).toBeNull()
  await database.delivery.update({ where: { id: slowClaim.id }, data: { leaseExpiresAt: ago(1_000) } })
  expect(await recoverExpired(replica, 'private')).toBe(1)
  expect(await finalize(database, slowClaim, success)).toBe(false)
  await database.delivery.update({ where: { id: slowClaim.id }, data: { nextAttemptAt: ago(100_000) } })
  const retry = (await claimNext(replica, 'private'))!
  expect(retry).toMatchObject({ id: slowClaim.id, attemptsInCycle: 2 })
  expect(await finalize(replica, retry, success)).toBe(true)
})

test('retention redacts both stored payload copies while protecting queued work and receipts', async () => {
  const alpha = await workspace('alpha')
  const input = event()
  const first = await submitWorkspaceEvent(database, alpha.id, input)
  const claim = (await claimNext(database, 'private'))!
  await finalize(database, claim, failure)
  const pending = await submitWorkspaceEvent(database, alpha.id, event())
  await database.event.updateMany({
    where: { id: { in: [first.eventId, pending.eventId] } }, data: { createdAt: ago(31 * 86_400_000) },
  })
  await expect(replay(database, alpha.id, claim.id)).rejects.toMatchObject({ status: 409 })
  expect(await purgeExpiredPayloads(database)).toBe(1)
  expect(await database.event.findUnique({ where: { id: first.eventId } })).toMatchObject({ payload: {}, canonicalBody: '' })
  expect(await database.event.findUnique({ where: { id: pending.eventId } })).toMatchObject({ payload: input.payload, payloadPurgedAt: null })
  expect(await deliveryDetail(database, alpha.id, claim.id)).toMatchObject({
    event: { payloadPurgedAt: expect.any(String) }, attempts: [{ status: 'FAILED' }],
  })
  await expect(submitWorkspaceEvent(database, alpha.id, input)).resolves.toEqual({ ...first, created: false })
})

test('old and new signatures both work over HTTPS during rotation and only the new key works afterward', async () => {
  const alpha = await workspace('alpha')
  const secrets = new Map([['/alpha', destinationSecret(signingRoot, alpha.endpoint.id)]])
  const receiver = await betaReceiver(secrets)
  try {
    const rotation = await rotateDestinationKey(database, 'alpha', alpha.endpoint.id, 'LIVE')
    await expect(rotateDestinationKey(replica, 'alpha', alpha.endpoint.id, 'LIVE')).rejects.toMatchObject({ status: 409 })
    await expect(rotateDestinationKey(replica, 'alpha', alpha.endpoint.id, 'TEST')).rejects.toMatchObject({ status: 409 })
    async function deliver() {
      await submitWorkspaceEvent(database, alpha.id, event())
      const claim = (await claimNext(database, 'private'))!
      const outcome = await sendApproved(claim, signingRoot, receiver.transport)
      await finalize(database, claim, outcome)
      return outcome
    }
    expect(await deliver()).toEqual(success)
    const oldSecret = secrets.get('/alpha')!
    const newSecret = destinationSecret(signingRoot, alpha.endpoint.id, rotation.signingVersion)
    secrets.set('/alpha', newSecret)
    expect(await deliver()).toEqual(success)
    await database.endpoint.update({ where: { id: alpha.endpoint.id }, data: { signingOverlapUntil: ago(1_000) } })
    expect(await deliver()).toEqual(success)
    secrets.set('/alpha', oldSecret)
    expect(await deliver()).toMatchObject({ kind: 'permanent', status: 401 })
  } finally {
    await receiver.close()
  }
})

test('a slow HTTPS receiver in flight does not delay another destination and worker metrics report its heartbeat', async () => {
  const slow = await workspace('slow')
  const healthy = await workspace('healthy')
  let markSlowStarted!: () => void
  let unblockSlow!: () => void
  const slowStarted = new Promise<void>((resolve) => { markSlowStarted = resolve })
  const slowUnblocked = new Promise<void>((resolve) => { unblockSlow = resolve })
  const receiver = await betaReceiver(new Map([
    ['/slow', destinationSecret(signingRoot, slow.endpoint.id)],
    ['/healthy', destinationSecret(signingRoot, healthy.endpoint.id)],
  ]), async (path) => {
    if (path !== '/slow') return 200
    markSlowStarted()
    await slowUnblocked
    return 503
  })
  const stop = new AbortController()
  const worker = runWorker(database, 'private', (claim) => sendApproved(claim, signingRoot, receiver.transport), stop.signal)
  try {
    const blocked = await submitWorkspaceEvent(database, slow.id, event())
    await slowStarted
    const other = await submitWorkspaceEvent(database, healthy.id, event())
    await expect.poll(
      async () => (await database.delivery.findUnique({ where: { id: other.deliveryId! } }))?.status,
      { timeout: 2_500, interval: 50 },
    ).toBe('DELIVERED')
    expect((await database.delivery.findUnique({ where: { id: blocked.deliveryId! } }))?.status).toBe('PROCESSING')
    expect(await metrics(database, 'private')).toMatch(/relaydesk_worker_heartbeat_age_seconds [0-9]/)
  } finally {
    unblockSlow()
    stop.abort()
    await worker
    await receiver.close()
  }
})
