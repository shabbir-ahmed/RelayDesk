import { Prisma, type PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { accountSchema } from './accounts'
import { recordAudit } from './audit'
import { newSecret, secretDigest } from './credentials'
import { ApiError, unauthorized } from './http'
import { hashPassword, verifyPassword } from './password'

export const joinSchema = accountSchema.extend({ token: z.string().regex(/^rdi_[A-Za-z0-9_-]{43}$/) }).strict()
const inviteSelect = { id: true, expiresAt: true, createdAt: true, redeemedAt: true, revokedAt: true } as const
const unavailable = () => new ApiError(404, 'NOT_FOUND', 'This invitation is invalid, expired, or already used.')

export function listInvitations(db: PrismaClient, workspaceId: string) {
  return db.invitation.findMany({ where: { workspaceId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50, select: inviteSelect })
}

export async function createInvitation(db: PrismaClient, workspaceId: string, actor: string) {
  const token = newSecret('rdi_')
  return db.$transaction(async (tx) => {
    const invitation = await tx.invitation.create({
      data: { workspaceId, digest: secretDigest(token), expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000) },
      select: inviteSelect,
    })
    await recordAudit(tx, workspaceId, 'INVITE_CREATED', invitation.id, 'Created a workspace invitation.', { actor })
    return { ...invitation, token }
  })
}

export async function revokeInvitation(db: PrismaClient, workspaceId: string, id: string, actor: string) {
  return db.$transaction(async (tx) => {
    const revokedAt = new Date()
    const { count } = await tx.invitation.updateMany({
      where: { id, workspaceId, redeemedAt: null, revokedAt: null, expiresAt: { gt: revokedAt } },
      data: { revokedAt },
    })
    if (!count) throw unavailable()
    await recordAudit(tx, workspaceId, 'INVITE_REVOKED', id, 'Revoked a workspace invitation.', { actor })
  })
}

export async function redeemInvitation(db: PrismaClient, input: z.infer<typeof joinSchema>) {
  const digest = secretDigest(input.token)
  const pending = await db.invitation.findUnique({
    where: { digest, redeemedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { workspaceId: true },
  })
  if (!pending) throw unavailable()

  const existing = await db.account.findUnique({
    where: { username: input.username },
    select: { id: true, passwordHash: true, sessionVersion: true },
  })
  if (existing && !await verifyPassword(input.password, existing.passwordHash)) throw unauthorized()
  const passwordHash = existing ? undefined : await hashPassword(input.password)
  try {
    return await db.$transaction(async (tx) => {
      // A conditional update locks and checks expiry together, using PostgreSQL's clock after a wait.
      const [invitation] = await tx.$queryRaw<{ id: string; workspaceId: string }[]>`
        UPDATE "Invitation" SET "redeemedAt" = clock_timestamp()
        WHERE digest = ${digest} AND "redeemedAt" IS NULL AND "revokedAt" IS NULL
          AND "expiresAt" > clock_timestamp()
        RETURNING id, "workspaceId"
      `
      if (!invitation) throw unavailable()
      if (existing) {
        const [current] = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Account" WHERE id = ${existing.id}::uuid AND "sessionVersion" = ${existing.sessionVersion}
          FOR UPDATE
        `
        if (!current) throw unauthorized()
      }
      const account = existing ?? await tx.account.create({
        data: { username: input.username, passwordHash: passwordHash! }, select: { id: true, sessionVersion: true },
      })
      const member = await tx.membership.create({
        data: { workspaceId: invitation.workspaceId, accountId: account.id, role: 'MEMBER' },
        select: { sessionId: true },
      })
      await recordAudit(tx, invitation.workspaceId, 'INVITE_ACCEPTED', invitation.id, 'Joined the workspace by invitation.', { actor: input.username })
      return { workspaceId: invitation.workspaceId, accountId: account.id, memberSessionId: member.sessionId, sessionVersion: account.sessionVersion }
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ApiError(409, 'CONFLICT', 'That account already exists or belongs to this workspace.')
    }
    throw error
  }
}
