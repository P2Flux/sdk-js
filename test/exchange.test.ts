import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createP2Flux, exchangeOptInMessage } from '../src/index.js'

const capture = (reply: Record<string, unknown>) => {
  const seen: { path: string; body: Record<string, unknown> }[] = []
  const fetch = (async (url: string, init: { body: string }) => {
    seen.push({ path: new URL(url).pathname, body: JSON.parse(init.body) })
    return { status: 200, json: async () => reply } as never
  }) as unknown as typeof globalThis.fetch
  return { seen, p2flux: createP2Flux({ apiUrl: 'https://api.example', fetch }) }
}

test('exchangeOptInMessage is the exact text the API verifies (core packages/base/src/exchange-optin.ts)', () => {
  assert.equal(
    exchangeOptInMessage(84532, '0xAbCdEf0000000000000000000000000000000001', 'enable', 1_800_000_000, 'https://API-test.p2flux.com/v1'),
    'P2Flux: enable exchange payments\n\nBuyers may pay this wallet by withdrawing USDC from an exchange. It moves no funds and approves nothing.\n\n' +
      'Wallet: 0xabcdef0000000000000000000000000000000001\nAPI: https://api-test.p2flux.com\nChain ID: 84532\nIssued at: 1800000000',
  )
  assert.match(exchangeOptInMessage(8453, '0x01', 'disable', 1, 'https://api.p2flux.com'), /^P2Flux: disable exchange payments\n\nBuyers may no longer pay/)
})

test('createPayment sends exchange fields only when given, and reads them back', async () => {
  const { seen, p2flux } = capture({ intent: 'p2f1.x', exchange: true, exchange_tolerance_bps: 50 })
  const made = await p2flux.createPayment({ recipient: '0x33', amount: '10.00', exchange: true, exchangeToleranceBps: 50 })
  assert.deepEqual(seen[0]!.body, { recipient: '0x33', amount: '10.00', exchange: true, exchange_tolerance_bps: 50 })
  assert.equal(made.exchange, true)
  assert.equal(made.exchangeToleranceBps, 50)
  await p2flux.createPayment({ recipient: '0x33', amount: '10.00' })
  assert.deepEqual(seen[1]!.body, { recipient: '0x33', amount: '10.00' }, 'old calls send exactly what they sent before')
})

test('resolvePayment reports exchangeStarted', async () => {
  const { p2flux } = capture({ exchange: true, exchange_started: true })
  const r = await p2flux.resolvePayment('p2f1.x')
  assert.equal(r.exchangeStarted, true)
  assert.equal(r.exchange, true)
})

test('exchange order: start, status and accept decode the wire shape', async () => {
  const order = {
    reference: `0x${'ab'.repeat(32)}`, status: 'underpaid', exchange: true, chain_id: 84532, token: '0x22', recipient: '0x33',
    amount: '10.37', amount_units: '10370000', price_units: '10000000', tolerance_bps: 0, expires_at: 100,
    received_units: '5000000', missing_units: '5370000', missing: '5.37', confirmations_required: 30,
    tx_hashes: [`0x${'ee'.repeat(32)}`], possible: [{ amount: '5.00', amount_units: '5000000', at: 90 }], watch_until: 200,
  }
  const { seen, p2flux } = capture(order)
  const started = await p2flux.startExchangePayment('p2f1.x')
  assert.deepEqual({ ...started, raw: undefined }, {
    reference: order.reference, status: 'underpaid', chainId: 84532, token: '0x22', recipient: '0x33', amount: '10.37',
    amountUnits: '10370000', priceUnits: '10000000', toleranceBps: 0, expiresAt: 100, receivedUnits: '5000000',
    missingUnits: '5370000', watchUntil: 200, confirmationsRequired: 30, txHashes: order.tx_hashes,
    possible: [{ amount: '5.00', amountUnits: '5000000', at: 90 }], raw: undefined,
  })
  await p2flux.exchangePaymentStatus('p2f1.x')
  await p2flux.acceptExchangePayment({ intent: 'p2f1.x', txHash: order.tx_hashes[0]!, logIndex: 3 })
  assert.deepEqual(seen.map((s) => [s.path, s.body]), [
    ['/v1/payments/exchange', { intent: 'p2f1.x' }],
    ['/v1/payments/exchange/status', { intent: 'p2f1.x' }],
    ['/v1/payments/exchange/accept', { intent: 'p2f1.x', tx_hash: order.tx_hashes[0], log_index: 3 }],
  ])
  const none = await capture({ reference: order.reference, status: 'none' }).p2flux.exchangePaymentStatus('p2f1.x')
  assert.equal(none.status, 'none')
  assert.deepEqual(none.possible, [])
  assert.deepEqual(none.txHashes, [])
})

test('setExchangeSeller and exchangeSellerStatus', async () => {
  const { seen, p2flux } = capture({ wallet: '0x33', exchange_enabled: true })
  const on = await p2flux.setExchangeSeller({ wallet: '0x33', action: 'enable', issuedAt: 5, signature: '0x01' })
  assert.equal(on.exchangeEnabled, true)
  await p2flux.setExchangeSeller({ wallet: '0x33', action: 'disable' })
  await p2flux.exchangeSellerStatus('0x33')
  assert.deepEqual(seen.map((s) => s.body), [
    { wallet: '0x33', action: 'enable', issued_at: 5, signature: '0x01' },
    { wallet: '0x33', action: 'disable' },
    { wallet: '0x33' },
  ])
})
