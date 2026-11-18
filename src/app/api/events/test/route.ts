import { z } from 'zod'
import { db } from '@/server/db'
import { submitWorkspaceTest, workspaceSubmissionSchema } from '@/server/events'
import { ApiError, json, parse, readJson, respond } from '@/server/http'
import { authorizeMutation } from '@/server/operator'

const body = workspaceSubmissionSchema.extend({ destinationId: z.uuid().optional() })

export async function POST(request: Request) {
  return respond(async () => {
    const scope = await authorizeMutation(request)
    if (scope.mode !== 'private') throw new ApiError(404, 'NOT_FOUND', 'Test events are available in private workspaces.')
    if (scope.environment !== 'TEST') throw new ApiError(400, 'INVALID_INPUT', 'Switch to the Test environment to send a test event.')
    const { destinationId, ...input } = parse(body, await readJson(request))
    const { created, ...data } = await submitWorkspaceTest(db(), scope.workspaceId, input, destinationId)
    return json(data, created ? 201 : 200)
  })
}
