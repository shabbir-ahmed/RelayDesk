import { redirect } from 'next/navigation'
import { Dashboard } from '@/components/dashboard'
import { db } from '@/server/db'
import { demoScope } from '@/server/demo'
import { appMode } from '@/server/env'
import { operatorSession } from '@/server/operator'
import { deliverySummary, listDeliveries } from '@/server/reads'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const mode = appMode()
  const session = await operatorSession()
  if (mode === 'private' && !session) redirect('/login')
  const workspaceId = session?.workspaceId ?? demoScope.workspaceId
  const database = db()
  const [workspace, initial] = await Promise.all([
    mode === 'private' ? database.workspace.findFirst({
      where: { id: workspaceId, slug: { not: null } },
      select: { name: true, endpoint: { select: { destinationUrl: true } } },
    }) : null,
    Promise.all([listDeliveries(database, workspaceId), deliverySummary(database, workspaceId)])
      .then(([list, summary]) => ({ list, summary })).catch(() => undefined),
  ])
  if (mode === 'private' && !workspace) redirect('/login')
  return <Dashboard key={workspaceId} operator={Boolean(session)} initial={initial}
    workspaceName={workspace?.name} destination={workspace?.endpoint?.destinationUrl} />
}
