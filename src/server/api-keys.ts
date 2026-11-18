import type { Environment, PrismaClient } from '@prisma/client'
import { ApiError } from './http'
import { recordAudit } from './audit'
import { newSecret, secretDigest } from './credentials'

const apiKeySelect = { id: true, name: true, prefix: true, createdAt: true, expiresAt: true } as const

const active = () => ({ revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] })

export function listApiKeys(db: PrismaClient, workspaceId: string, environment: Environment = 'LIVE') {
  return db.apiKey.findMany({
    where: { workspaceId, environment, ...active() },
    select: apiKeySelect,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 100,
  })
}

export async function createApiKey(db: PrismaClient, workspaceId: string, name: string, environment: Environment = 'LIVE', actor?: string) {
  const token = newSecret('rd_')
  return db.$transaction(async (tx) => {
    const key = await tx.apiKey.create({
      data: { workspaceId, environment, name, prefix: token.slice(0, 12), digest: secretDigest(token) },
      select: apiKeySelect,
    })
    await recordAudit(tx, workspaceId, 'API_KEY_CREATED', key.id, `Workspace operator created API key ${key.name}.`, { environment, actor })
    return { ...key, token }
  })
}

export async function apiKeyWorkspace(db: PrismaClient, token: string) {
  if (!/^rd_[A-Za-z0-9_-]{43}$/.test(token)) return null
  const key = await db.apiKey.findUnique({
    where: { digest: secretDigest(token), ...active(), workspace: { slug: { not: null } } },
    select: { workspaceId: true, environment: true },
  })
  return key
}

export async function revokeApiKey(db: PrismaClient, workspaceId: string, id: string, environment: Environment = 'LIVE', actor?: string) {
  return db.$transaction(async (tx) => {
    const [key] = await tx.apiKey.updateManyAndReturn({
      where: { workspaceId, environment, id, revokedAt: null },
      data: { revokedAt: new Date() },
      select: { name: true },
    })
    if (!key) return false
    await recordAudit(tx, workspaceId, 'API_KEY_REVOKED', id, `Workspace operator revoked API key ${key.name}.`, { environment, actor })
    return true
  })
}

export async function rotateApiKey(db: PrismaClient, workspaceId: string, id: string, environment: Environment, actor: string) {
  const token = newSecret('rd_')
  return db.$transaction(async (tx) => {
    const [{ expiresAt }] = await tx.$queryRaw<{ expiresAt: Date }[]>`
      SELECT statement_timestamp() + interval '24 hours' AS "expiresAt"
    `
    const [previous] = await tx.apiKey.updateManyAndReturn({
      where: { workspaceId, environment, id, revokedAt: null, expiresAt: null },
      data: { expiresAt }, select: { name: true },
    })
    if (!previous) throw new ApiError(404, 'NOT_FOUND', 'Rotatable API key not found.')
    const key = await tx.apiKey.create({
      data: { workspaceId, environment, name: previous.name, prefix: token.slice(0, 12), digest: secretDigest(token) },
      select: apiKeySelect,
    })
    await recordAudit(tx, workspaceId, 'API_KEY_ROTATED', key.id, 'Created a replacement API key with a 24-hour overlap.', { environment, actor })
    return { key: { ...key, token }, expiresAt }
  })
}
