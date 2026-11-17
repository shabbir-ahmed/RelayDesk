import { expect, test } from 'vitest'
import { testDatabaseUrl } from '../../scripts/test-db.mjs'

test('test database guard rejects runtime aliases, missing settings, and non-test names', () => {
  const DATABASE_URL = 'postgresql://user@127.0.0.1:5432/relaydesk'
  expect(() => testDatabaseUrl({ DATABASE_URL })).toThrow()
  expect(() => testDatabaseUrl({ DATABASE_URL, TEST_DATABASE_URL: 'postgres://different@localhost/relaydesk?schema=public' })).toThrow()
  expect(() => testDatabaseUrl({ DATABASE_URL, TEST_DATABASE_URL: 'postgres://different@localhost/another' })).toThrow()
  const TEST_DATABASE_URL = 'postgres://user@localhost/relaydesk_test'
  expect(testDatabaseUrl({ DATABASE_URL, TEST_DATABASE_URL })).toBe(TEST_DATABASE_URL)
  expect(() => testDatabaseUrl({ DATABASE_URL: TEST_DATABASE_URL, TEST_DATABASE_URL })).toThrow()
})
