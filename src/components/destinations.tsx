'use client'

import { useId, useState, type FormEvent } from 'react'
import type { DestinationOption } from '@/shared/delivery'
import { errorMessage, requestJson } from './client-http'
import { CopyButton, InlineError } from './controls'
import { CreateEventButton } from './event-form'

type Destination = DestinationOption & { eventTypes: string[] }

export function Destinations({ destinations }: { destinations: Destination[] }) {
  return <main className="shell page-content guide-page" id="main">
    <div className="page-heading">
      <div>
        <h1 className="page-title">Destinations</h1>
        <p className="muted mt-2">Choose which event types each approved HTTPS endpoint receives.</p>
      </div>
    </div>
    <div className="space-y-4">
      {!destinations.length && <p className="panel p-5">Ask your RelayDesk administrator to approve a destination.</p>}
      {destinations.map((destination) => <DestinationCard key={destination.id} destination={destination} />)}
    </div>
  </main>
}

function DestinationCard({ destination }: { destination: Destination }) {
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
      <CreateEventButton destinations={[destination]} />
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
