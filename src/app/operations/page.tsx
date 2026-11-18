import { notFound, redirect } from 'next/navigation'
import { Operations } from '@/components/operations'
import { listAlerts } from '@/server/alerts'
import { listAudit } from '@/server/audit'
import { db } from '@/server/db'
import { appMode } from '@/server/env'
import { operatorSession } from '@/server/operator'

export const metadata = { title: 'Operations' }

export default async function Page() {
  if (appMode() !== 'private') notFound()
  const scope = await operatorSession()
  if (!scope) redirect('/login')
  const database = db()
  const [alerts, audit] = await Promise.all([
    listAlerts(database, scope.workspaceId, new URLSearchParams(), true),
    listAudit(database, scope.workspaceId, new URLSearchParams()),
  ])
  return <Operations key={scope.workspaceId} initialAlerts={alerts} initialAudit={audit} />
}
