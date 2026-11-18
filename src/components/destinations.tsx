'use client'

import { useRouter } from 'next/navigation'
import { useId, useState, type FormEvent } from 'react'
import type { DestinationRequestItem } from '@/server/destination-requests'
import { environmentLabel, type DestinationOption, type Environment } from '@/shared/delivery'
import { errorMessage, post, requestJson } from './client-http'
import { CopyButton, InlineError, Modal } from './controls'
import { CreateEventButton } from './event-form'
import { Timestamp } from './presentation'

type Destination = DestinationOption & { eventTypes: string[] }

const requestStatus = {
  PENDING: { label: 'Pending review', tone: 'pending' },
  APPROVED: { label: 'Approved', tone: 'delivered' },
  REJECTED: { label: 'Rejected', tone: 'failed' },
} as const

export function Destinations({ destinations, requests, owner, environment }: {
  destinations: Destination[]; requests: DestinationRequestItem[]; owner: boolean; environment: Environment
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState('')

  return <main className="shell page-content guide-page" id="main">
    <div className="page-heading">
      <div>
        <h1 className="page-title">Destinations</h1>
        <p className="muted mt-2">Choose which event types each approved HTTPS endpoint receives.</p>
      </div>
      {owner && <button type="button" className="button button-primary" onClick={() => {
        setNotice('')
        setOpen(true)
      }}>
        Request destination
      </button>}
    </div>
    {notice && <p className="confirmation mb-4" role="status">{notice}</p>}
    <div className="space-y-4">
      {!destinations.length && <p className="panel p-5">There are no approved destinations in {environmentLabel[environment]}.</p>}
      {destinations.map((destination) => <DestinationCard key={destination.id} destination={destination} showTest={environment === 'TEST'} />)}
      {owner && <section className="panel" aria-labelledby="destination-requests">
        <div className="panel-heading flex-wrap">
          <h2 className="section-title" id="destination-requests">Destination requests</h2>
          <button type="button" className="button button-small button-secondary" onClick={() => router.refresh()}>
            Refresh requests
          </button>
        </div>
        {requests.length ? <ul className="divide-y divide-slate-200">
          {requests.map((request) => {
            const status = requestStatus[request.status]
            return <li key={request.id} className="flex flex-wrap items-start justify-between gap-3 p-5">
              <div className="min-w-0">
                <p className="font-semibold wrap-anywhere">{request.name}</p>
                <code className="muted wrap-anywhere text-sm">{request.destinationUrl}</code>
                <p className="muted mt-1 text-xs">Requested <Timestamp value={request.createdAt} />
                  {request.reviewedAt && <> · Reviewed <Timestamp value={request.reviewedAt} /></>}
                </p>
                {request.reviewNote && <p className="mt-2 text-sm wrap-anywhere">{request.reviewNote}</p>}
              </div>
              <span className={`badge tone-${status.tone}`}><span aria-hidden="true" />{status.label}</span>
            </li>
          })}
        </ul> : <p className="muted p-5">There are no destination requests in {environmentLabel[environment]}.</p>}
      </section>}
    </div>
    {open && <RequestForm environment={environment} onClose={() => setOpen(false)} onSuccess={() => {
      setOpen(false)
      setNotice('Destination request submitted.')
      router.refresh()
    }} />}
  </main>
}

function RequestForm({ environment, onClose, onSuccess }: {
  environment: Environment; onClose: () => void; onSuccess: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setError('')
    setBusy(true)
    try {
      await post('/api/destinations/requests', { name: data.get('name'), url: data.get('url') })
      onSuccess()
    } catch (error) {
      setError(errorMessage(error))
      setBusy(false)
    }
  }

  return <Modal title={`Request a ${environmentLabel[environment]} destination`} busy={busy} onClose={onClose}>
    <form method="post" onSubmit={submit} className="space-y-4">
      <p className="muted">An administrator will review this endpoint before you can send events to it.</p>
      <div className="field">
        <label htmlFor="destination-request-name">Destination name</label>
        <input id="destination-request-name" name="name" required maxLength={80} disabled={busy} />
      </div>
      <div className="field">
        <label htmlFor="destination-request-url">HTTPS endpoint URL</label>
        <input id="destination-request-url" name="url" type="url" required maxLength={2048}
          aria-describedby="destination-request-help" autoComplete="off" disabled={busy} />
        <p id="destination-request-help" className="muted text-sm">Use a public hostname. Leave out credentials, query strings, and fragments.</p>
      </div>
      {error && <InlineError message={error} />}
      <button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit request'}</button>
    </form>
  </Modal>
}

function DestinationCard({ destination, showTest }: { destination: Destination; showTest: boolean }) {
  const heading = useId()
  const field = useId()
  const [value, setValue] = useState(destination.eventTypes.join('\n'))
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSaved(false)
    setBusy(true)
    try {
      const result = await requestJson<Destination>(`/api/destinations/${destination.id}/subscriptions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventTypes: value.split('\n').map((type) => type.trim()).filter(Boolean) }),
      })
      setValue(result.eventTypes.join('\n'))
      setSaved(true)
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return <section className="panel" aria-labelledby={heading}>
    <div className="panel-heading flex-wrap">
      <h2 className="section-title" id={heading}>{destination.name}</h2>
      {showTest && <CreateEventButton destinations={[destination]} />}
    </div>
    <div className="p-5">
      <div className="id-group mb-4">
        <code className="wrap-anywhere">{destination.destinationUrl}</code>
        {destination.destinationUrl && <CopyButton value={destination.destinationUrl} label="Copy destination URL" />}
      </div>
      <form className="space-y-3" onSubmit={save}>
        <div className="field">
          <label htmlFor={field}>Event types</label>
          <textarea id={field} value={value} rows={3} disabled={busy} aria-describedby={field + '-hint'}
            onChange={(event) => { setValue(event.target.value); setSaved(false) }} />
          <p className="muted text-sm" id={field + '-hint'}>
            Enter one exact event type per line, or use <code>*</code> for all events. An empty list pauses live deliveries.
          </p>
        </div>
        <button type="submit" className="button button-secondary" disabled={busy}>Save subscriptions</button>
        {saved && <p role="status" className="text-sm text-emerald-800">Subscriptions saved.</p>}
        {error && <InlineError message={error} />}
      </form>
    </div>
  </section>
}
