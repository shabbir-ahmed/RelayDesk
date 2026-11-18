import { notFound, redirect } from 'next/navigation'
import { Destinations } from '@/components/destinations'
import { db } from '@/server/db'
import { workspaceDestinationRequests } from '@/server/destination-requests'
import { appMode } from '@/server/env'
import { operatorSession } from '@/server/operator'
import { workspaceDestinations } from '@/server/workspaces'

export const metadata = { title: 'Destinations' }

export default async function Page() {
  if (appMode() !== 'private') notFound()
  const scope = await operatorSession()
  if (scope?.mode !== 'private') redirect('/login')
  const owner = scope.role === 'OWNER'
  const database = db()
  const [destinations, requests] = await Promise.all([
    workspaceDestinations(database, scope.workspaceId, scope.environment),
    owner ? workspaceDestinationRequests(database, scope.workspaceId, scope.environment) : [],
  ])
  return <Destinations key={scope.workspaceId + scope.environment} destinations={destinations}
    requests={requests} owner={owner} environment={scope.environment} />
}
