import { db } from '@/server/db'
import { json, missingDelivery, respond } from '@/server/http'
import { deliveryReadScope } from '@/server/operator'
import { deliveryDetail } from '@/server/reads'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const { workspaceId } = await deliveryReadScope()
    const result = await deliveryDetail(db(), workspaceId, (await params).id)
    if (!result) throw missingDelivery()
    return json(result)
  })
}
