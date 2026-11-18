import { db } from '@/server/db'
import { webEnv } from '@/server/env'
import { json, respond } from '@/server/http'
import { createInvitation } from '@/server/invitations'
import { authorizeMutation, requireOwner } from '@/server/operator'

export async function POST(request: Request) {
  return respond(async () => {
    const scope = await authorizeMutation(request)
    requireOwner(scope)
    const { token, ...invitation } = await createInvitation(db(), scope.workspaceId, scope.actor)
    return json({ invitation, link: webEnv().APP_ORIGIN + '/join#' + token }, 201)
  })
}
