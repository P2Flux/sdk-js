/**
 * A small merchant integration you can run: create an order, pay it in the hosted checkout, and let
 * the server decide whether it is paid.
 *
 *   P2FLUX_RECIPIENT=0x... node --import tsx examples/complete-payment-flow/server.ts
 *
 * THE ORDER STORE IS EDUCATIONAL ONLY - an in-memory Map, so the demo runs with nothing installed.
 * A production integration keeps orders in its database and makes the "paid" transition inside a
 * transaction. See README.md.
 */
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { createP2Flux, P2FluxError } from '@p2flux/sdk'

const env = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback
  if (!value) {
    console.error(`Missing required environment variable ${name}`)
    process.exit(1)
  }
  return value
}

const apiUrl = env('P2FLUX_API_URL', 'https://api.p2flux.com')
const checkoutUrl = env('P2FLUX_CHECKOUT_URL', 'https://pay.p2flux.com').replace(/\/$/, '')
const recipient = env('P2FLUX_RECIPIENT')
const amount = env('DEMO_AMOUNT', '12.50')
const port = Number(env('PORT', '8100'))

const p2flux = createP2Flux({ apiUrl, timeoutMs: 30_000 })

type Order = {
  id: string
  amount: string
  status: 'pending' | 'paid'
  intent: string
  txHash?: string
  blockNumber?: string
  settlementReceipt?: string
}

/** Educational only. Yours is a database table with a unique constraint on the intent. */
const orders = new Map<string, Order>()

const json = (body: unknown, status = 200) => ({ status, body: JSON.stringify(body), type: 'application/json' })
const html = (body: string, status = 200) => ({ status, body, type: 'text/html; charset=utf-8' })
const escape = (value: string) => value.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`)

const shopPage = html(`<!doctype html><meta charset="utf-8"><title>P2Flux demo shop</title>
<h1>P2Flux demo shop</h1><p>One imaginary product, ${escape(amount)} USDC.</p>
<form method="post" action="/create"><button type="submit">Buy</button></form>`)

/** Step 1 - the merchant server mints the intent. A browser must never choose recipient or amount. */
async function create() {
  const payment = await p2flux.createPayment({ recipient, amount })

  // Your own reference comes first; the intent is stored beside it, because verification and
  // recovery both need it and recovery still works after the intent expires.
  const order: Order = {
    id: randomBytes(8).toString('hex'),
    amount,
    status: 'pending',
    intent: payment.intent,
  }
  orders.set(order.id, order)

  const checkout = `${checkoutUrl}/#/pay/${encodeURIComponent(order.intent)}`

  return html(`<!doctype html><meta charset="utf-8"><title>Order ${escape(order.id)}</title>
<h1>Order ${escape(order.id)}</h1>
<p>Amount: ${escape(order.amount)} USDC</p>
<p id="state">Opening the checkout…</p>
<p><a href="${escape(checkout)}" target="_blank" rel="noopener">Open the checkout</a></p>
<p><a href="/status?order=${encodeURIComponent(order.id)}">Order status (server truth)</a></p>
<script>
// Step 2 - the buyer pays in the hosted checkout, which reports back by postMessage.
//
// EVERYTHING HERE IS A CLAIM. This page cannot mark anything paid; it hands the claim to the
// server, which verifies it against the chain.
const ORDER = ${JSON.stringify(order.id)}
const ORIGIN = new URL(${JSON.stringify(checkoutUrl)}).origin
const state = document.getElementById('state')

const win = window.open(${JSON.stringify(checkout)}, 'p2flux', 'width=460,height=680')
state.textContent = win ? 'Complete the payment in the checkout window.' : 'Popup blocked - use the link below.'

addEventListener('message', (event) => {
  if (event.origin !== ORIGIN) return                          // always check the origin

  if (event.data?.type === 'p2flux.ready' && win) {
    win.postMessage({ type: 'p2flux.hello' }, ORIGIN)          // the handshake the checkout waits for
  }

  if (event.data?.type === 'p2flux.payment.completed') {
    state.textContent = 'Verifying on the server…'
    verify(event.data.tx_hash, event.data.settlement_receipt)
  }
})

async function verify(txHash, settlementReceipt) {
  const res = await fetch('/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order: ORDER, txHash, settlementReceipt }),
  })
  const body = await res.json()

  // The server's answer, not the browser's, decides what the buyer is told.
  if (body.status === 'paid') state.textContent = 'Paid. Thank you!'
  else if (body.status === 'confirming') { state.textContent = 'Confirming on chain…'; setTimeout(() => verify(txHash, settlementReceipt), 4000) }
  else state.textContent = 'Not settled: ' + (body.code || body.status)
}
</script>`)
}

/** Step 3 - the trust boundary. Repeat-safe: a retry, a second tab and a cron all land here. */
async function verify(input: Record<string, unknown>) {
  const order = orders.get(String(input.order ?? ''))
  if (!order) return json({ status: 'unknown_order' }, 404)

  // Already settled by an earlier call: answer the same thing again and touch nothing.
  if (order.status === 'paid') return json({ status: 'paid', txHash: order.txHash, repeat: true })

  const txHash = typeof input.txHash === 'string' ? input.txHash : ''
  const settlementReceipt = typeof input.settlementReceipt === 'string' ? input.settlementReceipt : undefined

  try {
    // No hash in the claim (a dead callback): the intent alone can still find the settlement.
    const verdict = txHash
      ? await p2flux.verifyPayment(order.intent, txHash, settlementReceipt)
      : await p2flux.recoverPayment(order.intent)

    if (verdict.valid) {
      // A production integration does this inside a database transaction, re-checking the unpaid
      // status under a row lock so two concurrent verifications cannot both fulfil.
      order.status = 'paid'
      order.txHash = verdict.txHash
      if ('blockNumber' in verdict) order.blockNumber = verdict.blockNumber
      if ('settlementReceipt' in verdict) order.settlementReceipt = verdict.settlementReceipt
      return json({ status: 'paid', txHash: order.txHash })
    }

    const code = 'code' in verdict ? verdict.code : verdict.status
    if (code === 'PAYMENT_CONFIRMING' || ('found' in verdict && verdict.found)) {
      // On chain, not settled to the required depth. Keep the order open and poll the SAME hash.
      order.txHash = 'txHash' in verdict ? verdict.txHash : txHash
      return json({ status: 'confirming', txHash: order.txHash }, 202)
    }

    // A verdict about the chain: this transaction does not settle this intent. Order stays unpaid.
    return json({ status: 'unsettled', code })
  } catch (error) {
    // The request never reached a verdict. Unknown, not rejected - the caller retries.
    const failure = error as P2FluxError
    return json({ status: 'unavailable', code: failure.status, action: failure.action }, 503)
  }
}

const server = createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', (chunk: Buffer) => chunks.push(chunk))
  req.on('end', () => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      let answer = json({ status: 'not_found' }, 404)

      if (url.pathname === '/' && req.method === 'GET') {
        answer = shopPage
      } else if (url.pathname === '/create' && req.method === 'POST') {
        answer = await create()
      } else if (url.pathname === '/verify' && req.method === 'POST') {
        let input: Record<string, unknown> = {}
        try {
          input = JSON.parse(Buffer.concat(chunks).toString() || '{}') as Record<string, unknown>
        } catch {
          input = {}
        }
        answer = await verify(input)
      } else if (url.pathname === '/status' && req.method === 'GET') {
        const order = orders.get(url.searchParams.get('order') ?? '')
        answer = order
          ? json({ order: order.id, status: order.status, amount: order.amount, txHash: order.txHash ?? null })
          : json({ status: 'unknown_order' }, 404)
      }

      res.statusCode = answer.status
      res.setHeader('content-type', answer.type)
      res.end(answer.body)
    })()
  })
})

server.listen(port, '127.0.0.1', () => console.log(`demo shop on http://127.0.0.1:${port}`))
