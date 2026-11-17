'use client'

import { useState, type FormEvent } from 'react'
import { errorMessage, post, requestJson } from './client-http'
import { CopyButton, InlineError, Modal } from './controls'
import { Timestamp } from './presentation'

type Key = { id: string; name: string; prefix: string; createdAt: string }

export function ApiKeys({ initial }: { initial: Key[] }) {
  const [keys, setKeys] = useState(initial)
  const [name, setName] = useState('')
  const [token, setToken] = useState('')
  const [selected, setSelected] = useState<Key>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { token, ...key } = await post<Key & { token: string }>('/api/keys', { name })
      setKeys((previous) => [key, ...previous])
      setToken(token)
      setName('')
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function revoke() {
    if (!selected) return
    setBusy(true)
    setError('')
    try {
      await requestJson('/api/keys/' + selected.id, { method: 'DELETE' })
      setKeys((previous) => previous.filter((entry) => entry.id !== selected.id))
      setSelected(undefined)
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return <main className="shell page-content guide-page" id="main">
    <div className="page-heading">
      <div>
        <h1 className="page-title">API keys</h1>
        <p className="muted mt-2">Use a bearer key to submit events from your application to <code>/api/events</code>.</p>
      </div>
    </div>
    <div className="space-y-5">
      <section className="panel" aria-labelledby="create-key">
        <div className="panel-heading"><h2 className="section-title" id="create-key">Create API key</h2></div>
        <form className="p-5" onSubmit={create}>
          <div className="field">
            <label htmlFor="key-name">Name</label>
            <input id="key-name" value={name} onChange={(event) => setName(event.target.value)}
              maxLength={80} required disabled={busy || Boolean(token)} />
          </div>
          <button className="button button-primary mt-4" type="submit" disabled={busy || Boolean(token)}>Create key</button>
        </form>
      </section>
      <section className="panel" aria-labelledby="active-keys">
        <div className="panel-heading"><h2 className="section-title" id="active-keys">Active keys</h2></div>
        {!keys.length && <p className="muted p-5">Create a key when you’re ready to connect an application.</p>}
        <ul className="divide-y divide-slate-200">
          {keys.map((key) => <li key={key.id} className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <p className="font-semibold wrap-anywhere">{key.name}</p>
              <p className="muted text-sm"><code>{key.prefix}…</code> · <Timestamp value={key.createdAt} /></p>
            </div>
            <button className="button button-secondary" type="button" onClick={() => {
              setError('')
              setSelected(key)
            }} aria-label={`Revoke ${key.name}`}>Revoke</button>
          </li>)}
        </ul>
      </section>
      {error && !selected && <InlineError message={error} />}
    </div>
    {token && <Modal title="Copy API key" busy={false} onClose={() => setToken('')}>
      <p className="muted mb-3">Save this key now. RelayDesk shows the full value once.</p>
      <div className="id-group mb-5"><code className="wrap-anywhere" data-testid="new-api-key">{token}</code>
        <CopyButton value={token} label="Copy API key" visible />
      </div>
      <button type="button" className="button button-secondary" onClick={() => setToken('')}>Done</button>
    </Modal>}
    {selected && <Modal title="Revoke API key" busy={busy} onClose={() => setSelected(undefined)}>
      <p className="muted mb-4">Requests using <strong>{selected.name}</strong> will lose access immediately.</p>
      {error && <InlineError message={error} />}
      <div className="modal-actions">
        <button className="button button-secondary" type="button" onClick={() => setSelected(undefined)} disabled={busy}>Cancel</button>
        <button className="button button-primary" type="button" onClick={revoke} disabled={busy}>Revoke key</button>
      </div>
    </Modal>}
  </main>
}
