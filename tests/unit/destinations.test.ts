import { expect, test } from 'vitest'
import { BlockedDestination, destinationUrl, resolveDestination } from '../../src/server/destinations'

test.each([
  'http://receiver.example.com/hook',
  'https://127.0.0.1/hook',
  'https://0x7f000001/hook',
  'https://[::1]/hook',
  'https://receiver.example.com:8443/hook',
  'https://user:pass@receiver.example.com/hook',
  'https://receiver.example.com/hook?token=example',
  'https://receiver.example.com/hook#fragment',
])('rejects an unapproved URL shape: %s', (url) => {
  expect(() => destinationUrl(url)).toThrow(BlockedDestination)
})

test('accepts a canonical HTTPS URL with a path', () => {
  expect(destinationUrl('https://RECEIVER.example.com:443/partner/hook').href)
    .toBe('https://receiver.example.com/partner/hook')
})

test.each([
  ['127.0.0.1', 4], ['169.254.169.254', 4], ['192.168.1.2', 4],
  ['100.64.0.1', 4], ['168.63.129.16', 4], ['::1', 6], ['::ffff:10.0.0.1', 6],
  ['fe80::1', 6], ['fd00::1', 6], ['64:ff9b::a00:1', 6], ['2002::1', 6],
])('blocks %s even when DNS also returns a matching public address', async (address, family) => {
  await expect(resolveDestination('receiver.example.com', async () => [
    { address: '1.1.1.1', family: 4 }, { address, family },
  ])).rejects.toBeInstanceOf(BlockedDestination)
})

test('accepts public DNS and blocks an empty result', async () => {
  const ipv6 = { address: '2606:4700:4700::1111', family: 6 }
  await expect(resolveDestination('receiver.example.com', async () => [ipv6])).resolves.toEqual(ipv6)
  await expect(resolveDestination('receiver.example.com', async () => [])).rejects.toBeInstanceOf(BlockedDestination)
})
