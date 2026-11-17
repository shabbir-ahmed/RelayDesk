import { z } from 'zod'

type ErrorCode = 'INVALID_INPUT' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'BODY_TOO_LARGE' | 'RATE_LIMITED' | 'UNAVAILABLE'

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: ErrorCode, message: string) {
    super(message)
  }
}

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function respond(handler: () => Promise<Response>) {
  try {
    return await handler()
  } catch (error) {
    if (error instanceof ApiError) return json({ error: { code: error.code, message: error.message } }, error.status)
    console.error('RelayDesk request failed', error instanceof Error ? error.name : 'UnknownError')
    return json({ error: { code: 'UNAVAILABLE', message: 'The application could not complete the request.' } }, 503)
  }
}

export const invalid = (message: string) => new ApiError(400, 'INVALID_INPUT', message)
export const unauthorized = () => new ApiError(401, 'UNAUTHORIZED', 'Valid authentication is required.')
export const missingDelivery = () => new ApiError(404, 'NOT_FOUND', 'Delivery was not found.')

export function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value)
  if (!result.success) {
    const { path, message } = result.error.issues[0]
    throw invalid(path.length ? `${path.join('.')}: ${message}` : message)
  }
  return result.data
}

export async function readBytes(request: Request, cap = 16 * 1024) {
  const tooLarge = () => new ApiError(413, 'BODY_TOO_LARGE', `Request body must be at most ${cap / 1024} KiB.`)
  if (Number(request.headers.get('content-length')) > cap) throw tooLarge()
  if (!request.body) return Buffer.alloc(0)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return Buffer.concat(chunks, length)
      length += value.byteLength
      if (length > cap) {
        void reader.cancel().catch(() => {})
        throw tooLarge()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
}

export function decodeJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw invalid('Enter valid UTF-8 JSON.')
  }
}

export async function readJson(request: Request, cap?: number) {
  return decodeJson(await readBytes(request, cap))
}
