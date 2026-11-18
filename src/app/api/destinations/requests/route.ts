import { db } from '@/server/db'
import { requestDestination, requestDestinationSchema } from '@/server/destination-requests'
import { json, parse, readJson, respond } from '@/server/http'
import { authorizeMutation, requireOwner } from '@/server/operator'

export async function POST(request: Request) {
  return respond(async () => {
    const scope = await authorizeMutation(request)
    requireOwner(scope)
    const input = parse(requestDestinationSchema, await readJson(request, 16 * 1024))
    return json(await requestDestination(db(), scope.workspaceId, scope.environment, scope.actor, input), 201)
  })
}
