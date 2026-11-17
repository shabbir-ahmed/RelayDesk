import { db } from '@/server/db'
import { submissionSchema, submitEvent } from '@/server/events'
import { json, parse, readJson, respond } from '@/server/http'
import { authorizeMutation } from '@/server/operator'

export async function POST(request: Request) {
  return respond(async () => {
    await authorizeMutation(request, true)
    const input = parse(submissionSchema, await readJson(request))
    const { created, ...result } = await submitEvent(db(), input)
    return json(result, created ? 201 : 200)
  })
}
