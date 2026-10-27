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

/**
 * Recovering a recurring settlement.
 *
 * The rule that matters: a period that was never collected is ordinary history - there is no
 * catch-up billing - so "not found" is an answer rather than an exception, exactly as it is for a
 * one-time payment. Only a broken request or a deployment that cannot search throws.
 */
test('recoverCharge asks for one exact period and normalizes the settlement', async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = []
  const p2flux = createP2Flux({
    apiUrl: 'https://api.p2flux.example',
    fetch: (async (url: string, init: { body: string }) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) })
      return {
        status: 200,
        json: async () => ({
          found: true,
          subscription_id: `0x${'cd'.repeat(32)}`,
          period_index: 3,
          tx_hash: '0xrecovered',
          block_number: '45688490',
          net_units: '9700000',
          fee_units: '200000',
          network_fee_units: '100000',
          amount_units: '10000000',
        }),
      }
    }) as unknown as typeof fetch,
  })

  const settled = await p2flux.recoverCharge('p2s2.x', 3)
  assert.equal(settled.found, true)
  assert.equal(settled.txHash, '0xrecovered')
  assert.equal(settled.periodIndex, 3)
  assert.equal(settled.amountUnits, '10000000')
  assert.deepEqual(calls[0]!.body, { subscription: 'p2s2.x', period_index: 3 })

  // A hint is optional, snake_cased on the wire, and omitted entirely when empty.
  await p2flux.recoverCharge('p2s2.x', 3, { attemptedAt: 1700000000 })
  assert.deepEqual(calls[1]!.body.hint, { attempted_at: 1700000000 })
  await p2flux.recoverCharge('p2s2.x', 3, {})
  assert.equal('hint' in (calls[2]!.body as object), false)
})

test('a period that was never collected is an answer, not a throw', async () => {
  const p2flux = createP2Flux({
    apiUrl: 'https://api.p2flux.example',
    fetch: (async () => ({
      status: 200,
      json: async () => ({ found: false, code: 'PAYMENT_NOT_FOUND', as_of_block: '45688490' }),
    })) as unknown as typeof fetch,
  })

  const missing = await p2flux.recoverCharge('p2s2.x', 5)
  assert.equal(missing.found, false)
  assert.equal(missing.status, 'PAYMENT_NOT_FOUND')
  assert.equal(missing.action, 'RETRY_LATER', 'as of this block, and never a permanent verdict')
  assert.equal(missing.asOfBlock, '45688490')
})

test('a deployment that cannot complete the search throws rather than reporting a miss', async () => {
  const p2flux = createP2Flux({
    apiUrl: 'https://api.p2flux.example',
    fetch: (async () => ({ status: 503, json: async () => ({ error: 'RECOVERY_UNAVAILABLE' }) })) as unknown as typeof fetch,
  })

  await assert.rejects(() => p2flux.recoverCharge('p2s2.x', 3), /RECOVERY_UNAVAILABLE/)
})

test('an allowance-restore session carries no capability', async () => {
  const p2flux = createP2Flux({
    apiUrl: 'https://api.p2flux.example',
    fetch: (async () => ({
      status: 200,
      json: async () => ({
        approve_token: 'p2approve1.k1.body.mac',
        expires_at: 1700000900,
        payer: `0x${'55'.repeat(20)}`,
        subscription_id: `0x${'cd'.repeat(32)}`,
      }),
    })) as unknown as typeof fetch,
  })

  const session = await p2flux.createAllowanceRestoreSession('p2s2.x')
  assert.equal(session.approveToken, 'p2approve1.k1.body.mac')
  assert.doesNotMatch(JSON.stringify(session), /p2s2\./)
})

// --- checkout links -------------------------------------------------------------

test('checkoutLink: P2Flux hosted checkout by default, for the API in use', () => {
  const live = createP2Flux({ apiUrl: 'https://api.p2flux.com' })
  assert.equal(live.checkoutLink('pay', 'p2f1.a.b.c'), 'https://pay.p2flux.com/#/pay/p2f1.a.b.c')
  const test_ = createP2Flux({ apiUrl: 'https://api-test.p2flux.com/' })
  assert.equal(test_.checkoutLink('subscribe', 'tok'), 'https://pay-test.p2flux.com/#/subscribe/tok')
})

test('checkoutLink: a self-hosted checkout, on a domain or a sub-path', () => {
  const own = createP2Flux({ apiUrl: 'https://api.p2flux.com', checkoutUrl: 'https://pay.example.com/' })
  assert.equal(own.checkoutLink('refund', 'r'), 'https://pay.example.com/#/refund/r')
  const sub = createP2Flux({ apiUrl: 'https://api.p2flux.com', checkoutUrl: 'https://example.com/pay//' })
  assert.equal(sub.checkoutLink('approve', 'a'), 'https://example.com/pay/#/approve/a')
  // The token is encoded: it can never break out of the fragment.
  assert.equal(own.checkoutLink('pay', 'a/b#c'), 'https://pay.example.com/#/pay/a%2Fb%23c')
})

test('checkoutLink: refuses what would be a wrong or unsafe link - at the link, never at construction', () => {
  const bad = (checkoutUrl: string) => {
    // The client still works for everything else: a typo in an optional setting never stops payments.
    const p = createP2Flux({ apiUrl: 'https://api.p2flux.com', checkoutUrl })
    assert.equal(typeof p.createPayment, 'function')
    assert.throws(() => p.checkoutLink('pay', 't'), TypeError, checkoutUrl)
  }
  bad('http://pay.example.com')
  bad('https://pay.example.com/?x=1')
  bad('https://user:pw@pay.example.com')
  bad('not a url')
  bad('ftp://localhost')
  bad('javascript:alert(1)')
  bad('http://localhost.evil.com')
  assert.equal(createP2Flux({ apiUrl: 'https://api.p2flux.com', checkoutUrl: 'http://localhost:5173' }).checkoutLink('pay', 't'), 'http://localhost:5173/#/pay/t')
  // An empty setting (an unset env var) means "not set": the hosted checkout of the API.
  assert.equal(createP2Flux({ apiUrl: 'https://api.p2flux.com', checkoutUrl: '' }).checkoutLink('pay', 't'), 'https://pay.p2flux.com/#/pay/t')
  assert.equal(createP2Flux({ apiUrl: 'https://API.P2FLUX.COM' }).checkoutLink('pay', 't'), 'https://pay.p2flux.com/#/pay/t')
  const own = createP2Flux({ apiUrl: 'http://localhost:3000' })
  assert.throws(() => own.checkoutLink('pay', 't'), /checkoutUrl is required/)
  assert.throws(() => createP2Flux({ apiUrl: 'https://constructor' }).checkoutLink('pay', 't'), /checkoutUrl is required/)
  const live = createP2Flux({ apiUrl: 'https://api.p2flux.com' })
  assert.throws(() => live.checkoutLink('pay', ''), TypeError)
  assert.throws(() => live.checkoutLink('admin' as 'pay', 't'), TypeError)
})

// --- webhooks: a notification is a hint, confirmed by asking the API again ------------------------

const routed = (answers: Record<string, unknown>) => {
  const calls: { url: string; body: Record<string, unknown> }[] = []
  const impl = (async (url: string, init: { body: string }) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) })
    const path = new URL(String(url)).pathname
    return { status: 200, json: async () => answers[path] } as never
  }) as unknown as typeof fetch
  return { impl, calls }
}
const REF = `0x${'12'.repeat(32)}`
const TXH = `0x${'ab'.repeat(32)}`
const intentFor = (reference: string) => `p2f1.k1.${Buffer.from(JSON.stringify({ v: 1, reference })).toString('base64url')}.mac`
const INTENT = intentFor(REF)
const paidEvent = { id: `0x${'99'.repeat(32)}`, type: 'payment.paid', created_at: 1, chain_id: 84532, data: { intent: INTENT, tx_hash: TXH, reference: REF } }

test('createPayment sends notify_url only when given', async () => {
  const { impl, calls } = answering(200, { intent: 'p2i1.x', reference: REF, amount: '10.00', expires_at: 1, pay: {}, notify_url: 'https://shop.example.com/n' })
  const plain = await client(impl).createPayment({ recipient: '0x1', amount: '10.00' })
  assert.equal('notify_url' in (calls[0]!.body as object), false)
  assert.equal(plain.notifyUrl, 'https://shop.example.com/n')
  await client(impl).createPayment({ recipient: '0x1', amount: '10.00', notifyUrl: 'https://shop.example.com/n' })
  assert.equal((calls[1]!.body as { notify_url: string }).notify_url, 'https://shop.example.com/n')
})

test('return_url goes out only when given; return and checkout URLs come back', async () => {
  const back = 'https://shop.example.com/order/1'
  const page = 'https://pay-test.p2flux.com/#/pay/p2i1.x'
  const { impl, calls } = answering(200, { intent: 'p2i1.x', reference: REF, amount: '10.00', expires_at: 1, pay: {}, return_url: back, checkout_url: page, link: 'p2l1.x', manage: 'p2lm1.x', kind: 'once' })
  const plain = await client(impl).createPayment({ recipient: '0x1', amount: '10.00' })
  assert.equal('return_url' in (calls[0]!.body as object), false)
  assert.equal(plain.returnUrl, back)
  assert.equal(plain.checkoutUrl, page)
  await client(impl).createPayment({ recipient: '0x1', amount: '10.00', returnUrl: back })
  assert.equal((calls[1]!.body as { return_url: string }).return_url, back)
  const link = await client(impl).createPaymentLink({ kind: 'once', recipient: '0x1', amount: '10.00', returnUrl: back })
  assert.equal((calls[2]!.body as { return_url: string }).return_url, back)
  assert.equal(link.returnUrl, back)
  assert.equal(link.checkoutUrl, page)
})

test('private_payment goes out only when given and comes back on the payment, resolve and link', async () => {
  const { impl, calls } = answering(200, { intent: 'p2i1.x', reference: REF, amount: '10.00', expires_at: 1, pay: {}, private_payment: 'hinkal', link: 'p2l1.x', manage: 'p2lm1.x', kind: 'once', gas_payment_mode: 'native' })
  await client(impl).createPayment({ recipient: '0x1', amount: '10.00' })
  assert.equal('private_payment' in (calls[0]!.body as object), false)
  const paid = await client(impl).createPayment({ recipient: '0x1', amount: '10.00', privatePayment: 'hinkal' })
  assert.equal((calls[1]!.body as { private_payment: string }).private_payment, 'hinkal')
  assert.equal(paid.privatePayment, 'hinkal')
  assert.equal((await client(impl).resolvePayment('p2i1.x')).privatePayment, 'hinkal')
  const link = await client(impl).createPaymentLink({ kind: 'once', recipient: '0x1', amount: '10.00', privatePayment: 'hinkal' })
  assert.equal((calls[3]!.body as { private_payment: string }).private_payment, 'hinkal')
  assert.equal(link.privatePayment, 'hinkal')
})

test('a privacy-service payment reports refundable false; a normal one leaves it absent', async () => {
  const accounting = { payment_units: '1', payment_fee_units: '0', network_fee_units: '0', fixed_network_fee_units: '0', merchant_net_units: '1', buyer_total_units: '1' }
  const hidden = answering(200, { valid: true, tx_hash: TXH, reference: REF, amount: '10.00', screening: 'unknown', accounting: { ...accounting, payer: '0xf66d', refundable: false } })
  const v = await client(hidden.impl).verifyPayment('p2i1.x', TXH)
  assert.equal(v.valid && v.accounting?.refundable, false)
  assert.equal(v.valid && v.screening, 'unknown')
  const plain = answering(200, { valid: true, tx_hash: TXH, reference: REF, amount: '10.00', accounting: { ...accounting, payer: '0xb0b' } })
  const w = await client(plain.impl).verifyPayment('p2i1.x', TXH)
  assert.equal(w.valid && 'refundable' in (w.accounting ?? {}), false)
})

test('handleNotification confirms a payment.paid only through verify, for your reference', async () => {
  const { impl, calls } = routed({ '/v1/payments/verify': { valid: true, tx_hash: TXH, reference: REF, amount: '10.00' } })
  const ok = await client(impl).handleNotification(JSON.stringify(paidEvent), { reference: REF })
  assert.equal(ok.confirmed, true)
  assert.equal(ok.eventId, paidEvent.id)
  assert.equal(ok.dedupeKey, `${REF}:${TXH}`)
  assert.deepEqual(calls[0]!.body, { intent: INTENT, tx_hash: TXH })

  // The same real payment replayed with a fresh event id: the dedupe key does not change.
  const replay = await client(impl).handleNotification({ ...paidEvent, id: `0x${'55'.repeat(32)}` }, { reference: REF })
  assert.equal(replay.dedupeKey, ok.dedupeKey)

  // Another order's notification: refused before the API is asked.
  const before = calls.length
  const other = await client(impl).handleNotification(paidEvent, { reference: `0x${'34'.repeat(32)}` })
  assert.equal(other.reason, 'NOT_YOUR_ORDER')
  assert.equal(calls.length, before)

  // Link payments: the verified reference starts with your link id.
  const link = await client(impl).handleNotification(paidEvent, { linkId: REF.slice(0, 34) })
  assert.equal(link.confirmed, true)
})

test('handleNotification never confirms what verify does not', async () => {
  const { impl } = routed({ '/v1/payments/verify': { valid: false, code: 'TERMS_MISMATCH' } })
  const forged = await client(impl).handleNotification(paidEvent, { reference: REF })
  assert.equal(forged.confirmed, false)
  assert.equal(forged.reason, 'TERMS_MISMATCH')
  // The notification names your reference, the API's verdict another: not yours.
  const { impl: lying } = routed({ '/v1/payments/verify': { valid: true, tx_hash: TXH, reference: `0x${'34'.repeat(32)}` } })
  assert.equal((await client(lying).handleNotification(paidEvent, { reference: REF })).reason, 'NOT_YOUR_ORDER')
  // A forged intent the API refuses outright is an answer, not an exception.
  const refusing = answering(400, { error: 'INVALID_INTENT' })
  assert.equal((await client(refusing.impl).handleNotification(paidEvent, { reference: REF })).reason, 'INVALID_INTENT')
  // An intent for another order, with this order's reference written next to it: refused locally.
  const before = refusing.calls.length
  const swapped = { ...paidEvent, data: { ...paidEvent.data, intent: intentFor(`0x${'34'.repeat(32)}`) } }
  assert.equal((await client(refusing.impl).handleNotification(swapped, { reference: REF })).reason, 'NOT_YOUR_ORDER')
  assert.equal(refusing.calls.length, before)
  // Not final yet: thrown, so the endpoint answers 5xx and the notification comes again.
  const { impl: confirming } = routed({ '/v1/payments/verify': { valid: false, code: 'PAYMENT_CONFIRMING' } })
  await assert.rejects(() => client(confirming).handleNotification(paidEvent, { reference: REF }), P2FluxError)
  assert.equal((await client(impl).handleNotification('{not json', { reference: REF })).reason, 'MALFORMED')
  assert.equal((await client(impl).handleNotification({ type: 'payment.paid', data: {} }, { reference: REF })).reason, 'MALFORMED')
  await assert.rejects(() => client(impl).handleNotification(paidEvent, {}), TypeError)
})

test('handleNotification confirms subscription events against the manage view', async () => {
  const LINK = `0x${'01'.repeat(16)}`
  const SUB = `0x${'cd'.repeat(32)}`
  const { impl } = routed({
    '/v1/links/status': { kind: 'subscription', id: LINK, state: 'open', subscribers: [{ subscription_id: SUB, payer: '0x2', state: 'active', started_at: 1, last_period: 1 }] },
  })
  const event = { id: `0x${'77'.repeat(32)}`, type: 'subscription.charged', data: { link_id: LINK, subscription_id: SUB, period_index: 1 } }
  const ok = await client(impl).handleNotification(event, { linkId: LINK, manage: 'p2lm.x' })
  assert.equal(ok.confirmed, true)
  assert.equal(ok.dedupeKey, `${SUB}:1`)
  assert.equal(ok.subscriber?.lastPeriod, 1)
  const ahead = await client(impl).handleNotification({ ...event, data: { ...event.data, period_index: 2 } }, { linkId: LINK, manage: 'p2lm.x' })
  assert.equal(ahead.reason, 'NOT_CHARGED')
  // An older (or skipped, never paid) period replayed: not confirmed, no new key to credit.
  const older = await client(impl).handleNotification({ ...event, data: { ...event.data, period_index: 0 } }, { linkId: LINK, manage: 'p2lm.x' })
  assert.equal(older.reason, 'NOT_CURRENT')
  const updated = await client(impl).handleNotification({ ...event, type: 'subscription.updated' }, { linkId: LINK, manage: 'p2lm.x' })
  assert.equal(updated.confirmed, true)
  assert.equal(updated.dedupeKey, undefined, 'apply the state; no key that could collide')
  assert.equal(updated.subscriber?.state, 'active')
  const notANumber = await client(impl).handleNotification({ ...event, data: { ...event.data, period_index: 'x' } }, { linkId: LINK, manage: 'p2lm.x' })
  assert.equal(notANumber.reason, 'MALFORMED')
  const foreign = await client(impl).handleNotification({ ...event, data: { ...event.data, link_id: `0x${'02'.repeat(16)}` } }, { linkId: LINK, manage: 'p2lm.x' })
  assert.equal(foreign.reason, 'NOT_YOUR_ORDER')
  await assert.rejects(() => client(impl).handleNotification(event, { linkId: LINK }), TypeError)
})
