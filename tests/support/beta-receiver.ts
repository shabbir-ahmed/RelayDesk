import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, request } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifySignature } from '../../src/server/signing'
import type { sendApproved } from '../../src/worker/send-approved'

export async function betaReceiver(secrets: Map<string, string>) {
  const folder = await mkdtemp(join(tmpdir(), 'relaydesk-https-test-'))
  const messages: { path: string; body: string; event: string; cycle: number }[] = []
  const config = join(folder, 'openssl.cnf')
  let cert: Buffer
  let key: Buffer
  try {
    await writeFile(config, [
      '[req]', 'prompt = no', 'distinguished_name = dn', 'x509_extensions = extensions',
      '[dn]', 'CN = alpha.receiver.test', '[extensions]',
      'subjectAltName = DNS:alpha.receiver.test,DNS:beta.receiver.test',
    ].join('\n'))
    execFileSync('openssl', [
      'req', '-x509', '-nodes', '-newkey', 'rsa:2048', '-days', '1', '-config', config,
      '-keyout', join(folder, 'key.pem'), '-out', join(folder, 'cert.pem'),
    ], { stdio: 'ignore' })
    ;[cert, key] = await Promise.all([readFile(join(folder, 'cert.pem')), readFile(join(folder, 'key.pem'))])
  } finally {
    await rm(folder, { recursive: true, force: true })
  }

  const server = createServer({ key, cert }, async (incoming, response) => {
    try {
      const path = incoming.url ?? ''
      const secret = secrets.get(path)
      const chunks: Uint8Array[] = []
      for await (const chunk of incoming) chunks.push(chunk)
      const bytes = Buffer.concat(chunks)
      const headers = new Headers()
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (typeof value === 'string') headers.set(name, value)
      }
      const metadata = secret && verifySignature(secret, headers, bytes)
      if (!metadata) {
        response.writeHead(401).end()
        return
      }
      const body = bytes.toString()
      messages.push({ path, body, event: metadata.eventId, cycle: metadata.cycle })
      response.writeHead(JSON.parse(body).test && metadata.cycle === 1 ? 422 : 200).end()
    } catch {
      response.writeHead(500).end()
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Local HTTPS receiver did not start.')

  const transport: NonNullable<Parameters<typeof sendApproved>[2]> = {
    resolve: async () => [{ address: '1.1.1.1', family: 4 }],
    request: (url, options, callback) => {
      if (!options.lookup) throw new Error('Expected a pinned DNS lookup.')
      const pinnedLookup = options.lookup
      return request(url, {
        ...options,
        port: address.port,
        ca: cert,
        lookup: (hostname, settings, done) => pinnedLookup(hostname, settings, (error, ip, family) => {
          if (error || ip !== '1.1.1.1' || family !== 4) {
            done(error ?? new Error('Unexpected pinned address.'), '', 4)
            return
          }
          // Replace the validated address only for this local HTTPS fixture.
          done(null, '127.0.0.1', 4)
        }),
      }, callback)
    },
  }
  return { messages, transport, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}
