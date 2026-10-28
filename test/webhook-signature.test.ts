/**
 * Signed webhooks: the `p2flux-signature` header, checked against the same fixed vector the API's
 * own suite uses (P2Flux/core tests/webhooks.test.ts) and the PHP SDK's.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPrivateKey, sign } from 'node:crypto'
import { createP2Flux, P2FluxError } from '../src/index.js'

// Seed 0x5a x 32, as in the API's vector.
const KID = '790901b82a89fe50'
const PUBLIC_KEY = 'DXVQdU4IAKXSN-71gmA1dmubPloVhoqUCrKJlYeI47A'
const BODY = '{"id":"evt_1","type":"payment.paid"}'
const T = 1_800_000_000
const HEADER = `t=${T},kid=${KID},v1=lwzmVe0dReBbLhyVjzTXtdT1W9EVhY7DPkr4C8WR7cGkXrxHOaZKWGpd3DMnhKvqbug464UZHtIHJ-IdGQNfAA`
const KEYS = { [KID]: PUBLIC_KEY }

const privateKey = createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, 0x5a)]),
  format: 'der',
  type: 'pkcs8',
})
const signed = (body: string, t: number) => `t=${t},kid=${KID},v1=${sign(null, Buffer.from(`${t}.${body}`), privateKey).toString('base64url')}`

/** A fetch that serves capabilities with the signing key and counts the calls. */
const capabilitiesApi = (keys: unknown[] = [{ kid: KID, alg: 'Ed25519', public_key: PUBLIC_KEY }]) => {
  let calls = 0
  const impl = (async (url: string) => {
    calls++
    assert.equal(new URL(String(url)).pathname, '/v1/capabilities')
    return { status: 200, json: async () => ({ chain_id: 8453, supported: true, tokens: [], webhook_signing_keys: keys }) } as never
  }) as unknown as typeof fetch
  return { impl, calls: () => calls }
}
const offline = createP2Flux({ apiUrl: 'https://api.p2flux.example', fetch: (() => assert.fail('no API call expected')) as never })

const rejects = (promise: Promise<unknown>, status: string) =>
  assert.rejects(promise, (err: unknown) => err instanceof P2FluxError && err.status === status && err.action === 'INVALID_REQUEST')

test('verifyWebhook: the API vector verifies and returns the parsed event', async () => {
  const event = await offline.verifyWebhook(BODY, HEADER, { keys: KEYS, now: T })
  assert.deepEqual(event, { id: 'evt_1', type: 'payment.paid' })
  // Raw bytes work as well as a string.
  assert.deepEqual(await offline.verifyWebhook(new TextEncoder().encode(BODY), HEADER, { keys: KEYS, now: T + 300 }), event)
})

test('verifyWebhook: a changed body, another key, an unknown kid or a moved t is WEBHOOK_SIGNATURE_INVALID', async () => {
  await rejects(offline.verifyWebhook(BODY.replace('paid', 'pa1d'), HEADER, { keys: KEYS, now: T }), 'WEBHOOK_SIGNATURE_INVALID')
  await rejects(offline.verifyWebhook(BODY, HEADER, { keys: { other: PUBLIC_KEY }, now: T }), 'WEBHOOK_SIGNATURE_INVALID')
  await rejects(offline.verifyWebhook(BODY, HEADER, { keys: { [KID]: 'A'.repeat(43) }, now: T }), 'WEBHOOK_SIGNATURE_INVALID')
  await rejects(offline.verifyWebhook(BODY, HEADER.replace(`t=${T}`, `t=${T - 1}`), { keys: KEYS, now: T }), 'WEBHOOK_SIGNATURE_INVALID')
  for (const garbage of ['', 'garbage', `t=${T},kid=${KID}`, `t=x,kid=${KID},v1=abc`, `kid=${KID},v1=abc`]) {
    await rejects(offline.verifyWebhook(BODY, garbage, { keys: KEYS, now: T }), 'WEBHOOK_SIGNATURE_INVALID')
  }
})

test('verifyWebhook: older (or newer) than the tolerance is WEBHOOK_TOO_OLD', async () => {
  await rejects(offline.verifyWebhook(BODY, HEADER, { keys: KEYS, now: T + 301 }), 'WEBHOOK_TOO_OLD')
  await rejects(offline.verifyWebhook(BODY, HEADER, { keys: KEYS, now: T - 301 }), 'WEBHOOK_TOO_OLD')
  assert.ok(await offline.verifyWebhook(BODY, HEADER, { keys: KEYS, now: T + 3600, toleranceSec: 3600 }))
})

test('verifyWebhook: a fresh signature verifies with the default clock', async () => {
  const now = Math.floor(Date.now() / 1000)
  assert.ok(await offline.verifyWebhook(BODY, signed(BODY, now), { keys: KEYS }))
})

test('verifyWebhook: keys come from capabilities once and are cached', async () => {
  const api = capabilitiesApi()
  const p2flux = createP2Flux({ apiUrl: 'https://api.p2flux.example', fetch: api.impl })
  assert.ok(await p2flux.verifyWebhook(BODY, HEADER, { now: T }))
  assert.ok(await p2flux.verifyWebhook(BODY, HEADER, { now: T }))
  assert.equal(api.calls(), 1)
  assert.deepEqual((await p2flux.capabilities()).webhookSigningKeys, [{ kid: KID, alg: 'Ed25519', publicKey: PUBLIC_KEY }])
})

test('verifyWebhook: an API without signing keys verifies nothing', async () => {
  const p2flux = createP2Flux({ apiUrl: 'https://api.p2flux.example', fetch: capabilitiesApi([]).impl })
  await rejects(p2flux.verifyWebhook(BODY, HEADER, { now: T }), 'WEBHOOK_SIGNATURE_INVALID')
})

test('handleNotification: with `signature`, a forged or stale body is refused before the API is asked', async () => {
  const REF = `0x${'12'.repeat(32)}`
  const event = JSON.stringify({ id: 'evt_2', type: 'payment.paid', data: { reference: REF, intent: 'p2f1.k.e30.s', tx_hash: `0x${'ab'.repeat(32)}` } })
  const now = Math.floor(Date.now() / 1000)

  const forged = await offline.handleNotification(event, { reference: REF, signature: signed(event.replace('evt_2', 'evt_3'), now), keys: KEYS })
  assert.deepEqual(forged, { confirmed: false, eventId: '', type: '', reason: 'WEBHOOK_SIGNATURE_INVALID' })
  const stale = await offline.handleNotification(event, { reference: REF, signature: signed(event, now - 3600), keys: KEYS })
  assert.equal(stale.reason, 'WEBHOOK_TOO_OLD')
  // A signature needs the raw body: a parsed object cannot be checked.
  await assert.rejects(offline.handleNotification(JSON.parse(event), { reference: REF, signature: signed(event, now), keys: KEYS }), TypeError)

  // A good signature passes on to the usual checks (here: the intent names another reference).
  const passed = await offline.handleNotification(event, { reference: REF, signature: signed(event, now), keys: KEYS })
  assert.equal(passed.reason, 'NOT_YOUR_ORDER')
  assert.equal(passed.eventId, 'evt_2')
})
