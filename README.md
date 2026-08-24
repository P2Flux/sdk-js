# @p2flux/sdk

Zero-dependency JavaScript/TypeScript client for the P2Flux payments API. One file, no runtime
dependencies, `fetch` injectable for tests and for hosts with their own HTTP stack.

This repository is the **canonical source** for the JS SDK.

```bash
npm install github:P2Flux/sdk-js#v0.4.0     # not on npm yet
```

## Scope

This client covers the **complete public V1 merchant/server API** — the same surface as the PHP
SDK (`p2flux/p2flux-php`). One-time payments, verification with settlement receipts, lost-payment
recovery, subscription setup / finalize / charge / status, cancellation, allowance revocation and
refunds are all first-class typed methods: no raw REST calls are needed for a normal integration.
The buyer-side wallet experience is the hosted checkout, not an SDK.

Production API: `https://api.p2flux.com` (Base Mainnet — **real money**). Test:
`https://api-test.p2flux.com` (Base Sepolia, faucet USDC — integrate here first).

```ts
import { createP2Flux } from '@p2flux/sdk'

const p2flux = createP2Flux({ apiUrl: 'https://api.p2flux.com', timeoutMs: 30_000 })

// One-time: create → hosted checkout → verify
const payment = await p2flux.createPayment({ recipient: merchantWallet, amount: '12.50' })
sendBuyerTo(`https://pay.p2flux.com/#/pay/${payment.intent}`)
const verdict = await p2flux.verifyPayment(payment.intent, txHash)
if (verdict.valid) markPaid(verdict.txHash, verdict.settlementReceipt)

// Recurring: create → hosted checkout authorizes → finalize → charge from YOUR renewal job
const setup = await p2flux.createSubscription({ recipient: merchantWallet, amount: '5.00', period: 30 * 24 * 3600 })
const sub = await p2flux.finalizeSubscription(setup.setupToken, payer, signature)
const result = await p2flux.charge(sub.subscription)   // never throws; inspect status / action
```

### Method ↔ operation map

| Operation | Method | PHP equivalent |
|---|---|---|
| `POST /v1/payments` | `createPayment` | `createPayment` |
| `POST /v1/payments/resolve` | `resolvePayment` | `resolvePayment` |
| `POST /v1/payments/verify` | `verifyPayment` | `verifyPayment` |
| `POST /v1/payments/recover` | `recoverPayment` | `recoverPayment` |
| `POST /v1/subscriptions` | `createSubscription` | `createSubscription` |
| `POST /v1/subscriptions/resolve` | `resolveSubscription` | `resolveSubscription` |
| `POST /v1/subscriptions/finalize` | `finalizeSubscription` | `finalizeSubscription` |
| `POST /v1/charges` | `charge` | `charge` |
| `POST /v1/subscriptions/status` | `status` | `status` |
| `POST /v1/subscriptions/revoke/session` | `createCancellationSession` | `createCancellationSession` |
| `POST /v1/subscriptions/revoke/prepare` | `prepareSubscriptionCancellation` | `prepareSubscriptionCancellation` |
| `POST /v1/allowances/revoke/prepare` | `prepareAllowanceRevocation` | `prepareAllowanceRevocation` |
| `POST /v1/refunds/prepare` | `prepareRefund` | `prepareRefund` |
| `POST /v1/refunds/resolve` | `resolveRefund` | `resolveRefund` |
| `POST /v1/refunds/verify` | `verifyRefund` | `verifyRefund` |

`/health` is an operational liveness endpoint, not a merchant operation; `/metrics` and `/ready`
are loopback-only. None of the three belongs in an SDK.

**Parity is tested, not promised.** `test/parity.test.ts` holds the checked-in list of all 15
public V1 merchant operations and fails if any stops being reachable through the SDK; the PHP SDK
and P2Flux/core carry the same guard. A new public operation added to the API turns every list
red until both SDKs support it.

## The one rule worth knowing

**`charge()` never throws on a payment outcome.** "The customer has no funds" is an answer, not an
error, so every outcome comes back as a result you switch on. Only transport-level surprises are
exceptional, and even those arrive as `NETWORK_ERROR` / `RETRY_LATER` rather than as a verdict —
because an unreachable API tells you nothing about whether the charge landed, and treating it as a
decline would let you cancel a subscription that just paid.

Act on `action`, not on `status`, unless you need the detail:

| action | meaning |
|---|---|
| `SUCCESS` | paid — `ok` is true for both `CHARGED` and `ALREADY_CHARGED` |
| `WAIT` | broadcast and confirming; the money moved, do not re-charge |
| `RETRY_LATER` | transient — capacity, a busy chain, an unreachable API |
| `CUSTOMER_ACTION_REQUIRED` | they must top up or re-approve; do not cancel |
| `STOP_SUBSCRIPTION` | revoked or expired on chain; final |

`alreadyPaid` exists so a retry that races an earlier success is not a double charge: the second
call returns `ALREADY_CHARGED`, `ok: true`. Retrying is always safe.

The full result contract, including every status code, is in
[`docs/protocol-contract.md`](docs/protocol-contract.md).

## Examples

[`examples/`](examples/) — a one-time payment end to end (`one-time.ts`), a subscription from
setup to cancellation (`subscription-setup.ts`), a refund (`refund.ts`), a renewal worker, a
single charge with every branch handled, and cancellation.

## A lost callback is recoverable

If your checkout window dies between the wallet returning a transaction hash and your server
recording it, the payment happened and your order looks unpaid. `recoverPayment` finds it again from
the intent alone:

```js
const recovered = await p2flux.recoverPayment(intent)
if (recovered.found && recovered.valid) markPaid(recovered.txHash)
else if (recovered.found) pollAgainLater()          // still confirming; you have the hash now
else keepWaiting()                                   // nothing settled AS OF recovered.asOfBlock
```

You supply the intent and nothing else — no hash, no hint. The match is bound to the exact payment
that intent describes, so it can never return somebody else's transaction, and it works long after
the intent expired: expiry stops a payment being *started*, not one that already happened.

`PAYMENT_NOT_FOUND` is a statement about one block height, not a verdict. The contract does not
enforce your intent's expiry, so a slow wallet can still settle afterwards and a later call will
find it — stop polling on your own business rules, never on one not-found.

## Refunds are the merchant's transaction

A refund is a plain USDC transfer from your own wallet to the wallet that paid you. There is no
refund contract, no relayer and no P2Flux custody in the path: P2Flux charges no refund fee, returns
none of its original commission, and you pay the gas.

```js
const refund = await p2flux.prepareRefund({ intent, txHash }, '2500000')  // micro-USDC, integer
// -> open your checkout at #/refund/<refund.refundToken> so your wallet can send it
const result = await p2flux.verifyRefund({ intent, txHash }, '2500000', refundTxHash)
if (result.refunded) markRefunded()
else if (result.confirming) pollTheSameHashAgainLater()   // never send a second refund
```

`prepareRefund` derives the payer, the merchant, the token and the refundable maximum from the chain
— you supply identifiers and an amount, and nothing else. There is no way to name a recipient, which
is what keeps a refund from being a withdrawal.

**P2Flux keeps no refund history.** It cannot tell you whether a payment has already been refunded,
and calling `prepareRefund` twice will prepare two valid refunds. One refund per payment is your
integration's rule to enforce, and the safe place is *before* preparing: reserve the order row
atomically, then prepare. Reconciliation later uses `verifyRefund` with the original settlement, so
the short-lived `refundToken` never needs storing.

## Cancellation is the customer's transaction

P2Flux cannot revoke a customer's on-chain authority. `prepareSubscriptionCancellation()` and
`prepareAllowanceRevocation()` return calldata for the customer's own wallet to send — you surface
it, they sign it.

## Development

```bash
npm install
npm test          # offline: injected fetch, no API needed
npm run typecheck
npm run build     # -> dist/
```

`dist/` is committed on release tags so the package installs from a git tag without running install
scripts. It is build output; edit `src/`.

The full integration suite — the SDK driven against a real API — lives in the private P2Flux/core
repository, which pins this package by tag and exercises the published surface.

## License

MIT.
