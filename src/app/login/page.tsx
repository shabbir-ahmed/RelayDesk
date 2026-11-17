import { ShieldCheck, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { LoginForm } from '@/components/login-form'
import { hasOperatorSession } from '@/server/operator'

export const metadata = { title: 'Operator login' }

export default async function Login() {
  if (await hasOperatorSession()) redirect('/')
  return <main className="shell page-content" id="main">
    <div className="mx-auto max-w-md">
      <Link href="/" className="back-link"><ArrowLeft size={16} aria-hidden="true" /> Back to deliveries</Link>
      <div className="panel p-6 sm:p-8">
        <div className="feature-icon tone-processing mb-5"><ShieldCheck size={22} aria-hidden="true" /></div>
        <h1 className="page-title mb-2">Operator login</h1>
        <p className="muted mb-6">Sign in to submit synthetic events and replay failed deliveries.</p>
        <LoginForm />
      </div>
    </div>
  </main>
}
