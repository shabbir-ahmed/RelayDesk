export function testDatabaseUrl(env = process.env) {
  const runtimeUrl = env.DATABASE_URL
  const testUrl = env.TEST_DATABASE_URL
  if (!runtimeUrl || !testUrl) throw new Error('Set DATABASE_URL and a separate TEST_DATABASE_URL.')
  const runtime = new URL(runtimeUrl)
  const test = new URL(testUrl)
  const isPostgres = (url) => ['postgresql:', 'postgres:'].includes(url.protocol)
  if (!isPostgres(runtime) || !isPostgres(test)) throw new Error('Use PostgreSQL URLs.')
  const runtimeDb = decodeURIComponent(runtime.pathname)
  const testDb = decodeURIComponent(test.pathname)
  if (runtimeDb === testDb || !/^\/[a-z][a-z0-9_]*_test$/.test(testDb)) {
    throw new Error('TEST_DATABASE_URL must name a different, disposable database ending in _test.')
  }
  return testUrl
}
