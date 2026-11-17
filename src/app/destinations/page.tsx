import { notFound, redirect } from 'next/navigation'
import { CopyButton } from '@/components/controls'
import { CreateEventButton } from '@/components/event-form'
import { db } from '@/server/db'
import { appMode } from '@/server/env'
import { operatorSession } from '@/server/operator'
import { workspaceDestination } from '@/server/workspaces'

export const metadata = { title: 'Destination' }

export default async function Page() {
  if (appMode() !== 'private') notFound()
  const scope = await operatorSession()
  if (!scope) redirect('/login')
  const destination = (await workspaceDestination(db(), scope.workspaceId))?.destinationUrl
  return <main className="shell page-content guide-page" id="main">
    <div className="page-heading">
      <div>
        <h1 className="page-title">Destination</h1>
        <p className="muted mt-2">RelayDesk delivers this workspace’s webhooks to its approved HTTPS endpoint.</p>
      </div>
      {destination && <CreateEventButton destination={destination} />}
    </div>
    <section className="panel" aria-labelledby="approved-destination">
      <div className="panel-heading"><h2 className="section-title" id="approved-destination">Approved endpoint</h2></div>
      <div className="p-5">
        {destination
          ? <div className="id-group"><code className="wrap-anywhere">{destination}</code>
              <CopyButton value={destination} label="Copy destination URL" />
            </div>
          : <p className="muted">Ask your RelayDesk administrator to approve a destination.</p>}
      </div>
    </section>
  </main>
}
