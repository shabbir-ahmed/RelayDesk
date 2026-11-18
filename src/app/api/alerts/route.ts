import { listAlerts } from '@/server/alerts'
import { db } from '@/server/db'
import { json, respond } from '@/server/http'
import { privateSession } from '@/server/operator'

export async function GET(request: Request) {
  return respond(async () => {
    const { workspaceId, environment } = await privateSession(request)
    const params = new URL(request.url).searchParams
    return json(await listAlerts(db(), workspaceId, params, params.get('view') !== 'all', environment))
  })
}
