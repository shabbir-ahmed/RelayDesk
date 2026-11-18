'use client'

import { ArrowUpRight, Bell, ChevronLeft, ChevronRight, Globe2, Inbox, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useId, useState } from 'react'
import type { DeliveryList, DeliverySummary } from '@/server/reads'
import { deliveryStatuses, type DeliveryStatus, type DestinationOption, type Environment } from '@/shared/delivery'
import { requestJson } from './client-http'
import { CopyButton, InlineError } from './controls'
import { CreateEventButton } from './event-form'
import { DeliveryBadge, statusInfo, Timestamp } from './presentation'
import { useLive } from './use-live'

type DashboardData = { list: DeliveryList; summary: DeliverySummary | null }

export function Dashboard({ operator, initial, workspaceName, destinations, environment }: {
  operator: boolean; initial?: DashboardData; environment: Environment; workspaceName?: string; destinations?: DestinationOption[]
}) {
  const [filter, setFilter] = useState<DeliveryStatus | ''>('')
  const [destination, setDestination] = useState('')
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const searchId = useId()
  const [cursors, setCursors] = useState<(string | null)[]>([null])
  const [revision, setRevision] = useState(0)
  const cursor = cursors.at(-1)
  const params = new URLSearchParams()
  if (filter) params.set('status', filter)
  if (destination) params.set('destination', destination)
  if (search) params.set('query', search)
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
  const openAlerts = data?.summary?.openAlerts ?? 0
  const usage = data?.summary?.usage
  const list = data?.list

  return <main className="shell page-content" id="main">
    <div className="page-heading">
      <div>
        <div className="access-label">
          {operator ? <ShieldCheck size={15} aria-hidden="true" /> : <Globe2 size={15} aria-hidden="true" />}
          {workspaceName ?? (operator ? 'Operator session' : 'Read-only demo')}
        </div>
        <h1 className="page-title mt-3">Webhook deliveries</h1>
        <p className="muted mt-2">{workspaceName
          ? 'Monitor deliveries to your destinations and replay failed events.'
          : 'Track synthetic webhook events, inspect delivery attempts, and recover from failures.'}</p>
      </div>
      {operator && (!destinations || (environment === 'TEST' && destinations.length > 0)) && <CreateEventButton destinations={destinations} />}
    </div>

    {usage && <section aria-labelledby="event-usage" className="panel mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
      <div>
        <h2 id="event-usage" className="font-semibold">Daily event usage</h2>
        <p className="muted text-sm">{usage.used.toLocaleString()} of {usage.limit.toLocaleString()} · Resets at midnight UTC</p>
        <p className="muted text-sm">{usage.deliveries.used.toLocaleString()} of {usage.deliveries.limit.toLocaleString()} deliveries used</p>
      </div>
      <progress aria-label="Daily event usage" className="w-44 max-w-full accent-indigo-600"
        value={Math.min(usage.used, usage.limit)} max={usage.limit} />
    </section>}

    {workspaceName && openAlerts > 0 && <Link href="/operations" className="panel mb-4 flex items-center gap-2 p-4 font-semibold text-indigo-700">
      <Bell size={17} aria-hidden="true" /> {openAlerts} open failure {openAlerts === 1 ? 'alert' : 'alerts'}
    </Link>}

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
      {destinations && <div className="flex flex-wrap items-end gap-4 px-5 pb-4">
        <form className="flex min-w-0 flex-1 flex-wrap items-end gap-2" role="search" onSubmit={(event) => {
          event.preventDefault()
          setSearch(draft.trim())
          setCursors([null])
        }}>
          <div className="field min-w-0 flex-1">
            <label htmlFor={searchId}>Search deliveries</label>
            <input id={searchId} type="search" placeholder="Event type or full ID" maxLength={100}
              value={draft} onChange={(event) => setDraft(event.target.value)} />
          </div>
          <button className="button button-secondary" type="submit">Search</button>
          {search && <button className="button button-secondary" type="button" onClick={() => {
            setDraft('')
            setSearch('')
            setCursors([null])
          }}>Clear search</button>}
        </form>
        <div className="field">
          <label htmlFor="destination-filter">Destination</label>
          <select id="destination-filter" value={destination} onChange={(event) => {
            setDestination(event.target.value)
            setCursors([null])
          }}>
            <option value="">All destinations</option>
            {destinations.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
      </div>}
      {error && <div className="px-5 pb-4">
        <InlineError message={error} />
        <button type="button" className="button button-secondary button-small mt-2" onClick={() => setRevision((value) => value + 1)}>Refresh</button>
      </div>}
      {!list && !error && <div className="table-state" role="status">Loading deliveries…</div>}
      {list && (list.items.length
        ? <DeliveryTable items={list.items} showDestination={Boolean(destinations)} />
        : <div className="table-state"><Inbox size={26} aria-hidden="true" /><p>{workspaceName && environment === 'TEST' && !filter && !search && !destination ? 'Send a test event to see your first delivery here.' : 'No deliveries match this view.'}</p></div>)}
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

function DeliveryTable({ items, showDestination }: { items: DeliveryList['items']; showDestination: boolean }) {
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
          {delivery.event.isTest && <span className="fixture-label">Test event</span>}
          {showDestination && <div className="muted text-xs wrap-anywhere">{delivery.endpoint.name}</div>}
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
