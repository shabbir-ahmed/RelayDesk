import { z } from 'zod'
import { invalid, parse } from './http'

const cursorShape = z.tuple([z.iso.datetime(), z.uuid()])
export const pageSchema = z.object({
  cursor: z.string().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/).optional(),
  limit: z.string().regex(/^\d{1,2}$/).transform(Number).pipe(z.number().int().min(1).max(50)).optional(),
})

export const newestFirst = [{ createdAt: 'desc' as const }, { id: 'desc' as const }]

export function pageParams(params: URLSearchParams) {
  const { cursor, limit = 25 } = parse(pageSchema, Object.fromEntries(params))
  return { cursor, limit }
}

export function pageBoundary(cursor?: string) {
  if (!cursor) return {}
  try {
    const [time, id] = cursorShape.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')))
    const createdAt = new Date(time)
    return { OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }] }
  } catch {
    throw invalid('Use a cursor returned by this list.')
  }
}

export function pageResult<Row extends { id: string; createdAt: Date }>(rows: Row[], limit: number) {
  const items = rows.slice(0, limit).map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
  const last = items.at(-1)
  return {
    items,
    nextCursor: rows.length > limit && last
      ? Buffer.from(JSON.stringify([last.createdAt, last.id])).toString('base64url')
      : null,
  }
}
