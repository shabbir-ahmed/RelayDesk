import { listAudit } from '@/server/audit'
import { db } from '@/server/db'
import { json, respond } from '@/server/http'
import { privateSession } from '@/server/operator'

export async function GET(request: Request) {
  return respond(async () => {
    const { workspaceId } = await privateSession()
    return json(await listAudit(db(), workspaceId, new URL(request.url).searchParams))
  })
}
