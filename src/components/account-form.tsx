'use client'

import { useState, type FormEvent } from 'react'
import { errorMessage, post } from './client-http'
import { InlineError } from './controls'

export function AccountForm({ signup }: { signup: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const credentials = { username: form.get('username'), password: form.get('password') }
    setError('')
    setBusy(true)
    try {
      if (signup) {
        await post('/api/signup', { ...credentials, workspace: form.get('workspace'), name: form.get('name') })
      } else {
        const token = window.location.hash.slice(1)
        if (!token) throw new Error('Open the invitation link shared by your workspace owner.')
        await post('/api/invitations/redeem', { ...credentials, token })
      }
      window.location.replace('/')
    } catch (error) {
      setError(errorMessage(error))
      setBusy(false)
    }
  }

  return <form method="post" className="space-y-4" onSubmit={submit}>
    {signup && <>
      <div className="field">
        <label htmlFor="account-workspace-name">Workspace name</label>
        <input id="account-workspace-name" name="name" maxLength={80} required disabled={busy} />
      </div>
      <div className="field">
        <label htmlFor="account-workspace-slug">Workspace slug</label>
        <input id="account-workspace-slug" name="workspace" minLength={2} maxLength={60}
          placeholder="my-workspace" autoCapitalize="none" required disabled={busy} />
      </div>
    </>}
    <div className="field">
      <label htmlFor="account-username">Username</label>
      <input id="account-username" name="username" autoComplete="username" autoCapitalize="none"
        minLength={3} maxLength={60} required disabled={busy} />
    </div>
    <div className="field">
      <label htmlFor="account-password">Password</label>
      <input id="account-password" name="password" type="password" autoComplete={signup ? 'new-password' : 'current-password'}
        minLength={12} maxLength={128} required disabled={busy} aria-describedby="account-password-hint" />
      <p className="muted text-xs" id="account-password-hint">Use at least 12 characters.</p>
    </div>
    {error && <InlineError message={error} />}
    <button type="submit" className="button button-primary w-full" disabled={busy}>
      {busy ? 'Working…' : signup ? 'Create workspace' : 'Join workspace'}
    </button>
  </form>
}
