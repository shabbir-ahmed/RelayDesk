'use client'

import { ArrowUpRight, ChevronLeft, ChevronRight, Globe2, Inbox, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useState } from 'react'
import type { DeliveryList, DeliverySummary } from '@/server/reads'
import { deliveryStatuses, type DeliveryStatus } from '@/shared/delivery'
import { requestJson } from './client-http'
import { CopyButton, InlineError } from './controls'
import { CreateEventButton } from './event-form'
import { DeliveryBadge, statusInfo, Timestamp } from './presentation'
import { useLive } from './use-live'

type DashboardData = { list: DeliveryList; summary: DeliverySummary | null }

export function Dashboard({ operator, initial }: { operator: boolean; initial?: DashboardData }) {
  const [filter, setFilter] = useState<DeliveryStatus | ''>('')
  const [cursors, setCursors] = useState<(string | null)[]>([null])
  const [revision, setRevision] = useState(0)
  const cursor = cursors.at(-1)
  const params = new URLSearchParams()
  if (filter) params.set('status', filter)
  if (cursor) params.set('cursor', cursor)
  const query = params.toString()
  const load = useCallback(async (signal: AbortSignal) => {
    const [list, summary] = await Promise.all([
      requestJson<DeliveryList>('/api/deliveries?' + query, { signal }),
      requestJson<DeliverySummary>('/api/summary', { signal }),
    ])
    return { list, summary }
  }, [query])
  const { data, error } = useLive(query, load, initial, revision)
  const latest = data?.summary?.latestCompletionAt
  const list = data?.list

  return <main className="shell page-content" id="main">
    <div className="page-heading">
      <div>
        <div className="access-label">
          {operator ? <ShieldCheck size={15} aria-hidden="true" /> : <Globe2 size={15} aria-hidden="true" />}
          {operator ? 'Operator session' : 'Read-only demo'}
        </div>
        <h1 className="page-title mt-3">Webhook deliveries</h1>
        <p className="muted mt-2">Track synthetic webhook events, inspect delivery attempts, and recover from failures.</p>
      </div>
      {operator && <CreateEventButton />}
    </div>

    <section aria-label="Delivery status counts" className="summary-grid">
      {deliveryStatuses.map((status) => {
        const { label, icon: Icon, detail, tone } = statusInfo[status]
        const count = data?.summary?.counts[status]
        return <div key={status} className="panel summary-card">
          <div className="feature-icon tone-neutral"><Icon size={20} aria-hidden="true" /></div>
          <div className="summary-description">
            <h2>{label}</h2>
            <p>{detail}</p>
          </div>
          <p className={`summary-number text-${tone}`}>{count === undefined ? '—' : count.toLocaleString('en-US')}</p>
        </div>
      })}
    </section>

    <section className="panel delivery-panel" aria-labelledby="delivery-log">
      <div className="table-toolbar">
        <div>
          <h2 id="delivery-log" className="section-title">Delivery log</h2>
          <p className="muted mt-1 text-sm">{latest ? <>Last completion <Timestamp value={latest} /></> : 'All times in UTC'}</p>
        </div>
        <div className="table-filter">
          <label htmlFor="status-filter">Status</label>
          <select id="status-filter" value={filter} onChange={(event) => {
            setFilter(event.target.value as DeliveryStatus | '')
            setCursors([null])
          }}>
            <option value="">All statuses</option>
            {deliveryStatuses.map((status) => <option key={status} value={status}>{statusInfo[status].label}</option>)}
          </select>
        </div>
      </div>
      {error && <div className="px-5 pb-4">
        <InlineError message={error} />
        <button type="button" className="button button-secondary button-small mt-2" onClick={() => setRevision((value) => value + 1)}>Refresh</button>
      </div>}
      {!list && !error && <div className="table-state" role="status">Loading deliveries…</div>}
      {list && (list.items.length
        ? <DeliveryTable items={list.items} />
        : <div className="table-state"><Inbox size={26} aria-hidden="true" /><p>No deliveries match this view.</p></div>)}
      {list && <div className="pagination">
        <span>{list.items.length} {list.items.length === 1 ? 'delivery' : 'deliveries'} · Page {cursors.length}</span>
        <div className="flex gap-2">
          <button type="button" className="button button-secondary button-small" disabled={cursors.length < 2}
            onClick={() => setCursors((previous) => previous.slice(0, -1))}>
            <ChevronLeft size={16} aria-hidden="true" /> Previous
          </button>
          <button type="button" className="button button-secondary button-small" disabled={!list.nextCursor}
            onClick={() => list.nextCursor && setCursors((previous) => [...previous, list.nextCursor])}>
            Next <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>}
    </section>
  </main>
}

function DeliveryTable({ items }: { items: DeliveryList['items'] }) {
  return <table className="delivery-table">
    <caption className="sr-only">Webhook delivery log</caption>
    <thead>
      <tr>
        <th scope="col">Event type</th>
        <th scope="col" className="desktop-cell">Delivery ID</th>
        <th scope="col">Status</th>
        <th scope="col" className="desktop-cell">Attempts</th>
        <th scope="col" className="desktop-cell">Created</th>
        <th scope="col"><span className="sr-only">Detail</span></th>
      </tr>
    </thead>
    <tbody>
      {items.map((delivery) => <tr key={delivery.id}>
        <td>
          <span className="event-type">{delivery.event.eventType}</span>
          {delivery.historical && <span className="fixture-label">Sample</span>}
          <div className="mobile-metadata">
            <code>{delivery.id.slice(0, 8)}</code>
            <CopyButton value={delivery.id} label={`Copy delivery ID for ${delivery.event.eventType}`} />
          </div>
          <div className="mobile-metadata text-xs"><Timestamp value={delivery.createdAt} /> · {delivery.attemptsInCycle} attempts</div>
        </td>
        <td className="desktop-cell">
          <div className="id-group"><code>{delivery.id.slice(0, 8)}…</code>
            <CopyButton value={delivery.id} label={`Copy delivery ID for ${delivery.event.eventType}`} />
          </div>
        </td>
        <td><DeliveryBadge status={delivery.status} /></td>
        <td className="desktop-cell">
          <span className="tabular-nums">{delivery.attemptsInCycle}</span>
          {delivery.cycle > 1 && <span className="muted ml-2 text-xs">Cycle {delivery.cycle}</span>}
        </td>
        <td className="desktop-cell"><Timestamp value={delivery.createdAt} /></td>
        <td>
          <Link className="table-link" href={`/deliveries/${delivery.id}`} aria-label={`View ${delivery.event.eventType} delivery ${delivery.id.slice(0, 8)}`}>
            <span>Details</span><ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        </td>
      </tr>)}
    </tbody>
  </table>
}
