import { ShieldCheck, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { LoginForm } from '@/components/login-form'
import { appMode } from '@/server/env'
import { operatorSession } from '@/server/operator'

export const metadata = { title: 'Operator login' }

export default async function Login() {
  if (await operatorSession()) redirect('/')
  const demo = appMode() === 'demo'
  return <main className="shell page-content" id="main">
    <div className="mx-auto max-w-md">
      {demo && <Link href="/" className="back-link"><ArrowLeft size={16} aria-hidden="true" /> Back to deliveries</Link>}
      <div className="panel p-6 sm:p-8">
        <div className="feature-icon tone-processing mb-5"><ShieldCheck size={22} aria-hidden="true" /></div>
        <h1 className="page-title mb-2">{demo ? 'Operator login' : 'Sign in to your workspace'}</h1>
        <p className="muted mb-6">{demo
          ? 'Sign in to submit synthetic events and replay failed deliveries.'
          : 'Enter the workspace slug and access code from your RelayDesk administrator.'}</p>
        <LoginForm demo={demo} />
      </div>
    </div>
  </main>
}
