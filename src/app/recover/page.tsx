import Link from 'next/link'
import { notFound } from 'next/navigation'
import { RecoveryForm } from '@/components/recovery'
import { appMode } from '@/server/env'

export const metadata = { title: 'Recover account' }

export default function Recover() {
  if (appMode() !== 'private') notFound()
  return <main className="shell page-content" id="main">
    <section className="panel mx-auto max-w-md p-6 sm:p-8" aria-labelledby="recover-account">
      <h1 className="page-title mb-2" id="recover-account">Reset your password</h1>
      <p className="muted mb-5">Use the code you saved in Team. Resetting your password signs you out across all workspaces.</p>
      <RecoveryForm />
      <Link className="table-link mt-5 inline-block" href="/login">Back to sign in</Link>
    </section>
  </main>
}
