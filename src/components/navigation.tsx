'use client'

import { BookOpen, List, LogIn, LogOut, Webhook } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { errorMessage, post } from './client-http'
import { InlineError } from './controls'

export function Navigation({ operator }: { operator: boolean }) {
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
      router.refresh()
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return <header className="site-header">
    <div className="site-nav shell">
      <Link href="/" aria-label="RelayDesk home" className="brand">
        <span className="brand-icon"><Webhook size={21} aria-hidden="true" /></span>
        <span>RelayDesk</span>
      </Link>
      <nav aria-label="Main navigation">
        <Link href="/" className={`nav-link ${deliveries ? 'nav-selected' : ''}`} aria-current={pathname === '/' ? 'page' : undefined}>
          <List size={16} aria-hidden="true" /> Deliveries
        </Link>
        <Link href="/demo" className={`nav-link ${guide ? 'nav-selected' : ''}`} aria-current={guide ? 'page' : undefined}>
          <BookOpen size={16} aria-hidden="true" /> Demo guide
        </Link>
      </nav>
      {operator
        ? <button type="button" onClick={logout} disabled={busy} className="button button-secondary nav-account">
            <LogOut size={16} aria-hidden="true" /> {busy ? 'Signing out…' : 'Sign out'}
          </button>
        : <Link href="/login" className="button button-secondary nav-account"><LogIn size={16} aria-hidden="true" /> Operator login</Link>}
    </div>
    {error && <div className="shell pb-3"><InlineError message={error} /></div>}
  </header>
}
