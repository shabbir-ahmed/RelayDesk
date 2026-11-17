import { db } from '@/server/db'
import { json, respond } from '@/server/http'
import { deliveryReadScope } from '@/server/operator'
import { deliverySummary } from '@/server/reads'

export const dynamic = 'force-dynamic'

export async function GET() {
  return respond(async () => {
    const { workspaceId } = await deliveryReadScope()
    return json(await deliverySummary(db(), workspaceId))
  })
}
