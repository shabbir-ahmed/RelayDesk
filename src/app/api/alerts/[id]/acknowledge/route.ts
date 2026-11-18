import { z } from 'zod'
import { acknowledgeAlert } from '@/server/alerts'
import { db } from '@/server/db'
import { ApiError, json, parse, respond } from '@/server/http'
import { authorizeMutation } from '@/server/operator'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const scope = await authorizeMutation(request)
    const id = parse(z.uuid(), (await params).id)
    if (scope.mode !== 'private' || !await acknowledgeAlert(db(), scope.workspaceId, id)) {
      throw new ApiError(404, 'NOT_FOUND', 'Alert not found.')
    }
    return json({ acknowledged: true })
  })
}
