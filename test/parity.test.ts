/**
 * The parity guard: every public V1 merchant/server operation has a method here.
 *
 * The list below is the checked-in contract, mirrored in the PHP SDK (tests/transport.php) and in
 * P2Flux/core. When a new public merchant endpoint lands in the API, it is added to all three
 * lists — and each SDK fails this test until it grows the method. That is the point: an SDK can
 * no longer fall behind silently.
 *
 * Deliberately NOT here: /health (operational liveness, not a merchant operation), /metrics and
 * /ready (loopback-only, not public API).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createP2Flux } from '../src/index.js'

const REQUIRED_OPERATIONS = [
  '/v1/payments',
  '/v1/payments/resolve',
  '/v1/payments/verify',
  '/v1/payments/recover',
  '/v1/subscriptions',
  '/v1/subscriptions/resolve',
  '/v1/subscriptions/finalize',
  '/v1/charges',
  '/v1/charges/recover',
  '/v1/subscriptions/status',
  '/v1/subscriptions/revoke/session',
  '/v1/subscriptions/revoke/prepare',
  '/v1/allowances/revoke/prepare',
  '/v1/allowances/restore/session',
  '/v1/allowances/restore/resolve',
  '/v1/refunds/prepare',
  '/v1/refunds/resolve',
  '/v1/refunds/verify',
  // Paying the network fee in the payment currency.
  '/v1/capabilities',
  '/v1/payments/sponsor',
  '/v1/allowances/restore/submit',
]

test('every public V1 merchant operation is reachable through the SDK', async () => {
  const seen = new Set<string>()
  const capture = (async (url: string) => {
    seen.add(new URL(String(url)).pathname)
    return { status: 200, json: async () => ({}) } as never
  }) as unknown as typeof fetch
  const p2flux = createP2Flux({ apiUrl: 'https://api.p2flux.example', fetch: capture })

  const HASH = `0x${'ab'.repeat(32)}`
  await p2flux.createPayment({ recipient: '0x' + '33'.repeat(20), amount: '1.00' })
  await p2flux.resolvePayment('p2f1.x')
  await p2flux.verifyPayment('p2f1.x', HASH)
  await p2flux.recoverPayment('p2f1.x')
  await p2flux.createSubscription({ recipient: '0x' + '33'.repeat(20), amount: '1.00', period: 3600 })
  await p2flux.resolveSubscription('p2setup2.x')
  await p2flux.finalizeSubscription('p2setup2.x', '0x' + '55'.repeat(20), '0x00')
  await p2flux.charge('p2s2.x')
  await p2flux.recoverCharge('p2s2.x', 3)
  await p2flux.status('p2s2.x')
  await p2flux.createCancellationSession('p2s2.x')
  await p2flux.prepareSubscriptionCancellation('p2s2.x')
  await p2flux.prepareAllowanceRevocation()
  await p2flux.createAllowanceRestoreSession('p2s2.x')
  await p2flux.resolveAllowanceRestore('p2approve1.x')
  await p2flux.prepareRefund({ intent: 'p2f1.x', txHash: HASH }, '1000000')
  await p2flux.resolveRefund('p2refund1.x')
  await p2flux.verifyRefund({ intent: 'p2f1.x', txHash: HASH }, '1000000', HASH)
  await p2flux.capabilities()
  await p2flux.sponsorPayment({ intent: 'p2f1.x', quote: 'p2gas1.x', payer: '0x' + '55'.repeat(20), signature: '0x00' })
  await p2flux.submitAllowanceRestore({
    approveToken: 'p2approve1.x',
    quote: 'p2gas1.x',
    permitSignature: '0x00',
    networkFeeSignature: '0x00',
  })

  assert.deepEqual([...seen].sort(), [...REQUIRED_OPERATIONS].sort())
})
