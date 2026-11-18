import { z } from 'zod'
import { rotateApiKey } from '@/server/api-keys'
import { db } from '@/server/db'
import { ApiError, json, parse, respond } from '@/server/http'
import { authorizeMutation } from '@/server/operator'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const scope = await authorizeMutation(request)
    if (scope.mode !== 'private') throw new ApiError(404, 'NOT_FOUND', 'API key not found.')
    const id = parse(z.uuid(), (await params).id)
    return json(await rotateApiKey(db(), scope.workspaceId, id, scope.environment, scope.actor), 201)
  })
}
