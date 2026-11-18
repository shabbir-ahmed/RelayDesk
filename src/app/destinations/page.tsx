import { notFound, redirect } from 'next/navigation'
import { Destinations } from '@/components/destinations'
import { db } from '@/server/db'
import { appMode } from '@/server/env'
import { operatorSession } from '@/server/operator'
import { workspaceDestinations } from '@/server/workspaces'

export const metadata = { title: 'Destinations' }

export default async function Page() {
  if (appMode() !== 'private') notFound()
  const scope = await operatorSession()
  if (!scope) redirect('/login')
  const destinations = await workspaceDestinations(db(), scope.workspaceId, scope.environment)
  return <Destinations destinations={destinations} showTest={scope.environment === 'TEST'} />
}
