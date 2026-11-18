import { z } from 'zod'
import { createApiKey, listApiKeys } from '@/server/api-keys'
import { db } from '@/server/db'
import { ApiError, json, parse, readJson, respond } from '@/server/http'
import { authorizeMutation, privateSession } from '@/server/operator'

const name = z.string().trim().min(1).max(80).refine((value) => !value.includes('\u0000') && value.isWellFormed())
const body = z.strictObject({ name })

export async function GET(request: Request) {
  return respond(async () => {
    const scope = await privateSession(request)
    return json({ keys: await listApiKeys(db(), scope.workspaceId, scope.environment) })
  })
}

export async function POST(request: Request) {
  return respond(async () => {
    const scope = await authorizeMutation(request)
    if (scope.mode !== 'private') throw new ApiError(404, 'NOT_FOUND', 'Key management is available in private workspaces.')
    const { name } = parse(body, await readJson(request, 2 * 1024))
    return json(await createApiKey(db(), scope.workspaceId, name, scope.environment, scope.actor), 201)
  })
}
