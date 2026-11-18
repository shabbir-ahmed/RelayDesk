import { createHmac } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { recordAudit } from './audit'
import { newSecret, secretDigest } from './credentials'
import { destinationUrl } from './destinations'
import { ApiError } from './http'

export const workspaceSlug = z.string().min(2).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const nameSchema = z.string().trim().min(1).max(80).refine((name) => !name.includes('\u0000') && name.isWellFormed())
const workspaceInput = z.object({ slug: workspaceSlug, name: nameSchema, url: z.string().transform(destinationUrl) })
const destinationSelect = { id: true, name: true, destinationUrl: true, eventTypes: true } as const

export function destinationSecret(key: string, endpointId: string) {
  return createHmac('sha256', Buffer.from(key, 'hex'))
    .update('relaydesk-destination-v1:' + endpointId)
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
    await recordAudit(tx, workspace.id, 'DESTINATION_APPROVED', endpoint.id, 'Administrator approved the first destination for all events.')
    return { ...workspace, endpoint, credential }
  })
}

export async function approveDestination(db: PrismaClient, input: { slug: string; name: string; url: string }) {
  const { slug, name, url } = workspaceInput.parse(input)
  return db.$transaction(async (tx) => {
    const workspace = await tx.workspace.findUnique({ where: { slug }, select: { id: true } })
    if (!workspace) throw new ApiError(404, 'NOT_FOUND', 'Workspace not found.')
    const destination = await tx.endpoint.create({
      data: { workspaceId: workspace.id, name, destinationUrl: url.href },
      select: destinationSelect,
    })
    await recordAudit(tx, workspace.id, 'DESTINATION_APPROVED', destination.id, `Administrator approved ${name}.`)
    return destination
  })
}

export function workspaceDestinations(db: PrismaClient, workspaceId: string) {
  return db.endpoint.findMany({
    where: { workspaceId, destinationUrl: { not: null } },
    select: destinationSelect,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  })
}

const eventType = z.string().trim().min(1).max(80).refine((value) => !value.includes('\u0000') && value.isWellFormed())
export const subscriptionsSchema = z.strictObject({
  eventTypes: z.array(eventType).max(100).transform((types) => [...new Set(types)].sort())
    .refine((types) => !types.includes('*') || types.length === 1, 'Use * by itself to subscribe to all events.'),
})

export async function updateSubscriptions(db: PrismaClient, workspaceId: string, id: string, eventTypes: string[]) {
  return db.$transaction(async (tx) => {
    const [destination] = await tx.endpoint.updateManyAndReturn({
      where: { id, workspaceId, destinationUrl: { not: null } },
      data: { eventTypes },
      select: destinationSelect,
    })
    if (!destination) throw new ApiError(404, 'NOT_FOUND', 'Destination not found.')
    const choice = eventTypes[0] === '*' ? 'all events' : `${eventTypes.length} event ${eventTypes.length === 1 ? 'type' : 'types'}`
    await recordAudit(tx, workspaceId, 'SUBSCRIPTIONS_UPDATED', id, `Workspace operator subscribed ${destination.name} to ${choice}.`, eventTypes)
    return destination
  })
}
