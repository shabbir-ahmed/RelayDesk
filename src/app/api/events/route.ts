import { db } from '@/server/db'
import { demoScope } from '@/server/demo'
import { submissionSchema, submitEvent, submitWorkspaceEvent, workspaceSubmissionSchema } from '@/server/events'
import { json, parse, readJson, respond } from '@/server/http'
import { authorizeMutation } from '@/server/operator'

export async function POST(request: Request) {
  return respond(async () => {
    const scope = await authorizeMutation(request, true)
    const input = await readJson(request)
    const result = scope.mode === 'demo'
      ? await submitEvent(db(), parse(submissionSchema, input), demoScope)
      : await submitWorkspaceEvent(db(), scope.workspaceId, parse(workspaceSubmissionSchema, input), scope.environment)
    const { created, ...data } = result
    return json(data, created ? 201 : 200)
  })
}
