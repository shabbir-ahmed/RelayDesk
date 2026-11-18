import type { PrismaClient } from '@prisma/client'
import { ApiError } from './http'

export async function limitAuth(db: PrismaClient, key: string, limit = 5) {
  const [attempt] = await db.$queryRaw<{ windowStart: Date }[]>`
    INSERT INTO "AuthLimit" ("key", "windowStart", "count")
    VALUES (${key}, date_trunc('minute', statement_timestamp()), 1)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "AuthLimit"."windowStart" < EXCLUDED."windowStart" THEN 1 ELSE "AuthLimit"."count" + 1 END,
      "windowStart" = GREATEST("AuthLimit"."windowStart", EXCLUDED."windowStart")
    WHERE "AuthLimit"."windowStart" < EXCLUDED."windowStart" OR "AuthLimit"."count" < ${limit}
    RETURNING "windowStart"
  `
  if (!attempt) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Try again in a minute.')
  return attempt.windowStart
}

export async function clearAuthLimit(db: PrismaClient, key: string, windowStart: Date) {
  await db.authLimit.deleteMany({ where: { key, windowStart } })
}
