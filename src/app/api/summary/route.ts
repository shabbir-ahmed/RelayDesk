import { db } from '@/server/db'
import { json, respond } from '@/server/http'
import { deliveryReadScope } from '@/server/operator'
import { deliverySummary } from '@/server/reads'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return respond(async () => {
    const { workspaceId, environment } = await deliveryReadScope(request)
    return json(await deliverySummary(db(), workspaceId, environment))
  })
}
