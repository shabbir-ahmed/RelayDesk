'use client'

import { ArrowLeft, Code2, History, RotateCcw } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useState, type FormEvent, type ReactNode } from 'react'
import type { DeliveryDetail as Detail } from '@/server/reads'
import type { ReceiverMode } from '@/shared/delivery'
import { maxAttempts, maxReplayCycles } from '@/worker/timing'
import { errorMessage, post, requestJson } from './client-http'
import { CopyButton, InlineError, Modal, ModeField } from './controls'
import { attemptInfo, Badge, DeliveryBadge, modeInfo, Timestamp } from './presentation'
import { useLive } from './use-live'

type Attempt = Detail['attempts'][number]

export function DeliveryDetail({ id, initial, operator }: { id: string; initial: Detail; operator: boolean }) {
  const [revision, setRevision] = useState(0)
  const [replayOpen, setReplayOpen] = useState(false)
  const [replayCycle, setReplayCycle] = useState<number>()
  const load = useCallback((signal: AbortSignal) => requestJson<Detail>(`/api/deliveries/${id}`, { signal }), [id])
  const { data, error } = useLive(id, load, initial, revision)
  const delivery = data ?? initial
  const replaysUsed = delivery.cycle - 1
  const canReplay = delivery.status === 'FAILED' && replaysUsed < maxReplayCycles
  const groups = new Map<number, Attempt[]>()
  for (const attempt of delivery.attempts) {
    const group = groups.get(attempt.cycle)
    if (group) group.push(attempt)
    else groups.set(attempt.cycle, [attempt])
  }

  return <main className="shell page-content detail-page" id="main">
    <Link className="back-link" href="/"><ArrowLeft size={16} aria-hidden="true" /> Back to deliveries</Link>
    <div className="page-heading">
      <div className="min-w-0">
        <div className="detail-label"><DeliveryBadge status={delivery.status} />
          {delivery.historical && <span className="access-label">Synthetic fixture</span>}
        </div>
        <h1 className="page-title mt-3 wrap-break-word">{delivery.event.eventType}</h1>
        <div className="id-group mt-2"><span className="muted text-sm">Delivery</span><code className="wrap-anywhere">{delivery.id}</code>
          <CopyButton value={delivery.id} label="Copy delivery ID" />
        </div>
      </div>
      {operator && canReplay && (!replayCycle || delivery.cycle >= replayCycle) && <button type="button" className="button button-primary" onClick={() => setReplayOpen(true)}>
        <RotateCcw size={17} aria-hidden="true" /> Replay delivery
      </button>}
    </div>
    {error && <div className="mb-5"><InlineError message={error} /></div>}
    {replayCycle && <p className="confirmation mb-5" role="status">Replay queued as cycle {replayCycle}.</p>}
    {replayOpen && <ReplayForm delivery={delivery} onClose={() => setReplayOpen(false)} onReplay={(cycle) => {
      setReplayOpen(false)
      setReplayCycle(cycle)
      setRevision((value) => value + 1)
    }} />}

    <div className="detail-grid">
      <div className="space-y-5">
        <section className="panel" aria-labelledby="delivery-state">
          <div className="panel-heading"><h2 className="section-title" id="delivery-state">Delivery state</h2></div>
          <dl className="detail-fields">
            <Field label="Endpoint">{delivery.endpoint.name}</Field>
            <Field label="Receiver mode">{modeInfo[delivery.receiverMode].label}</Field>
            <Field label="Current cycle">{delivery.cycle} · {delivery.attemptsInCycle} of {maxAttempts} attempts used</Field>
            <Field label="Manual replays">{replaysUsed} of {maxReplayCycles} used</Field>
            <Field label="Event ID"><div className="id-group">
              <code className="wrap-anywhere">{delivery.event.id}</code><CopyButton value={delivery.event.id} label="Copy event ID" />
            </div></Field>
            <Field label="Created"><Timestamp value={delivery.event.createdAt} /></Field>
          </dl>
          <div className="state-note"><StateNote delivery={delivery} /></div>
        </section>

        <section className="panel" aria-labelledby="event-payload">
          <div className="panel-heading">
            <h2 className="section-title" id="event-payload"><Code2 size={18} aria-hidden="true" /> Event payload</h2>
            <CopyButton value={JSON.stringify(delivery.event.payload, null, 2)} visible label="Copy JSON payload" />
          </div>
          <pre className="payload"><code>{JSON.stringify(delivery.event.payload, null, 2)}</code></pre>
        </section>
      </div>

      <section className="panel timeline-panel" aria-labelledby="attempt-history">
        <div className="panel-heading">
          <h2 className="section-title" id="attempt-history"><History size={18} aria-hidden="true" /> Attempt history</h2>
          <span className="muted text-sm">{delivery.attempts.length} {delivery.attempts.length === 1 ? 'attempt' : 'attempts'}</span>
        </div>
        {!groups.size && <p className="table-state">Waiting for the first attempt.</p>}
        {[...groups].map(([cycle, attempts]) => <div key={cycle} className="timeline-group">
          <h3>Cycle {cycle} <span>{cycle === 1 ? 'Original delivery' : 'Manual replay'}</span></h3>
          <ol>
            {attempts.map((attempt) => <AttemptItem key={attempt.id} attempt={attempt} />)}
          </ol>
        </div>)}
      </section>
    </div>
  </main>
}

function StateNote({ delivery }: { delivery: Detail }) {
  if (delivery.nextAttemptAt) return <>Next attempt is eligible at <Timestamp value={delivery.nextAttemptAt} seconds />.</>
  if (delivery.leaseExpiresAt) return <>A worker owns this attempt until <Timestamp value={delivery.leaseExpiresAt} seconds />.</>
  if (delivery.status === 'FAILED') return delivery.cycle > maxReplayCycles
    ? 'The manual replay limit has been reached.'
    : 'Automatic delivery has ended. An operator can start a new cycle.'
  if (delivery.status === 'DELIVERED') return 'The receiver returned a successful HTTP response.'
  return 'Waiting for a worker to claim this delivery.'
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>
}

function AttemptItem({ attempt }: { attempt: Attempt }) {
  const { label, tone } = attemptInfo[attempt.status]
  return <li className={`attempt tone-${tone}`}>
    <span className="timeline-dot" aria-hidden="true" />
    <div className="attempt-heading">
      <h4>Attempt {attempt.attemptNumber}</h4>
      <Badge label={label} tone={tone} />
    </div>
    <p className="attempt-meta">
      <span><Timestamp value={attempt.startedAt} seconds /></span>
      {attempt.durationMs !== null && <span>{attempt.durationMs.toLocaleString('en-US')} ms</span>}
      {attempt.httpStatus !== null && <code>HTTP {attempt.httpStatus}</code>}
    </p>
    {attempt.completedAt && <p className="muted mt-1 text-xs">Recorded <Timestamp value={attempt.completedAt} seconds /></p>}
    {attempt.error && <p className="attempt-error">{attempt.error}</p>}
    <p className="muted mt-1 text-xs">Receiver mode · {modeInfo[attempt.receiverMode].label}</p>
  </li>
}

function ReplayForm({ delivery, onClose, onReplay }: { delivery: Detail; onClose: () => void; onReplay: (cycle: number) => void }) {
  const [receiverMode, setMode] = useState<ReceiverMode>('SUCCEED')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { cycle } = await post<{ cycle: number }>(`/api/deliveries/${delivery.id}/replay`, { receiverMode })
      onReplay(cycle)
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return <Modal title="Replay delivery" onClose={onClose} busy={busy}>
    <p className="muted mb-5 text-sm">Queue the same event in cycle {delivery.cycle + 1}. Prior attempts stay in the history.</p>
    <form className="space-y-4" onSubmit={submit}>
      <ModeField id="replay-mode" value={receiverMode} onChange={setMode} disabled={busy} />
      {error && <InlineError message={error} />}
      <div className="modal-actions">
        <button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Queuing…' : 'Queue replay'}</button>
      </div>
    </form>
  </Modal>
}
