import { z } from 'zod'
import { db } from '@/server/db'
import { ApiError, json, parse, readJson, respond } from '@/server/http'
import { authorizeMutation } from '@/server/operator'
import { subscriptionsSchema, updateSubscriptions } from '@/server/workspaces'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const scope = await authorizeMutation(request)
    if (scope.mode !== 'private') throw new ApiError(404, 'NOT_FOUND', 'Destination not found.')
    const id = parse(z.uuid(), (await params).id)
    const { eventTypes } = parse(subscriptionsSchema, await readJson(request, 16 * 1024))
    return json(await updateSubscriptions(db(), scope.workspaceId, id, eventTypes, scope.environment, scope.actor))
  })
}
