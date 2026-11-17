'use client'

import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import type { ReceiverMode } from '@/shared/delivery'
import { errorMessage, post } from './client-http'
import { InlineError, Modal, ModeField } from './controls'

const example = JSON.stringify({ orderId: 'demo-1042', total: 49.95, currency: 'USD', synthetic: true }, null, 2)

export function CreateEventButton({ destination }: { destination?: string | null }) {
  const [idempotencyKey, setKey] = useState<string>()
  return <>
    <button type="button" className="button button-primary" onClick={() => setKey(crypto.randomUUID())}>
      <Plus size={18} aria-hidden="true" /> {destination ? 'Send test event' : 'Create event'}
    </button>
    {idempotencyKey && <EventForm destination={destination} idempotencyKey={idempotencyKey} onClose={() => setKey(undefined)} />}
  </>
}

function EventForm({ idempotencyKey, onClose, destination }: {
  idempotencyKey: string; onClose: () => void; destination?: string | null
}) {
  const router = useRouter()
  const [eventType, setEventType] = useState(destination ? 'relaydesk.test' : 'order.created')
  const [payload, setPayload] = useState(destination ? '{\n  "message": "Hello from RelayDesk"\n}' : example)
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
        destination ? '/api/events/test' : '/api/events',
        { eventType, payload: parsed, idempotencyKey, ...(!destination && { receiverMode }) },
      )
      onClose()
      router.push(`/deliveries/${deliveryId}`)
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return <Modal title={destination ? 'Send test event' : 'Create event'} busy={busy} onClose={onClose}>
    <p className="muted mb-5 break-all text-sm">{destination
      ? <>Send a signed test event to <code>{destination}</code>.</>
      : 'Use synthetic data. Visitors can see the event payload and delivery history.'}</p>
    <form className="space-y-4" onSubmit={submit}>
      <div className="field">
        <label htmlFor="event-type">Event type</label>
        <input id="event-type" required maxLength={80} value={eventType} disabled={busy} onChange={(event) => setEventType(event.target.value)} />
      </div>
      {!destination && <ModeField id="create-mode" value={receiverMode} onChange={setMode} disabled={busy} />}
      <div className="field">
        <label htmlFor="payload">JSON payload</label>
        <textarea id="payload" rows={7} required value={payload} disabled={busy} onChange={(event) => setPayload(event.target.value)} spellCheck={false} />
      </div>
      {error && <InlineError message={error} />}
      <div className="modal-actions">
        <button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Submitting…' : destination ? 'Send test' : 'Submit event'}</button>
      </div>
    </form>
  </Modal>
}
