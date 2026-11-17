import { db } from '../src/server/db'
import { BlockedDestination, destinationUrl, resolveDestination } from '../src/server/destinations'
import { appMode, signingEnv } from '../src/server/env'
import { destinationSecret, provisionWorkspace } from '../src/server/workspaces'

async function main() {
  const [slug, name, input, ...extra] = process.argv.slice(2)
  if (!slug || !name || !input || extra.length) {
    throw new Error('Usage: npm run workspace:create -- <slug> "<name>" <https-destination>')
  }
  if (appMode() !== 'private') throw new Error('Select the private RelayDesk instance before creating a workspace.')
  const { DESTINATION_SIGNING_KEY } = signingEnv()
  const url = destinationUrl(input)
  await resolveDestination(url.hostname)
  const database = db()
  try {
    const { credential, endpoint, id } = await provisionWorkspace(database, { slug, name, url: url.href })
    if (!endpoint) throw new Error('The destination could not be created.')
    console.log(JSON.stringify({ workspaceId: id, slug, credential, signingSecret: destinationSecret(DESTINATION_SIGNING_KEY, endpoint.id) }, null, 2))
  } finally {
    await database.$disconnect()
  }
}

main().catch((error: unknown) => {
  if (error instanceof BlockedDestination || (error instanceof Error && error.name === 'ZodError')) {
    console.error('Could not approve the workspace. Check the slug, name, and public HTTPS destination.')
  } else if (error instanceof Error && error.name === 'Error' && /^(Usage:|Select the private|Invalid environment)/.test(error.message)) {
    console.error(error.message)
  } else {
    console.error('Could not create the workspace. Check DNS, database access, and whether the slug is already in use.')
  }
  process.exitCode = 1
})
