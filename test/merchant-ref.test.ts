/**
 * merchant_ref: your own order or invoice number, sent on create and read back everywhere the API
 * echoes it - and the dependency-free proof that a reference commits to it.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkMerchantRef, createP2Flux } from '../src/index.js'
import { keccak256 } from '../src/keccak.js'

// The API's published vector (P2Flux/core packages/base/src/merchant-ref.ts), computed with `cast keccak`.
const SALT = `0x${'11'.repeat(32)}`
const REFERENCE = '0x03f0752ac8d6e9e6b5bffa5a84881ce0d69c595da28be9ddd91fca4306478f52'

test('keccak256 matches the standard vectors, across the 136-byte block boundary', () => {
  const utf8 = (s: string) => new TextEncoder().encode(s)
  assert.equal(keccak256(new Uint8Array()), '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470')
  assert.equal(keccak256(utf8('abc')), '0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45')
  assert.equal(keccak256(utf8('a'.repeat(135))), '0x34367dc248bbd832f4e3e69dfaac2f92638bd0bbd18f2912ba4ef454919cf446')
  assert.equal(keccak256(utf8('a'.repeat(200))), '0x96ea54061def936c4be90b518992fdc6f12f535068a256229aca54267b4d084d')
  assert.equal(keccak256(utf8('Transfer(address,address,uint256)')), '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef')
})

test('checkMerchantRef: the published vector, and nothing else', () => {
  assert.equal(checkMerchantRef(REFERENCE, SALT, 'INV-1042'), true)
  assert.equal(checkMerchantRef(REFERENCE.toUpperCase().replace('0X', '0x'), SALT, 'INV-1042'), true)
  assert.equal(checkMerchantRef(REFERENCE, SALT, 'INV-1043'), false)
  assert.equal(checkMerchantRef(REFERENCE, `0x${'12'.repeat(32)}`, 'INV-1042'), false)
  // Malformed input is a no, never an exception.
  assert.equal(checkMerchantRef(REFERENCE, '0x11', 'INV-1042'), false)
  assert.equal(checkMerchantRef('nope', SALT, 'INV-1042'), false)
  assert.equal(checkMerchantRef(REFERENCE, SALT, 'a@b.com'), false)
})

/** A fetch that answers every path with `body` and records the requests. */
const echoing = (body: Record<string, unknown>) => {
  const calls: { path: string; body: Record<string, unknown> }[] = []
  const impl = (async (url: string, init: { body: string }) => {
    calls.push({ path: new URL(String(url)).pathname, body: JSON.parse(init.body) })
    return { status: 200, json: async () => body } as never
  }) as unknown as typeof fetch
  return { client: createP2Flux({ apiUrl: 'https://api.p2flux.example', fetch: impl }), calls }
}

const WITH = { merchant_ref: 'INV-1042', reference_salt: SALT, reference: REFERENCE, valid: true, found: true, tx_hash: '0xab', state: 'open', status: 'REFUNDED' }

test('merchantRef goes out as merchant_ref on payments, links and subscriptions', async () => {
  const { client, calls } = echoing(WITH)
  const R = '0x' + '33'.repeat(20)
  await client.createPayment({ recipient: R, amount: '1.00', merchantRef: 'INV-1042' })
  await client.createPaymentLink({ kind: 'once', recipient: R, amount: '1.00', merchantRef: 'INV-1042' })
  await client.createSubscription({ recipient: R, amount: '1.00', period: 86400, merchantRef: 'INV-1042' })
  assert.deepEqual(calls.map((c) => c.body.merchant_ref), ['INV-1042', 'INV-1042', 'INV-1042'])

  const without = echoing({})
  await without.client.createPayment({ recipient: R, amount: '1.00' })
  assert.equal('merchant_ref' in without.calls[0]!.body, false, 'absent stays absent: an older API refuses unknown fields')
})

test('merchant_ref and reference_salt are read back wherever the API echoes them', async () => {
  const { client } = echoing(WITH)
  const R = '0x' + '33'.repeat(20)
  const intent = await client.createPayment({ recipient: R, amount: '1.00', merchantRef: 'INV-1042' })
  assert.equal(intent.merchantRef, 'INV-1042')
  assert.equal(intent.referenceSalt, SALT)
  assert.ok(checkMerchantRef(intent.reference, intent.referenceSalt!, intent.merchantRef!))

  assert.equal((await client.resolvePayment('p2f1.x')).merchantRef, 'INV-1042')
  const verdict = await client.verifyPayment('p2f1.x', '0xab')
  assert.ok(verdict.valid)
  assert.equal(verdict.merchantRef, 'INV-1042')
  assert.equal(verdict.referenceSalt, SALT)
  const recovered = await client.recoverPayment('p2f1.x')
  assert.equal(recovered.merchantRef, 'INV-1042')
  assert.equal(recovered.referenceSalt, SALT)
  assert.equal((await client.createPaymentLink({ kind: 'once', recipient: R, amount: '1.00' })).merchantRef, 'INV-1042')
  assert.equal((await client.paymentLinkStatus({ link: 'p2l1.x' })).merchantRef, 'INV-1042')
  assert.equal((await client.createSubscription({ recipient: R, amount: '1.00', period: 86400 })).merchantRef, 'INV-1042')
  assert.equal((await client.resolveSubscription('p2setup2.x')).merchantRef, 'INV-1042')
  assert.equal((await client.status('p2s2.x')).merchantRef, 'INV-1042')
  assert.equal((await client.verifyRefund({ intent: 'p2f1.x', txHash: '0xab' }, '1', '0xcd')).merchantRef, 'INV-1042')

  const bare = echoing({ valid: true, tx_hash: '0xab' }).client
  const old = await bare.verifyPayment('p2f1.x', '0xab')
  assert.ok(old.valid && !('merchantRef' in old) && !('referenceSalt' in old), 'an older API: no keys at all')
})

test('handleNotification passes the verified merchant_ref on', async () => {
  const b64 = Buffer.from(JSON.stringify({ reference: REFERENCE })).toString('base64url')
  const intent = `p2f1.k1.${b64}.mac`
  const { client } = echoing({ ...WITH, tx_hash: `0x${'ab'.repeat(32)}` })
  const result = await client.handleNotification(
    { id: 'evt', type: 'payment.paid', data: { intent, tx_hash: `0x${'ab'.repeat(32)}`, reference: REFERENCE } },
    { reference: REFERENCE },
  )
  assert.equal(result.confirmed, true)
  assert.equal(result.merchantRef, 'INV-1042')
  assert.equal(result.referenceSalt, SALT)
})

test('a charge carries its own merchantRef, read back on the result and on recovery', async () => {
  const { client, calls } = echoing({ status: 'CHARGED', merchant_ref: 'INV-2001', found: true })
  const result = await client.charge('p2s2.x', { merchantRef: 'INV-2001' })
  assert.deepEqual(calls[0]!.body, { subscription: 'p2s2.x', merchant_ref: 'INV-2001' })
  assert.equal(result.merchantRef, 'INV-2001')
  assert.equal((await client.recoverCharge('p2s2.x', 3)).merchantRef, 'INV-2001')
  await client.charge('p2s2.x')
  assert.deepEqual(calls.at(-1)!.body, { subscription: 'p2s2.x' }, 'without it, the request is unchanged')
})
