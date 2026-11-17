import { Activity, CircleCheck, CircleX, Clock3, Timer } from 'lucide-react'
import type { DeliveryStatus, ReceiverMode } from '@/shared/delivery'

export const statusInfo = {
  PENDING: { label: 'Pending', detail: 'Waiting in queue', icon: Clock3, tone: 'pending' },
  PROCESSING: { label: 'Processing', detail: 'In progress', icon: Activity, tone: 'processing' },
  DELIVERED: { label: 'Delivered', detail: 'Accepted by receiver', icon: CircleCheck, tone: 'delivered' },
  FAILED: { label: 'Failed', detail: 'Requires attention', icon: CircleX, tone: 'failed' },
} satisfies Record<DeliveryStatus, { label: string; detail: string; icon: typeof Timer; tone: string }>

export const modeInfo = {
  SUCCEED: { label: 'Succeed', detail: 'Returns HTTP 200 on the first attempt.' },
  FAIL_TWICE: { label: 'Fail twice', detail: 'Returns HTTP 503 twice, then HTTP 200 on attempt three.' },
  ALWAYS_FAIL: { label: 'Always fail', detail: 'Returns HTTP 503 on every attempt.' },
  TIMEOUT: { label: 'Timeout', detail: 'Responds after four seconds, beyond the three-second worker deadline.' },
} satisfies Record<ReceiverMode, { label: string; detail: string }>

export const attemptInfo = {
  STARTED: { label: 'Started', tone: 'processing' },
  SUCCEEDED: { label: 'Succeeded', tone: 'delivered' },
  FAILED: { label: 'Failed', tone: 'failed' },
  UNKNOWN: { label: 'Unknown', tone: 'pending' },
}

export function Badge({ label, tone }: { label: string; tone: string }) {
  return <span className={`badge tone-${tone}`}><span aria-hidden="true" />{label}</span>
}

export function DeliveryBadge({ status }: { status: DeliveryStatus }) {
  return <Badge {...statusInfo[status]} />
}

const timeOptions = {
  month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  hourCycle: 'h23', timeZone: 'UTC',
} satisfies Intl.DateTimeFormatOptions
const dateTime = new Intl.DateTimeFormat('en-US', timeOptions)
const preciseTime = new Intl.DateTimeFormat('en-US', { ...timeOptions, second: '2-digit' })

export function Timestamp({ value, seconds = false }: { value: string; seconds?: boolean }) {
  return <time dateTime={value}>{(seconds ? preciseTime : dateTime).format(new Date(value))} UTC</time>
}
