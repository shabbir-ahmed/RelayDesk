import type { Environment, Prisma, PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { recordAudit } from './audit'
import { BlockedDestination, destinationUrl, resolveDestination, type ResolveHost } from './destinations'
import { ApiError, invalid } from './http'
import { destinationNameSchema, lockWorkspaceDestinations, saveApprovedDestination } from './workspaces'

export const requestDestinationSchema = z.strictObject({
  name: destinationNameSchema,
  url: z.string().trim().min(1).max(2048),
})
export const rejectionNoteSchema = z.string().trim().min(1).max(240)
  .refine((value) => !value.includes('\u0000') && value.isWellFormed(), 'Enter a valid reason.')

const selection = {
  id: true, name: true, destinationUrl: true, status: true, createdAt: true, reviewedAt: true, reviewNote: true,
} as const

const missingRequest = () => new ApiError(404, 'NOT_FOUND', 'Destination request was not found.')
const alreadyReviewed = () => new ApiError(409, 'CONFLICT', 'This destination request has already been reviewed.')

export async function requestDestination(
  db: PrismaClient, workspaceId: string, environment: Environment, actor: string,
  input: z.infer<typeof requestDestinationSchema>,
) {
  let url: string
  try {
    url = destinationUrl(input.url).href
  } catch (error) {
    if (error instanceof BlockedDestination) throw invalid(error.message)
    throw error
  }
  return db.$transaction(async (tx) => {
    await lockWorkspaceDestinations(tx, workspaceId)
    const match = { workspaceId, environment, destinationUrl: url }
    if (await tx.endpoint.findUnique({ where: { workspaceId_environment_destinationUrl: match }, select: { id: true } })) {
      throw new ApiError(409, 'CONFLICT', 'This destination is already approved in the selected environment.')
    }
    if (await tx.destinationRequest.findFirst({ where: { ...match, status: 'PENDING' }, select: { id: true } })) {
      throw new ApiError(409, 'CONFLICT', 'This destination already has a pending request.')
    }
    const request = await tx.destinationRequest.create({
      data: { ...match, name: input.name },
      select: selection,
    })
    await recordAudit(tx, workspaceId, 'DESTINATION_REQUESTED', request.id, `Requested ${request.name} for approval.`, { environment, actor })
    return request
  })
}

export async function workspaceDestinationRequests(db: PrismaClient, workspaceId: string, environment: Environment) {
  const requests = await db.destinationRequest.findMany({
    where: { workspaceId, environment },
    orderBy: [{ reviewedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }, { id: 'desc' }],
    take: 100,
    select: selection,
  })
  return requests.map(({ createdAt, reviewedAt, ...request }) => ({
    ...request, createdAt: createdAt.toISOString(), reviewedAt: reviewedAt?.toISOString() ?? null,
  }))
}

export type DestinationRequestItem = Awaited<ReturnType<typeof workspaceDestinationRequests>>[number]

export function pendingDestinationRequests(db: PrismaClient) {
  return db.destinationRequest.findMany({
    where: { status: 'PENDING' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 100,
    select: { ...selection, environment: true, workspace: { select: { slug: true } } },
  })
}

type RequestLookup = Pick<Prisma.TransactionClient, 'destinationRequest'>

async function getPendingRequest(db: RequestLookup, id: string) {
  const request = await db.destinationRequest.findUnique({
    where: { id }, select: { ...selection, workspaceId: true, environment: true },
  })
  if (!request) throw missingRequest()
  if (request.status !== 'PENDING') throw alreadyReviewed()
  return request
}

export async function approveRequestedDestination(db: PrismaClient, id: string, resolve?: ResolveHost) {
  const pending = await getPendingRequest(db, id)
  const url = destinationUrl(pending.destinationUrl)
  await resolveDestination(url.hostname, resolve)
  return db.$transaction(async (tx) => {
    await lockWorkspaceDestinations(tx, pending.workspaceId)
    const request = await getPendingRequest(tx, id)
    const endpoint = await saveApprovedDestination(tx, request.workspaceId, request.environment, request.name, url.href)
    return { ...endpoint, environment: request.environment }
  })
}

export async function rejectDestinationRequest(db: PrismaClient, id: string, reason: string) {
  const pending = await getPendingRequest(db, id)
  return db.$transaction(async (tx) => {
    await lockWorkspaceDestinations(tx, pending.workspaceId)
    const request = await getPendingRequest(tx, id)
    const rejected = await tx.destinationRequest.update({
      where: { id }, data: { status: 'REJECTED', reviewedAt: new Date(), reviewNote: reason }, select: selection,
    })
    await recordAudit(
      tx, request.workspaceId, 'DESTINATION_REQUEST_REJECTED', id, `Administrator rejected ${request.name}.`,
      { environment: request.environment },
    )
    return rejected
  })
}
