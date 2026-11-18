import type { Prisma, PrismaClient } from '@prisma/client'
import type { Environment } from '../shared/delivery'
import { ApiError } from './http'

export const dailyLimits = { TEST: 100, LIVE: 1000 } satisfies Record<Environment, number>

function usageDay(now: Date) {
  return now.toISOString().slice(0, 10)
}

export async function consumeEvent(tx: Prisma.TransactionClient, workspaceId: string, environment: Environment, now: Date) {
  const day = usageDay(now)
  const [updated] = await tx.$queryRaw<{ count: number }[]>`
    INSERT INTO "DailyUsage" ("workspaceId", "environment", day, count)
    VALUES (${workspaceId}::uuid, ${environment}::"Environment", ${day}::date, 1)
    ON CONFLICT ("workspaceId", "environment", day) DO UPDATE
    SET count = "DailyUsage".count + 1
    WHERE "DailyUsage".count < ${dailyLimits[environment]}
    RETURNING count
  `
  if (!updated) throw new ApiError(429, 'RATE_LIMITED', 'Daily event limit reached. Usage resets at midnight UTC.')
}

export async function readUsage(db: PrismaClient, workspaceId: string, environment: Environment, now = new Date()) {
  const day = new Date(usageDay(now))
  const usage = await db.dailyUsage.findUnique({
    where: { workspaceId_environment_day: { workspaceId, environment, day } }, select: { count: true },
  })
  const resetsAt = new Date(day.getTime() + 86_400_000).toISOString()
  return { environment, used: usage?.count ?? 0, limit: dailyLimits[environment], resetsAt }
}
