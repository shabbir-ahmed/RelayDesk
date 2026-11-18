import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { createAccountWorkspace } from '../../src/server/accounts'
import { listAudit } from '../../src/server/audit'
import { submitWorkspaceEvent, submitWorkspaceTest } from '../../src/server/events'
import { createInvitation, redeemInvitation, revokeInvitation } from '../../src/server/invitations'
import { listDeliveries } from '../../src/server/reads'
import { readUsage } from '../../src/server/usage'
import { approveDestination, updateSubscriptions } from '../../src/server/workspaces'
import { prepareDatabase, testDb } from '../support/database'

const database = testDb()
const password = 'local-only test password'

beforeEach(prepareDatabase)
afterAll(() => database.$disconnect())

async function signup(slug: string) {
  return createAccountWorkspace(database, { name: slug, workspace: slug, username: slug + '-owner', password })
}

test('an invitation can be redeemed once and stays scoped to its workspace', async () => {
  const alpha = await signup('alpha')
  const beta = await signup('beta')
  const invitation = await createInvitation(database, alpha.workspaceId, 'alpha-owner')
  await expect(revokeInvitation(database, beta.workspaceId, invitation.id, 'beta-owner')).rejects.toMatchObject({ status: 404 })
  await expect(redeemInvitation(database, { token: invitation.token, username: 'beta-owner', password: 'incorrect password' }))
    .rejects.toMatchObject({ status: 401 })

  const accepted = await Promise.allSettled([
    redeemInvitation(database, { token: invitation.token, username: 'beta-owner', password }),
    redeemInvitation(database, { token: invitation.token, username: 'beta-owner', password }),
  ])
  expect(accepted.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  expect(accepted.find((result) => result.status === 'rejected')).toMatchObject({ reason: { status: 404 } })
  const memberships = await database.membership.findMany({
    where: { accountId: beta.accountId }, orderBy: { role: 'asc' }, select: { role: true, workspaceId: true },
  })
  expect(memberships).toEqual([
    { role: 'OWNER', workspaceId: beta.workspaceId }, { role: 'MEMBER', workspaceId: alpha.workspaceId },
  ])
  const audit = await listAudit(database, alpha.workspaceId, new URLSearchParams(), 'TEST')
  expect(audit.items.filter(({ action }) => action === 'INVITE_ACCEPTED'))
    .toMatchObject([{ actor: 'beta-owner', targetId: invitation.id }])
  expect(JSON.stringify(audit)).not.toContain(invitation.token)
})

test('expired and revoked invitations cannot create accounts or memberships', async () => {
  const alpha = await signup('alpha')
  const expired = await createInvitation(database, alpha.workspaceId, 'alpha-owner')
  const revoked = await createInvitation(database, alpha.workspaceId, 'alpha-owner')
  await database.invitation.update({ where: { id: expired.id }, data: { expiresAt: new Date(0) } })
  await revokeInvitation(database, alpha.workspaceId, revoked.id, 'alpha-owner')
  for (const invitation of [expired, revoked]) {
    await expect(redeemInvitation(database, { token: invitation.token, username: 'new-member', password }))
      .rejects.toMatchObject({ status: 404 })
  }
  expect(await database.account.count()).toBe(1)
  expect(await database.membership.count()).toBe(1)
})

test('quota charging is atomic, idempotent and independent across environments', async () => {
  const { workspaceId } = await signup('alpha')
  const url = 'https://alpha.receiver.test/quotes'
  const demo = await approveDestination(database, { slug: 'alpha', name: 'Sandbox', url, environment: 'TEST' })
  const live = await approveDestination(database, { slug: 'alpha', name: 'Production', url, environment: 'LIVE' })
  await updateSubscriptions(database, workspaceId, demo.id, ['*'], 'TEST')
  await updateSubscriptions(database, workspaceId, live.id, ['*'], 'LIVE')

  const today = new Date(new Date().toISOString().slice(0, 10))
  await database.dailyUsage.create({
    data: { workspaceId, environment: 'TEST', day: new Date(today.getTime() - 86_400_000), count: 100 },
  })
  expect((await readUsage(database, workspaceId, 'TEST')).used).toBe(0)
  await database.dailyUsage.create({ data: { workspaceId, environment: 'TEST', day: today, count: 99 } })

  const inputs = [randomUUID(), randomUUID()].map((idempotencyKey) => ({ eventType: 'quote.accepted', payload: {}, idempotencyKey }))
  const received = await Promise.allSettled(inputs.map((input) => submitWorkspaceEvent(database, workspaceId, input, 'TEST')))
  expect(received.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
  expect(received.find(({ status }) => status === 'rejected')).toMatchObject({ reason: { status: 429 } })
  const index = received.findIndex(({ status }) => status === 'fulfilled')
  const accepted = received[index]
  if (accepted.status !== 'fulfilled') throw new Error('Expected one accepted submission.')
  expect(await submitWorkspaceEvent(database, workspaceId, inputs[index], 'TEST')).toEqual({ ...accepted.value, created: false })

  const production = await submitWorkspaceEvent(database, workspaceId, inputs[index], 'LIVE')
  expect(production.eventId).not.toBe(accepted.value.eventId)
  const testRows = (await listDeliveries(database, workspaceId, undefined, 'TEST')).items
  const liveRows = (await listDeliveries(database, workspaceId, undefined, 'LIVE')).items
  expect(testRows).toMatchObject([{ endpoint: { id: demo.id }, event: { isTest: true } }])
  expect(liveRows).toMatchObject([{ endpoint: { id: live.id }, event: { isTest: false } }])
  expect(await database.event.count({ where: { workspaceId } })).toBe(2)
  expect((await readUsage(database, workspaceId, 'TEST')).used).toBe(100)
  expect((await readUsage(database, workspaceId, 'LIVE')).used).toBe(1)
})

test('a rejected test destination does not charge quota', async () => {
  const { workspaceId } = await signup('alpha')
  const live = await approveDestination(database, { slug: 'alpha', name: 'Live', url: 'https://alpha.receiver.test/live' })
  await expect(submitWorkspaceTest(database, workspaceId, { eventType: 'sample', payload: {}, idempotencyKey: randomUUID() }, live.id))
    .rejects.toMatchObject({ status: 404 })
  expect((await readUsage(database, workspaceId, 'TEST')).used).toBe(0)
  expect(await database.event.count({ where: { workspaceId } })).toBe(0)
})
