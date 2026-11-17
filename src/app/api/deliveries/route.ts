import { db } from '@/server/db'
import { json, respond } from '@/server/http'
import { listDeliveries } from '@/server/reads'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return respond(async () => json(await listDeliveries(db(), new URL(request.url).searchParams)))
}
