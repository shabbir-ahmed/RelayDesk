import { notFound } from 'next/navigation'
import { AccountForm } from '@/components/account-form'
import { appMode } from '@/server/env'

export const metadata = { title: 'Join a workspace' }

export default function Join() {
  if (appMode() !== 'private') notFound()
  return <main className="shell page-content" id="main">
    <section className="panel mx-auto max-w-md p-6 sm:p-8" aria-labelledby="join-workspace">
      <h1 className="page-title mb-2" id="join-workspace">Join a workspace</h1>
      <p className="muted mb-5">Use your existing username and password, or choose credentials for a new account.</p>
      <AccountForm signup={false} />
    </section>
  </main>
}
