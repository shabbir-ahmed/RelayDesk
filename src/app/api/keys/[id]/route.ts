import { z } from 'zod'
import { revokeApiKey } from '@/server/api-keys'
import { db } from '@/server/db'
import { ApiError, json, parse, respond } from '@/server/http'
import { authorizeMutation } from '@/server/operator'

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const scope = await authorizeMutation(request)
    const id = parse(z.uuid(), (await params).id)
    if (scope.mode !== 'private' || !await revokeApiKey(db(), scope.workspaceId, id)) {
      throw new ApiError(404, 'NOT_FOUND', 'API key not found.')
    }
    return json({ revoked: true })
  })
}
