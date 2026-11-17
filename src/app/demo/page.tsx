import { ArrowUpRight, FlaskConical, SquareTerminal } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { appMode } from '@/server/env'
import { CopyButton } from '@/components/controls'
import { modeInfo } from '@/components/presentation'
import { receiverModes } from '@/shared/delivery'

export const metadata = { title: 'Demo guide' }

const create = [
  'curl -sS "$APP_ORIGIN/api/events" \\',
  '  -H "Authorization: Bearer $RELAYDESK_API_TOKEN" \\',
  "  -H 'Content-Type: application/json' \\",
  "  -d '{\"eventType\":\"order.created\",\"payload\":{\"orderId\":\"demo-1042\",\"synthetic\":true},\"idempotencyKey\":\"demo-order-1042\",\"receiverMode\":\"FAIL_TWICE\"}'",
].join('\n')

const read = 'curl -sS "$APP_ORIGIN/api/deliveries/<delivery-id>"'

export default function DemoGuide() {
  if (appMode() !== 'demo') notFound()
  return <main className="shell page-content guide-page" id="main">
    <div className="page-heading">
      <div>
        <h1 className="page-title">Demo guide</h1>
        <p className="muted mt-2">Follow an event through a failed attempt, an automatic retry, and a manual replay.</p>
      </div>
      <Link className="button button-secondary" href="/">View deliveries <ArrowUpRight size={16} aria-hidden="true" /></Link>
    </div>
    <div className="space-y-5">
      <section className="panel" aria-labelledby="guide-modes">
        <div className="panel-heading"><h2 className="section-title" id="guide-modes"><FlaskConical size={19} aria-hidden="true" /> Controlled receiver modes</h2></div>
        <dl className="guide-modes">
          {receiverModes.map((mode) => <div key={mode}>
            <dt>{modeInfo[mode].label} <code>{mode}</code></dt><dd>{modeInfo[mode].detail}</dd>
          </div>)}
        </dl>
      </section>
      <section className="panel" aria-labelledby="guide-api">
        <div className="panel-heading"><h2 className="section-title" id="guide-api"><SquareTerminal size={19} aria-hidden="true" /> API examples</h2></div>
        <div className="space-y-4 p-5">
          <p className="muted text-sm">Set <code>APP_ORIGIN</code> to your instance and <code>RELAYDESK_API_TOKEN</code> to your operator’s API token. Keep the idempotency key when retrying the same submission.</p>
          <Example title="Submit a flaky event" value={create} />
          <Example title="Read delivery and attempt history" value={read} />
        </div>
      </section>
      <section className="panel p-5" aria-labelledby="guide-semantics">
        <h2 className="section-title mb-2" id="guide-semantics">Delivery and recovery</h2>
        <p className="muted mb-2">A functioning worker attempts each accepted event at least once. Transient failures retry after 5 and 15 seconds, up to three attempts per cycle. Sign in to replay an exhausted delivery in a new cycle.</p>
        <p className="muted">If a worker loses its lease after sending, RelayDesk records the attempt as unknown. The receiver may already have accepted it, so retrying can cause duplicates. The simulated receiver has no business side effects.</p>
      </section>
    </div>
  </main>
}

function Example({ title, value }: { title: string; value: string }) {
  return <div>
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <CopyButton value={value} label={`Copy example to ${title.toLowerCase()}`} visible />
    </div>
    <pre className="example-code"><code>{value}</code></pre>
  </div>
}
