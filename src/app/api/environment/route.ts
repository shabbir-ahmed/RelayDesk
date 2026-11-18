import { z } from 'zod'
import { webEnv } from '@/server/env'
import { ApiError, json, parse, readJson, respond } from '@/server/http'
import { authorizeMutation, beginSession } from '@/server/operator'
import { environments } from '@/shared/delivery'

const body = z.strictObject({ environment: z.enum(environments) })

export async function POST(request: Request) {
  return respond(async () => {
    const scope = await authorizeMutation(request)
    if (scope.mode !== 'private') throw new ApiError(404, 'NOT_FOUND', 'Environments are available in private workspaces.')
    const { environment } = parse(body, await readJson(request, 1024))
    await beginSession(webEnv(), { ...scope, environment })
    return json({ environment })
  })
}
