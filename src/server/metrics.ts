import type { PrismaClient } from '@prisma/client'
import type { AppMode } from './env'

export async function metrics(db: PrismaClient, mode: AppMode) {
  const [row] = await db.$queryRaw<{
    heartbeat: number; ready: number; oldest: number; expired: number; failures: number; attempts: number; retried: number
  }[]>`
    WITH pending AS (
      SELECT d."nextAttemptAt"
      FROM "Delivery" d JOIN "Endpoint" e ON e.id = d."endpointId"
      WHERE d.status = 'PENDING' AND d."nextAttemptAt" <= statement_timestamp()
        AND (NOT d.historical OR d.cycle > 1)
        AND (e."destinationUrl" IS NOT NULL) = ${mode === 'private'}
    ),
    recent AS (
      SELECT a."attemptNumber", a.status
      FROM "DeliveryAttempt" a JOIN "Delivery" d ON d.id = a."deliveryId" JOIN "Endpoint" e ON e.id = d."endpointId"
      WHERE a."completedAt" >= statement_timestamp() - interval '5 minutes'
        AND (NOT d.historical OR d.cycle > 1)
        AND (e."destinationUrl" IS NOT NULL) = ${mode === 'private'}
    )
    SELECT
      COALESCE((SELECT EXTRACT(EPOCH FROM statement_timestamp() - "seenAt")::float8
        FROM "WorkerHeartbeat" WHERE mode = ${mode}), -1) AS heartbeat,
      (SELECT count(*)::float8 FROM pending) AS ready,
      COALESCE((SELECT EXTRACT(EPOCH FROM statement_timestamp() - min("nextAttemptAt"))::float8 FROM pending), 0) AS oldest,
      (SELECT count(*)::float8 FROM "Delivery" d JOIN "Endpoint" e ON e.id = d."endpointId"
        WHERE d.status = 'PROCESSING' AND d."leaseExpiresAt" <= statement_timestamp()
          AND (NOT d.historical OR d.cycle > 1)
          AND (e."destinationUrl" IS NOT NULL) = ${mode === 'private'}) AS expired,
      (SELECT count(*)::float8 FROM "FailureAlert" WHERE "createdAt" >= statement_timestamp() - interval '5 minutes'
        AND ${mode === 'private'}) AS failures,
      (SELECT count(*)::float8 FROM recent) AS attempts,
      (SELECT count(*)::float8 FROM recent WHERE "attemptNumber" > 1) AS retried
  `
  const gauges = {
    worker_heartbeat_age_seconds: row.heartbeat,
    queue_ready: row.ready,
    queue_oldest_ready_seconds: row.oldest,
    expired_leases: row.expired,
    exhausted_deliveries_5m: row.failures,
    completed_attempts_5m: row.attempts,
    retry_attempts_5m: row.retried,
  }
  return Object.entries(gauges).map(([name, value]) =>
    `# TYPE relaydesk_${name} gauge\nrelaydesk_${name} ${value}\n`
  ).join('')
}
