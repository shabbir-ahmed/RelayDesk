import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/server/db'
import { deliveryDetail } from '@/server/reads'

export const dynamic = 'force-dynamic'

export default async function Delivery({ params }: { params: Promise<{ id: string }> }) {
  const delivery = await deliveryDetail(db(), (await params).id)
  if (!delivery) notFound()
  return <main className="p-8">
    <Link href="/" className="underline">Deliveries</Link>
    <h1 className="mt-4 text-3xl font-bold">{delivery.event.eventType}</h1>
    <p>{delivery.status}</p>
    <pre className="my-4">{JSON.stringify(delivery.event.payload, null, 2)}</pre>
    <ol>{delivery.attempts.map((attempt) => <li key={attempt.id}>
      Attempt {attempt.attemptNumber} · {attempt.status} · HTTP {attempt.httpStatus}
    </li>)}</ol>
  </main>
}
