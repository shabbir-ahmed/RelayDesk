import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'

async function smoke() {
  const { APP_ORIGIN: origin, API_TOKEN: token } = process.env
  if (!origin || !token) throw new Error('Set APP_ORIGIN and API_TOKEN for the target RelayDesk instance.')
  const request = (path, options) => fetch(new URL(path, origin), { ...options, signal: AbortSignal.timeout(5_000) })
  const health = await request('/api/health')
  assert.equal(health.status, 200, 'Health must confirm database connectivity')
  assert.equal((await health.json()).database, 'reachable')

  const body = {
    eventType: 'synthetic.smoke.retry',
    payload: { synthetic: true, source: 'RelayDesk smoke' },
    receiverMode: 'FAIL_TWICE',
    idempotencyKey: randomUUID(),
  }
  const submit = (data, authenticated = true) => request('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(data),
  })
  assert.equal((await submit(body, false)).status, 401, 'Anonymous submission must fail')
  const created = await submit(body)
  assert.equal(created.status, 201, 'Authenticated submission must create work')
  const ids = await created.json()
  assert.ok(ids.eventId && ids.deliveryId)
  const repeat = await submit(body)
  assert.equal(repeat.status, 200)
  assert.deepEqual(await repeat.json(), ids, 'Repeating a submission must keep both IDs')
  assert.equal((await submit({ ...body, receiverMode: 'SUCCEED' })).status, 409)

  const detailPath = '/api/deliveries/' + ids.deliveryId
  let detail
  for (let check = 0; check < 45; check++) {
    const response = await request(detailPath)
    assert.equal(response.status, 200)
    detail = await response.json()
    if (['DELIVERED', 'FAILED'].includes(detail.status)) break
    await sleep(1_000)
  }
  assert.equal(detail.status, 'DELIVERED', 'Flaky event must succeed within three attempts')
  assert.equal(detail.event.id, ids.eventId)
  assert.deepEqual(detail.attempts.map(({ attemptNumber, status, httpStatus }) => [attemptNumber, status, httpStatus]),
    [[1, 'FAILED', 503], [2, 'FAILED', 503], [3, 'SUCCEEDED', 200]])
  assert.equal((await request(detailPath + '/replay', { method: 'POST' })).status, 401, 'Anonymous replay must fail')
  console.info('Smoke passed · 503 → 503 → 200')
  console.info(new URL('/deliveries/' + ids.deliveryId, origin).href)
}

smoke().catch((error) => {
  console.error('Smoke failed:', error.message)
  process.exitCode = 1
})
