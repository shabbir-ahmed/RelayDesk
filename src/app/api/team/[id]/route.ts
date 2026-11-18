import { z } from 'zod'
import { removeWorkspaceMember } from '@/server/accounts'
import { db } from '@/server/db'
import { json, parse, respond } from '@/server/http'
import { authorizeMutation, requireOwner } from '@/server/operator'

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const scope = await authorizeMutation(request)
    requireOwner(scope)
    const id = parse(z.uuid(), (await params).id)
    await removeWorkspaceMember(db(), scope.workspaceId, id, scope.actor)
    return json({ removed: true })
  })
}
