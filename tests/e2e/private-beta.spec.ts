import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { demoScope } from '../../src/server/demo'
import { submitEvent } from '../../src/server/events'
import { destinationSecret, provisionWorkspace } from '../../src/server/workspaces'
import { runWorker } from '../../src/worker/run'
import { sendApproved } from '../../src/worker/send-approved'
import { betaReceiver } from '../support/beta-receiver'
import { testDb } from '../support/database'

const origin = process.env.APP_ORIGIN!
const signingKey = process.env.DESTINATION_SIGNING_KEY!

async function signIn(page: Page, slug: string, credential: string) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Sign in to your workspace' })).toBeVisible()
  await page.getByLabel('Workspace slug').fill(slug)
  await page.getByLabel('Workspace access code').fill(credential)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Webhook deliveries' })).toBeVisible()
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
  await expect(database.endpoint.create({
    data: { workspaceId: alpha.id, name: 'Second destination', destinationUrl: 'https://beta.receiver.test/alpha' },
  })).rejects.toMatchObject({ code: 'P2002' })
  const demo = await submitEvent(database, {
    eventType: 'demo.private-boundary', payload: {}, idempotencyKey: randomUUID(), receiverMode: 'SUCCEED',
  }, demoScope)
  const receiver = await betaReceiver(new Map([
    ['/alpha', destinationSecret(signingKey, alpha.endpoint!.id)],
    ['/beta', destinationSecret(signingKey, beta.endpoint!.id)],
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
    await page.getByRole('link', { name: 'Destination' }).click()
    await expect(page.getByText('https://alpha.receiver.test/alpha')).toBeVisible()
    await page.getByRole('button', { name: 'Send test event' }).click()
    await page.getByRole('button', { name: 'Send test', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'relaydesk.test' })).toBeVisible()
    await expect(page.getByText('HTTP 422', { exact: true })).toBeVisible()
    await expect(page.getByText('Test event', { exact: true })).toBeVisible()
    const path = new URL(page.url()).pathname
    expect((await request.get('/api' + path)).status()).toBe(401)

    await signIn(betaPage, beta.slug!, beta.credential)
    await expect(betaPage.getByText('Beta Workspace')).toBeVisible()
    expect((await betaPage.request.get('/api' + path)).status()).toBe(404)
    expect((await betaPage.request.post('/api' + path + '/replay', { headers: mutation })).status()).toBe(404)
    expect((await betaPage.request.get('/api/deliveries/' + demo.deliveryId)).status()).toBe(404)
    expect((await betaPage.request.get('/api/deliveries')).ok()).toBe(true)
    expect((await (await betaPage.request.get('/api/deliveries')).json()).items).toEqual([])
    expect((await (await betaPage.request.get('/api/summary')).json()).counts.FAILED).toBe(0)

    await page.getByRole('button', { name: 'Replay delivery' }).click()
    await page.getByRole('button', { name: 'Queue replay' }).click()
    await expect(page.getByText('HTTP 200', { exact: true })).toBeVisible()
    await expect(page.getByText('HTTP 422', { exact: true })).toBeVisible()
    expect(receiver.messages.map(({ path, cycle }) => [path, cycle])).toEqual([['/alpha', 1], ['/alpha', 2]])
    expect(receiver.messages[0].body).toBe(receiver.messages[1].body)
    expect(JSON.parse(receiver.messages[0].body)).toMatchObject({ id: receiver.messages[0].event, test: true })
    expect((await database.delivery.findUniqueOrThrow({ where: { id: demo.deliveryId } })).status).toBe('PENDING')

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
    expect((await send(token)).status()).toBe(201)
    expect((await send(token)).status()).toBe(200)
    expect((await send(betaKey.token)).status()).toBe(201)
    expect((await request.get('/api/deliveries', { headers: { authorization: 'Bearer ' + token } })).status()).toBe(401)
    await expect.poll(() => receiver.messages.slice(2).map(({ path }) => path).sort()).toEqual(['/alpha', '/beta'])
    expect(receiver.messages.slice(2).map(({ body }) => JSON.parse(body).test)).toEqual([undefined, undefined])

    await page.getByRole('button', { name: 'Revoke Integration' }).click()
    await page.getByRole('button', { name: 'Revoke key' }).click()
    await expect(page.getByText('Create a key when you’re ready to connect an application.')).toBeVisible()
    expect((await send(token)).status()).toBe(401)
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
