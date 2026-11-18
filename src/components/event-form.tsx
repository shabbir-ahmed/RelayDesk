'use client'

import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import type { DestinationOption, ReceiverMode } from '@/shared/delivery'
import { errorMessage, post } from './client-http'
import { InlineError, Modal, ModeField } from './controls'

const example = JSON.stringify({ orderId: 'demo-1042', total: 49.95, currency: 'USD', synthetic: true }, null, 2)

export function CreateEventButton({ destinations }: { destinations?: DestinationOption[] }) {
  const [idempotencyKey, setKey] = useState<string>()
  return <>
    <button type="button" className="button button-primary" onClick={() => setKey(crypto.randomUUID())}>
      <Plus size={18} aria-hidden="true" /> {destinations ? 'Send test event' : 'Create event'}
    </button>
    {idempotencyKey && <EventForm destinations={destinations} idempotencyKey={idempotencyKey} onClose={() => setKey(undefined)} />}
  </>
}

function EventForm({ idempotencyKey, onClose, destinations }: {
  idempotencyKey: string; onClose: () => void; destinations?: DestinationOption[]
}) {
  const router = useRouter()
  const [destinationId, setDestinationId] = useState(destinations?.[0]?.id ?? '')
  const destination = destinations?.find(({ id }) => id === destinationId)
  const [eventType, setEventType] = useState(destinations ? 'relaydesk.test' : 'order.created')
  const [payload, setPayload] = useState(destinations ? '{\n  "message": "Hello from RelayDesk"\n}' : example)
  const [receiverMode, setMode] = useState<ReceiverMode>('FAIL_TWICE')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
    } catch {
      setError('Enter a valid JSON object for the payload.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const { deliveryId } = await post<{ deliveryId: string }>(
        destinations ? '/api/events/test' : '/api/events',
        { eventType, payload: parsed, idempotencyKey, ...(destinations ? { destinationId } : { receiverMode }) },
      )
      onClose()
      router.push(`/deliveries/${deliveryId}`)
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return <Modal title={destinations ? 'Send test event' : 'Create event'} busy={busy} onClose={onClose}>
    <p className="muted mb-5 break-all text-sm">{destination
      ? <>Send a signed test event to <code>{destination.destinationUrl}</code>.</>
      : 'Use synthetic data. Visitors can see the event payload and delivery history.'}</p>
    <form className="space-y-4" onSubmit={submit}>
      {destinations && destinations.length > 1 && <div className="field">
        <label htmlFor="test-destination">Destination</label>
        <select id="test-destination" value={destinationId} disabled={busy}
          onChange={(event) => setDestinationId(event.target.value)}>
          {destinations.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
        </select>
      </div>}
      <div className="field">
        <label htmlFor="event-type">Event type</label>
        <input id="event-type" required maxLength={80} value={eventType} disabled={busy} onChange={(event) => setEventType(event.target.value)} />
      </div>
      {!destinations && <ModeField id="create-mode" value={receiverMode} onChange={setMode} disabled={busy} />}
      <div className="field">
        <label htmlFor="payload">JSON payload</label>
        <textarea id="payload" rows={7} required value={payload} disabled={busy} onChange={(event) => setPayload(event.target.value)} spellCheck={false} />
      </div>
      {error && <InlineError message={error} />}
      <div className="modal-actions">
        <button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Submitting…' : destinations ? 'Send test' : 'Submit event'}</button>
      </div>
    </form>
  </Modal>
}
