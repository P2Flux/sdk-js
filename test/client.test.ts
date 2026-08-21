/**
 * The SDK against an injected fetch, with no API running.
 *
 * The full integration suite lives in P2Flux/core, where a stub API can actually be started and
 * driven — it pins this package by tag and exercises the real published surface. What belongs HERE
 * is everything provable without a server: that the result contract is honoured, and that a
 * transport failure is never reported as a payment outcome.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createP2Flux, P2FluxError } from '../src/index.js'

/** A fetch that answers once, with whatever a test needs. */
const answering = (status: number, body: unknown) => {
  const calls: { url: string; body: unknown }[] = []
  const impl = (async (url: string, init: { body: string }) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) })
    return { status, json: async () => body } as never
  }) as unknown as typeof fetch
  return { impl, calls }
}

const client = (fetchImpl: typeof fetch) => createP2Flux({ apiUrl: 'https://api.p2flux.example', fetch: fetchImpl })

test('a successful charge returns the result rather than throwing', async () => {
  const { impl, calls } = answering(200, { status: 'CHARGED', tx_hash: `0x${'ab'.repeat(32)}` })
  const result = await client(impl).charge('p2s2.k1.body.mac')

  assert.equal(result.status, 'CHARGED')
  assert.equal(calls[0]!.url, 'https://api.p2flux.example/v1/charges')
  assert.deepEqual(calls[0]!.body, { subscription: 'p2s2.k1.body.mac' })
})

test('a declined charge is a RESULT, not an exception', async () => {
  /* The core of the merchant contract: charge() never throws on a payment outcome, because
   * "the customer has no funds" is an answer, not an error. Callers switch on status/action. */
  const { impl } = answering(402, { error: 'INSUFFICIENT_BALANCE' })
  const result = await client(impl).charge('p2s2.k1.body.mac')

  assert.equal(result.status, 'INSUFFICIENT_BALANCE')
  assert.equal(result.action, 'CUSTOMER_ACTION_REQUIRED')
})

test('an unreachable API is NETWORK_ERROR / RETRY_LATER, never a payment verdict', async () => {
  /* The distinction that protects money: a transport failure says nothing about whether the charge
   * landed. Reporting it as a decline would let a merchant cancel a subscription that just paid. */
  const dead = (async () => {
    throw new Error('ECONNREFUSED')
  }) as unknown as typeof fetch
  const result = await client(dead).charge('p2s2.k1.body.mac')

  assert.equal(result.status, 'NETWORK_ERROR')
  assert.equal(result.action, 'RETRY_LATER')
})

test('non-charge calls throw, because there every failure is exceptional', async () => {
  const { impl } = answering(400, { error: 'INVALID_SUBSCRIPTION' })
  await assert.rejects(
    () => client(impl).status('p2s2.broken'),
    (err: P2FluxError) => err.status === 'INVALID_SUBSCRIPTION',
  )
})

test('a trailing slash on apiUrl does not produce a double slash', async () => {
  const { impl, calls } = answering(200, { status: 'CHARGED' })
  await createP2Flux({ apiUrl: 'https://api.p2flux.example/', fetch: impl }).charge('p2s2.x')
  assert.equal(calls[0]!.url, 'https://api.p2flux.example/v1/charges')
})

test('a refund is prepared from identifiers alone, and the wire names are translated', async () => {
  const { impl, calls } = answering(200, {
    refund_token: 'p2refund1.k1.body.mac',
    chain_id: 8453,
    token: '0xtoken',
    merchant: '0xmerchant',
    payer: '0xpayer',
    original_amount: '10.000000',
    original_amount_units: '10000000',
    refund_amount: '2.500000',
    refund_amount_units: '2500000',
    expires_at: 1_800_000_000,
  })

  const refund = await client(impl).prepareRefund({ subscription: 'p2s2.k1.body.mac', txHash: '0xabc', periodIndex: 3 }, '2500000')

  assert.equal(calls[0]!.url, 'https://api.p2flux.example/v1/refunds/prepare')
  /* Identifiers and an integer amount. Notably absent: payer, merchant, token - a caller that could
   * name the recipient would turn a refund into a withdrawal. */
  assert.deepEqual(calls[0]!.body, {
    subscription: 'p2s2.k1.body.mac',
    tx_hash: '0xabc',
    period_index: 3,
    amount: '2500000',
  })
  assert.equal(refund.payer, '0xpayer')
  assert.equal(refund.refundAmountUnits, '2500000')
})

test('a refund that is still confirming is a result, never an exception', async () => {
  /* Same rule as a charge in flight: the money may already have moved. A merchant loop that had to
   * catch an exception to learn "wait" is a loop that eventually refunds the customer twice.
   *
   * 409 is what the API answers as of 2026-08-21, matching PAYMENT_CONFIRMING. */
  const { impl } = answering(409, { error: 'REFUND_CONFIRMING', action: 'WAIT' })
  const result = await client(impl).verifyRefund({ intent: 'p2f1.k1.body.mac', txHash: '0xabc' }, '2500000', '0xdef')

  assert.equal(result.confirming, true)
  assert.equal(result.refunded, false)
  assert.equal(result.action, 'WAIT')
})

test('a confirming refund from an older deployment still reads as confirming', async () => {
  // The same code arrived as 400 before the status was corrected. Keyed on the code, so both work.
  const { impl } = answering(400, { error: 'REFUND_CONFIRMING' })
  const result = await client(impl).verifyRefund({ intent: 'p2f1.k1.body.mac', txHash: '0xabc' }, '2500000', '0xdef')

  assert.equal(result.confirming, true)
  assert.equal(result.action, 'WAIT')
})

test('a settled refund reports the transaction it settled with', async () => {
  /* These come back as refund_tx_hash/refund_amount. Reading tx_hash/amount - the keys the CHARGE
   * response uses - left both undefined on every successful refund. */
  const { impl } = answering(200, {
    status: 'REFUNDED',
    refund_tx_hash: `0x${'ab'.repeat(32)}`,
    refund_amount: '2500000',
    original_amount: '10000000',
  })
  const result = await client(impl).verifyRefund({ intent: 'p2f1.k1.body.mac', txHash: '0xabc' }, '2500000', '0xdef')

  assert.equal(result.refunded, true)
  assert.equal(result.txHash, `0x${'ab'.repeat(32)}`)
  assert.equal(result.amount, '2500000')
})

test('a refund that does not match the original payment throws', async () => {
  const { impl } = answering(400, { error: 'REFUND_TRANSACTION_MISMATCH' })
  await assert.rejects(
    () => client(impl).verifyRefund({ intent: 'p2f1.k1.body.mac', txHash: '0xabc' }, '2500000', '0xdef'),
    (err: P2FluxError) => err.status === 'REFUND_TRANSACTION_MISMATCH' && err.action === 'INVALID_REQUEST',
  )
})

test('a lost payment is recovered from the intent alone', async () => {
  const { impl, calls } = answering(200, { found: true, valid: true, tx_hash: `0x${'ab'.repeat(32)}`, amount: '10.000000' })
  const result = await client(impl).recoverPayment('p2f1.k1.body.mac')

  assert.equal(calls[0]!.url, 'https://api.p2flux.example/v1/payments/recover')
  // The intent and nothing else: no hash, no hint, nothing a caller could get wrong.
  assert.deepEqual(calls[0]!.body, { intent: 'p2f1.k1.body.mac' })
  assert.equal(result.found, true)
  assert.equal(result.txHash, `0x${'ab'.repeat(32)}`)
  assert.equal(result.valid, true)
})

test('nothing settled yet is a result, and never a permanent verdict', async () => {
  /* The contract does not enforce an intent's expiry, so a slow wallet can still settle after this
   * answer. A merchant loop must be able to read it without catching an exception, and must not be
   * encouraged to write the order off. */
  const { impl } = answering(200, { found: false, code: 'PAYMENT_NOT_FOUND', as_of_block: '45688490' })
  const result = await client(impl).recoverPayment('p2f1.k1.body.mac')

  assert.equal(result.found, false)
  assert.equal(result.status, 'PAYMENT_NOT_FOUND')
  assert.equal(result.action, 'RETRY_LATER')
  assert.equal(result.asOfBlock, '45688490', 'the answer names the block it was true at')
})

test('a recovered payment still confirming reports the hash, not an error', async () => {
  const { impl } = answering(200, { found: true, valid: false, code: 'PAYMENT_CONFIRMING', tx_hash: `0x${'cd'.repeat(32)}` })
  const result = await client(impl).recoverPayment('p2f1.k1.body.mac')

  assert.equal(result.found, true)
  assert.equal(result.txHash, `0x${'cd'.repeat(32)}`, 'losing the hash here is what recovery exists to prevent')
  assert.equal(result.action, 'WAIT')
})

test('a deployment that cannot recover throws rather than reporting "no payment"', async () => {
  const { impl } = answering(503, { error: 'RECOVERY_UNAVAILABLE' })
  await assert.rejects(
    () => client(impl).recoverPayment('p2f1.k1.body.mac'),
    (err: P2FluxError) => err.status === 'RECOVERY_UNAVAILABLE',
  )
})
