import { createHmac } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import type { Environment } from '../shared/delivery'
import { z } from 'zod'
import { recordAudit } from './audit'
import { newSecret, secretDigest } from './credentials'
import { destinationUrl } from './destinations'
import { ApiError } from './http'

export const workspaceSlug = z.string().min(2).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
export const destinationNameSchema = z.string().trim().min(1).max(80).refine((name) => !name.includes('\u0000') && name.isWellFormed())
const workspaceInput = z.object({ slug: workspaceSlug, name: destinationNameSchema, url: z.string().transform(destinationUrl) })
const destinationSelect = { id: true, name: true, destinationUrl: true, eventTypes: true } as const

export function destinationSecret(key: string, endpointId: string, version = 1) {
  return createHmac('sha256', Buffer.from(key, 'hex'))
    .update(`relaydesk-destination-v${version}:${endpointId}`)
    .digest('hex')
}

export async function provisionWorkspace(db: PrismaClient, input: { slug: string; name: string; url: string }) {
  const { slug, name, url } = workspaceInput.parse(input)
  const credential = newSecret('rdw_')
  return db.$transaction(async (tx) => {
    const workspace = await tx.workspace.create({
      data: { slug, name, credentialDigest: secretDigest(credential) },
      select: { id: true, slug: true, name: true },
    })
    const endpoint = await tx.endpoint.create({
      data: { workspaceId: workspace.id, name: 'Approved destination', destinationUrl: url.href, eventTypes: ['*'] },
      select: destinationSelect,
    })
    await recordAudit(tx, workspace.id, 'WORKSPACE_CREATED', workspace.id, 'Administrator provisioned this workspace.')
    await recordAudit(tx, workspace.id, 'DESTINATION_APPROVED', endpoint.id, 'Administrator approved the first destination for all events.', { environment: 'LIVE' })
    return { ...workspace, endpoint, credential }
  })
}

export async function approveDestination(db: PrismaClient, input: { slug: string; name: string; url: string; environment?: Environment }) {
  const { slug, name, url } = workspaceInput.parse(input)
  const environment = input.environment ?? 'LIVE'
  return db.$transaction(async (tx) => {
    const workspace = await tx.workspace.findUnique({ where: { slug }, select: { id: true } })
    if (!workspace) throw new ApiError(404, 'NOT_FOUND', 'Workspace not found.')
    await lockWorkspaceDestinations(tx, workspace.id)
    return saveApprovedDestination(tx, workspace.id, environment, name, url.href)
  })
}

// Serialize changes that span the request and approved destination tables.
export async function lockWorkspaceDestinations(tx: Prisma.TransactionClient, workspaceId: string) {
  const [workspace] = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Workspace" WHERE id = ${workspaceId}::uuid AND slug IS NOT NULL FOR NO KEY UPDATE
  `
  if (!workspace) throw new ApiError(404, 'NOT_FOUND', 'Workspace not found.')
}

export async function saveApprovedDestination(
  tx: Prisma.TransactionClient, workspaceId: string, environment: Environment, name: string, destinationUrl: string,
) {
  const destination = await tx.endpoint.create({
    data: { workspaceId, name, environment, destinationUrl },
    select: destinationSelect,
  })
  await tx.destinationRequest.updateMany({
    where: { workspaceId, environment, destinationUrl, status: 'PENDING' },
    data: { status: 'APPROVED', reviewedAt: new Date(), endpointId: destination.id },
  })
  await recordAudit(tx, workspaceId, 'DESTINATION_APPROVED', destination.id, `Administrator approved ${name}.`, { environment })
  return destination
}

export function workspaceDestinations(db: PrismaClient, workspaceId: string, environment: Environment = 'LIVE') {
  return db.endpoint.findMany({
    where: { workspaceId, environment, destinationUrl: { not: null } },
    select: destinationSelect,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  })
}

const eventType = z.string().trim().min(1).max(80).refine((value) => !value.includes('\u0000') && value.isWellFormed())
export const subscriptionsSchema = z.strictObject({
  eventTypes: z.array(eventType).max(100).transform((types) => [...new Set(types)].sort())
    .refine((types) => !types.includes('*') || types.length === 1, 'Use * by itself to subscribe to all events.'),
})

export async function updateSubscriptions(
  db: PrismaClient, workspaceId: string, id: string, eventTypes: string[], environment: Environment = 'LIVE', actor?: string,
) {
  return db.$transaction(async (tx) => {
    const [destination] = await tx.endpoint.updateManyAndReturn({
      where: { id, workspaceId, environment, destinationUrl: { not: null } },
      data: { eventTypes },
      select: destinationSelect,
    })
    if (!destination) throw new ApiError(404, 'NOT_FOUND', 'Destination not found.')
    const choice = eventTypes[0] === '*' ? 'all events' : `${eventTypes.length} event ${eventTypes.length === 1 ? 'type' : 'types'}`
    await recordAudit(tx, workspaceId, 'SUBSCRIPTIONS_UPDATED', id, `Workspace operator subscribed ${destination.name} to ${choice}.`, { eventTypes, environment, actor })
    return destination
  })
}

export async function rotateDestinationKey(db: PrismaClient, slug: string, endpointId: string, environment: Environment) {
  return db.$transaction(async (tx) => {
    const [endpoint] = await tx.$queryRaw<{ workspaceId: string; signingVersion: number; signingOverlapUntil: Date }[]>`
      UPDATE "Endpoint" e SET "signingVersion" = e."signingVersion" + 1,
        "signingOverlapUntil" = clock_timestamp() + interval '24 hours'
      FROM "Workspace" w
      WHERE w.id = e."workspaceId" AND w.slug = ${slug} AND e.id = ${endpointId}::uuid
        AND e.environment = ${environment}::"Environment" AND e."destinationUrl" IS NOT NULL
        AND (e."signingOverlapUntil" IS NULL OR e."signingOverlapUntil" <= clock_timestamp())
      RETURNING e."workspaceId", e."signingVersion", e."signingOverlapUntil"
    `
    if (!endpoint) throw new ApiError(409, 'CONFLICT', 'Destination is unavailable for rotation or already has an active overlap.')
    await recordAudit(tx, endpoint.workspaceId, 'SIGNING_KEY_ROTATED', endpointId, 'Administrator rotated the destination signing key.', { environment })
    return endpoint
  })
}
