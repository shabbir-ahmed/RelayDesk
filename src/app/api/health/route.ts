import { db } from '@/server/db'
import { appMode, demoWebEnv, webEnv } from '@/server/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const headers = { 'Cache-Control': 'no-store' }
  try {
    if (appMode() === 'demo') demoWebEnv()
    else webEnv()
    await db().$queryRaw`SELECT 1`
    return Response.json({ status: 'ok', database: 'reachable' }, { headers })
  } catch {
    return Response.json({ error: { code: 'UNAVAILABLE', message: 'Application is not ready.' } }, { status: 503, headers })
  }
}
