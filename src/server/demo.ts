import type { PrismaClient } from '@prisma/client'

export const workspaceId = '3a39a983-27ec-4489-a38e-520aa7911001'
export const endpointId = '3a39a983-27ec-4489-a38e-520aa7911002'

export const demoScope = { mode: 'demo' as const, environment: 'LIVE' as const, workspaceId, endpointId }

export async function ensureDemo(db: PrismaClient) {
  await db.$transaction([
    db.workspace.upsert({
      where: { id: workspaceId },
      update: {},
      create: { id: workspaceId, name: 'RelayDesk demo' },
    }),
    db.endpoint.upsert({
      where: { id: endpointId },
      update: {},
      create: { id: endpointId, workspaceId, name: 'Controlled receiver' },
    }),
  ])
}
