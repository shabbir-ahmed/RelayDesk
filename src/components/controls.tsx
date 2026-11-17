'use client'

import { Check, Copy, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { receiverModes, type ReceiverMode } from '@/shared/delivery'
import { modeInfo } from './presentation'

export function CopyButton({ value, label, visible = false }: { value: string; label: string; visible?: boolean }) {
  const [feedback, setFeedback] = useState('')
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setFeedback('Copied')
    } catch {
      setFeedback('Copy unavailable')
    }
  }

  const displayed = feedback || 'Copy'
  const Icon = feedback === 'Copied' ? Check : Copy
  return <button type="button" className={visible ? 'button button-small button-secondary' : 'icon-button'}
    onClick={copy} aria-label={label} title={feedback || label}>
    <Icon size={14} aria-hidden="true" />
    {visible ? <span aria-live="polite">{displayed}</span> : <span className="sr-only" aria-live="polite">{feedback}</span>}
  </button>
}

export function ModeField({ id, value, onChange, disabled }: {
  id: string; value: ReceiverMode; onChange: (mode: ReceiverMode) => void; disabled: boolean
}) {
  return <div className="field">
    <label htmlFor={id}>Receiver mode</label>
    <select id={id} value={value} onChange={(event) => onChange(event.target.value as ReceiverMode)}
      aria-describedby={id + '-help'} disabled={disabled}>
      {receiverModes.map((mode) => <option key={mode} value={mode}>{modeInfo[mode].label}</option>)}
    </select>
    <p className="muted text-sm" id={id + '-help'}>{modeInfo[value].detail}</p>
  </div>
}

export function Modal({ title, onClose, busy, children }: {
  title: string; onClose: () => void; busy: boolean; children: React.ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  return <dialog ref={ref} className="modal" aria-labelledby="modal-heading" onCancel={(event) => {
    event.preventDefault()
    if (!busy) onClose()
  }}>
    <div className="mb-5 flex items-start justify-between gap-4">
      <h2 id="modal-heading" className="text-xl font-bold">{title}</h2>
      <button className="icon-button" aria-label="Close dialog" type="button" onClick={onClose} disabled={busy}>
        <X size={19} aria-hidden="true" />
      </button>
    </div>
    {children}
  </dialog>
}

export function InlineError({ message }: { message: string }) {
  return <p className="inline-error" role="alert">{message}</p>
}
