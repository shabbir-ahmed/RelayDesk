ALTER TYPE "AuditAction" ADD VALUE 'MEMBER_REMOVED';
ALTER TYPE "AuditAction" ADD VALUE 'API_KEY_ROTATED';
ALTER TYPE "AuditAction" ADD VALUE 'SIGNING_KEY_ROTATED';

ALTER TABLE "Account" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "recoveryDigest" CHAR(64);
ALTER TABLE "Membership" ADD COLUMN "sessionId" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "ApiKey" ADD COLUMN "expiresAt" TIMESTAMPTZ(3);
ALTER TABLE "Endpoint" ADD COLUMN "signingVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "signingOverlapUntil" TIMESTAMPTZ(3);
ALTER TABLE "Event" ADD COLUMN "payloadPurgedAt" TIMESTAMPTZ(3);
ALTER TABLE "DailyUsage" ADD COLUMN "deliveries" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "AuthLimit" (
  "key" TEXT PRIMARY KEY,
  "windowStart" TIMESTAMPTZ(3) NOT NULL,
  "count" INTEGER NOT NULL
);
CREATE TABLE "WorkerHeartbeat" (
  "mode" TEXT PRIMARY KEY,
  "seenAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "Delivery_endpointId_status_idx" ON "Delivery"("endpointId", status);
CREATE INDEX "Event_payloadPurgedAt_createdAt_idx" ON "Event"("payloadPurgedAt", "createdAt");
CREATE INDEX "FailureAlert_createdAt_idx" ON "FailureAlert"("createdAt");

-- Carry today's existing delivery and manual replay charges into the first pilot limit window.
WITH charges AS (
  SELECT e."workspaceId", e.environment, count(*) AS deliveries
  FROM "Delivery" d JOIN "Event" e ON e.id = d."eventId"
  JOIN "Workspace" w ON w.id = e."workspaceId"
  WHERE w.slug IS NOT NULL AND d."createdAt" >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
  GROUP BY e."workspaceId", e.environment
  UNION ALL
  SELECT a."workspaceId", COALESCE(a.environment, e.environment), count(*)
  FROM "AuditEntry" a
  LEFT JOIN "Delivery" d ON d.id = a."targetId"
  LEFT JOIN "Event" e ON e.id = d."eventId"
  WHERE a.action = 'DELIVERY_REPLAYED' AND a."createdAt" >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    AND COALESCE(a.environment, e.environment) IS NOT NULL
  GROUP BY a."workspaceId", COALESCE(a.environment, e.environment)
)
INSERT INTO "DailyUsage" ("workspaceId", environment, day, count, deliveries)
SELECT "workspaceId", environment, (now() AT TIME ZONE 'UTC')::date, 0, sum(deliveries)::integer
FROM charges WHERE environment IS NOT NULL GROUP BY "workspaceId", environment
ON CONFLICT ("workspaceId", environment, day) DO UPDATE SET deliveries = EXCLUDED.deliveries;
