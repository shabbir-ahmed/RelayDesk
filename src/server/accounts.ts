import { Prisma, type PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { recordAudit } from './audit'
import { ApiError } from './http'
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
        data: { username: input.username, passwordHash }, select: { id: true, username: true },
      })
      const workspace = await tx.workspace.create({
        data: { slug: input.workspace, name: input.name }, select: { id: true, slug: true },
      })
      await tx.membership.create({ data: { workspaceId: workspace.id, accountId: account.id, role: 'OWNER' } })
      await recordAudit(tx, workspace.id, 'WORKSPACE_CREATED', workspace.id, 'Created workspace.', { actor: account.username })
      return { accountId: account.id, workspaceId: workspace.id }
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ApiError(409, 'CONFLICT', 'That username or workspace slug is already in use.')
    }
    throw error
  }
}
