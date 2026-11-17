import { receiverPath } from '../shared/delivery'
import type { Claim, Outcome } from './queue'
import { timing } from './timing'

export async function send(claim: Claim, origin: string, secret: string): Promise<Outcome> {
  const timeout = AbortSignal.timeout(timing.timeoutMs)
  try {
    const response = await fetch(new URL(receiverPath, origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: claim.event.canonicalBody,
      redirect: 'manual',
      signal: timeout,
    })
    void response.body?.cancel().catch(() => {})
    return response.ok
      ? { ok: true, status: response.status }
      : { ok: false, status: response.status, error: `Receiver returned HTTP ${response.status}.` }
  } catch {
    return { ok: false, error: timeout.aborted ? 'Receiver deadline exceeded.' : 'Could not reach receiver.' }
  }
}
