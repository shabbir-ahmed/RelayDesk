import { signedHeaders } from '../server/signing'
import { receiverPath } from '../shared/delivery'
import { classifyHttp, type Outcome } from './outcomes'
import type { Claim } from './queue'
import { timing } from './timing'

export async function send(claim: Claim, origin: string, secret: string): Promise<Outcome> {
  const timeout = AbortSignal.timeout(timing.timeoutMs)
  const body = claim.event.canonicalBody
  const headers = signedHeaders(secret, {
    eventId: claim.event.id,
    deliveryId: claim.id,
    cycle: claim.cycle,
    attempt: claim.attemptsInCycle,
    timestamp: Math.floor(Date.now() / 1_000),
    mode: claim.receiverMode,
  }, body)
  try {
    const response = await fetch(new URL(receiverPath, origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
      redirect: 'manual',
      signal: timeout,
    })
    void response.body?.cancel().catch(() => {})
    return classifyHttp(response.status)
  } catch {
    return {
      kind: 'retry',
      error: timeout.aborted ? 'Receiver deadline exceeded. Outcome at receiver is unknown.' : 'Could not reach receiver.',
    }
  }
}
