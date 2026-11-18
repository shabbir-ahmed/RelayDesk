import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { demoScope } from '../../src/server/demo'
import { submitEvent } from '../../src/server/events'
import { approveDestination, destinationSecret, provisionWorkspace, updateSubscriptions } from '../../src/server/workspaces'
import { runWorker } from '../../src/worker/run'
import { sendApproved } from '../../src/worker/send-approved'
import { betaReceiver } from '../support/beta-receiver'
import { testDb } from '../support/database'

const origin = process.env.APP_ORIGIN!
const signingKey = process.env.DESTINATION_SIGNING_KEY!

async function signIn(page: Page, slug: string, credential: string, username?: string) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Sign in to your workspace' })).toBeVisible()
  await page.getByLabel('Workspace slug').fill(slug)
  if (username) await page.getByLabel('Username').fill(username)
  await page.getByLabel(username ? 'Password' : 'Workspace access code').fill(credential)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Webhook deliveries' })).toBeVisible()
}

async function switchEnvironment(page: Page, value: 'LIVE' | 'TEST') {
  await page.getByLabel('Environment', { exact: true }).selectOption(value)
  await expect(page.locator('html')).toHaveAttribute('data-environment', value)
}

test('private workspaces deliver signed HTTPS events, isolate history and revoke keys', async ({ page, browser, request }) => {
  if (process.env.RELAYDESK_MODE !== 'private') throw new Error('Run via npm run test:e2e.')
  const database = testDb()
  const alpha = await provisionWorkspace(database, {
    slug: 'alpha-' + randomUUID().slice(0, 8), name: 'Alpha Workspace', url: 'https://alpha.receiver.test/alpha',
  })
  const beta = await provisionWorkspace(database, {
    slug: 'beta-' + randomUUID().slice(0, 8), name: 'Beta Workspace', url: 'https://beta.receiver.test/beta',
  })
  const extra = await approveDestination(database, {
    slug: alpha.slug!, name: 'Billing destination', url: 'https://alpha.receiver.test/extra',
  })
  const testEndpoint = await approveDestination(database, {
    slug: alpha.slug!, name: 'Test endpoint', url: 'https://alpha.receiver.test/sample', environment: 'TEST',
  })
  await expect(approveDestination(database, {
    slug: alpha.slug!, name: 'Duplicate', url: 'https://alpha.receiver.test/alpha',
  })).rejects.toMatchObject({ code: 'P2002' })
  const demo = await submitEvent(database, {
    eventType: 'demo.private-boundary', payload: {}, idempotencyKey: randomUUID(), receiverMode: 'SUCCEED',
  }, demoScope)
  const receiver = await betaReceiver(new Map([
    ['/alpha', destinationSecret(signingKey, alpha.endpoint!.id)],
    ['/beta', destinationSecret(signingKey, beta.endpoint!.id)],
    ['/extra', destinationSecret(signingKey, extra.id)],
    ['/sample', destinationSecret(signingKey, testEndpoint.id)],
  ]))
  const stop = new AbortController()
  const worker = runWorker(database, 'private', (claim) => sendApproved(claim, signingKey, receiver.transport), stop.signal)
  const betaViewer = await browser.newContext({ baseURL: origin })
  const betaPage = await betaViewer.newPage()
  const mutation = { origin }
  try {
    expect((await request.get('/api/deliveries')).status()).toBe(401)
    expect((await request.get('/api/summary')).status()).toBe(401)
    expect((await request.get('/api/keys')).status()).toBe(401)
    expect((await request.post('/api/demo/receiver')).status()).toBe(404)
    expect((await request.post('/api/operator/login', {
      data: { workspace: beta.slug, credential: alpha.credential }, headers: mutation,
    })).status()).toBe(401)

    await signIn(page, alpha.slug!, alpha.credential)
    await expect(page.getByText('Alpha Workspace')).toBeVisible()
    await page.getByRole('link', { name: 'Destinations' }).click()
    await expect(page.getByText('https://alpha.receiver.test/alpha')).toBeVisible()
    const extraCard = page.getByRole('region', { name: 'Billing destination' })
    await extraCard.getByLabel('Event types').fill('invoice.paid')
    await extraCard.getByRole('button', { name: 'Save subscriptions' }).click()
    await expect(extraCard.getByText('Subscriptions saved.')).toBeVisible()
    expect((await page.request.post('/api/events/test', {
      headers: mutation, data: { eventType: 'sample', payload: {}, idempotencyKey: randomUUID() },
    })).status()).toBe(400)
    await switchEnvironment(page, 'TEST')
    await page.getByRole('region', { name: 'Test endpoint' }).getByRole('button', { name: 'Send test event' }).click()
    await page.getByRole('button', { name: 'Send test', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'relaydesk.test' })).toBeVisible()
    await expect(page.getByText('HTTP 422', { exact: true })).toBeVisible()
    await expect(page.getByText('Test event', { exact: true })).toBeVisible()
    const path = new URL(page.url()).pathname
    expect((await request.get('/api' + path)).status()).toBe(401)
    expect((await request.get('/api/alerts')).status()).toBe(401)
    expect((await request.get('/api/audit')).status()).toBe(401)
    const { items: [alert] } = await (await page.request.get('/api/alerts')).json()
    expect(alert.cycle).toBe(1)

    await signIn(betaPage, beta.slug!, beta.credential)
    await expect(betaPage.getByText('Beta Workspace')).toBeVisible()
    expect((await betaPage.request.get('/api' + path)).status()).toBe(404)
    expect((await betaPage.request.post('/api' + path + '/replay', { headers: mutation })).status()).toBe(404)
    expect((await betaPage.request.get('/api/deliveries/' + demo.deliveryId)).status()).toBe(404)
    expect((await betaPage.request.get('/api/deliveries')).ok()).toBe(true)
    expect((await (await betaPage.request.get('/api/deliveries')).json()).items).toEqual([])
    expect((await (await betaPage.request.get('/api/summary')).json()).counts.FAILED).toBe(0)

    expect((await betaPage.request.put(`/api/destinations/${extra.id}/subscriptions`, {
      headers: mutation, data: { eventTypes: ['*'] },
    })).status()).toBe(404)
    expect((await betaPage.request.post('/api/alerts/' + alert.id + '/acknowledge', { headers: mutation })).status()).toBe(404)
    expect((await (await betaPage.request.get('/api/alerts?view=all')).json()).items).toEqual([])

    await page.getByRole('button', { name: 'Replay delivery' }).click()
    await page.getByRole('button', { name: 'Queue replay' }).click()
    await expect(page.getByText('HTTP 200', { exact: true })).toBeVisible()
    await expect(page.getByText('HTTP 422', { exact: true })).toBeVisible()
    expect(receiver.messages.map(({ path, cycle }) => [path, cycle])).toEqual([['/sample', 1], ['/sample', 2]])
    expect(receiver.messages[0].body).toBe(receiver.messages[1].body)
    expect(JSON.parse(receiver.messages[0].body)).toMatchObject({ id: receiver.messages[0].event, test: true })
    expect((await database.delivery.findUniqueOrThrow({ where: { id: demo.deliveryId } })).status).toBe('PENDING')

    await page.getByRole('link', { name: 'Operations' }).click()
    await expect(page.getByRole('region', { name: 'Audit log' }).getByText('Workspace operator queued replay cycle 2.')).toBeVisible()
    await page.getByRole('button', { name: 'Acknowledge', exact: true }).click()
    await expect(page.getByText('No open failure alerts.')).toBeVisible()
    await page.getByLabel('Show alerts').selectOption('all')
    await expect(page.getByText('Acknowledged', { exact: false })).toBeVisible()

    await switchEnvironment(page, 'LIVE')
    expect((await page.request.get('/api' + path)).status()).toBe(404)
    await expect(page.getByText('Workspace operator subscribed Billing destination to 1 event type.')).toBeVisible()
    await expect(page.getByText('Workspace operator queued replay cycle 2.')).toHaveCount(0)
    await page.getByRole('link', { name: 'API keys' }).click()
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Integration')
    await page.getByRole('button', { name: 'Create key' }).click()
    const token = await page.getByTestId('new-api-key').innerText()
    expect(token).toMatch(/^rd_/)
    await page.getByRole('button', { name: 'Done' }).click()
    const { keys: [apiKey] } = await (await page.request.get('/api/keys')).json()
    expect(JSON.stringify(apiKey)).not.toContain(token)
    expect(apiKey.digest).toBeUndefined()
    expect((await betaPage.request.delete('/api/keys/' + apiKey.id, { headers: mutation })).status()).toBe(404)
    expect((await page.request.delete('/api/keys/' + apiKey.id, { headers: { origin: 'https://other.example' } })).status()).toBe(403)
    const betaKey = await (await betaPage.request.post('/api/keys', { headers: mutation, data: { name: 'Beta source' } })).json()
    expect((await (await betaPage.request.get('/api/keys')).json()).keys.map(({ id }: { id: string }) => id)).toEqual([betaKey.id])

    const sample = { eventType: 'invoice.paid', payload: { number: 42 }, idempotencyKey: randomUUID() }
    const send = (key: string, data: object = sample) => request.post('/api/events', {
      headers: { authorization: 'Bearer ' + key }, data,
    })
    expect((await page.request.post('/api/events', { headers: mutation, data: sample })).status()).toBe(401)
    expect((await send(token, { ...sample, destinationUrl: 'https://beta.receiver.test/beta' })).status()).toBe(400)
    const accepted = await send(token)
    expect(accepted.status()).toBe(201)
    expect((await accepted.json()).deliveryIds).toHaveLength(2)
    expect((await send(token)).status()).toBe(200)
    expect((await send(betaKey.token)).status()).toBe(201)
    expect((await request.get('/api/deliveries', { headers: { authorization: 'Bearer ' + token } })).status()).toBe(401)
    await expect.poll(() => receiver.messages.slice(2).map(({ path }) => path).sort()).toEqual(['/alpha', '/beta', '/extra'])
    expect(receiver.messages.slice(2).map(({ body }) => JSON.parse(body).test)).toEqual([undefined, undefined, undefined])

    await page.getByRole('button', { name: 'Revoke Integration' }).click()
    await page.getByRole('button', { name: 'Revoke key' }).click()
    await expect(page.getByText('Create a key when you’re ready to connect an application.')).toBeVisible()
    expect((await send(token)).status()).toBe(401)
    await page.getByRole('link', { name: 'Deliveries', exact: true }).click()
    await page.getByLabel('Search deliveries').fill('INVOICE')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.getByRole('row', { name: /invoice.paid/ })).toHaveCount(2)
    await page.getByLabel('Destination', { exact: true }).selectOption(extra.id)
    await expect(page.getByRole('row', { name: /invoice.paid/ })).toHaveCount(1)

    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.getByRole('heading', { name: 'Sign in to your workspace' })).toBeVisible()
    expect((await page.request.get('/api' + path)).status()).toBe(401)
  } finally {
    stop.abort()
    await worker
    await betaViewer.close()
    await receiver.close()
    await database.$disconnect()
  }
})

test('self-service signup, ownership and environment isolation work end to end', async ({ page, browser, request }) => {
  if (process.env.RELAYDESK_MODE !== 'private') throw new Error('Run via npm run test:e2e.')
  const database = testDb()
  const unique = randomUUID().slice(0, 8)
  const slug = 'self-service-' + unique
  const owner = 'owner-' + unique
  const member = 'member-' + unique
  const password = 'A long test-only password'
  const mutation = { origin }
  const visitor = await browser.newContext({ baseURL: origin })
  const invitee = await visitor.newPage()
  try {
    await page.goto('/signup')
    await page.getByLabel('Workspace name').fill('Self-service team')
    await page.getByLabel('Workspace slug').fill(slug)
    await page.getByLabel('Username').fill(owner)
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Create workspace', exact: true }).click()
    await expect(page.getByText('Self-service team')).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-environment', 'TEST')
    await expect(page.getByText('0 of 100 · Resets at midnight UTC')).toBeVisible()
    const workspace = await database.workspace.findUniqueOrThrow({ where: { slug } })
    const ownerAccount = await database.account.findUniqueOrThrow({ where: { username: owner } })
    expect(ownerAccount.passwordHash).toMatch(/^scrypt-v1:/)
    expect(ownerAccount.passwordHash).not.toContain(password)

    await page.getByRole('link', { name: 'Team', exact: true }).click()
    await expect(page.getByText(owner, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Create invitation' }).click()
    const link = await page.getByTestId('invitation-link').innerText()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await invitee.goto(link)
    await invitee.getByLabel('Username').fill(member)
    await invitee.getByLabel('Password', { exact: true }).fill(password)
    await invitee.getByRole('button', { name: 'Join workspace' }).click()
    await expect(invitee.getByText('Self-service team')).toBeVisible()
    await invitee.getByRole('link', { name: 'Team', exact: true }).click()
    await expect(invitee.getByText(member, { exact: true })).toBeVisible()
    await expect(invitee.getByRole('button', { name: 'Create invitation' })).toHaveCount(0)
    expect((await invitee.request.post('/api/invitations', { headers: mutation })).status()).toBe(403)
    expect((await request.post('/api/invitations/redeem', {
      headers: mutation, data: { username: 'reuse-' + unique, password, token: new URL(link).hash.slice(1) },
    })).status()).toBe(404)
    await invitee.getByRole('button', { name: 'Sign out' }).click()
    await expect(invitee.getByRole('heading', { name: 'Sign in to your workspace' })).toBeVisible()
    await signIn(invitee, slug, password, member)

    const testEndpoint = await approveDestination(database, {
      slug, name: 'Sandbox receiver', url: 'https://alpha.receiver.test/phase3', environment: 'TEST',
    })
    const liveEndpoint = await approveDestination(database, {
      slug, name: 'Live receiver', url: 'https://alpha.receiver.test/phase3', environment: 'LIVE',
    })
    await updateSubscriptions(database, workspace.id, testEndpoint.id, ['*'], 'TEST')
    await updateSubscriptions(database, workspace.id, liveEndpoint.id, ['*'], 'LIVE')
    const sandboxKey = await (await page.request.post('/api/keys', { headers: mutation, data: { name: 'Sandbox source' } })).json()
    const input = { eventType: 'workspace.created', payload: {}, idempotencyKey: randomUUID() }
    const send = (token: string, environment: string) => request.post('/api/events', {
      headers: { authorization: 'Bearer ' + token, 'x-relaydesk-environment': environment }, data: input,
    })
    const accepted = await send(sandboxKey.token, 'LIVE')
    expect(accepted.status()).toBe(201)
    const sample = await accepted.json()
    expect((await page.request.get('/api/deliveries/' + sample.deliveryId)).status()).toBe(200)

    await switchEnvironment(page, 'LIVE')
    expect((await page.request.get('/api/deliveries/' + sample.deliveryId)).status()).toBe(404)
    expect((await page.request.delete('/api/keys/' + sandboxKey.id, { headers: mutation })).status()).toBe(404)
    const stale = { ...mutation, 'x-relaydesk-environment': 'TEST' }
    expect((await page.request.get('/api/deliveries', { headers: stale })).status()).toBe(409)
    expect((await page.request.post('/api/keys', { headers: stale, data: { name: 'Stale tab' } })).status()).toBe(409)
    expect((await (await page.request.get('/api/keys')).json()).keys).toEqual([])
    const liveKey = await (await page.request.post('/api/keys', { headers: mutation, data: { name: 'Production source' } })).json()
    const sent = await send(liveKey.token, 'TEST')
    expect(sent.status()).toBe(201)
    const live = await sent.json()
    expect(live.eventId).not.toBe(sample.eventId)
    const record = await database.delivery.findUniqueOrThrow({
      where: { id: live.deliveryId }, select: { endpointId: true, event: { select: { isTest: true, environment: true } } },
    })
    expect(record).toEqual({ endpointId: liveEndpoint.id, event: { isTest: false, environment: 'LIVE' } })
    expect((await (await page.request.get('/api/summary')).json()).usage).toMatchObject({ environment: 'LIVE', limit: 1000, used: 1 })
    expect((await (await invitee.request.get('/api/summary')).json()).usage).toMatchObject({ environment: 'TEST', limit: 100, used: 1 })
  } finally {
    await visitor.close()
    await database.$disconnect()
  }
})
