import { notFound, redirect } from 'next/navigation'
import { ApiKeys } from '@/components/api-keys'
import { listApiKeys } from '@/server/api-keys'
import { db } from '@/server/db'
import { appMode } from '@/server/env'
import { operatorSession } from '@/server/operator'

export const metadata = { title: 'API keys' }

export default async function Page() {
  if (appMode() !== 'private') notFound()
  const scope = await operatorSession()
  if (!scope || scope.mode !== 'private') redirect('/login')
  const keys = await listApiKeys(db(), scope.workspaceId, scope.environment)
  return <ApiKeys key={scope.workspaceId + scope.environment} initial={keys.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() }))} />
}
