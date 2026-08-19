# @p2flux/sdk

Zero-dependency JavaScript/TypeScript client for the P2Flux payments API. One file, no runtime
dependencies, `fetch` injectable for tests and for hosts with their own HTTP stack.

This repository is the **canonical source** for the JS SDK.

```bash
npm install github:P2Flux/sdk-js#v0.1.0     # not on npm yet
```

```ts
import { createP2Flux } from '@p2flux/sdk'

const p2flux = createP2Flux({ apiUrl: 'https://api.p2flux.example', timeoutMs: 30_000 })

const result = await p2flux.charge(ref)   // never throws; inspect result.status / result.action
const state  = await p2flux.status(ref)   // throws P2FluxError on a bad reference
const cancel = await p2flux.prepareSubscriptionCancellation(ref)
const stop   = await p2flux.prepareAllowanceRevocation()
```

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

[`examples/`](examples/) — a renewal worker, a single charge with every branch handled, and
cancellation.

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
