# Charge AI agents (x402 paywall)

`@p2flux/sdk/paywall` charges AI agents for a route, in USDC, over x402. Live on Base Mainnet and
Base Sepolia. No x402 library, no account, no API key.

Runnable: [`examples/paywall-express.mjs`](../examples/paywall-express.mjs).

```ts
import { createPaywall } from '@p2flux/sdk/paywall'

const paywall = createPaywall({
  apiUrl: 'https://api.p2flux.com',   // https://api-test.p2flux.com for Base Sepolia
  recipient: '0xYourWallet',
  price: '0.05',                      // USDC per request, at least 0.01
})
```

You say who is paid and how much. P2Flux builds what the agent signs and settles what it sends. The
payment is settled **before** your handler runs: one payment, one response. The money goes to your
wallet in the settlement transaction; P2Flux takes its fee on chain and never holds funds.

## The cycle

1. A request without payment gets `402 Payment Required`. The `PAYMENT-REQUIRED` header (base64 JSON)
   says what to pay and to whom.
2. The agent signs a USDC payment and repeats the request with a `PAYMENT-SIGNATURE` header. The
   legacy `X-PAYMENT` header is read too.
3. The paywall hands the header to P2Flux, which settles it on Base.
4. Your handler runs. The response carries a `PAYMENT-RESPONSE` header with the settlement.

The agent needs USDC on Base and no ETH.

## Options

| Option | Default | |
|---|---|---|
| `apiUrl` | required | `https://api.p2flux.com` (real USDC on Base) or `https://api-test.p2flux.com` (Base Sepolia) |
| `recipient` | required | Your wallet on Base. Every payment goes to it. |
| `price` | required | USDC per request, e.g. `'0.05'`. At least `0.01`. |
| `agentsOnly` | `false` | `true`: only AI agents and programs pay; browsers and search engines pass free |
| `prepaid` | `true` | Offer the prepaid balance next to pay-per-request, when P2Flux offers it |
| `onUnavailable` | `'refuse'` | What happens when P2Flux cannot be reached. See below. |
| `timeoutMs` | `25000` | Per call to P2Flux |
| `fetch` | global `fetch` | Your own `fetch` |

A recipient or price P2Flux refuses (a malformed wallet, a price below 0.01) is a configuration
error: the call **throws**. `express()` passes the error to `next()`.

## Express

```js
app.get('/report', paywall.express(), (req, res) => res.json(report))
app.get('/big-report', paywall.express({ price: '0.50' }), (req, res) => res.json(bigReport))
```

`express(overrides)` is Connect-style middleware. It builds the URL from `req.protocol`, the `Host`
header and `req.originalUrl`. A paid request reaches your handler with the `PAYMENT-RESPONSE` header
already set on `res`; anything else is answered by the middleware.

## Fetch API: Workers, Bun, Deno, Hono, Next

```ts
export default {
  fetch: paywall.wrap((request) => new Response('paid content'), { price: '0.10', mimeType: 'text/plain' }),
}
```

`wrap(handler, overrides)` returns a handler with the same signature. A refused request gets a JSON
body and its status; a paid one gets your response with the paywall headers added.

## Per-route overrides

`express()` and `wrap()` take `{ price, mimeType }`. `guard()` takes them in its input. `price`
replaces the default price for that route. `mimeType` is the `resource.mimeType` in the 402 (default
`application/json`).

## guard(): the framework-neutral core

```ts
const result = await paywall.guard({
  url: request.url,                                       // the full URL the client asked for
  paymentHeader: request.headers.get('payment-signature') ?? request.headers.get('x-payment'),
  userAgent: request.headers.get('user-agent'),
  signatureAgent: request.headers.get('signature-agent'), // Web Bot Auth
  price: '0.10',                                          // optional override
  mimeType: 'text/html',                                  // optional override
})

if (!result.allow) {
  return new Response(JSON.stringify(result.body), { status: result.status, headers: result.headers })
}
// serve, adding result.headers to the response
```

The result:

| Field | |
|---|---|
| `allow` | `true`: serve the content. `false`: answer `status`, `headers` and `body` instead. |
| `paid` | `allow: true` only. `false` when the request passed free (`agentsOnly`, or `onUnavailable: 'free'`). |
| `status` | `allow: false` only. `402` pay first; `503` P2Flux unreachable; `200` see below. |
| `headers` | Set them on your response, whatever `allow` is. |
| `body` | `allow: false` only. The JSON to send. |
| `payer` | The agent's wallet, when P2Flux reports it. |
| `transaction` | The settlement transaction hash. Absent for a prepaid payment. |
| `receipt` | Prepaid only: a unique id for this paid request. |
| `scheme` | `'exact'` (pay-per-request) or `'batch-settlement'` (prepaid). |

`status: 200` with `allow: false` is an agent taking its unused prepaid balance back. The body is
`{ refunded: true }` and the headers carry its receipt. Serve no content; send it as it is.

The headers:

| Header | When |
|---|---|
| `PAYMENT-REQUIRED` | On a 402: what to pay, base64 JSON |
| `PAYMENT-RESPONSE` | On a paid request, and on a prepaid refund: the settlement, base64 JSON |
| `Retry-After: 60` | On a 503 |
| `Cache-Control: no-store, private` | On every answer except a request that passed free |

A payment this process already took is refused with a fresh 402 without asking P2Flux. P2Flux
refuses it anyway: a payment is settled once.

## When P2Flux cannot be reached

This is a decision, not a detail. Choose it:

- `onUnavailable: 'refuse'` (default): the request gets `503` with `Retry-After: 60` and body
  `{ error: 'payment_service_unavailable' }`. Nothing is served unpaid.
- `onUnavailable: 'free'`: the request is served without payment (`allow: true`, `paid: false`).
  Content stays available while P2Flux is down, and nobody pays for it.

A 400 from P2Flux is not "unavailable": it throws, as above.

## Agents only

```ts
import { createPaywall, isAgent, AGENT_SIGNATURES } from '@p2flux/sdk/paywall'

const paywall = createPaywall({ apiUrl, recipient, price: '0.02', agentsOnly: true })
```

With `agentsOnly: true`, people read free and agents pay. `isAgent(userAgent, hasPayment, signed)`
decides, in this order:

1. A request carrying a payment is an agent.
2. An empty user agent, or `node`, is an agent.
3. Search engines and link previews (Googlebot, bingbot, Applebot, Slackbot, Twitterbot and others)
   are never asked to pay.
4. A request with a `Signature-Agent` header (Web Bot Auth) is an agent. The signature is not
   verified here; it only decides who is asked to pay.
5. A user agent containing one of `AGENT_SIGNATURES` is an agent: AI crawlers and assistants
   (GPTBot, ClaudeBot, PerplexityBot and others) and HTTP libraries (`curl/`, `python-requests`,
   `axios/`, `undici` and others). The list is the same as the WordPress plugin's.

Everything else passes free. A user agent is easy to fake: use `agentsOnly` for content you are
happy to show people, not for an API.

## Prepaid balance

Next to pay-per-request, the 402 offers x402 batch-settlement when P2Flux offers it. The agent puts
USDC aside once in the standard x402 escrow contract and then pays each request with a signed voucher,
with no transaction per request. You are paid out through an on-chain vault contract, less 3%. The
agent's unused balance stays its own; its request to take it back is answered for you
(`status: 200`, above).

`prepaid: false` offers pay-per-request only.

## Usage pricing

When the cost is known only after the work (tokens, rows, seconds), the agent signs for at most
`maxPrice` (x402 `upto`) and you charge what it cost, at least 0.01:

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

The work runs only after P2Flux confirmed the payment will settle, and once per payment. If the
settlement then fails, the result is not returned. A paid result carries `value`, `amount` (what was
charged), `payer` and `transaction`. An `amount` above `maxPrice` throws.

## Fees

| | P2Flux fee |
|---|---|
| Pay-per-request | 1%, at least 0.003 USDC |
| Prepaid | 3% |

The fee is split out on chain. There is no free tier.

## From test to live

1. Run the whole cycle on `https://api-test.p2flux.com` first: a request without payment gets 402, an
   agent with test USDC pays, the repeat gets 200 with `PAYMENT-RESPONSE`. The
   [P2Flux MCP server](https://p2flux.com/docs/mcp.html) can play the agent.
2. Set `recipient` to a mainnet wallet **you control**. Payments to it are final.
3. Set `apiUrl` to `https://api.p2flux.com`.
4. Decide `onUnavailable` on purpose.
5. Check `price` per route: real USDC from here on.

More: [AI agent payments](https://p2flux.com/docs/agents.html) on p2flux.com, including the
facilitator for the official x402 packages.
