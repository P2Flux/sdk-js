/**
 * The eight methods that completed V1 parity (2026-08-24): one-time payment creation and
 * verification, subscription setup/resolve/finalize, the browser-safe cancel session, and the
 * refund-token read. Same discipline as client.test.ts: injected fetch, no server, and every
 * assertion is about the public contract - URL, wire body, mapping, and throw-vs-verdict.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createP2Flux, P2FluxError } from '../src/index.js'

const answering = (status: number, body: unknown) => {
  const calls: { url: string; body: unknown }[] = []
  const impl = (async (url: string, init: { body: string }) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) })
    return { status, json: async () => body } as never
  }) as unknown as typeof fetch
  return { impl, calls }
}

const client = (fetchImpl: typeof fetch) => createP2Flux({ apiUrl: 'https://api.p2flux.example', fetch: fetchImpl })

const HASH = `0x${'ab'.repeat(32)}`

// ---------------------------------------------------------------- one-time

test('createPayment sends the terms and maps the intent', async () => {
  const { impl, calls } = answering(200, {
    intent: 'p2f1.k1.body.mac',
    reference: HASH,
    amount: '12.500000',
    expires_at: 1787600000,
    pay: {
      chain_id: 8453,
      splitter: '0x' + '11'.repeat(20),
      token: '0x' + '22'.repeat(20),
      recipient: '0x' + '33'.repeat(20),
      amount_units: '12500000',
      reference: HASH,
    },
  })
  const intent = await client(impl).createPayment({ recipient: '0x' + '33'.repeat(20), amount: '12.50' })

  assert.equal(calls[0]!.url, 'https://api.p2flux.example/v1/payments')
  assert.deepEqual(calls[0]!.body, { recipient: '0x' + '33'.repeat(20), amount: '12.50' })
  assert.equal(intent.intent, 'p2f1.k1.body.mac')
  assert.equal(intent.expiresAt, 1787600000)
  assert.equal(intent.pay.chainId, 8453)
  assert.equal(intent.pay.amountUnits, '12500000')
})

test('createPayment throws typed on refusal', async () => {
  const { impl } = answering(400, { error: 'AMOUNT_OUT_OF_BOUNDS', action: 'INVALID_REQUEST' })
  await assert.rejects(
    () => client(impl).createPayment({ recipient: '0x' + '33'.repeat(20), amount: '0.001' }),
    (err: P2FluxError) => err.status === 'AMOUNT_OUT_OF_BOUNDS' && err.action === 'INVALID_REQUEST',
  )
})

test('resolvePayment reads the terms back, including a null confirmations_required', async () => {
  const { impl, calls } = answering(200, {
    recipient: '0x' + '33'.repeat(20),
    amount: '12.500000',
    amount_units: '12500000',
    token: '0x' + '22'.repeat(20),
    splitter: '0x' + '11'.repeat(20),
    chain_id: 8453,
    reference: HASH,
    expires_at: 1787600000,
    confirmations_required: null,
  })
  const resolved = await client(impl).resolvePayment('p2f1.k1.body.mac')

  assert.equal(calls[0]!.url, 'https://api.p2flux.example/v1/payments/resolve')
  assert.deepEqual(calls[0]!.body, { intent: 'p2f1.k1.body.mac' })
  assert.equal(resolved.chainId, 8453)
  assert.equal(resolved.confirmationsRequired, null)
})

test('verifyPayment narrows on valid: a confirmed settlement carries its receipt', async () => {
  const { impl, calls } = answering(200, {
    valid: true,
    tx_hash: HASH,
    reference: HASH,
    amount: '12.500000',
    block_number: '50403306',
    block_hash: HASH,
    settlement_receipt: 'p2paid1.k1.body.mac',
  })
  const verdict = await client(impl).verifyPayment('p2f1.k1.body.mac', HASH)

  assert.equal(calls[0]!.url, 'https://api.p2flux.example/v1/payments/verify')
  assert.deepEqual(calls[0]!.body, { intent: 'p2f1.k1.body.mac', tx_hash: HASH })
  assert.equal(verdict.valid, true)
  if (verdict.valid) {
    // The discriminated union at work: inside this branch, success fields are typed.
    assert.equal(verdict.txHash, HASH)
    assert.equal(verdict.settlementReceipt, 'p2paid1.k1.body.mac')
  }
})

test('verifyPayment forwards a settlement receipt, and omits the key when absent', async () => {
  const { impl, calls } = answering(200, { valid: true, tx_hash: HASH })
  await client(impl).verifyPayment('p2f1.k1.body.mac', HASH, 'p2paid1.k1.body.mac')
  assert.deepEqual(calls[0]!.body, {
    intent: 'p2f1.k1.body.mac',
    tx_hash: HASH,
    settlement_receipt: 'p2paid1.k1.body.mac',
  })
})

test('a negative verdict is an ANSWER with a code, never an exception', async () => {
  /* The API answers verification questions at 200 - PAYMENT_CONFIRMING, TRANSACTION_REVERTED,
   * TERMS_MISMATCH are verdicts about the chain, not server failures. */
  const { impl } = answering(200, { valid: false, code: 'PAYMENT_CONFIRMING' })
  const verdict = await client(impl).verifyPayment('p2f1.k1.body.mac', HASH)

  assert.equal(verdict.valid, false)
  if (!verdict.valid) {
    assert.equal(verdict.code, 'PAYMENT_CONFIRMING')
    assert.equal(verdict.action, 'WAIT')
  }
})

test('verifyPayment still throws on rate limiting, which IS exceptional', async () => {
  const { impl } = answering(429, { error: 'RATE_LIMITED', action: 'RETRY_LATER' })
  await assert.rejects(
    () => client(impl).verifyPayment('p2f1.k1.body.mac', HASH),
    (err: P2FluxError) => err.status === 'RATE_LIMITED' && err.action === 'RETRY_LATER',
  )
})

// ---------------------------------------------------------------- subscriptions

test('createSubscription sends seconds and keeps the salt', async () => {
  const { impl, calls } = answering(200, {
    setup_token: 'p2setup2.k1.body.mac',
    expires_at: 1787600000,
    chain_id: 8453,
    contract: '0x' + '44'.repeat(20),
    amount: '5.000000',
    salt: '424242',
  })
  const setup = await client(impl).createSubscription({
    recipient: '0x' + '33'.repeat(20),
    amount: '5.00',
    period: 2592000,
  })

  assert.equal(calls[0]!.url, 'https://api.p2flux.example/v1/subscriptions')
  // `end` must be absent when not given - additionalProperties:false would 400 on `end: undefined`.
  assert.deepEqual(calls[0]!.body, { recipient: '0x' + '33'.repeat(20), amount: '5.00', period: 2592000 })
  assert.equal(setup.setupToken, 'p2setup2.k1.body.mac')
  assert.equal(setup.salt, '424242')
  assert.equal(setup.contract, '0x' + '44'.repeat(20))
})

test('createSubscription passes an end date through when given', async () => {
  const { impl, calls } = answering(200, { setup_token: 't', expires_at: 1, chain_id: 8453, contract: '0x0', amount: '5', salt: 's' })
  await client(impl).createSubscription({ recipient: '0x' + '33'.repeat(20), amount: '5.00', period: 3600, end: 1790000000 })
  assert.deepEqual(calls[0]!.body, { recipient: '0x' + '33'.repeat(20), amount: '5.00', period: 3600, end: 1790000000 })
})

test('resolveSubscription returns the terms and the exact typed data to sign', async () => {
  const typed = { domain: { chainId: 8453 }, primaryType: 'Authorization' }
  const { impl, calls } = answering(200, {
    recipient: '0x' + '33'.repeat(20),
    amount: '5.000000',
    amount_units: '5000000',
    period: 2592000,
    start: 1787600000,
    end: 0,
    token: '0x' + '22'.repeat(20),
    chain_id: 8453,
    contract: '0x' + '44'.repeat(20),
    salt: '424242',
    max_gas_reimbursement: '0.050000',
    fee_bps: 200,
    network_fee: '0.100000',
    network_fee_units: '100000',
    network_fee_estimate: null,
    expires_at: 1787600900,
    typed_data: typed,
  })
  const resolved = await client(impl).resolveSubscription('p2setup2.k1.body.mac')

  assert.equal(calls[0]!.url, 'https://api.p2flux.example/v1/subscriptions/resolve')
  assert.deepEqual(calls[0]!.body, { setup_token: 'p2setup2.k1.body.mac' })
  assert.equal(resolved.feeBps, 200)
  assert.equal(resolved.networkFeeEstimate, null)
  assert.deepEqual(resolved.typedData, typed)
})

test('finalizeSubscription exchanges the signature for the capability', async () => {
  const { impl, calls } = answering(200, {
    subscription: 'p2s2.k1.body.mac',
    subscription_id: HASH,
    amount: '5.000000',
    period: 2592000,
    end: 0,
  })
  const finalized = await client(impl).finalizeSubscription('p2setup2.k1.body.mac', '0x' + '55'.repeat(20), '0x' + 'cd'.repeat(65))

  assert.equal(calls[0]!.url, 'https://api.p2flux.example/v1/subscriptions/finalize')
  assert.deepEqual(calls[0]!.body, {
    setup_token: 'p2setup2.k1.body.mac',
    payer: '0x' + '55'.repeat(20),
    signature: '0x' + 'cd'.repeat(65),
  })
  assert.equal(finalized.subscription, 'p2s2.k1.body.mac')
  assert.equal(finalized.subscriptionId, HASH)
})

test('a signature the API cannot afford to validate is typed, with customer guidance', async () => {
  /* The API ships no `action` for this one; the SDK's fallback must say CUSTOMER_ACTION_REQUIRED -
   * only the customer can switch to a wallet whose signature is affordable to validate. */
  const { impl } = answering(400, { error: 'SIGNATURE_VALIDATION_TOO_EXPENSIVE' })
  await assert.rejects(
    () => client(impl).finalizeSubscription('p2setup2.k1.body.mac', '0x' + '55'.repeat(20), '0x00'),
    (err: P2FluxError) =>
      err.status === 'SIGNATURE_VALIDATION_TOO_EXPENSIVE' && err.action === 'CUSTOMER_ACTION_REQUIRED',
  )
})

test('a dead setup token is INVALID_REQUEST, never a retry', async () => {
  const { impl } = answering(400, { error: 'SETUP_TOKEN_EXPIRED' })
  await assert.rejects(
    () => client(impl).resolveSubscription('p2setup2.dead'),
    (err: P2FluxError) => err.status === 'SETUP_TOKEN_EXPIRED' && err.action === 'INVALID_REQUEST',
  )
})

test('createCancellationSession hands back a browser-safe token, never the capability', async () => {
  const { impl, calls } = answering(200, {
    cancel_token: 'p2cancel1.k1.body.mac',
    expires_at: 1787600000,
    subscription_id: HASH,
    payer: '0x' + '55'.repeat(20),
  })
  const session = await client(impl).createCancellationSession('p2s2.k1.body.mac')

  assert.equal(calls[0]!.url, 'https://api.p2flux.example/v1/subscriptions/revoke/session')
  assert.deepEqual(calls[0]!.body, { subscription: 'p2s2.k1.body.mac' })
  assert.equal(session.cancelToken, 'p2cancel1.k1.body.mac')
  assert.equal(session.payer, '0x' + '55'.repeat(20))
})

// ---------------------------------------------------------------- refunds

test('resolveRefund reads what the token authorizes', async () => {
  const { impl, calls } = answering(200, {
    chain_id: 8453,
    token: '0x' + '22'.repeat(20),
    merchant: '0x' + '33'.repeat(20),
    payer: '0x' + '55'.repeat(20),
    amount: '2.500000',
    amount_units: '2500000',
    expires_at: 1787600000,
  })
  const resolved = await client(impl).resolveRefund('p2refund1.k1.body.mac')

  assert.equal(calls[0]!.url, 'https://api.p2flux.example/v1/refunds/resolve')
  assert.deepEqual(calls[0]!.body, { refund_token: 'p2refund1.k1.body.mac' })
  assert.equal(resolved.merchant, '0x' + '33'.repeat(20))
  assert.equal(resolved.amountUnits, '2500000')
})

// ---------------------------------------------------------------- transport edges

test('a malformed JSON response degrades to an empty body, not a crash', async () => {
  const impl = (async () => ({ status: 200, json: async () => Promise.reject(new Error('bad json')) })) as unknown as typeof fetch
  const verdict = await client(impl).verifyPayment('p2f1.k1.body.mac', HASH)
  // No `valid: true` in the (empty) body means no settlement was proven - the safe reading.
  assert.equal(verdict.valid, false)
})

test('a timeout aborts the request and surfaces as NETWORK_ERROR', async () => {
  const never = ((url: string, init: { signal: AbortSignal }) =>
    new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')))
    })) as unknown as typeof fetch
  const fast = createP2Flux({ apiUrl: 'https://api.p2flux.example', fetch: never, timeoutMs: 20 })
  await assert.rejects(
    () => fast.createPayment({ recipient: '0x' + '33'.repeat(20), amount: '1.00' }),
    (err: P2FluxError) => err.status === 'NETWORK_ERROR' && err.action === 'RETRY_LATER',
  )
})
