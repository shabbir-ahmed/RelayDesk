ALTER TABLE "Workspace"
  ADD COLUMN "slug" VARCHAR(60),
  ADD COLUMN "credentialDigest" CHAR(64);

ALTER TABLE "Endpoint" ADD COLUMN "destinationUrl" VARCHAR(2048);
ALTER TABLE "Event" ADD COLUMN "isTest" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ApiKey" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "prefix" VARCHAR(16) NOT NULL,
  "digest" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMPTZ(3),
  CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ApiKey_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");
CREATE UNIQUE INDEX "Endpoint_workspaceId_key" ON "Endpoint"("workspaceId");
CREATE UNIQUE INDEX "ApiKey_digest_key" ON "ApiKey"("digest");
CREATE INDEX "ApiKey_workspaceId_createdAt_idx" ON "ApiKey"("workspaceId", "createdAt");
