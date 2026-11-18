import { Prisma, type PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { newSecret, secretDigest } from './credentials'
import { recordAudit } from './audit'
import { ApiError, unauthorized } from './http'
import { hashPassword } from './password'
import { workspaceSlug } from './workspaces'

export const usernameSchema = z.string().trim().toLowerCase().min(3).max(60).regex(/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/)
export const passwordSchema = z.string().min(12).max(128).refine((value) => value.isWellFormed())
export const accountSchema = z.object({ username: usernameSchema, password: passwordSchema })
export const signupSchema = accountSchema.extend({
  workspace: workspaceSlug,
  name: z.string().trim().min(1).max(80).refine((name) => !name.includes('\u0000') && name.isWellFormed()),
}).strict()

export async function createAccountWorkspace(db: PrismaClient, input: z.infer<typeof signupSchema>) {
  const passwordHash = await hashPassword(input.password)
  try {
    return await db.$transaction(async (tx) => {
      const account = await tx.account.create({
        data: { username: input.username, passwordHash }, select: { id: true, username: true, sessionVersion: true },
      })
      const workspace = await tx.workspace.create({
        data: { slug: input.workspace, name: input.name }, select: { id: true, slug: true },
      })
      const member = await tx.membership.create({
        data: { workspaceId: workspace.id, accountId: account.id, role: 'OWNER' }, select: { sessionId: true },
      })
      await recordAudit(tx, workspace.id, 'WORKSPACE_CREATED', workspace.id, 'Created workspace.', { actor: account.username })
      return { accountId: account.id, workspaceId: workspace.id, memberSessionId: member.sessionId, sessionVersion: account.sessionVersion }
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ApiError(409, 'CONFLICT', 'That username or workspace slug is already in use.')
    }
    throw error
  }
}

export const recoverySchema = accountSchema.extend({ code: z.string().regex(/^rdr_[A-Za-z0-9_-]{43}$/) }).strict()

export async function issueRecoveryCode(
  db: PrismaClient, scope: { workspaceId: string; accountId: string; memberSessionId: string; sessionVersion: number },
) {
  const code = newSecret('rdr_')
  const { count } = await db.account.updateMany({
    where: {
      id: scope.accountId, sessionVersion: scope.sessionVersion,
      memberships: { some: { workspaceId: scope.workspaceId, sessionId: scope.memberSessionId } },
    },
    data: { recoveryDigest: secretDigest(code) },
  })
  if (!count) throw unauthorized()
  return code
}

export async function recoverAccount(db: PrismaClient, input: z.infer<typeof recoverySchema>) {
  const recoveryDigest = secretDigest(input.code)
  const match = { username: input.username, recoveryDigest }
  if (!await db.account.findFirst({ where: match, select: { id: true } })) throw unauthorized()
  const passwordHash = await hashPassword(input.password)
  const { count } = await db.account.updateMany({
    where: match,
    data: { passwordHash, recoveryDigest: null, sessionVersion: { increment: 1 } },
  })
  if (!count) throw unauthorized()
}

export async function removeWorkspaceMember(db: PrismaClient, workspaceId: string, accountId: string, actor: string) {
  return db.$transaction(async (tx) => {
    const { count } = await tx.membership.deleteMany({ where: { workspaceId, accountId, role: 'MEMBER' } })
    if (!count) throw new ApiError(404, 'NOT_FOUND', 'Removable workspace member not found.')
    await recordAudit(tx, workspaceId, 'MEMBER_REMOVED', accountId, 'Removed a workspace member.', { actor })
  })
}
