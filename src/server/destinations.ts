import { lookup } from 'node:dns/promises'
import type { LookupAddress } from 'node:dns'
import { BlockList, isIP } from 'node:net'

export class BlockedDestination extends Error {}

const blocked = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3], ['168.63.129.16', 32],
] as const) blocked.addSubnet(network, prefix, 'ipv4')
for (const [network, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
] as const) blocked.addSubnet(network, prefix, 'ipv6')

const globalIPv6 = new BlockList()
globalIPv6.addSubnet('2000::', 3, 'ipv6')

export function destinationUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new BlockedDestination('Enter a valid public HTTPS destination.')
  }
  const hostname = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i
  if (
    url.protocol !== 'https:' || url.port || url.username || url.password ||
    url.href.includes('?') || url.href.includes('#') || url.href.length > 2048 ||
    !hostname.test(url.hostname) || isIP(url.hostname)
  ) {
    throw new BlockedDestination('Use a public HTTPS hostname on port 443 with no credentials, query, or fragment.')
  }
  return url
}

function isPublic({ address, family }: LookupAddress) {
  if (isIP(address) !== family) return false
  if (family === 4) return !blocked.check(address, 'ipv4')
  return family === 6 && globalIPv6.check(address, 'ipv6') && !blocked.check(address, 'ipv6')
}

export type ResolveHost = (hostname: string) => Promise<LookupAddress[]>

export async function resolveDestination(
  hostname: string,
  resolve: ResolveHost = (name) => lookup(name, { all: true }),
) {
  const addresses = await resolve(hostname)
  if (!addresses.length || addresses.some((address) => !isPublic(address))) {
    throw new BlockedDestination('The destination must resolve exclusively to public addresses.')
  }
  return addresses[0]
}
