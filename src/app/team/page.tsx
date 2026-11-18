import { notFound, redirect } from 'next/navigation'
import { Team } from '@/components/team'
import { db } from '@/server/db'
import { appMode } from '@/server/env'
import { listInvitations } from '@/server/invitations'
import { operatorSession } from '@/server/operator'

export const metadata = { title: 'Team' }

export default async function TeamPage() {
  if (appMode() !== 'private') notFound()
  const scope = await operatorSession()
  if (scope?.mode !== 'private') redirect('/login')
  const database = db()
  const [members, invitations, legacyWorkspace] = await Promise.all([
    database.membership.findMany({
      where: { workspaceId: scope.workspaceId },
      select: { role: true, account: { select: { username: true } } },
      orderBy: [{ createdAt: 'asc' }, { accountId: 'asc' }],
    }),
    scope.role === 'OWNER' ? listInvitations(database, scope.workspaceId) : [],
    database.workspace.count({ where: { id: scope.workspaceId, credentialDigest: { not: null } } }),
  ])
  const now = new Date()
  return <Team key={scope.workspaceId} members={members.map(({ account, role }) => ({ username: account.username, role }))}
    owner={scope.role === 'OWNER'} legacy={legacyWorkspace > 0} initial={invitations.map((invite) => ({
      ...invite, expired: invite.expiresAt <= now, createdAt: invite.createdAt.toISOString(), expiresAt: invite.expiresAt.toISOString(),
      redeemedAt: invite.redeemedAt?.toISOString() ?? null, revokedAt: invite.revokedAt?.toISOString() ?? null,
    }))} />
}
