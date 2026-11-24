import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createP2Flux, P2FluxError } from '../src/index.js'

const capture = (reply: Record<string, unknown>, status = 200) => {
  const seen: { path: string; body: Record<string, unknown> }[] = []
  const fetch = (async (url: string, init: { body: string }) => {
    seen.push({ path: new URL(url).pathname, body: JSON.parse(init.body) })
    return { status, json: async () => reply } as never
  }) as unknown as typeof globalThis.fetch
  return { seen, p2flux: createP2Flux({ apiUrl: 'https://api.example', fetch }) }
}

const pending = { fee_bps: 80, fixed_network_fee_units: '20000', partner_rate: false, effective_at: 1_900_000_000 }
const pendingCamel = { feeBps: 80, fixedNetworkFeeUnits: '20000', partnerRate: false, effectiveAt: 1_900_000_000 }

test('createPayment sends contract_version and auto only when given, and reads v2 fees back', async () => {
  const { seen, p2flux } = capture({
    intent: 'p2f1.x', contract_version: 2, gas_payment_mode: 'auto',
    fees: { payment_fee_units: '100000', fixed_network_fee_units: '30000', merchant_net_units: '9870000', fee_bps: 100, partner_rate: false, pending_change: pending, pending_changes: [pending] },
  })
  const made = await p2flux.createPayment({ recipient: '0x33', amount: '10.00', contractVersion: 2, gasPaymentMode: 'auto' })
  assert.deepEqual(seen[0]!.body, { recipient: '0x33', amount: '10.00', gas_payment_mode: 'auto', contract_version: 2 })
  assert.equal(made.contractVersion, 2)
  assert.deepEqual(made.fees, {
    paymentFeeUnits: '100000', fixedNetworkFeeUnits: '30000', merchantNetUnits: '9870000', feeBps: 100, partnerRate: false,
    pendingChange: pendingCamel, pendingChanges: [pendingCamel],
  })
  await p2flux.createPayment({ recipient: '0x33', amount: '10.00' })
  assert.deepEqual(seen[1]!.body, { recipient: '0x33', amount: '10.00' }, 'old calls send exactly what they sent before')
})

test('a v1 answer has no contractVersion', async () => {
  const { p2flux } = capture({ intent: 'p2f1.x', gas_payment_mode: 'native' })
  assert.equal((await p2flux.createPayment({ recipient: '0x33', amount: '1.00' })).contractVersion, undefined)
  assert.equal((await p2flux.resolvePayment('p2f1.x')).contractVersion, undefined)
})

test('resolvePayment sends sponsored only when asked and reads contract_version', async () => {
  const { seen, p2flux } = capture({ contract_version: 2, gas_payment_mode: 'auto' })
  const r = await p2flux.resolvePayment('p2f1.x', { sponsored: true })
  assert.deepEqual(seen[0]!.body, { intent: 'p2f1.x', sponsored: true })
  assert.equal(r.contractVersion, 2)
  assert.equal(r.gasPaymentMode, 'auto')
  await p2flux.resolvePayment('p2f1.x')
  assert.deepEqual(seen[1]!.body, { intent: 'p2f1.x' })
})

test('createSubscription v2: contract_version out, fee and pending changes back', async () => {
  const { seen, p2flux } = capture({ setup_token: 's', contract_version: 2, fee_bps: 150, pending_change: pending, pending_changes: [pending] })
  const s = await p2flux.createSubscription({ recipient: '0x33', amount: '5.00', period: 2_592_000, contractVersion: 2 })
  assert.equal(seen[0]!.body.contract_version, 2)
  assert.equal(s.contractVersion, 2)
  assert.equal(s.feeBps, 150)
  assert.deepEqual(s.pendingChanges, [pendingCamel])
  await p2flux.createSubscription({ recipient: '0x33', amount: '5.00', period: 2_592_000 })
  assert.equal('contract_version' in seen[1]!.body, false)
})

test('prepareAllowanceRevocation: empty body by default, contract_version 2 when asked', async () => {
  const spender = '0x' + 'd'.repeat(40)
  const { seen, p2flux } = capture({ chain_id: 84532, to: '0x22', data: '0x', description: 'd', contract_version: 2, spender })
  const tx = await p2flux.prepareAllowanceRevocation({ contractVersion: 2 })
  assert.deepEqual(seen[0]!.body, { contract_version: 2 })
  assert.equal(tx.spender, spender)
  assert.equal(tx.contractVersion, 2)
  await p2flux.prepareAllowanceRevocation()
  assert.deepEqual(seen[1]!.body, {})
})

test('verifyPayment passes the reason through on valid: false', async () => {
  const { p2flux } = capture({ valid: false, code: 'INVALID_REFERENCE', reason: 'UNRELATED_SETTLEMENT_SAME_REFERENCE' })
  const v = await p2flux.verifyPayment('p2f1.x', '0x' + '1'.repeat(64))
  assert.equal(v.valid, false)
  if (!v.valid) assert.equal(v.reason, 'UNRELATED_SETTLEMENT_SAME_REFERENCE')
})

test('SETTLED_ELSEWHERE and AMOUNT_BELOW_FEES are not retryable', async () => {
  for (const code of ['SETTLED_ELSEWHERE', 'AMOUNT_BELOW_FEES']) {
    const { p2flux } = capture({ error: code }, 409)
    await assert.rejects(p2flux.resolvePayment('p2f1.x'), (e: unknown) => e instanceof P2FluxError && e.status === code && e.action === 'INVALID_REQUEST')
  }
  const { p2flux } = capture({ error: 'INVALID_REQUEST', reason: 'CONTRACTS_V2_UNAVAILABLE' }, 400)
  await assert.rejects(p2flux.createPayment({ recipient: '0x33', amount: '1.00', contractVersion: 2 }), (e: unknown) => e instanceof P2FluxError && e.raw.reason === 'CONTRACTS_V2_UNAVAILABLE')
})
