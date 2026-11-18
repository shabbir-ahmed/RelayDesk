import { z } from 'zod'
import { db } from '@/server/db'
import { json, parse, respond } from '@/server/http'
import { revokeInvitation } from '@/server/invitations'
import { authorizeMutation, requireOwner } from '@/server/operator'

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const scope = await authorizeMutation(request)
    requireOwner(scope)
    const id = parse(z.uuid(), (await params).id)
    await revokeInvitation(db(), scope.workspaceId, id, scope.actor)
    return json({ revoked: true })
  })
}
