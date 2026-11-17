import { db } from '@/server/db'
import { submitWorkspaceEvent, workspaceSubmissionSchema } from '@/server/events'
import { ApiError, json, parse, readJson, respond } from '@/server/http'
import { authorizeMutation } from '@/server/operator'

export async function POST(request: Request) {
  return respond(async () => {
    const scope = await authorizeMutation(request)
    if (scope.mode !== 'private') throw new ApiError(404, 'NOT_FOUND', 'Test events are available in private workspaces.')
    const input = parse(workspaceSubmissionSchema, await readJson(request))
    const { created, ...data } = await submitWorkspaceEvent(db(), scope.workspaceId, input, true)
    return json(data, created ? 201 : 200)
  })
}
