import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { acknowledgeAlert, countOpenAlerts, listAlerts } from '../../src/server/alerts'
import { listAudit } from '../../src/server/audit'
import { submitWorkspaceEvent, submitWorkspaceTest } from '../../src/server/events'
import { listDeliveries } from '../../src/server/reads'
import { replay } from '../../src/server/replay'
import { approveDestination, provisionWorkspace, updateSubscriptions } from '../../src/server/workspaces'
import { classifyHttp } from '../../src/worker/outcomes'
import { claimNext, finalize, recoverExpired } from '../../src/worker/queue'
import { prepareDatabase, testDb } from '../support/database'

const database = testDb()

beforeEach(prepareDatabase)
afterAll(() => database.$disconnect())

async function workspace(slug: string) {
  return provisionWorkspace(database, { slug, name: slug, url: `https://${slug}.receiver.test/initial` })
}

function event(eventType: string) {
  return { idempotencyKey: randomUUID(), eventType, payload: { value: 1 } }
}

test('fan-out and zero-match receipts stay fixed across subscription changes', async () => {
  const alpha = await workspace('alpha')
  const beta = await workspace('beta')
  const extra = await approveDestination(database, { slug: 'alpha', name: 'Invoices', url: 'https://alpha.receiver.test/invoices' })
  const paused = await approveDestination(database, { slug: 'alpha', name: 'Paused', url: 'https://alpha.receiver.test/paused' })
  await updateSubscriptions(database, alpha.id, extra.id, ['invoice.paid'])
  const input = event('invoice.paid')
  const create = () => submitWorkspaceEvent(database, alpha.id, input)
  const receipts = await Promise.all([create(), create()])
  const { eventId, deliveryId, deliveryIds } = receipts[0]
  expect(receipts.map(({ created }) => created).sort()).toEqual([false, true])
  expect(receipts[1]).toMatchObject({ eventId, deliveryId, deliveryIds })
  expect(deliveryIds).toHaveLength(2)

  const query = (workspaceId: string, fields: Record<string, string>) =>
    listDeliveries(database, workspaceId, new URLSearchParams(fields))
  const first = await query(alpha.id, { query: 'PAID', limit: '1' })
  const second = await query(alpha.id, { query: 'PAID', limit: '1', cursor: first.nextCursor! })
  expect([...first.items, ...second.items].map(({ id }) => id).sort()).toEqual([...deliveryIds].sort())
  expect((await query(alpha.id, { query: eventId })).items).toHaveLength(2)
  expect((await query(alpha.id, { query: deliveryId! })).items).toHaveLength(1)
  expect((await query(alpha.id, { destination: extra.id, query: 'paid', status: 'PENDING' })).items).toHaveLength(1)
  expect((await query(alpha.id, { destination: paused.id })).items).toEqual([])
  expect((await query(alpha.id, { query: '%' })).items).toEqual([])
  expect((await query(beta.id, { query: eventId })).items).toEqual([])
  expect((await query(beta.id, { destination: extra.id })).items).toEqual([])

  await updateSubscriptions(database, alpha.id, alpha.endpoint.id, [])
  await updateSubscriptions(database, alpha.id, extra.id, [])
  expect(await create()).toEqual({ eventId, deliveryId, deliveryIds, created: false })
  const noMatch = event('order.created')
  const unrouted = await submitWorkspaceEvent(database, alpha.id, noMatch)
  expect(unrouted).toMatchObject({ deliveryId: null, deliveryIds: [], created: true })
  await updateSubscriptions(database, alpha.id, paused.id, ['*'])
  expect(await submitWorkspaceEvent(database, alpha.id, noMatch)).toEqual({ ...unrouted, created: false })

  const sample = event('relaydesk.test')
  const testExtra = await approveDestination(database, { slug: 'alpha', name: 'Test invoices', url: 'https://alpha.receiver.test/invoices', environment: 'TEST' })
  const testPaused = await approveDestination(database, { slug: 'alpha', name: 'Test paused', url: 'https://alpha.receiver.test/paused', environment: 'TEST' })
  await expect(submitWorkspaceTest(database, alpha.id, sample)).rejects.toMatchObject({ status: 400 })
  await expect(submitWorkspaceTest(database, alpha.id, sample, beta.endpoint.id)).rejects.toMatchObject({ status: 404 })
  await expect(submitWorkspaceTest(database, alpha.id, sample, extra.id)).rejects.toMatchObject({ status: 404 })
  const targeted = await submitWorkspaceTest(database, alpha.id, sample, testExtra.id)
  expect(targeted.deliveryIds).toHaveLength(1)
  expect(await submitWorkspaceTest(database, alpha.id, sample, testExtra.id)).toEqual({ ...targeted, created: false })
  await expect(submitWorkspaceTest(database, alpha.id, sample, testPaused.id)).rejects.toMatchObject({ status: 409 })
  expect((await listDeliveries(database, alpha.id, new URLSearchParams({ destination: testExtra.id }), 'TEST')).items[0])
    .toMatchObject({ id: targeted.deliveryId, event: { isTest: true } })
  expect((await query(alpha.id, { destination: testExtra.id })).items).toEqual([])
})

test('terminal failures alert once per cycle and only the owning workspace can acknowledge or replay them', async () => {
  const alpha = await workspace('alpha')
  const beta = await workspace('beta')
  const receipt = await submitWorkspaceEvent(database, alpha.id, event('invoice.paid'))
  for (let attempt = 1; attempt <= 3; attempt++) {
    const claim = await claimNext(database, 'private')
    expect(claim?.id).toBe(receipt.deliveryId)
    expect(await finalize(database, claim!, classifyHttp(503))).toBe(true)
    expect(await finalize(database, claim!, classifyHttp(503))).toBe(false)
    expect(await countOpenAlerts(database, alpha.id)).toBe(attempt === 3 ? 1 : 0)
    if (attempt < 3) {
      await database.$executeRaw`UPDATE "Delivery" SET "nextAttemptAt" = clock_timestamp() - interval '1 second'
        WHERE id = ${receipt.deliveryId}::uuid`
    }
  }
  const { items: [alert] } = await listAlerts(database, alpha.id, new URLSearchParams(), true)
  expect(alert).toMatchObject({ deliveryId: receipt.deliveryId, cycle: 1, reason: expect.stringContaining('503') })
  expect(await acknowledgeAlert(database, beta.id, alert.id)).toBe(false)
  expect((await listAlerts(database, beta.id, new URLSearchParams(), false)).items).toEqual([])
  await expect(replay(database, beta.id, receipt.deliveryId!)).rejects.toMatchObject({ status: 404 })

  expect(await replay(database, alpha.id, receipt.deliveryId!)).toMatchObject({ cycle: 2 })
  const claim = (await claimNext(database, 'private'))!
  expect(claim.id).toBe(receipt.deliveryId)
  expect(await finalize(database, claim, classifyHttp(400))).toBe(true)
  expect(await countOpenAlerts(database, alpha.id)).toBe(2)
  expect(await acknowledgeAlert(database, alpha.id, alert.id)).toBe(true)
  expect(await acknowledgeAlert(database, alpha.id, alert.id)).toBe(true)
  const history = await listAlerts(database, alpha.id, new URLSearchParams(), false)
  expect(history.items).toHaveLength(2)
  expect(history.items.find(({ id }) => id === alert.id)?.acknowledgedAt).toBeTruthy()
  expect(await countOpenAlerts(database, alpha.id)).toBe(1)
  expect((await listAudit(database, alpha.id, new URLSearchParams())).items
    .filter(({ action }) => action === 'DELIVERY_REPLAYED')).toHaveLength(1)
  expect((await listAudit(database, beta.id, new URLSearchParams())).items
    .some(({ action }) => action === 'DELIVERY_REPLAYED')).toBe(false)
})

test('recovery emits an alert when the final worker lease expires', async () => {
  const alpha = await workspace('alpha')
  const receipt = await submitWorkspaceEvent(database, alpha.id, event('invoice.paid'))
  for (let attempt = 1; attempt <= 3; attempt++) {
    const claim = await claimNext(database, 'private')
    expect(claim?.id).toBe(receipt.deliveryId)
    await database.$executeRaw`UPDATE "Delivery" SET "leaseExpiresAt" = clock_timestamp() - interval '1 second'
      WHERE id = ${receipt.deliveryId}::uuid`
    expect(await recoverExpired(database, 'private')).toBe(1)
    expect(await countOpenAlerts(database, alpha.id)).toBe(attempt === 3 ? 1 : 0)
    if (attempt < 3) {
      await database.$executeRaw`UPDATE "Delivery" SET "nextAttemptAt" = clock_timestamp() - interval '1 second'
        WHERE id = ${receipt.deliveryId}::uuid`
    }
  }
  const history = await listAlerts(database, alpha.id, new URLSearchParams(), false)
  expect(history.items).toHaveLength(1)
  expect(history.items[0].reason).toMatch(/lease expired/)
})
