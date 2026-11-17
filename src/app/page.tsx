import { Dashboard } from '@/components/dashboard'
import { db } from '@/server/db'
import { hasOperatorSession } from '@/server/operator'
import { deliverySummary, listDeliveries } from '@/server/reads'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const [operator, initial] = await Promise.all([
    hasOperatorSession(),
    Promise.all([listDeliveries(db()), deliverySummary(db())])
      .then(([list, summary]) => ({ list, summary })).catch(() => undefined),
  ])
  return <Dashboard operator={operator} initial={initial} />
}
