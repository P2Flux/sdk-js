/** Webhook delivery history and "retry now". */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createP2Flux } from '../src/index.js'

const answering = (body: Record<string, unknown>) => {
  const calls: { path: string; body: Record<string, unknown> }[] = []
  const impl = (async (url: string, init: { body: string }) => {
    calls.push({ path: new URL(String(url)).pathname, body: JSON.parse(init.body) })
    return { status: 200, json: async () => body } as never
  }) as unknown as typeof fetch
  return { client: createP2Flux({ apiUrl: 'https://api.p2flux.example', fetch: impl }), calls }
}

test('webhookDeliveries: by intent or manage token, attempts in camelCase', async () => {
  const { client, calls } = answering({
    events: [
      {
        id: 'evt_1',
        type: 'payment.paid',
        created_at: 1_800_000_000,
        attempts: [{ at: 1_800_000_001, status: 0, duration_ms: 10_000 }, { at: 1_800_000_061, status: 200, duration_ms: 85 }],
        next_at: null,
        outcome: 'delivered',
      },
    ],
  })
  const history = await client.webhookDeliveries({ intent: 'p2f1.x' })
  assert.deepEqual(calls[0], { path: '/v1/webhooks/deliveries', body: { intent: 'p2f1.x' } })
  assert.deepEqual(history.events, [
    {
      id: 'evt_1',
      type: 'payment.paid',
      createdAt: 1_800_000_000,
      attempts: [{ at: 1_800_000_001, status: 0, durationMs: 10_000 }, { at: 1_800_000_061, status: 200, durationMs: 85 }],
      nextAt: null,
      outcome: 'delivered',
    },
  ])
  await client.webhookDeliveries({ manage: 'p2lm1.x' })
  assert.deepEqual(calls[1]!.body, { manage: 'p2lm1.x' })
  assert.deepEqual((await answering({}).client.webhookDeliveries({ intent: 'p2f1.x' })).events, [])
})

test('redeliverWebhook: asks for one pending event to be sent now', async () => {
  const { client, calls } = answering({ id: 'evt_1', next_at: 1_800_000_100 })
  const raw = await client.redeliverWebhook({ manage: 'p2lm1.x' }, 'evt_1')
  assert.deepEqual(calls[0], { path: '/v1/webhooks/redeliver', body: { manage: 'p2lm1.x', event_id: 'evt_1' } })
  assert.equal(raw.id, 'evt_1')
})
