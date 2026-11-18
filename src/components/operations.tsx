'use client'

import { Bell, History } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useState } from 'react'
import type { listAlerts } from '@/server/alerts'
import type { listAudit } from '@/server/audit'
import { errorMessage, post, requestJson } from './client-http'
import { InlineError } from './controls'
import { DeliveryBadge, Timestamp } from './presentation'
import { useLive } from './use-live'

type Alerts = Awaited<ReturnType<typeof listAlerts>>
type Audit = Awaited<ReturnType<typeof listAudit>>

function useLog<T extends { nextCursor: string | null }>(path: string, initial: T, view = '', revision = 0) {
  const [pages, setPages] = useState<(string | null)[]>([null])
  const cursor = pages.at(-1)
  const params = new URLSearchParams()
  if (view) params.set('view', view)
  if (cursor) params.set('cursor', cursor)
  const url = path + '?' + params.toString()
  const load = useCallback((signal: AbortSignal) => requestJson<T>(url, { signal }), [url])
  const { data, error } = useLive(url, load, initial, revision)
  return {
    data, error, hasPrevious: pages.length > 1,
    previous: () => setPages((items) => items.length > 1 ? items.slice(0, -1) : items),
    next: () => { if (data?.nextCursor) setPages((items) => [...items, data.nextCursor]) },
    reset: () => setPages([null]),
  }
}

export function Operations({ initialAlerts, initialAudit }: { initialAlerts: Alerts; initialAudit: Audit }) {
  return <main id="main" className="shell page-content">
    <div className="page-heading">
      <div>
        <h1 className="page-title">Operations</h1>
        <p className="muted mt-2">Review failed deliveries and track changes to your workspace.</p>
      </div>
    </div>
    <div className="detail-grid">
      <AlertPanel initial={initialAlerts} />
      <AuditPanel initial={initialAudit} />
    </div>
  </main>
}

function AlertPanel({ initial }: { initial: Alerts }) {
  const [view, setView] = useState('open')
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const page = useLog('/api/alerts', initial, view, revision)

  async function acknowledge(id: string) {
    setBusy(id)
    setError('')
    try {
      await post('/api/alerts/' + id + '/acknowledge')
      setRevision((value) => value + 1)
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy('')
    }
  }

  return <section className="panel" aria-labelledby="failure-alerts">
    <div className="panel-heading flex-wrap">
      <h2 className="section-title" id="failure-alerts"><Bell size={17} aria-hidden="true" /> Failure alerts</h2>
      <div className="field">
        <label className="sr-only" htmlFor="alert-view">Show alerts</label>
        <select id="alert-view" value={view} onChange={(event) => {
          setView(event.target.value)
          page.reset()
        }}>
          <option value="open">Open alerts</option>
          <option value="all">All alerts</option>
        </select>
      </div>
    </div>
    {(error || page.error) && <div className="px-5 pt-4"><InlineError message={error || page.error!} /></div>}
    {!page.data && !page.error && <p className="muted p-5" role="status">Loading failure alerts…</p>}
    {page.data?.items.length === 0 && <p className="muted p-5">{view === 'open' ? 'No open failure alerts.' : 'No failure alerts yet.'}</p>}
    <ul className="divide-y divide-slate-200">
      {page.data?.items.map((alert) => <li key={alert.id} className="space-y-2 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <Link className="table-link wrap-anywhere" href={`/deliveries/${alert.deliveryId}`}>{alert.delivery.event.eventType}</Link>
          <DeliveryBadge status={alert.delivery.status} />
        </div>
        <p className="muted text-sm">{alert.delivery.endpoint.name} · Failed cycle {alert.cycle} · <Timestamp value={alert.createdAt} /></p>
        <p className="text-sm">{alert.reason}</p>
        {alert.acknowledgedAt
          ? <p className="muted text-xs">Acknowledged <Timestamp value={alert.acknowledgedAt} /></p>
          : <button type="button" className="button button-secondary" disabled={Boolean(busy)}
            onClick={() => acknowledge(alert.id)}>{busy === alert.id ? 'Acknowledging…' : 'Acknowledge'}</button>}
      </li>)}
    </ul>
    <LogPagination page={page} />
  </section>
}

function AuditPanel({ initial }: { initial: Audit }) {
  const page = useLog('/api/audit', initial)
  return <section className="panel" aria-labelledby="audit-log">
    <div className="panel-heading">
      <h2 className="section-title" id="audit-log"><History size={17} aria-hidden="true" /> Audit log</h2>
    </div>
    {page.error && <div className="px-5 pt-4"><InlineError message={page.error} /></div>}
    {!page.data && !page.error && <p className="muted p-5" role="status">Loading audit log…</p>}
    {page.data?.items.length === 0 && <p className="muted p-5">Workspace changes and replays will appear here.</p>}
    <ul className="divide-y divide-slate-200">
      {page.data?.items.map((entry) => <li key={entry.id} className="space-y-1 p-5">
        <p className="text-sm font-semibold wrap-anywhere">{entry.summary}</p>
        <div className="muted text-xs">{entry.actor && <>{entry.actor} · </>}<Timestamp value={entry.createdAt} seconds /></div>
        {entry.action === 'SUBSCRIPTIONS_UPDATED' && entry.eventTypes.length > 0 && <details className="muted text-sm">
          <summary className="cursor-pointer">Configured event types</summary>
          <p className="wrap-anywhere">{entry.eventTypes[0] === '*' ? 'All event types' : entry.eventTypes.join(', ')}</p>
        </details>}
        {entry.action === 'DELIVERY_REPLAYED' && <Link className="table-link" href={`/deliveries/${entry.targetId}`}>Open delivery</Link>}
      </li>)}
    </ul>
    <LogPagination page={page} />
  </section>
}

function LogPagination({ page }: {
  page: { hasPrevious: boolean; previous: () => void; next: () => void; data?: { nextCursor: string | null } }
}) {
  if (!page.hasPrevious && !page.data?.nextCursor) return null
  return <div className="pagination">
    <button type="button" className="button button-secondary" disabled={!page.hasPrevious} onClick={page.previous}>Previous</button>
    <button type="button" className="button button-secondary" disabled={!page.data?.nextCursor} onClick={page.next}>Next</button>
  </div>
}
