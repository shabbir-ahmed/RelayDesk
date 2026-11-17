import { db } from '@/server/db'
import { json, missingDelivery, respond } from '@/server/http'
import { deliveryDetail } from '@/server/reads'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const result = await deliveryDetail(db(), (await params).id)
    if (!result) throw missingDelivery()
    return json(result)
  })
}
