/**
 * The paywall helper: the seller's wallet and price decide what is owed; a payment is settled before
 * the handler runs and serves one response; nothing an agent sends reaches the handler unpaid.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPaywall, isAgent } from '../src/paywall.js'

const WALLET = '0xb4e43f3fBa5Add75395adAD366627E7d74141Fa9'
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64')
const decode = (h: string) => JSON.parse(Buffer.from(h, 'base64').toString())
const pay = (id: string) => b64({ id })

/** A P2Flux API that pays each payment id once - the property the helper relies on. */
function api(over: { down?: boolean; badConfig?: boolean } = {}) {
  const calls: { path: string; body: Record<string, unknown> }[] = []
  const usedIds = new Set<string>()
  const state = { ...over }
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    calls.push({ path, body })
    if (state.down) throw new Error('ECONNREFUSED')
    if (state.badConfig) return new Response(JSON.stringify({ error: 'INVALID_REQUEST' }), { status: 400 })
    if (path.endsWith('/challenge')) {
      return Response.json({ x402Version: 2, ttl: 3600, accepts: [
        { scheme: 'exact', network: 'eip155:84532', amount: String(Math.round(Number(body.price) * 1e6)), payTo: '0xvault' },
        { scheme: 'batch-settlement', network: 'eip155:84532', amount: String(Math.round(Number(body.price) * 1e6)), payTo: '0xbatchvault' },
      ] })
    }
    const id = (decode(String(body.payment)) as { id: string }).id
    if (id.startsWith('bad-')) return Response.json({ paid: false, reason: 'invalid_exact_evm_insufficient_balance' })
    if (id.startsWith('stale-')) return Response.json({ paid: false, reason: 'batch_stale', payment_required: b64({ x402Version: 2, error: 'batch_stale', accepts: [{ extra: { channelState: { charged: '150000' } } }] }) })
    if (usedIds.has(id)) return Response.json({ paid: false, reason: 'invalid_transaction_state' })
    usedIds.add(id)
    return Response.json({ paid: true, transaction: `0x${'ab'.repeat(32)}`, payer: '0xagent', scheme: 'exact', payment_response: b64({ success: true }) })
  }) as unknown as typeof fetch
  return { fetchImpl, calls, state }
}
const paywallOn = (a: ReturnType<typeof api>, over: Record<string, unknown> = {}) =>
  createPaywall({ apiUrl: 'https://api-test.p2flux.com/', recipient: WALLET, price: '0.05', fetch: a.fetchImpl, ...over })
const URL_ = 'https://shop.example/report'

test('no payment: 402 with the x402 requirement for THIS url, the seller wallet and price sent to P2Flux', async () => {
  const a = api()
  const r = await paywallOn(a).guard({ url: URL_ })
  assert.equal(r.allow, false)
  if (r.allow) return
  assert.equal(r.status, 402)
  const required = decode(r.headers['payment-required']!)
  assert.equal(required.x402Version, 2)
  assert.equal(required.resource.url, URL_)
  assert.deepEqual(required.accepts.map((x: { scheme: string }) => x.scheme), ['exact', 'batch-settlement'])
  assert.match(r.headers['cache-control']!, /no-store/)
  assert.deepEqual(a.calls, [{ path: '/x402/paywall/challenge', body: { recipient: WALLET, price: '0.05' } }])
})

test('the requirement is fetched once per price, not per request', async () => {
  const a = api()
  const p = paywallOn(a)
  await p.guard({ url: URL_ })
  await p.guard({ url: `${URL_}?2` })
  await p.guard({ url: URL_, price: '0.20' })
  assert.deepEqual(a.calls.map((c) => c.body.price), ['0.05', '0.20'])
})

test('a payment is settled with the seller terms, then allowed, with the receipt header', async () => {
  const a = api()
  const r = await paywallOn(a).guard({ url: URL_, paymentHeader: pay('p1') })
  assert.equal(r.allow, true)
  if (!r.allow) return
  assert.equal(r.paid, true)
  assert.equal(decode(r.headers['payment-response']!).success, true)
  assert.equal(r.transaction, `0x${'ab'.repeat(32)}`)
  assert.deepEqual(a.calls.at(-1), { path: '/x402/paywall/redeem', body: { recipient: WALLET, price: '0.05', payment: pay('p1'), resource: URL_ } })
})

test('one payment, one response: the same header again is refused - without asking P2Flux', async () => {
  const a = api()
  const p = paywallOn(a)
  assert.equal((await p.guard({ url: URL_, paymentHeader: pay('once') })).allow, true)
  const n = a.calls.length
  for (const url of [URL_, 'https://shop.example/other']) {
    const again = await p.guard({ url, paymentHeader: pay('once') })
    assert.equal(again.allow, false)
    if (!again.allow) assert.equal(decode(again.headers['payment-required']!).error, 'invalid_transaction_state')
  }
  assert.equal(a.calls.filter((c) => c.path.endsWith('/redeem')).length, 1)
  assert.ok(a.calls.length <= n + 1)
})

test('two requests with one payment at the same moment: one is allowed', async () => {
  const a = api()
  const p = paywallOn(a)
  const results = await Promise.all([p.guard({ url: URL_, paymentHeader: pay('race') }), p.guard({ url: URL_, paymentHeader: pay('race') })])
  assert.equal(results.filter((r) => r.allow).length, 1)
})

test('a refused payment is a 402 with the reason; a prepaid refusal forwards P2Flux own 402', async () => {
  const p = paywallOn(api())
  const bad = await p.guard({ url: URL_, paymentHeader: pay('bad-1') })
  assert.equal(bad.allow, false)
  if (!bad.allow) assert.equal(decode(bad.headers['payment-required']!).error, 'invalid_exact_evm_insufficient_balance')
  const stale = await p.guard({ url: URL_, paymentHeader: pay('stale-1') })
  if (!stale.allow) {
    const forwarded = decode(stale.headers['payment-required']!)
    assert.equal(forwarded.accepts[0].extra.channelState.charged, '150000')
    assert.equal((stale.body as { error: string }).error, 'batch_stale')
  } else assert.fail('allowed')
})

test('a header that is not base64, or too long, is refused without asking P2Flux to settle', async () => {
  const a = api()
  const p = paywallOn(a)
  for (const h of ['not base64 !!', 'A'.repeat(9000), '{"id":1}', '']) {
    const r = await p.guard({ url: URL_, paymentHeader: h })
    assert.equal(r.allow, false, h.slice(0, 12))
    if (!r.allow) assert.equal(decode(r.headers['payment-required']!).error, 'invalid_payload')
  }
  assert.equal(a.calls.filter((c) => c.path.endsWith('/redeem')).length, 0)
})

test('prepaid: false offers pay-per-request only', async () => {
  const r = await paywallOn(api(), { prepaid: false }).guard({ url: URL_ })
  if (!r.allow) assert.deepEqual(decode(r.headers['payment-required']!).accepts.map((x: { scheme: string }) => x.scheme), ['exact'])
})

test('P2Flux unreachable: 503 with Retry-After by default, or free if the seller chose so', async () => {
  const refuse = await paywallOn(api({ down: true })).guard({ url: URL_, paymentHeader: pay('x') })
  assert.equal(refuse.allow, false)
  if (!refuse.allow) {
    assert.equal(refuse.status, 503)
    assert.equal(refuse.headers['retry-after'], '60')
  }
  assert.equal((await paywallOn(api({ down: true })).guard({ url: URL_ })).allow, false)
  const free = await paywallOn(api({ down: true }), { onUnavailable: 'free' }).guard({ url: URL_ })
  assert.deepEqual(free, { allow: true, paid: false, headers: {} })
})

test('a wallet or price P2Flux rejects is the seller configuration: it throws, it is not a 402 for the agent', async () => {
  await assert.rejects(paywallOn(api({ badConfig: true })).guard({ url: URL_ }), /refused the paywall configuration/)
})

test('agentsOnly: browsers and search engines pass free, agents pay, a payment header always counts as an agent', async () => {
  const a = api()
  const p = paywallOn(a, { agentsOnly: true })
  const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
  assert.deepEqual(await p.guard({ url: URL_, userAgent: chrome }), { allow: true, paid: false, headers: {} })
  assert.equal((await p.guard({ url: URL_, userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1)' })).allow, true)
  assert.equal(a.calls.length, 0)
  assert.equal((await p.guard({ url: URL_, userAgent: 'Mozilla/5.0 (compatible; GPTBot/1.2)' })).allow, false)
  assert.equal((await p.guard({ url: URL_, userAgent: '' })).allow, false)
  assert.equal((await p.guard({ url: URL_, userAgent: chrome, paymentHeader: pay('bad-browser') })).allow, false)
  assert.equal(isAgent('node', false), true)
  assert.equal(isAgent('Googlebot GPTBot', false), false)
})

test('wrap: the handler runs only after payment; the receipt header is added to its response', async () => {
  let ran = 0
  const handler = paywallOn(api()).wrap(async () => {
    ran++
    return new Response('PAID CONTENT', { headers: { 'x-own': '1' } })
  })
  const unpaid = await handler(new Request(URL_))
  assert.equal(unpaid.status, 402)
  assert.ok(unpaid.headers.get('payment-required'))
  assert.equal(ran, 0)
  const paid = await handler(new Request(URL_, { headers: { 'payment-signature': pay('w1') } }))
  assert.equal(paid.status, 200)
  assert.equal(await paid.text(), 'PAID CONTENT')
  assert.equal(paid.headers.get('x-own'), '1')
  assert.ok(paid.headers.get('payment-response'))
  assert.equal(ran, 1)
  assert.equal((await handler(new Request(URL_, { headers: { 'X-PAYMENT': pay('w2') } }))).status, 200, 'legacy header name')
})

test('express: next() only after payment; 402 and headers otherwise; errors go to next(err)', async () => {
  const run = async (p: ReturnType<typeof paywallOn>, headers: Record<string, string>) => {
    const out: { status?: number; body?: unknown; headers: Record<string, string>; next?: unknown } = { headers: {} }
    const res = { status(c: number) { out.status = c; return res }, set(k: string, v: string) { out.headers[k] = v; return res }, json(b: unknown) { out.body = b } }
    await p.express()({ protocol: 'https', originalUrl: '/report?x=1', headers: { host: 'shop.example', ...headers } }, res, (err?: unknown) => { out.next = err ?? 'called' })
    return out
  }
  const a = api()
  const unpaid = await run(paywallOn(a), {})
  assert.equal(unpaid.status, 402)
  assert.equal(unpaid.next, undefined)
  assert.equal(decode(unpaid.headers['payment-required']!).resource.url, 'https://shop.example/report?x=1')
  const paid = await run(paywallOn(a), { 'payment-signature': pay('e1') })
  assert.equal(paid.next, 'called')
  assert.ok(paid.headers['payment-response'])
  const broken = await run(paywallOn(api({ badConfig: true })), {})
  assert.ok(broken.next instanceof Error)
})
