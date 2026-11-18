import { matchesSecret } from '@/server/credentials'
import { db } from '@/server/db'
import { appMode } from '@/server/env'
import { ApiError, respond, unauthorized } from '@/server/http'
import { metrics } from '@/server/metrics'

export async function GET(request: Request) {
  return respond(async () => {
    const secret = process.env.OPS_METRICS_TOKEN
    if (!secret || !/^[a-f0-9]{64}$/i.test(secret)) throw new ApiError(404, 'NOT_FOUND', 'Metrics are unavailable.')
    const bearer = request.headers.get('authorization') ?? ''
    if (bearer.length !== 71 || !matchesSecret(bearer, 'Bearer ' + secret)) throw unauthorized()
    return new Response(await metrics(db(), appMode()), {
      headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  })
}
