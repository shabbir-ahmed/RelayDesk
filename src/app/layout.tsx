import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = { title: 'RelayDesk', description: 'Webhook delivery and recovery for synthetic events.' }

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>
}
