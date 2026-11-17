'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { errorMessage, post } from './client-http'
import { InlineError } from './controls'

export function LoginForm({ demo }: { demo: boolean }) {
  const [workspace, setWorkspace] = useState('')
  const router = useRouter()
  const [credential, setCredential] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await post('/api/operator/login', demo ? { credential } : { workspace, credential })
      if (demo) {
        router.replace('/')
        router.refresh()
      } else {
        window.location.replace('/')
      }
    } catch (error) {
      setError(errorMessage(error))
      setBusy(false)
    }
  }

  return <form onSubmit={submit} className="space-y-5">
    {!demo && <div className="field">
      <label htmlFor="workspace">Workspace slug</label>
      <input id="workspace" value={workspace} autoComplete="username" autoCapitalize="none" maxLength={60}
        required onChange={(event) => setWorkspace(event.target.value)} disabled={busy} />
    </div>}
    <div className="field">
      <label htmlFor="credential">{demo ? 'Operator credential' : 'Workspace access code'}</label>
      <input id="credential" type="password" value={credential} autoComplete="current-password" maxLength={256} required
        onChange={(event) => setCredential(event.target.value)} disabled={busy} />
    </div>
    {error && <InlineError message={error} />}
    <button className="button button-primary w-full" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
  </form>
}
