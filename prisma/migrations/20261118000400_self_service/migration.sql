BEGIN;

CREATE TYPE "Environment" AS ENUM ('TEST', 'LIVE');
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'MEMBER');

ALTER TYPE "AuditAction" ADD VALUE 'INVITE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'INVITE_ACCEPTED';
ALTER TYPE "AuditAction" ADD VALUE 'INVITE_REVOKED';

ALTER TABLE "Endpoint" ADD COLUMN "environment" "Environment" NOT NULL DEFAULT 'LIVE';
ALTER TABLE "Event" ADD COLUMN "environment" "Environment" NOT NULL DEFAULT 'LIVE';
ALTER TABLE "ApiKey" ADD COLUMN "environment" "Environment" NOT NULL DEFAULT 'LIVE';
ALTER TABLE "AuditEntry" ADD COLUMN "environment" "Environment", ADD COLUMN "actor" VARCHAR(80);
UPDATE "AuditEntry" SET "environment" = 'LIVE' WHERE "action" <> 'WORKSPACE_CREATED';

DROP INDEX "Endpoint_workspaceId_destinationUrl_key";
DROP INDEX "Event_workspaceId_idempotencyKey_key";
DROP INDEX "ApiKey_workspaceId_createdAt_idx";
CREATE UNIQUE INDEX "Endpoint_workspaceId_environment_destinationUrl_key" ON "Endpoint"("workspaceId", "environment", "destinationUrl");
CREATE UNIQUE INDEX "Event_workspaceId_environment_idempotencyKey_key" ON "Event"("workspaceId", "environment", "idempotencyKey");
CREATE INDEX "ApiKey_workspaceId_environment_createdAt_idx" ON "ApiKey"("workspaceId", "environment", "createdAt");

CREATE TABLE "Account" (
  "id" UUID NOT NULL,
  "username" VARCHAR(60) NOT NULL,
  "passwordHash" VARCHAR(160) NOT NULL,
  CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Account_username_key" ON "Account"("username");

CREATE TABLE "Membership" (
  "workspaceId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "role" "WorkspaceRole" NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Membership_pkey" PRIMARY KEY ("workspaceId", "accountId"),
  CONSTRAINT "Membership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Membership_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "Membership_accountId_idx" ON "Membership"("accountId");

CREATE TABLE "Invitation" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "digest" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "redeemedAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Invitation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Invitation_digest_key" ON "Invitation"("digest");
CREATE INDEX "Invitation_workspaceId_createdAt_id_idx" ON "Invitation"("workspaceId", "createdAt", "id");

CREATE TABLE "DailyUsage" (
  "workspaceId" UUID NOT NULL,
  "environment" "Environment" NOT NULL,
  "day" DATE NOT NULL,
  "count" INTEGER NOT NULL,
  CONSTRAINT "DailyUsage_pkey" PRIMARY KEY ("workspaceId", "environment", "day"),
  CONSTRAINT "DailyUsage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "DailyUsage" ("workspaceId", "environment", "day", "count")
SELECT e."workspaceId", e."environment", (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, COUNT(*)::integer
FROM "Event" e JOIN "Workspace" w ON e."workspaceId" = w."id"
WHERE w.slug IS NOT NULL AND (e."createdAt" AT TIME ZONE 'UTC')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
GROUP BY e."workspaceId", e."environment";

COMMIT;
