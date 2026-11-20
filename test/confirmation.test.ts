/**
 * confirmation: how long a payment must sit on chain before it counts as paid (standard / fast / safe), chosen by
 * the merchant on create and signed into the payment or link.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createP2Flux } from '../src/index.js'

const echoing = () => {
  const calls: { path: string; body: Record<string, unknown> }[] = []
  const impl = (async (url: string, init: { body: string }) => {
    calls.push({ path: new URL(String(url)).pathname, body: JSON.parse(init.body) })
    return { status: 200, json: async () => ({ intent: 'i', reference: '0x', link: 'l' }) } as never
  }) as unknown as typeof fetch
  return { client: createP2Flux({ apiUrl: 'https://api.p2flux.example', fetch: impl }), calls }
}

test('confirmation goes out on payments and links; absent stays absent (older APIs refuse unknown fields)', async () => {
  const { client, calls } = echoing()
  const R = '0x' + '33'.repeat(20)
  await client.createPayment({ recipient: R, amount: '1.00', confirmation: 'fast' })
  await client.createPaymentLink({ kind: 'reusable', recipient: R, amount: '1.00', confirmation: 'safe' })
  await client.createPayment({ recipient: R, amount: '1.00' })
  assert.deepEqual(calls.map((c) => [c.path, c.body.confirmation]), [['/v1/payments', 'fast'], ['/v1/links', 'safe'], ['/v1/payments', undefined]])
  assert.equal('confirmation' in calls[2]!.body, false)
})
