import type { Metadata } from 'next'
import { Navigation } from '@/components/navigation'
import { appMode } from '@/server/env'
import { operatorSession } from '@/server/operator'
import './globals.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: { default: 'RelayDesk', template: '%s · RelayDesk' }, description: 'Inspect webhook deliveries, diagnose failures, and replay failed events.' }

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const operator = await operatorSession()
  return <html lang="en"><body>
    <a className="skip-link" href="#main">Skip to content</a>
    <Navigation operator={Boolean(operator)} demo={appMode() === 'demo'} />
    {children}
  </body></html>
}
