import { z } from 'zod'
import { db } from '../src/server/db'
import {
  approveRequestedDestination, pendingDestinationRequests, rejectDestinationRequest, rejectionNoteSchema,
} from '../src/server/destination-requests'
import { BlockedDestination } from '../src/server/destinations'
import { appMode, signingEnv } from '../src/server/env'
import { ApiError } from '../src/server/http'
import { destinationSecret } from '../src/server/workspaces'

const args = z.union([
  z.tuple([z.literal('list')]),
  z.tuple([z.literal('approve'), z.uuid()]),
  z.tuple([z.literal('reject'), z.uuid(), rejectionNoteSchema]),
])

async function main() {
  const input = args.safeParse(process.argv.slice(2))
  if (!input.success || appMode() !== 'private') {
    throw new ApiError(400, 'INVALID_INPUT', 'Usage (private RelayDesk): npm run destination:requests -- list | approve <request-id> | reject <request-id> "<reason>"')
  }
  const database = db()
  try {
    const [action, id, reason] = input.data
    if (action === 'list') {
      console.log(JSON.stringify(await pendingDestinationRequests(database), null, 2))
    } else if (action === 'reject') {
      console.log(JSON.stringify(await rejectDestinationRequest(database, id, reason), null, 2))
    } else {
      const { DESTINATION_SIGNING_KEY } = signingEnv()
      const endpoint = await approveRequestedDestination(database, id)
      console.log(JSON.stringify({
        ...endpoint, signingSecret: destinationSecret(DESTINATION_SIGNING_KEY, endpoint.id),
      }, null, 2))
    }
  } finally {
    await database.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof ApiError || error instanceof BlockedDestination
    ? error.message
    : 'Could not review the destination request. Check database access and the destination DNS.')
  process.exitCode = 1
})
