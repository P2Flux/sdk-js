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
   * catch an exception to learn "wait" is a loop that eventually refunds the customer twice. */
  const { impl } = answering(400, { error: 'REFUND_CONFIRMING' })
  const result = await client(impl).verifyRefund({ intent: 'p2f1.k1.body.mac', txHash: '0xabc' }, '2500000', '0xdef')

  assert.equal(result.confirming, true)
  assert.equal(result.refunded, false)
  assert.equal(result.action, 'WAIT')
})

test('a refund that does not match the original payment throws', async () => {
  const { impl } = answering(400, { error: 'REFUND_TRANSACTION_MISMATCH' })
  await assert.rejects(
    () => client(impl).verifyRefund({ intent: 'p2f1.k1.body.mac', txHash: '0xabc' }, '2500000', '0xdef'),
    (err: P2FluxError) => err.status === 'REFUND_TRANSACTION_MISMATCH' && err.action === 'INVALID_REQUEST',
  )
})
