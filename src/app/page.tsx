import Link from 'next/link'
import { db } from '@/server/db'
import { listDeliveries } from '@/server/reads'

export const dynamic = 'force-dynamic'

export default async function Dashboard() {
  const { items } = await listDeliveries(db())
  return <main className="p-8">
    <h1 className="text-3xl font-bold">RelayDesk</h1>
    <ul className="mt-5 space-y-3">
      {items.map(({ id, status, event }) => <li key={id}>
        <Link className="underline" href={`/deliveries/${id}`}>{event.eventType} · {status}</Link>
      </li>)}
    </ul>
  </main>
}
