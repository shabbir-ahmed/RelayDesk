import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { AccountForm } from '@/components/account-form'
import { appMode } from '@/server/env'
import { operatorSession } from '@/server/operator'

export const metadata = { title: 'Create a workspace' }

export default async function Signup() {
  if (appMode() !== 'private') notFound()
  if (await operatorSession()) redirect('/')
  return <main className="shell page-content" id="main">
    <section className="panel mx-auto max-w-md p-6 sm:p-8" aria-labelledby="create-workspace">
      <h1 className="page-title mb-2" id="create-workspace">Create a workspace</h1>
      <p className="muted mb-5">You’ll start in the Test environment.</p>
      <AccountForm signup />
      <p className="muted mt-5 text-sm">Already have an account? <Link className="table-link" href="/login">Sign in</Link></p>
    </section>
  </main>
}
