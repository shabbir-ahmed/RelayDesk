import { redirect } from 'next/navigation'
import { Dashboard } from '@/components/dashboard'
import { db } from '@/server/db'
import { demoScope } from '@/server/demo'
import { appMode } from '@/server/env'
import { operatorSession } from '@/server/operator'
import { workspaceDestinations } from '@/server/workspaces'
import { deliverySummary, listDeliveries } from '@/server/reads'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const mode = appMode()
  const session = await operatorSession()
  if (mode === 'private' && !session) redirect('/login')
  const workspaceId = session?.workspaceId ?? demoScope.workspaceId
  const database = db()
  const environment = session?.environment ?? demoScope.environment
  const [workspace, initial, destinations] = await Promise.all([
    mode === 'private' ? database.workspace.findFirst({
      where: { id: workspaceId, slug: { not: null } },
      select: { name: true },
    }) : null,
    Promise.all([listDeliveries(database, workspaceId, undefined, environment), deliverySummary(database, workspaceId, environment)])
      .then(([list, summary]) => ({ list, summary })).catch(() => undefined),
    mode === 'private' ? workspaceDestinations(database, workspaceId, environment) : undefined,
  ])
  if (mode === 'private' && !workspace) redirect('/login')
  return <Dashboard key={workspaceId + environment} environment={environment} operator={Boolean(session)} initial={initial}
    workspaceName={workspace?.name} destinations={destinations} />
}
