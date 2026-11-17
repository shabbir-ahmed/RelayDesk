import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { signedHeaders } from '../../src/server/signing'
import { classifyHttp } from '../../src/worker/outcomes'
import { claimNext, finalize } from '../../src/worker/queue'
import { send } from '../../src/worker/send'
import { prepareDatabase, testDb } from '../support/database'

const database = testDb()
const origin = process.env.APP_ORIGIN!
const secret = process.env.RECEIVER_SECRET!
const auth = { authorization: `Bearer ${process.env.API_TOKEN}` }
const request = (path: string, options?: RequestInit) => fetch(origin + path, options)
const post = (path: string, body?: unknown, headers: Record<string, string> = {}) => request(path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
})

const input = (receiverMode = 'SUCCEED') => ({
  eventType: 'synthetic.api.test', idempotencyKey: randomUUID(), receiverMode,
  payload: { synthetic: true, orderId: 'test-001', nested: { z: 2, a: '✓' } },
})

beforeEach(prepareDatabase)
afterAll(() => database.$disconnect())

test('T01 persists both records and delivers the signed body through HTTP', async () => {
  const payload = JSON.parse('{"constructor":"sample","nested":{"__proto__":{"synthetic":true}}}')
  const event = { ...input(), payload }
  const response = await post('/api/events', event, auth)
  expect(response.status).toBe(201)
  const { eventId, deliveryId } = await response.json()
  const stored = await database.event.findUniqueOrThrow({ where: { id: eventId } })
  expect(stored.payload).toEqual(payload)
  expect(JSON.parse(stored.canonicalBody)).toMatchObject({ id: eventId, payload })
  const claim = (await claimNext(database))!
  expect(claim).toMatchObject({ id: deliveryId, event: { id: eventId } })
  const outcome = await send(claim, origin, secret)
  expect(outcome).toEqual({ kind: 'success', status: 200 })
  expect(await finalize(database, claim, outcome)).toBe(true)
  expect(await (await request('/api/deliveries/' + deliveryId)).json()).toMatchObject({
    status: 'DELIVERED', attempts: [{ status: 'SUCCEEDED', httpStatus: 200 }],
  })
})

test('T02 simultaneous and reordered submissions reuse IDs while different inputs conflict', async () => {
  const event = input('ALWAYS_FAIL')
  const responses = await Promise.all([post('/api/events', event, auth), post('/api/events', event, auth)])
  expect(responses.map(({ status }) => status).sort()).toEqual([200, 201])
  const [ids, other] = await Promise.all(responses.map((response) => response.json()))
  expect(ids).toEqual(other)
  const reordering = { ...event, payload: { nested: { a: '✓', z: 2 }, orderId: 'test-001', synthetic: true } }
  const repeated = await post('/api/events', reordering, auth)
  expect(repeated.status).toBe(200)
  expect(await repeated.json()).toEqual(ids)
  expect((await post('/api/events', { ...event, receiverMode: 'SUCCEED' }, auth)).status).toBe(409)
  expect((await post('/api/events', { ...event, payload: { synthetic: true } }, auth)).status).toBe(409)
  expect(await database.event.count()).toBe(1)
  expect(await database.delivery.count()).toBe(1)

  await finalize(database, (await claimNext(database))!, classifyHttp(400))
  const login = await post('/api/operator/login', { credential: process.env.OPERATOR_CREDENTIAL }, { origin })
  const cookie = login.headers.get('set-cookie')!.split(';')[0]
  expect((await post(`/api/deliveries/${ids.deliveryId}/replay`, { receiverMode: 'SUCCEED' }, { origin, cookie })).status).toBe(200)
  const afterReplay = await post('/api/events', event, auth)
  expect(afterReplay.status).toBe(200)
  expect(await afterReplay.json()).toEqual(ids)
})

test('T05 times out through HTTP, reschedules, and terminates on a permanent 4xx', async () => {
  const { deliveryId } = await (await post('/api/events', input('TIMEOUT'), auth)).json()
  const claim = (await claimNext(database))!
  const outcome = await send(claim, origin, secret)
  expect(outcome).toMatchObject({ kind: 'retry', error: expect.stringContaining('Outcome at receiver is unknown') })
  expect(await finalize(database, claim, outcome)).toBe(true)
  expect(await database.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).toMatchObject({ status: 'PENDING', attemptsInCycle: 1 })
  expect(await claimNext(database)).toBeNull()

  await database.$executeRaw`UPDATE "Delivery" SET "nextAttemptAt" = clock_timestamp() WHERE id = ${deliveryId}::uuid`
  expect(await finalize(database, (await claimNext(database))!, classifyHttp(422))).toBe(true)
  expect(await database.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).toMatchObject({
    status: 'FAILED', attemptsInCycle: 2, nextAttemptAt: null,
  })
  expect(await claimNext(database)).toBeNull()
}, 8_000)

test('T09 rejects invalid JSON, modes, scalars, oversized streams, and creates no work', async () => {
  const invalid = await request('/api/events', { method: 'POST', headers: auth, body: '{"broken"' })
  expect(invalid.status).toBe(400)
  expect(await invalid.json()).toMatchObject({ error: { code: 'INVALID_INPUT' } })
  expect((await post('/api/events', input('https://example.com/'), auth)).status).toBe(400)
  expect((await post('/api/events', { ...input(), payload: ['bad'] }, auth)).status).toBe(400)
  expect((await post('/api/events', { ...input(), payload: { text: 'a'.repeat(17_000) } }, auth)).status).toBe(413)
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Buffer.from('{"payload":"'))
      for (let n = 0; n < 5; n++) controller.enqueue(Buffer.alloc(4_096, 'a'))
      controller.enqueue(Buffer.from('"}'))
      controller.close()
    },
  })
  const streamed: RequestInit & { duplex: 'half' } = { method: 'POST', headers: auth, body, duplex: 'half' }
  expect((await request('/api/events', streamed)).status).toBe(413)
  expect(await database.event.count()).toBe(0)
  expect(await database.delivery.count()).toBe(0)
})

test('T10 authorizes only the intended clients and throttles repeated bad sign-ins', async () => {
  const loginPath = '/api/operator/login'
  const credentials = { credential: process.env.OPERATOR_CREDENTIAL }
  const wrongOrigin = 'https://wrong.example'
  const replayPath = '/api/deliveries/' + randomUUID() + '/replay'
  expect((await post('/api/events', input())).status).toBe(401)
  expect((await post('/api/events', input(), { authorization: 'Bearer invalid' })).status).toBe(401)
  expect((await post(replayPath, {}, auth)).status).toBe(401)
  expect((await post('/api/operator/logout', undefined, { origin })).status).toBe(401)
  expect((await post(loginPath, credentials, { origin: wrongOrigin })).status).toBe(403)

  const login = await post(loginPath, credentials, { origin })
  expect(login.status).toBe(200)
  const cookieHeader = login.headers.get('set-cookie')!
  expect(cookieHeader).toMatch(/HttpOnly/i)
  expect(cookieHeader).toMatch(/SameSite=Lax/i)
  expect(cookieHeader).toMatch(/Max-Age=14400/i)
  expect(cookieHeader).not.toContain(process.env.OPERATOR_CREDENTIAL)
  const cookie = cookieHeader.split(';')[0]
  expect((await post('/api/events', input(), { origin: wrongOrigin, cookie })).status).toBe(403)
  expect((await post('/api/events', input(), { cookie })).status).toBe(403)
  expect((await post('/api/events', input(), { origin, cookie: cookie + 'broken' })).status).toBe(401)
  expect((await post('/api/events', input(), { origin, cookie })).status).toBe(201)
  expect((await post('/api/events', input(), auth)).status).toBe(201)

  const logout = await post('/api/operator/logout', undefined, { origin, cookie })
  expect(logout.status).toBe(200)
  expect(logout.headers.get('set-cookie')).toMatch(/Max-Age=0/i)
  for (let n = 0; n < 5; n++) expect((await post(loginPath, { credential: 'wrong' }, { origin })).status).toBe(401)
  expect((await post(loginPath, credentials, { origin })).status).toBe(429)
})

test('T11 accepts authentic receiver requests and rejects absent, stale, or modified signatures', async () => {
  const path = '/api/demo/receiver'
  const eventId = randomUUID()
  const event = { id: eventId, type: 'synthetic.signature', createdAt: new Date().toISOString(), payload: { synthetic: true } }
  const body = JSON.stringify(event)
  const metadata = { eventId, deliveryId: randomUUID(), cycle: 1, attempt: 1, timestamp: Math.floor(Date.now() / 1_000), mode: 'SUCCEED' as const }
  const signed = signedHeaders(secret, metadata, body)
  const sendBody = (headers: Record<string, string>, raw = body) => request(path, { method: 'POST', body: raw, headers })
  expect((await sendBody({})).status).toBe(401)
  expect((await sendBody(signed)).status).toBe(200)
  expect((await sendBody({ ...signed, 'x-relaydesk-mode': 'ALWAYS_FAIL' })).status).toBe(401)
  expect((await sendBody({ ...signed, 'x-relaydesk-attempt': '2' })).status).toBe(401)
  expect((await sendBody({ ...signed, 'x-relaydesk-cycle': '99999' })).status).toBe(401)
  expect((await sendBody(signed, body + ' ')).status).toBe(401)
  expect((await sendBody(signedHeaders(secret, { ...metadata, eventId: randomUUID() }, body))).status).toBe(401)
  expect((await sendBody(signedHeaders(secret, { ...metadata, timestamp: metadata.timestamp - 301 }, body))).status).toBe(401)
})

test('T12 list filters, keyset paging, limits, counts, and response fields are bounded', async () => {
  for (let number = 0; number < 52; number++) {
    expect((await post('/api/events', input(), auth)).status).toBe(201)
  }
  const twinDate = new Date('2026-01-01T00:00:00Z')
  await database.delivery.updateMany({ data: { createdAt: twinDate } })
  const failedId = (await database.delivery.findFirstOrThrow()).id
  await database.delivery.update({ where: { id: failedId }, data: { status: 'FAILED', nextAttemptAt: null } })
  const listPath = '/api/deliveries'
  const firstResponse = await request(listPath)
  expect(firstResponse.headers.get('cache-control')).toBe('no-store')
  const first = await firstResponse.json()
  expect(first.items).toHaveLength(25)
  const second = await (await request(listPath + '?cursor=' + first.nextCursor)).json()
  const third = await (await request(listPath + '?cursor=' + second.nextCursor)).json()
  expect(second.items).toHaveLength(25)
  expect(third.items).toHaveLength(2)
  expect(third.nextCursor).toBeNull()
  const ids: string[] = [...first.items, ...second.items, ...third.items].map(({ id }) => id)
  expect(ids).toEqual([...new Set(ids)].sort().reverse())
  expect((await (await request(listPath + '?limit=50')).json()).items).toHaveLength(50)
  expect((await request(listPath + '?limit=51')).status).toBe(400)
  expect((await request(listPath + '?cursor=bad')).status).toBe(400)
  expect((await request(listPath + '?status=INVALID')).status).toBe(400)
  expect(await (await request(listPath + '?status=FAILED')).json()).toMatchObject({ items: [{ id: failedId }], nextCursor: null })
  const detail = await (await request(listPath + '/' + failedId)).json()
  const summary = await (await request('/api/summary')).json()
  expect(summary.counts).toEqual({ FAILED: 1, PENDING: 51, PROCESSING: 0, DELIVERED: 0 })
  expect(Object.keys(first.items[0]).sort()).toEqual(['attemptsInCycle', 'createdAt', 'cycle', 'event', 'historical', 'id', 'status'])
  expect(Object.keys(detail.event).sort()).toEqual(['createdAt', 'eventType', 'id', 'payload'])
  expect(JSON.stringify({ first, detail, summary })).not.toMatch(/leaseToken|idempotencyKey|requestFingerprint|canonicalBody|secret/i)
})
