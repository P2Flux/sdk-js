import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createP2Flux, merchantTokenMessage } from '../src/index.js'

test('merchantTokenMessage is the exact text the API verifies (same as sdk-php and core)', () => {
  assert.equal(
    merchantTokenMessage(8453, '0xAbCdEf0000000000000000000000000000000001', 1_800_000_000, 'https://API.p2flux.com/'),
    'P2Flux merchant token\n\nThis signature only raises your P2Flux API limits. It moves no funds and approves nothing.\n\n' +
      'Wallet: 0xabcdef0000000000000000000000000000000001\nAPI: https://api.p2flux.com\nChain ID: 8453\nIssued at: 1800000000',
  )
  // The API line is the origin of apiUrl: one deployment's signature is refused by another.
  assert.match(merchantTokenMessage(84532, '0x01', 1, 'https://api-test.p2flux.com:8443/v1'), /\nAPI: https:\/\/api-test\.p2flux\.com:8443\n/)
})

test('createMerchantToken posts the proof; merchantToken / partnerKey ride on every request as headers', async () => {
  const seen: { path: string; headers: Record<string, string>; body: unknown }[] = []
  const capture = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    seen.push({ path: new URL(url).pathname, headers: init.headers, body: JSON.parse(init.body) })
    return { status: 200, json: async () => ({ merchant_token: 'p2m1.k1.x.y', wallet: '0xabc', expires_at: 99 }) } as never
  }) as unknown as typeof fetch
  const anon = createP2Flux({ apiUrl: 'https://api.example', fetch: capture })
  const minted = await anon.createMerchantToken({ wallet: '0xabc', signature: '0x01', issuedAt: 5 })
  assert.deepEqual({ ...minted, raw: undefined }, { merchantToken: 'p2m1.k1.x.y', wallet: '0xabc', expiresAt: 99, raw: undefined })
  assert.deepEqual(seen[0], { path: '/v1/merchant-token', headers: { 'content-type': 'application/json' }, body: { wallet: '0xabc', signature: '0x01', issued_at: 5 } })

  const merchant = createP2Flux({ apiUrl: 'https://api.example', fetch: capture, merchantToken: minted.merchantToken, partnerKey: 'acme.s' })
  await merchant.createPayment({ recipient: '0x' + '33'.repeat(20), amount: '1.00' })
  assert.equal(seen[1]!.headers['p2flux-merchant-token'], 'p2m1.k1.x.y')
  assert.equal(seen[1]!.headers['p2flux-partner-key'], 'acme.s')
})
