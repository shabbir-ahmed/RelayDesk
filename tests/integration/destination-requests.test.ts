import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, expect, test } from 'vitest'
import {
  approveRequestedDestination, pendingDestinationRequests, rejectDestinationRequest, requestDestination, workspaceDestinationRequests,
} from '../../src/server/destination-requests'
import { BlockedDestination, type ResolveHost } from '../../src/server/destinations'
import { submitWorkspaceEvent, submitWorkspaceTest } from '../../src/server/events'
import { approveDestination, updateSubscriptions, workspaceDestinations } from '../../src/server/workspaces'
import { prepareDatabase, testDb } from '../support/database'

const database = testDb()
const resolvePublic: ResolveHost = async () => [{ address: '1.1.1.1', family: 4 }]
const slug = 'destination-requests'
const input = { name: 'Billing preview', url: 'https://alpha.receiver.test/billing' }
const actor = 'pilot-owner'

beforeEach(prepareDatabase)
afterAll(() => database.$disconnect())

function workspace(name = slug) {
  return database.workspace.create({ data: { slug: name, name } })
}

test('requests are scoped by workspace and environment, and pending URLs never enter routing', async () => {
  const alpha = await workspace()
  const beta = await workspace('other-workspace')
  const pending = await requestDestination(database, alpha.id, 'TEST', actor, input)
  expect(await workspaceDestinationRequests(database, alpha.id, 'TEST')).toMatchObject([{ id: pending.id, status: 'PENDING' }])
  expect(await workspaceDestinationRequests(database, alpha.id, 'LIVE')).toEqual([])
  expect(await workspaceDestinationRequests(database, beta.id, 'TEST')).toEqual([])
  expect(await workspaceDestinations(database, alpha.id, 'TEST')).toEqual([])
  const event = { idempotencyKey: randomUUID(), eventType: 'invoice.paid', payload: { synthetic: true } }
  await expect(submitWorkspaceTest(database, alpha.id, event, pending.id)).rejects.toMatchObject({ status: 404 })
  await expect(submitWorkspaceEvent(database, alpha.id, event, 'TEST')).resolves.toMatchObject({ deliveryIds: [] })

  await expect(approveRequestedDestination(database, pending.id, async () => [])).rejects.toBeInstanceOf(BlockedDestination)
  expect(await pendingDestinationRequests(database)).toMatchObject([{ id: pending.id, workspace: { slug }, environment: 'TEST' }])
  const approved = await approveRequestedDestination(database, pending.id, resolvePublic)
  expect(approved).toMatchObject({ environment: 'TEST', name: input.name, eventTypes: [] })
  expect(await workspaceDestinationRequests(database, alpha.id, 'TEST')).toMatchObject([
    { id: pending.id, status: 'APPROVED', reviewedAt: expect.any(String) },
  ])
  expect(await pendingDestinationRequests(database)).toHaveLength(0)
  expect(await workspaceDestinations(database, alpha.id, 'LIVE')).toEqual([])
  expect(await workspaceDestinations(database, beta.id, 'TEST')).toEqual([])
  await updateSubscriptions(database, alpha.id, approved.id, ['invoice.paid'], 'TEST')
  await expect(submitWorkspaceEvent(database, alpha.id, event, 'TEST')).resolves.toMatchObject({ deliveryIds: [], created: false })
  const sent = await submitWorkspaceEvent(database, alpha.id, { ...event, idempotencyKey: randomUUID() }, 'TEST')
  expect(await database.delivery.findMany({ where: { eventId: sent.eventId } })).toMatchObject([{ endpointId: approved.id }])
  expect(await database.auditEntry.findMany({ where: { workspaceId: alpha.id, action: 'DESTINATION_REQUESTED' } }))
    .toMatchObject([{ targetId: pending.id, environment: 'TEST', actor }])
})

test('concurrent equivalent requests create only one pending record and direct approval resolves it', async () => {
  const alpha = await workspace()
  const requests = await Promise.allSettled([
    requestDestination(database, alpha.id, 'LIVE', actor, { ...input, url: 'https://ALPHA.receiver.test' }),
    requestDestination(database, alpha.id, 'LIVE', actor, { ...input, url: 'https://alpha.receiver.test/' }),
  ])
  expect(requests.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1)
  expect(requests.find((entry) => entry.status === 'rejected')).toMatchObject({ reason: { status: 409 } })
  const approved = await approveDestination(database, { slug, name: 'Billing', url: 'https://alpha.receiver.test/' })
  expect(await database.destinationRequest.findMany({ where: { workspaceId: alpha.id } }))
    .toMatchObject([{ status: 'APPROVED', endpointId: approved.id }])
  await expect(requestDestination(database, alpha.id, 'LIVE', actor, { ...input, url: 'https://alpha.receiver.test/' }))
    .rejects.toMatchObject({ status: 409 })
  await expect(requestDestination(database, alpha.id, 'TEST', actor, { ...input, url: 'https://alpha.receiver.test/' }))
    .resolves.toMatchObject({ status: 'PENDING' })
})

test('rejection wins over an in-flight approval and a new request keeps the old decision in history', async () => {
  const alpha = await workspace()
  const first = await requestDestination(database, alpha.id, 'TEST', actor, input)
  let started!: () => void
  let finish!: () => void
  const entered = new Promise<void>((resolve) => { started = resolve })
  const dns = new Promise<void>((resolve) => { finish = resolve })
  const approval = approveRequestedDestination(database, first.id, async (hostname) => {
    started()
    await dns
    return resolvePublic(hostname)
  })
  const approvalResult = expect(approval).rejects.toMatchObject({ status: 409 })
  try {
    await entered
    const rejected = await rejectDestinationRequest(database, first.id, 'Confirm who owns this endpoint.')
    expect(rejected).toMatchObject({ status: 'REJECTED', reviewNote: 'Confirm who owns this endpoint.' })
  } finally {
    finish()
  }
  await approvalResult
  const second = await requestDestination(database, alpha.id, 'TEST', actor, input)
  expect(second.id).not.toBe(first.id)
  expect(await workspaceDestinations(database, alpha.id, 'TEST')).toEqual([])
  expect(await workspaceDestinationRequests(database, alpha.id, 'TEST')).toMatchObject([
    { id: second.id, status: 'PENDING' }, { id: first.id, status: 'REJECTED' },
  ])
  expect(await database.auditEntry.findMany({ where: { workspaceId: alpha.id, action: 'DESTINATION_REQUEST_REJECTED' } }))
    .toMatchObject([{ targetId: first.id, environment: 'TEST' }])
})
