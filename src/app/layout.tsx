import type { Metadata } from 'next'
import { Navigation } from '@/components/navigation'
import { hasOperatorSession } from '@/server/operator'
import './globals.css'

export const metadata: Metadata = { title: { default: 'RelayDesk', template: '%s · RelayDesk' }, description: 'Inspect webhook deliveries, diagnose failures, and replay synthetic events.' }

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>
    <a className="skip-link" href="#main">Skip to content</a>
    <Navigation operator={await hasOperatorSession()} />
    {children}
  </body></html>
}
