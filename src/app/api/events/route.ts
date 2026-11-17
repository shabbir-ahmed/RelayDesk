import { matchesSecret } from '@/server/credentials'
import { db } from '@/server/db'
import { webEnv } from '@/server/env'
import { submissionSchema, submitEvent } from '@/server/events'
import { json, parse, readJson, respond, unauthorized } from '@/server/http'

export async function POST(request: Request) {
  return respond(async () => {
    const header = request.headers.get('authorization')
    if (!header?.startsWith('Bearer ') || !matchesSecret(header.slice(7), webEnv().API_TOKEN)) throw unauthorized()
    const input = parse(submissionSchema, await readJson(request))
    const { created, ...result } = await submitEvent(db(), input)
    return json(result, created ? 201 : 200)
  })
}
