import { z } from 'zod'
import { db } from '@/server/db'
import { decodeJson, json, parse, readBytes, respond } from '@/server/http'
import { authorizeMutation } from '@/server/operator'
import { replay } from '@/server/replay'
import { receiverModes } from '@/shared/delivery'

const replaySchema = z.strictObject({ receiverMode: z.enum(receiverModes).optional() })

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    await authorizeMutation(request)
    const id = parse(z.uuid(), (await params).id)
    const bytes = await readBytes(request, 2 * 1024)
    const { receiverMode } = parse(replaySchema, bytes.length ? decodeJson(bytes) : {})
    return json(await replay(db(), id, receiverMode))
  })
}
