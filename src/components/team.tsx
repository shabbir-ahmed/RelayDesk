'use client'

import { useState } from 'react'
import { errorMessage, post, requestJson } from './client-http'
import { CopyButton, InlineError, Modal } from './controls'
import { Timestamp } from './presentation'

type Invite = { expired: boolean; id: string; createdAt: string; expiresAt: string; redeemedAt: string | null; revokedAt: string | null }
type Member = { username: string; role: 'OWNER' | 'MEMBER' }

export function Team({ members, owner, legacy, initial }: { members: Member[]; owner: boolean; legacy: boolean; initial: Invite[] }) {
  const [invitations, setInvitations] = useState(initial)
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function create() {
    setBusy(true)
    setError('')
    try {
      const { invitation, link } = await post<{ invitation: Omit<Invite, 'expired'>; link: string }>('/api/invitations')
      setInvitations((previous) => [{ ...invitation, expired: false }, ...previous])
      setLink(link)
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string) {
    setBusy(true)
    setError('')
    try {
      await requestJson('/api/invitations/' + id, { method: 'DELETE' })
      const revokedAt = new Date().toISOString()
      setInvitations((previous) => previous.map((entry) => entry.id === id ? { ...entry, revokedAt } : entry))
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return <main className="shell page-content guide-page" id="main">
    <div className="page-heading">
      <div>
        <h1 className="page-title">Team</h1>
        <p className="muted mt-2">Manage who can work in this workspace.</p>
      </div>
      {owner && <button type="button" className="button button-primary" disabled={busy} onClick={create}>Create invitation</button>}
    </div>
    {error && <div className="mb-4"><InlineError message={error} /></div>}
    <section className="panel mb-5" aria-labelledby="team-members">
      <div className="panel-heading"><h2 className="section-title" id="team-members">Members</h2></div>
      <ul className="divide-y divide-slate-200">
        {legacy && <li className="flex justify-between p-4"><span>Legacy operator</span><span className="muted">Owner</span></li>}
        {members.map(({ username, role }) => <li key={username} className="flex flex-wrap justify-between gap-2 p-4">
          <span className="wrap-anywhere">{username}</span><span className="muted">{role === 'OWNER' ? 'Owner' : 'Member'}</span>
        </li>)}
      </ul>
    </section>
    {owner && <section className="panel" aria-labelledby="team-invitations">
      <div className="panel-heading"><h2 className="section-title" id="team-invitations">Recent invitations</h2></div>
      {!invitations.length && <p className="muted p-4">There are no invitations yet.</p>}
      <ul className="divide-y divide-slate-200">
        {invitations.map((invite) => {
          const status = invite.redeemedAt ? 'Accepted' : invite.revokedAt ? 'Revoked' : invite.expired ? 'Expired' : 'Pending'
          return <li key={invite.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
            <div>
              <p className="font-semibold">{status}</p>
              <p className="muted text-sm">Expires <Timestamp value={invite.expiresAt} /></p>
            </div>
            {status === 'Pending' && <button type="button" className="button button-secondary"
              onClick={() => revoke(invite.id)} disabled={busy}>Revoke invitation</button>}
          </li>
        })}
      </ul>
    </section>}
    {link && <Modal title="Share invitation" busy={false} onClose={() => setLink('')}>
      <p className="muted mb-4">Share this single-use link privately. It expires in 48 hours.</p>
      <div className="id-group mb-4">
        <code className="wrap-anywhere" data-testid="invitation-link">{link}</code>
        <CopyButton value={link} label="Copy invitation link" visible />
      </div>
      <button className="button button-secondary" type="button" onClick={() => setLink('')}>Done</button>
    </Modal>}
  </main>
}
