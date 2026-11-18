import { z } from 'zod'
import { db } from '../src/server/db'
import { appMode, signingEnv } from '../src/server/env'
import { ApiError } from '../src/server/http'
import { destinationSecret, rotateDestinationKey, workspaceSlug } from '../src/server/workspaces'

async function main() {
  const args = z.tuple([workspaceSlug, z.enum(['test', 'live']), z.uuid()]).safeParse(process.argv.slice(2))
  if (!args.success || appMode() !== 'private') {
    throw new ApiError(400, 'INVALID_INPUT', 'Usage (private RelayDesk): npm run destination:rotate -- <workspace-slug> <test|live> <destination-id>')
  }
  const [slug, scope, id] = args.data
  const { DESTINATION_SIGNING_KEY } = signingEnv()
  const database = db()
  try {
    const rotation = await rotateDestinationKey(database, slug, id, scope === 'test' ? 'TEST' : 'LIVE')
    console.log(JSON.stringify({
      id, environment: scope, overlapUntil: rotation.signingOverlapUntil,
      signingSecret: destinationSecret(DESTINATION_SIGNING_KEY, id, rotation.signingVersion),
    }, null, 2))
  } finally {
    await database.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof ApiError ? error.message : 'Could not rotate the destination signing key.')
  process.exitCode = 1
})
