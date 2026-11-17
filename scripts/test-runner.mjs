import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'
import { testDatabaseUrl } from './test-db.mjs'

if (existsSync('.env')) loadEnvFile('.env')
const mode = process.argv[2]
const test = testDatabaseUrl()
const env = { ...process.env, DATABASE_URL: test, RELAYDESK_TEST_RUN: '1' }

function run(command, args, settings = process.env) {
  const { status, error } = spawnSync(command, args, { env: settings, stdio: 'inherit' })
  if (error) throw error
  if (status !== 0) process.exit(status ?? 1)
}

if (mode !== 'integration') throw new Error('Choose the integration suite.')
run('npm', ['run', 'db:migrate'], env)
run('npx', ['--no-install', 'vitest', 'run', 'tests/integration'], env)
