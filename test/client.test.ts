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
