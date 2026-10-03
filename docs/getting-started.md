# Getting started

The P2Flux JavaScript SDK is a thin client over the P2Flux HTTP API: it normalizes result codes and
nothing else. No scheduler, no storage, no retry loops — your application owns all three.

- [Install](#install)
- [The words](#the-words)
- [Your first call](#your-first-call)
- [Configuration](#configuration)
- [Environments](#environments)
- [Where to go next](#where-to-go-next)

## Install


Any runtime with a global `fetch` — Node 18 or newer, Deno, Bun, Cloudflare Workers — or pass your
own `fetch`. ESM only, TypeScript types included, no runtime dependencies.

```bash
npm install @p2flux/sdk
```

### Basic client

```ts
import { createP2Flux } from '@p2flux/sdk'

const p2flux = createP2Flux({
  apiUrl: 'https://api-test.p2flux.com',   // see Environments
  timeoutMs: 30_000,                        // default 60 000
})
```

`timeoutMs` defaults to 60 seconds because a charge waits for on-chain confirmation, which can take
tens of seconds on a busy public RPC. A timed-out charge is safe: the next call answers
`ALREADY_CHARGED`.

### Your own `fetch`

Pass `fetch` to route requests through your own HTTP stack, or to stub the API in tests. It receives
exactly what the global `fetch` would.

```ts
const p2flux = createP2Flux({ apiUrl, fetch: myInstrumentedFetch })
```

## The words

P2Flux's vocabulary, once, so the rest of the documentation reads plainly.

| Term | What it is |
|---|---|
| **intent** | A signed one-time payment: recipient, amount, reference, all fixed. `createPayment()` mints it, `verifyPayment()` checks a transaction against it. |
| **reference** | The on-chain identifier inside an intent. P2Flux generates it; keep your own order id beside it. |
| **hosted checkout** | The page at `pay.p2flux.com` where the buyer's wallet does the work. Not part of this SDK; `checkoutLink()` builds the address that opens it. Large merchants can [host it themselves](https://p2flux.com/docs/self-hosted-checkout.html). |
| **settlement receipt** | A short-lived sealed token proving a verification already happened. Passing it back makes a repeat verify instant. |
| **setup token** | A signed set of subscription terms, valid fifteen minutes, that the checkout turns into a capability. |
| **salt** | Identifies one exact setup. Compare it in `status()` to prove a capability came from the setup you created. |
| **capability** (`p2s2…`) | The bearer credential that charges a subscription. Server-side only — see [Server and browser](server-and-browser.md). |
| **period** | One billing interval, in seconds. The contract allows one charge per period, which is what makes retries safe. |
| **allowance** | The ERC-20 permission the customer grants. It can run out without the subscription being dead. |
| **sponsorship** | P2Flux sending the transaction for a buyer with no ETH, who reimburses the network fee in USDC. |
| **base units** | Integer USDC: 1 USDC = 1 000 000. Every `…Units` field is one of these. |

## Your first call

`capabilities()` needs no credentials and moves no money — the quickest proof your client reaches
the API.

```ts
import { createP2Flux } from '@p2flux/sdk'

const p2flux = createP2Flux({ apiUrl: 'https://api.p2flux.com' })

const caps = await p2flux.capabilities()
console.log(caps.chainId)              // 8453 on Base Mainnet
console.log(caps.tokens[0]?.symbol)    // USDC
```

## Configuration

**There is no API key.** V1 has no API authentication: a payment is bound to an exact recipient,
amount and period by the customer's own signature, and the contract refuses a second charge in a
period. What you configure is which deployment to talk to.

| Option | |
|---|---|
| `apiUrl` | Required. The deployment to talk to. |
| `timeoutMs` | Optional, default 60 000. |
| `fetch` | Optional. Your own HTTP stack, or a stub in tests. |
| `checkoutUrl` | Optional. Where buyers open the checkout. Default: the hosted checkout of the API you use. Set it when you [host the checkout yourself](https://p2flux.com/docs/self-hosted-checkout.html). |

Open the checkout with the link `checkoutLink()` builds:

```ts
const p2flux = createP2Flux({ apiUrl: 'https://api.p2flux.com' })
const intent = await p2flux.createPayment({ recipient, amount: '25.00' })
const link = p2flux.checkoutLink('pay', intent.intent) // https://pay.p2flux.com/#/pay/…
```

## Environments

| | API | Hosted checkout | Chain |
|---|---|---|---|
| Test | `https://api-test.p2flux.com` | `https://pay-test.p2flux.com` | Base Sepolia (84532), faucet USDC |
| Production | `https://api.p2flux.com` | `https://pay.p2flux.com` | Base Mainnet (8453), real USDC |

Both environments support paying the network fee in USDC — see the section below.

The two are separate deployments with separate signing keys. **Every token — intent, setup token,
capability, cancel token, refund token, approve token — is bound to the deployment that issued it**
and is refused by the other one. An integration that lets a test-environment capability reach a
production client (or the reverse) gets `INVALID_SUBSCRIPTION`, never a charge on the wrong chain.

Store the environment alongside every order and subscription you create, and build the client for
that stored environment when you verify, charge, recover or refund it later.
