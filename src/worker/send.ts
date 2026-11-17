import { signedHeaders } from '../server/signing'
import { receiverPath } from '../shared/delivery'
import { classifyHttp, type Outcome } from './outcomes'
import type { Claim } from './queue'
import { timing } from './timing'

export function deliveryHeaders(claim: Claim, secret: string) {
  return signedHeaders(secret, {
    eventId: claim.event.id,
    deliveryId: claim.id,
    cycle: claim.cycle,
    attempt: claim.attemptsInCycle,
    timestamp: Math.floor(Date.now() / 1_000),
    mode: claim.receiverMode,
  }, claim.event.canonicalBody)
}

export function networkFailure(timeout: AbortSignal): Outcome {
  return {
    kind: 'retry',
    error: timeout.aborted ? 'Receiver deadline exceeded. Outcome at receiver is unknown.' : 'Could not reach receiver.',
  }
}

export async function send(claim: Claim, origin: string, secret: string): Promise<Outcome> {
  const timeout = AbortSignal.timeout(timing.timeoutMs)
  try {
    const response = await fetch(new URL(receiverPath, origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...deliveryHeaders(claim, secret) },
      body: claim.event.canonicalBody,
      redirect: 'manual',
      signal: timeout,
    })
    void response.body?.cancel().catch(() => {})
    return classifyHttp(response.status)
  } catch {
    return networkFailure(timeout)
  }
}
