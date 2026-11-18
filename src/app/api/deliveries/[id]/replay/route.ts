import { z } from 'zod'
import { db } from '@/server/db'
import { decodeJson, json, parse, readBytes, respond } from '@/server/http'
import { authorizeMutation } from '@/server/operator'
import { replay } from '@/server/replay'
import { receiverModes } from '@/shared/delivery'

const replaySchema = z.strictObject({ receiverMode: z.enum(receiverModes).optional() })

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const scope = await authorizeMutation(request)
    const id = parse(z.uuid(), (await params).id)
    const bytes = await readBytes(request, 2 * 1024)
    const input = bytes.length ? decodeJson(bytes) : {}
    if (scope.mode === 'demo') {
      const { receiverMode } = parse(replaySchema, input)
      return json(await replay(db(), scope.workspaceId, id, receiverMode))
    }
    parse(z.strictObject({}), input)
    return json(await replay(db(), scope.workspaceId, id, undefined, scope.environment, scope.actor))
  })
}
