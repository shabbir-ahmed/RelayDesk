'use client'

import { Bell, BookOpen, KeyRound, List, LogIn, LogOut, Users, Webhook } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { environmentLabel, type Environment } from '@/shared/delivery'
import { errorMessage, post } from './client-http'
import { InlineError } from './controls'

export function Navigation({ operator, demo, environment }: { operator: boolean; demo: boolean; environment?: Environment }) {
  const pathname = usePathname()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const guide = pathname === '/demo'
  const deliveries = pathname === '/' || pathname.startsWith('/deliveries/')

  async function logout() {
    setBusy(true)
    setError('')
    try {
      await post('/api/operator/logout')
      if (demo) router.refresh()
      else window.location.replace('/login')
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function selectEnvironment(value: Environment) {
    setBusy(true)
    setError('')
    try {
      await post('/api/environment', { environment: value })
      if (pathname.startsWith('/deliveries/')) window.location.replace('/')
      else window.location.reload()
    } catch (error) {
      setError(errorMessage(error))
      setBusy(false)
    }
  }

  return <header className="site-header">
    <div className="site-nav shell">
      <Link href="/" aria-label="RelayDesk home" className="brand">
        <span className="brand-icon"><Webhook size={21} aria-hidden="true" /></span>
        <span>RelayDesk</span>
      </Link>
      {(demo || operator) && <nav aria-label="Main navigation" className="flex-wrap">
        <Link href="/" className={`nav-link ${deliveries ? 'nav-selected' : ''}`} aria-current={pathname === '/' ? 'page' : undefined}>
          <List size={16} aria-hidden="true" /> Deliveries
        </Link>
        {demo ? <Link href="/demo" className={`nav-link ${guide ? 'nav-selected' : ''}`} aria-current={guide ? 'page' : undefined}>
          <BookOpen size={16} aria-hidden="true" /> Demo guide
        </Link> : <>
          <Link href="/destinations" className={`nav-link ${pathname === '/destinations' ? 'nav-selected' : ''}`}
            aria-current={pathname === '/destinations' ? 'page' : undefined}>
            <Webhook size={16} aria-hidden="true" /> Destinations
          </Link>
          <Link href="/operations" className={`nav-link ${pathname === '/operations' ? 'nav-selected' : ''}`}
            aria-current={pathname === '/operations' ? 'page' : undefined}>
            <Bell size={16} aria-hidden="true" /> Operations
          </Link>
          <Link href="/keys" className={`nav-link ${pathname === '/keys' ? 'nav-selected' : ''}`}
            aria-current={pathname === '/keys' ? 'page' : undefined}>
            <KeyRound size={16} aria-hidden="true" /> API keys
          </Link>
          <Link href="/team" className={`nav-link ${pathname === '/team' ? 'nav-selected' : ''}`}
            aria-current={pathname === '/team' ? 'page' : undefined}>
            <Users size={16} aria-hidden="true" /> Team
          </Link>
        </>}
      </nav>}
      {environment && <div className="field">
        <label className="sr-only" htmlFor="workspace-environment">Environment</label>
        <select id="workspace-environment" value={environment} disabled={busy}
          onChange={(event) => selectEnvironment(event.target.value as Environment)}>
          <option value="TEST">{environmentLabel.TEST}</option>
          <option value="LIVE">{environmentLabel.LIVE}</option>
        </select>
      </div>}
      {operator
        ? <button type="button" onClick={logout} disabled={busy} className="button button-secondary nav-account">
            <LogOut size={16} aria-hidden="true" /> {busy ? 'Signing out…' : 'Sign out'}
          </button>
        : <Link href="/login" className="button button-secondary nav-account"><LogIn size={16} aria-hidden="true" /> {demo ? 'Operator login' : 'Sign in'}</Link>}
    </div>
    {error && <div className="shell pb-3"><InlineError message={error} /></div>}
  </header>
}
