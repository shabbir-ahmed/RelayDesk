import { expect, test } from 'vitest'
import { classifyHttp, retryAt } from '../../src/worker/outcomes'

test.each([408, 429, 500, 503, 599])('retries transient HTTP %i', (status) => {
  expect(classifyHttp(status)).toMatchObject({ kind: 'retry', status })
})
test.each([302, 400, 401, 404, 409])('does not retry HTTP %i', (status) => {
  expect(classifyHttp(status)).toMatchObject({ kind: 'permanent', status })
})
test('accepts 2xx and bounds retries to five and fifteen seconds', () => {
  expect(classifyHttp(299)).toEqual({ kind: 'success', status: 299 })
  expect(retryAt(new Date(0), 1)).toEqual(new Date(5_000))
  expect(retryAt(new Date(0), 2)).toEqual(new Date(15_000))
  expect(retryAt(new Date(0), 3)).toBeNull()
})
