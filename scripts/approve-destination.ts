import { db } from '../src/server/db'
import { BlockedDestination, destinationUrl, resolveDestination } from '../src/server/destinations'
import { appMode, signingEnv } from '../src/server/env'
import { ApiError } from '../src/server/http'
import { approveDestination, destinationSecret } from '../src/server/workspaces'

async function main() {
  const [slug, name, input, mode = 'live', ...extra] = process.argv.slice(2)
  if (!slug || !name || !input || extra.length || (mode !== 'test' && mode !== 'live')) {
    throw new ApiError(400, 'INVALID_INPUT', 'Usage: npm run destination:approve -- <workspace-slug> "<name>" <https-destination> [test|live]')
  }
  if (appMode() !== 'private') throw new ApiError(400, 'INVALID_INPUT', 'Select the private RelayDesk instance.')
  const { DESTINATION_SIGNING_KEY } = signingEnv()
  const url = destinationUrl(input)
  await resolveDestination(url.hostname)
  const database = db()
  try {
    const approved = await approveDestination(database, { slug, name, url: url.href, environment: mode === 'test' ? 'TEST' : 'LIVE' })
    console.log(JSON.stringify({ id: approved.id, environment: mode, name: approved.name, destinationUrl: approved.destinationUrl, signingSecret: destinationSecret(DESTINATION_SIGNING_KEY, approved.id) }, null, 2))
  } finally {
    await database.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof ApiError || error instanceof BlockedDestination
    ? error.message
    : 'Could not approve the destination. Check the name, DNS, database access, and whether the URL is already approved.')
  process.exitCode = 1
})
