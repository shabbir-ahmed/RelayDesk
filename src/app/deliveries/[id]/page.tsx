import { notFound, redirect } from 'next/navigation'
import { DeliveryDetail } from '@/components/delivery-detail'
import { db } from '@/server/db'
import { demoScope } from '@/server/demo'
import { appMode } from '@/server/env'
import { operatorSession } from '@/server/operator'
import { deliveryDetail } from '@/server/reads'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Delivery detail' }

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const demo = appMode() === 'demo'
  const session = await operatorSession()
  if (!demo && !session) redirect('/login')
  const delivery = await deliveryDetail(db(), session?.workspaceId ?? demoScope.workspaceId, id)
  if (!delivery) notFound()
  return <DeliveryDetail key={id} id={id} initial={delivery} operator={Boolean(session)} demo={demo} />
}
