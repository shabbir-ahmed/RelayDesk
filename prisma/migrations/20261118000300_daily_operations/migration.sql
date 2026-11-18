BEGIN;

DROP INDEX "Endpoint_workspaceId_key";
ALTER TABLE "Endpoint" ADD COLUMN "eventTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
UPDATE "Endpoint" SET "eventTypes" = ARRAY['*'] WHERE "destinationUrl" IS NOT NULL;
CREATE UNIQUE INDEX "Endpoint_workspaceId_destinationUrl_key" ON "Endpoint"("workspaceId", "destinationUrl");

-- Delivery already records the destination for each existing event.
ALTER TABLE "Event" DROP CONSTRAINT "Event_endpointId_fkey", DROP COLUMN "endpointId";

CREATE TYPE "AuditAction" AS ENUM ('WORKSPACE_CREATED', 'DESTINATION_APPROVED', 'SUBSCRIPTIONS_UPDATED', 'DELIVERY_REPLAYED', 'API_KEY_CREATED', 'API_KEY_REVOKED');

CREATE TABLE "AuditEntry" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "action" "AuditAction" NOT NULL,
  "targetId" UUID NOT NULL,
  "summary" VARCHAR(240) NOT NULL,
  "eventTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuditEntry_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "AuditEntry_workspaceId_createdAt_id_idx" ON "AuditEntry"("workspaceId", "createdAt", "id");

CREATE TABLE "FailureAlert" (
  "id" UUID NOT NULL,
  "deliveryId" UUID NOT NULL,
  "cycle" INTEGER NOT NULL,
  "reason" VARCHAR(160) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" TIMESTAMPTZ(3),
  CONSTRAINT "FailureAlert_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FailureAlert_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FailureAlert_deliveryId_cycle_key" ON "FailureAlert"("deliveryId", "cycle");
CREATE INDEX "FailureAlert_acknowledgedAt_createdAt_id_idx" ON "FailureAlert"("acknowledgedAt", "createdAt", "id");

INSERT INTO "FailureAlert" ("id", "deliveryId", "cycle", "reason", "createdAt")
SELECT gen_random_uuid(), d.id, d.cycle, COALESCE(a.error, 'Delivery failed.'), d."updatedAt"
FROM "Delivery" d
JOIN "Endpoint" e ON e.id = d."endpointId"
LEFT JOIN "DeliveryAttempt" a ON a."deliveryId" = d.id
  AND a.cycle = d.cycle AND a."attemptNumber" = d."attemptsInCycle"
WHERE d.status = 'FAILED' AND e."destinationUrl" IS NOT NULL;

COMMIT;
