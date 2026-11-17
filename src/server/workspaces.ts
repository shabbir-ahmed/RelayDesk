import { createHmac } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { newSecret, secretDigest } from './credentials'
import { destinationUrl } from './destinations'

export const workspaceSlug = z.string().min(2).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const workspaceInput = z.object({
  slug: workspaceSlug,
  name: z.string().trim().min(1).max(80).refine((name) => !name.includes('\u0000') && name.isWellFormed()),
  url: z.string().transform(destinationUrl),
})

export function destinationSecret(key: string, endpointId: string) {
  return createHmac('sha256', Buffer.from(key, 'hex'))
    .update('relaydesk-destination-v1:' + endpointId)
    .digest('hex')
}

export async function provisionWorkspace(db: PrismaClient, input: { slug: string; name: string; url: string }) {
  const { slug, name, url } = workspaceInput.parse(input)
  const credential = newSecret('rdw_')
  const workspace = await db.workspace.create({
    data: {
      slug, name, credentialDigest: secretDigest(credential),
      endpoint: { create: { name: 'Approved destination', destinationUrl: url.href } },
    },
    select: { id: true, slug: true, name: true, endpoint: { select: { id: true, destinationUrl: true } } },
  })
  return { ...workspace, credential }
}

export function workspaceDestination(db: PrismaClient, workspaceId: string) {
  return db.endpoint.findUnique({
    where: { workspaceId },
    select: { id: true, destinationUrl: true },
  })
}
