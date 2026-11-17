import type { ClientRequest, IncomingMessage } from 'node:http'
import { request, type RequestOptions } from 'node:https'
import { BlockedDestination, destinationUrl, resolveDestination, type ResolveHost } from '../server/destinations'
import { destinationSecret } from '../server/workspaces'
import { classifyHttp, type Outcome } from './outcomes'
import type { Claim } from './queue'
import { deliveryHeaders, networkFailure } from './send'
import { timing } from './timing'

type HttpsRequest = (url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest
type Transport = { resolve?: ResolveHost; request?: HttpsRequest }

function withDeadline<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

export async function sendApproved(claim: Claim, key: string, transport: Transport = {}): Promise<Outcome> {
  const deadline = AbortSignal.timeout(timing.timeoutMs)
  const body = claim.event.canonicalBody
  try {
    if (!claim.endpoint.destinationUrl) throw new BlockedDestination()
    const url = destinationUrl(claim.endpoint.destinationUrl)
    const { address, family } = await withDeadline(resolveDestination(url.hostname, transport.resolve), deadline)
    const secret = destinationSecret(key, claim.endpoint.id)
    return await new Promise<Outcome>((resolve, reject) => {
      const post = (transport.request ?? request)(url, {
        method: 'POST',
        agent: false,
        family,
        signal: deadline,
        // Keep the original TLS hostname while connecting to the address just validated.
        lookup: (_hostname, _options, callback) => callback(null, address, family),
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...deliveryHeaders(claim, secret),
        },
      }, (response) => {
        const status = response.statusCode
        response.destroy()
        resolve(status ? classifyHttp(status) : networkFailure(deadline))
      })
      post.once('error', reject)
      post.end(body)
    })
  } catch (error) {
    if (error instanceof BlockedDestination) {
      return { kind: 'permanent', error: 'Destination blocked by the outbound HTTPS policy.' }
    }
    return networkFailure(deadline)
  }
}
