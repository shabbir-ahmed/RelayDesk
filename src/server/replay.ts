import type { PrismaClient } from '@prisma/client'
import type { Environment, ReceiverMode } from '../shared/delivery'
import { maxReplayCycles } from '../worker/timing'
import { recordAudit } from './audit'
import { demoScope } from './demo'
import { ApiError, missingDelivery } from './http'

export async function replay(
  db: PrismaClient, workspaceId: string, id: string, receiverMode?: ReceiverMode,
  environment: Environment = 'LIVE', actor?: string,
) {
  return db.$transaction(async (tx) => {
    const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
    const where = { id, event: { workspaceId, environment } }
    const [queued] = await tx.delivery.updateManyAndReturn({
      where: { ...where, status: 'FAILED', cycle: { lte: maxReplayCycles } },
      data: {
        status: 'PENDING', cycle: { increment: 1 }, attemptsInCycle: 0, nextAttemptAt: now,
        leaseToken: null, leaseExpiresAt: null, receiverMode, updatedAt: now,
      },
      select: { id: true, cycle: true, status: true },
    })
    if (queued) {
      if (workspaceId !== demoScope.workspaceId) {
        await recordAudit(tx, workspaceId, 'DELIVERY_REPLAYED', id, `Workspace operator queued replay cycle ${queued.cycle}.`, { environment, actor })
      }
      return queued
    }
    const delivery = await tx.delivery.findFirst({ where, select: { status: true, cycle: true } })
    if (!delivery) throw missingDelivery()
    const message = delivery.status === 'FAILED' && delivery.cycle > maxReplayCycles
      ? `This delivery already used all ${maxReplayCycles} manual replays.` : 'Only failed deliveries can be replayed.'
    throw new ApiError(409, 'CONFLICT', message)
  })
}
