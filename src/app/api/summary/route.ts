import { db } from '@/server/db'
import { json, respond } from '@/server/http'
import { deliverySummary } from '@/server/reads'

export const dynamic = 'force-dynamic'

export async function GET() {
  return respond(async () => json(await deliverySummary(db())))
}
