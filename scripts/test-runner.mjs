import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { loadEnvFile } from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { testDatabaseUrl } from './test-db.mjs'

if (existsSync('.env')) loadEnvFile('.env')
const mode = process.argv[2]
if (!['integration', 'e2e', 'verify'].includes(mode)) throw new Error('Choose integration, e2e, or verify.')
const test = testDatabaseUrl()

const env = { ...process.env, DATABASE_URL: test, RELAYDESK_TEST_RUN: '1', NEXT_TELEMETRY_DISABLED: '1' }
for (const name of ['OPERATOR_CREDENTIAL', 'SESSION_SECRET', 'API_TOKEN', 'RECEIVER_SECRET']) {
  env[name] = randomBytes(32).toString('hex')
}

function run(command, args) {
  const { status, error } = spawnSync(command, args, { env, stdio: 'inherit' })
  if (error) throw error
  if (status !== 0) throw new Error(`${command} ${args.join(' ')} exited with status ${status ?? 'unknown'}.`)
}

async function freePort() {
  const server = createServer()
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

async function waitForHealth(web) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (web.exitCode !== null || web.signalCode !== null) break
    const response = await fetch(env.APP_ORIGIN + '/api/health', { signal: AbortSignal.timeout(1_000) }).catch(() => null)
    if (response?.ok) return
    await sleep(250)
  }
  throw new Error('The local test web process did not become healthy.')
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill('SIGTERM')
  const timer = setTimeout(() => child.kill('SIGKILL'), 5_000)
  try {
    await exited
  } finally {
    clearTimeout(timer)
  }
}

async function withWeb(browserTests) {
  const web = spawn(process.execPath, ['.next/standalone/server.js'], { env, stdio: 'inherit' })
  let worker
  try {
    await waitForHealth(web)
    if (browserTests) {
      worker = spawn(process.execPath, ['dist/src/worker/main.js'], { env, stdio: 'inherit' })
      run('npx', ['--no-install', 'playwright', 'test'])
    } else {
      run('npx', ['--no-install', 'vitest', 'run', '--no-file-parallelism', 'tests/integration'])
    }
  } finally {
    await Promise.all([stop(web), stop(worker)])
  }
}

async function main() {
  const port = await freePort()
  const origin = `http://127.0.0.1:${port}`
  Object.assign(env, { PORT: String(port), HOSTNAME: '127.0.0.1', APP_ORIGIN: origin, RECEIVER_BASE_URL: origin })

  if (mode === 'verify') {
    for (const task of ['lint', 'typecheck', 'test:unit']) run('npm', ['run', task])
  }
  run('npm', ['run', 'build'])
  run('npm', ['run', 'db:migrate'])

  if (mode !== 'e2e') await withWeb(false)
  if (mode !== 'integration') {
    run(process.execPath, ['--import', 'tsx', 'tests/support/prepare.ts'])
    await withWeb(true)
  }
}

await main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
