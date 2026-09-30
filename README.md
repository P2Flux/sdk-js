# P2Flux JavaScript SDK

[![npm](https://img.shields.io/npm/v/@p2flux/sdk)](https://www.npmjs.com/package/@p2flux/sdk)
[![node](https://img.shields.io/node/v/@p2flux/sdk)](https://www.npmjs.com/package/@p2flux/sdk)

```bash
npm install @p2flux/sdk
```

Zero dependencies, TypeScript types included, ESM only. Node 18+, Deno, Bun, Cloudflare Workers.

## What P2Flux does

P2Flux takes USDC payments on Base that settle **straight to your own wallet**. There is no custody,
no payout step and no account balance: the buyer's transaction pays you directly.

It executes payments; your application keeps everything else. No scheduler, no stored orders, no
retry loops — you already have those.

- **One-time payments.** Create an intent, send the buyer to the hosted checkout, verify server-side.
- **Subscriptions.** The customer signs one authorization; your renewal job calls `charge()` when a
  period is due. The contract allows one charge per period, so retries are safe.
- **Buyers with no ETH.** Optionally, the buyer pays the network fee in USDC instead of holding the
  chain's native currency.
- **Refunds.** A plain transfer from your wallet, verified by P2Flux, which never holds the money.

## Five-minute payment

```ts
import { createP2Flux } from '@p2flux/sdk'

const p2flux = createP2Flux({ apiUrl: 'https://api-test.p2flux.com', timeoutMs: 30_000 })

// 1. Mint an intent on your server and store it on the order.
const payment = await p2flux.createPayment({ recipient: merchantWallet, amount: '12.50' })
order.p2fluxIntent = payment.intent

// 2. Send the buyer to the hosted checkout.
const url = `https://pay-test.p2flux.com/#/pay/${encodeURIComponent(payment.intent)}`

// 3. The checkout hands your page a transaction hash. Verify it server-side.
const verdict = await p2flux.verifyPayment(order.p2fluxIntent, txHash)
if (verdict.valid) {
  order.markPaid(verdict.txHash)
}
```

`https://api-test.p2flux.com` is Base Sepolia with faucet USDC. Production is
`https://api.p2flux.com` with real money. **There is no API key** — a payment is bound to its
recipient and amount by the buyer's own signature.

## Hosted checkout flow

The buyer pays in P2Flux's hosted checkout, which reports back to the page that opened it. This half
is plain browser JavaScript; the SDK is not involved and does not belong in a bundle.

```js
const url = `${CHECKOUT}/#/pay/${encodeURIComponent(intent)}`
const win = window.open(url, 'p2flux', 'width=460,height=680')

addEventListener('message', (event) => {
  if (event.origin !== new URL(CHECKOUT).origin) return

  if (event.data?.type === 'p2flux.ready') {
    win.postMessage({ type: 'p2flux.hello' }, new URL(CHECKOUT).origin)
  }

  if (event.data?.type === 'p2flux.payment.completed') {
    fetch('/orders/verify', {                    // hand it to your server; decide nothing here
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: ORDER_ID, txHash: event.data.tx_hash }),
    })
  }
})
```

The intent rides in the URL fragment, which browsers never send to a server or put in `Referer`.

## Verify before fulfilling

**P2Flux sends no webhooks.** The browser message says what a wallet did; your server's verdict is
what decides. `verifyPayment()` returns a discriminated union, so TypeScript narrows it for you:

| Verdict | Meaning |
|---|---|
| `valid: true` | Settled. Mark the order paid — once, under a lock. |
| `code: 'PAYMENT_CONFIRMING'` | On chain, not deep enough. Poll the same hash; never re-ask the buyer. |
| any other `code` | This transaction does not settle this intent. |
| a thrown `P2FluxError` | Never reached a verdict. Unknown, not rejected: retry. |

Lost the hash entirely? `recoverPayment(intent)` finds the settlement from the intent alone.

Full walk-through: [The payment lifecycle](docs/payment-flow.md).

## Pay the network fee in USDC

A buyer holding USDC and **no ETH** can still pay. They sign a token authorization; P2Flux submits
the transaction and pays the Base network fee in ETH, and the buyer reimburses that exact cost in
USDC in the same transaction. Nothing is waived — the fee is quoted before they sign, and they pay
it in USDC rather than in ETH. USDC is never converted.

```ts
const caps = await p2flux.capabilities()                    // ask before offering it
const usdc = caps.tokens.find((token) => token.symbol === 'USDC')
const sponsored = usdc?.gasPaymentModes.includes('payment_token') ?? false

const payment = await p2flux.createPayment({
  recipient: merchantWallet,
  amount: '12.50',
  gasPaymentMode: sponsored ? 'payment_token' : 'native',
})
```

`verifyPayment()` then returns `gasPaymentMode` and an `accounting` block naming every figure in
USDC base units. Subscription signup and allowance repair take the same path from the hosted
checkout. Details, limits and contract addresses:
[Paying the network fee in USDC](docs/network-fee-in-usdc.md).

## Subscriptions

P2Flux schedules nothing. Your renewal job decides a period is due:

```ts
const result = await p2flux.charge(capability)

if (result.ok) return                             // CHARGED or ALREADY_CHARGED - the period is paid

switch (result.action) {
  case 'WAIT': break                              // confirming; the money moved
  case 'RETRY_LATER': return retryLater()
  case 'CUSTOMER_ACTION_REQUIRED': return emailCustomer(result.status)
  case 'STOP_SUBSCRIPTION': return stopBilling(result.status)
}
```

**`charge()` never throws on a payment outcome.** "The customer has no funds" is an answer, not an
error. Only transport-level surprises are exceptional, and an unreachable API says nothing about
whether the charge landed. See [Subscriptions](docs/subscriptions.md).

The `p2s2` capability it charges is a bearer credential: server-side only, encrypted at rest, never
in a browser bundle. → [Server and browser](docs/server-and-browser.md)

## Charge AI agents (x402 paywall)

AI agents pay for an API route or a page in USDC, per request, with the open x402 standard. You add
one line; P2Flux builds what the agent signs and settles what it sends — before your handler runs.

```ts
import { createPaywall } from '@p2flux/sdk/paywall'

const paywall = createPaywall({
  apiUrl: 'https://api.p2flux.com',   // https://api-test.p2flux.com for Base Sepolia
  recipient: '0xYourWallet',
  price: '0.05',                      // USDC per request, at least 0.01
})

app.get('/report', paywall.express(), (req, res) => res.json(report))              // Express
export default { fetch: paywall.wrap((request) => new Response('paid content')) }  // Workers, Bun, Hono, Next
```

- A request without payment gets `402 Payment Required` with the price; the agent pays and repeats it.
- One payment serves one response. The same payment sent again is refused.
- Agents may pay per request (P2Flux keeps 1%, at least 0.003 USDC) or from a prepaid balance with no
  transaction per request (3%). `prepaid: false` offers pay-per-request only.
- `agentsOnly: true` charges AI agents and programs only; browsers and search engines pass free.
- `paywall.guard({ url, paymentHeader, userAgent })` is the framework-neutral core.
- A request signed as a bot (Web Bot Auth, a `Signature-Agent` header) counts as an agent under
  `agentsOnly`, whatever its user agent says.
- An agent's request to take back its unused prepaid balance is answered for you (its receipt, no content).

**Usage pricing** - when a request's cost is known only after the work (tokens, rows, seconds). The
agent signs for at most `maxPrice`; you charge what it cost, at least 0.01:

```js
const result = await paywall.usage(
  { url: request.url, paymentHeader: request.headers.get('payment-signature'), maxPrice: '1' },
  async () => {
    const rows = await runQuery()
    return { amount: (rows.length * 0.001).toFixed(6), value: rows }
  },
)
if (!result.allow) return new Response(JSON.stringify(result.body), { status: result.status, headers: result.headers })
return Response.json(result.value, { headers: result.headers })
```

The work runs only after P2Flux confirmed the payment will settle. If the settlement then fails, the
result is not returned.

Money goes to your wallet; the fee is taken on chain. No account, no API key, no x402 library.

## Runtime support

| | |
|---|---|
| Module format | **ESM only.** No CommonJS build. |
| CommonJS apps | Can load it with a dynamic `import('@p2flux/sdk')`. |
| Node | 18 or newer |
| Other runtimes | Deno, Bun, Cloudflare Workers — anything with a global `fetch`, or pass your own |
| Browsers | **Not a browser SDK.** It is a server-side client; the buyer's experience is the hosted checkout. |
| Types | Shipped, generated from the source |

## Documentation

| | |
|---|---|
| [Getting started](docs/getting-started.md) | Install, vocabulary, configuration, environments |
| [The payment lifecycle](docs/payment-flow.md) | The whole flow, and what may mark an order paid |
| [Server and browser](docs/server-and-browser.md) | What runs where, and what must never be bundled |
| [Payments](docs/payments.md) | Intents, checkout, verification |
| [Paying the network fee in USDC](docs/network-fee-in-usdc.md) | Buyers with no ETH |
| [Subscriptions](docs/subscriptions.md) | Setup, charging, allowance repair, cancellation |
| [Refunds](docs/refunds.md) | Merchant-sent, P2Flux-verified |
| [Recovery](docs/recovery.md) | Lost payments, lost charges, ambiguous requests |
| [Errors and retries](docs/errors.md) | Every public code, with a recipe per situation |
| [Testing](docs/testing.md) | A fake `fetch`, canned answers, no crypto spent |
| [Production checklist](docs/production-checklist.md) | Before real money |
| [Call and result contract](docs/protocol-contract.md) | All 21 operations in one table |
| [Examples](examples/) | Runnable, one operation per file |

Full protocol docs: [p2flux.com/docs](https://p2flux.com/docs/) ·
[OpenAPI](https://p2flux.com/openapi.json)

## Examples

```bash
npm install
P2FLUX_RECIPIENT=0xYourPayoutWallet node --import tsx examples/create-payment.ts
```

Every example reads its configuration from the environment and fails with the missing variable's
name. [`examples/complete-payment-flow/`](examples/complete-payment-flow/) is a runnable merchant
integration — order, checkout handshake, repeat-safe verification — against a canned API, so no
wallet or USDC is needed.

## Scope

This client covers the **complete public V1 merchant/server API** — the same surface as the PHP SDK
(`p2flux/sdk-php`). One-time payments, verification with settlement receipts, lost-payment recovery,
subscription setup / resolve / finalize / charge / status, recurring settlement recovery,
cancellation, allowance revocation and repair, and refunds are all first-class typed methods. No raw
REST calls are needed for a normal integration. The buyer-side wallet experience is the hosted
checkout, not an SDK.

**Parity is tested, not promised.** `test/parity.test.ts` holds the checked-in list of every public
V1 operation and fails if any stops being reachable; the PHP SDK and P2Flux/core carry the same
guard.

## Testing

Your own application never needs to spend crypto to be tested. `createP2Flux()` takes a `fetch`, so
a fake replaces HTTP entirely:

```ts
const p2flux = createP2Flux({
  apiUrl: 'https://api.example',
  fetch: (async () => ({ status: 200, json: async () => ({ valid: true, tx_hash: '0xabc' }) })) as never,
})
```

Recipes for every outcome worth a test: [Testing](docs/testing.md).

This repository's own suite is offline and runs in seconds:

```bash
npm test        # client, surface, parity, dist integrity, examples, complete flow, documentation
```

## The other official SDK

PHP: `composer require p2flux/sdk-php` —
[Packagist](https://packagist.org/packages/p2flux/sdk-php) ·
[GitHub](https://github.com/P2Flux/sdk-php). Same public operations, same semantics, same security
model. The two are released independently, so their version numbers differ.

## Requirements

Node 18 or newer, or any runtime with a global `fetch`. ESM only. No runtime dependencies.

## License

MIT.
