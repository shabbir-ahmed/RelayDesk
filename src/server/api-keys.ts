import type { PrismaClient } from '@prisma/client'
import { newSecret, secretDigest } from './credentials'

const apiKeySelect = { id: true, name: true, prefix: true, createdAt: true } as const

export function listApiKeys(db: PrismaClient, workspaceId: string) {
  return db.apiKey.findMany({
    where: { workspaceId, revokedAt: null },
    select: apiKeySelect,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 100,
  })
}

export async function createApiKey(db: PrismaClient, workspaceId: string, name: string) {
  const token = newSecret('rd_')
  const key = await db.apiKey.create({
    data: { workspaceId, name, prefix: token.slice(0, 12), digest: secretDigest(token) },
    select: apiKeySelect,
  })
  return { ...key, token }
}

export async function apiKeyWorkspace(db: PrismaClient, token: string) {
  if (!/^rd_[A-Za-z0-9_-]{43}$/.test(token)) return null
  const key = await db.apiKey.findUnique({
    where: { digest: secretDigest(token), revokedAt: null, workspace: { slug: { not: null } } },
    select: { workspaceId: true },
  })
  return key?.workspaceId ?? null
}

export async function revokeApiKey(db: PrismaClient, workspaceId: string, id: string) {
  const { count } = await db.apiKey.updateMany({
    where: { workspaceId, id, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  return count === 1
}
