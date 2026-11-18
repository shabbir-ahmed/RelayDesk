-- CreateEnum
CREATE TYPE "DestinationRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'DESTINATION_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'DESTINATION_REQUEST_REJECTED';

-- CreateTable
CREATE TABLE "DestinationRequest" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "environment" "Environment" NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "destinationUrl" VARCHAR(2048) NOT NULL,
    "status" "DestinationRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewNote" VARCHAR(240),
    "endpointId" UUID,

    CONSTRAINT "DestinationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DestinationRequest_lookup_idx" ON "DestinationRequest"("workspaceId", "environment", "destinationUrl", "status");

-- CreateIndex
CREATE INDEX "DestinationRequest_workspaceId_environment_createdAt_id_idx" ON "DestinationRequest"("workspaceId", "environment", "createdAt", "id");

-- CreateIndex
CREATE INDEX "DestinationRequest_status_createdAt_id_idx" ON "DestinationRequest"("status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "DestinationRequest_endpointId_idx" ON "DestinationRequest"("endpointId");

-- AddForeignKey
ALTER TABLE "DestinationRequest" ADD CONSTRAINT "DestinationRequest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DestinationRequest" ADD CONSTRAINT "DestinationRequest_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

