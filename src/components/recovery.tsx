'use client'

import { useState, type FormEvent } from 'react'
import { post, errorMessage } from './client-http'
import { CopyButton, InlineError, Modal } from './controls'

export function RecoveryForm() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function recover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      await post('/api/account/recover', { username: data.get('username'), code: data.get('code'), password: data.get('password') })
      window.location.replace('/login')
    } catch (error) {
      setError(errorMessage(error))
      setBusy(false)
    }
  }

  return <form method="post" onSubmit={recover} className="space-y-4">
    <div className="field">
      <label htmlFor="recovery-username">Username</label>
      <input id="recovery-username" name="username" autoComplete="username" autoCapitalize="none" minLength={3} maxLength={60} required />
    </div>
    <div className="field">
      <label htmlFor="recovery-code">Recovery code</label>
      <input id="recovery-code" name="code" type="password" autoComplete="off" required />
    </div>
    <div className="field">
      <label htmlFor="recovery-password">New password</label>
      <input id="recovery-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
    </div>
    {error && <InlineError message={error} />}
    <button className="button button-primary" disabled={busy}>Reset password</button>
  </form>
}

export function RecoveryCode() {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [code, setCode] = useState('')

  async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      const result = await post<{ code: string }>('/api/account/recovery-code', { password: data.get('password') })
      setCode(result.code)
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  function close() {
    setOpen(false)
    setCode('')
    setError('')
  }

  return <section className="panel mt-5" aria-labelledby="recovery-heading">
    <div className="panel-heading"><h2 className="section-title" id="recovery-heading">Account recovery</h2></div>
    <div className="p-4">
      <p className="muted mb-3">Save a single-use code so you can reset your password if you lose access.</p>
      <button type="button" className="button button-secondary" onClick={() => setOpen(true)}>Generate recovery code</button>
    </div>
    {open && <Modal title="Account recovery code" busy={busy} onClose={close}>
      {code ? <>
        <p className="muted mb-3">Store this code in your password manager. RelayDesk shows it once.</p>
        <div className="id-group mb-4"><code className="wrap-anywhere">{code}</code>
          <CopyButton value={code} label="Copy recovery code" visible />
        </div>
        <button type="button" className="button button-secondary" onClick={close}>Done</button>
      </> : <form method="post" onSubmit={issue} className="space-y-4">
        <p className="muted">Generating a new code invalidates your previous code.</p>
        <div className="field">
          <label htmlFor="recovery-current-password">Current password</label>
          <input id="recovery-current-password" name="password" type="password" autoComplete="current-password"
            maxLength={128} required disabled={busy} />
        </div>
        {error && <InlineError message={error} />}
        <button className="button button-primary" disabled={busy}>Generate code</button>
      </form>}
    </Modal>}
  </section>
}
