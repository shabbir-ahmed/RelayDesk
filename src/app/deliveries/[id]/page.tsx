import { notFound } from 'next/navigation'
import { DeliveryDetail } from '@/components/delivery-detail'
import { db } from '@/server/db'
import { hasOperatorSession } from '@/server/operator'
import { deliveryDetail } from '@/server/reads'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Delivery detail' }

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [delivery, operator] = await Promise.all([deliveryDetail(db(), id), hasOperatorSession()])
  if (!delivery) notFound()
  return <DeliveryDetail key={id} id={id} initial={delivery} operator={operator} />
}
