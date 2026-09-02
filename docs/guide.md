# P2Flux JavaScript SDK — integration guide

`@p2flux/sdk` v0.6.0. A thin, zero-dependency client over the P2Flux HTTP API: it normalizes result
codes and nothing else. No scheduler, no storage, no retry loops — your application owns all three.

The PHP SDK (`p2flux/p2flux-php`, also v0.6.0) covers the identical public protocol surface. Both
SDKs share one version number from this release on, so "both at v0.6.0" means the same eighteen
operations, the same semantics and the same security model in both languages.

- [Installation](#installation)
- [Environments](#environments)
- [One-time payments](#one-time-payments)
- [Recurring subscriptions](#recurring-subscriptions)
- [Charge outcomes](#charge-outcomes)
- [Recovering a lost charge: `recoverCharge()`](#recovering-a-lost-charge-recovercharge)
- [Restoring an allowance](#restoring-an-allowance)
- [Cancellation and revocation](#cancellation-and-revocation)
- [Refunds](#refunds)
- [Security](#security)
- [Errors and retries](#errors-and-retries)
- [Migrating to v0.6.0](#migrating-to-v060)

## Installation

Any runtime with a global `fetch` — Node 18 or newer, Deno, Bun, Cloudflare Workers — or pass your
own `fetch`. ESM only, TypeScript types included, no runtime dependencies.

Not on npm yet. Install from the repository by tag, and pin the exact tag:

```bash
npm install github:P2Flux/sdk-js#v0.6.0
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

## Environments

| | API | Hosted checkout | Chain |
|---|---|---|---|
| Test | `https://api-test.p2flux.com` | `https://pay-test.p2flux.com` | Base Sepolia (84532), faucet USDC |
| Production | `https://api.p2flux.com` | `https://pay.p2flux.com` | Base Mainnet (8453), real USDC |

The two are separate deployments with separate signing keys. **Every token — intent, setup token,
capability, cancel token, refund token, approve token — is bound to the deployment that issued it**
and is refused by the other one. An integration that lets a test-environment capability reach a
production client (or the reverse) gets `INVALID_SUBSCRIPTION`, never a charge on the wrong chain.

Store the environment alongside every order and subscription you create, and build the client for
that stored environment when you verify, charge, recover or refund it later.

## One-time payments

```
your server           createPayment()            -> intent
buyer's browser       <checkout>/#/pay/<intent>  -> wallet sends the transaction
buyer's browser       postMessage to your page   -> a CLAIM: tx_hash, settlement_receipt
your server           verifyPayment()            -> the verdict that marks the order paid
```

```ts
// 1. Mint the intent. Store it on the order: you will need it to verify, and to recover.
const payment = await p2flux.createPayment({ recipient: merchantWallet, amount: '12.50' })
order.p2fluxIntent = payment.intent

// 2. Send the buyer to the hosted checkout. The intent rides in the URL FRAGMENT, which never
//    reaches a server log.
const url = `https://pay-test.p2flux.com/#/pay/${encodeURIComponent(payment.intent)}`

// 3. The checkout posts `p2flux.payment.completed { tx_hash, settlement_receipt }` to your page.
//    That message is a claim. Verify it on your server:
const verdict = await p2flux.verifyPayment(order.p2fluxIntent, txHash, settlementReceipt)

if (verdict.valid) {
  order.markPaid(verdict.txHash)                   // blockNumber, reference, amount also present
} else if (verdict.code === 'PAYMENT_CONFIRMING') {
  // On chain, not deep enough yet. Poll the SAME hash. Never ask the buyer to pay again.
} else {
  // Not a settlement of this intent. verdict.code says why.
}
```

`verifyPayment()` returns a discriminated union on `valid` — a rejected payment is a verdict with a
`code`, never an exception. Only transport failures throw.

The optional third argument, the settlement receipt the checkout couriered, lets the API answer a
repeat verification without re-reading the chain. A bad receipt silently falls back to the full
check.

### When the callback never arrives: `recoverPayment()`

```ts
const found = await p2flux.recoverPayment(order.p2fluxIntent)

if (found.found && found.valid) {
  order.markPaid(found.txHash)
} else if (found.found) {
  // Located but still confirming; found.txHash names it. Poll that hash.
} else {
  // PAYMENT_NOT_FOUND as of found.asOfBlock. Not a verdict: a slow wallet can still settle.
  // Ask again on your own schedule; never mint a second intent for the same order.
}
```

Intent expiry stops a payment being **started**; it never makes a settlement unverifiable. Keep
every intent you ever minted for an order.

## Recurring subscriptions

**P2Flux does not schedule anything.** It has no cron, no database and no idea when your renewal is
due. Your application decides when to collect and calls `charge()`; the contract enforces one
charge per billing period, so a retry after a timeout or a crash can never charge twice.

```
your server           createSubscription()           -> setupToken, salt
buyer's browser       <checkout>/#/subscribe/<token> -> approve USDC once, sign EIP-712 once
buyer's browser       postMessage `p2flux.subscription.created { subscription }`  -> the p2s2 capability
your server           status()   -> compare terms.salt / amount / recipient / period to what you sold
your server           store the capability, encrypted, server-side only
your server           charge()   -> the first period; then answer the popup (finalized / activation_failed)
your renewal job      charge()   -> every later period, when YOUR schedule says it is due
```

```ts
// Setup. `period` is in seconds. Keep the salt with the pending order.
const setup = await p2flux.createSubscription({ recipient: merchantWallet, amount: '5.00', period: 30 * 86400 })
pending.salt = setup.salt
const url = `https://pay-test.p2flux.com/#/subscribe/${encodeURIComponent(setup.setupToken)}`

// The checkout finalizes and posts the capability to your page. Before storing it, prove it is
// the subscription THIS order set up — a cryptographically valid capability can still be the wrong one.
const state = await p2flux.status(capability)
if (state.terms.salt !== pending.salt
  || state.terms.amountUnits !== pending.amountUnits
  || state.terms.recipient.toLowerCase() !== merchantWallet.toLowerCase()) {
  throw new Error('SETUP_MISMATCH')
}

// Store it encrypted, server-side. This is the ONE thing you keep; everything else is on chain.
subscription.p2fluxRef = encrypt(capability)
```

If you run your own checkout, `resolveSubscription(setupToken)` returns the terms plus the exact
EIP-712 `typedData`, and `finalizeSubscription(setupToken, payer, signature)` exchanges the signature
for the capability.

### The first charge and the checkout handoff

After `p2flux.subscription.created`, the popup is still open, telling the buyer the seller is
collecting the first charge. Your page attempts it server-side and **must answer**: post
`{ type: 'p2flux.finalized', tx_hash? }` on success, or `{ type: 'p2flux.activation_failed', code }`
for a failure your renewal job will not quietly recover. Send the bare CODE — the checkout composes
the sentence the buyer reads. `result.action` already makes the split: `CUSTOMER_ACTION_REQUIRED`
and `STOP_SUBSCRIPTION` are worth reporting; for `RETRY_LATER` and `WAIT` send nothing.

### If the handoff is lost

If the buyer's window dies after the handshake and the capability never reaches you, nothing
chargeable is orphaned — nobody holds it. Send the buyer back to the **same** subscribe link: every
term the on-chain id derives from, `start` and `salt` included, is fixed in the setup token, so
signing it again reproduces the same subscription rather than a second one. The checkout's waiting
screen offers the buyer the public subscription ID as a support reference; it never offers the
capability.

### Renewals

```ts
// Inside YOUR renewal job, when YOUR schedule says this subscription is due.
const result = await p2flux.charge(decrypt(subscription.p2fluxRef))

if (result.ok && result.txHash) renewal.markPaid(result.txHash)          // CHARGED
else if (result.ok) renewal.reconcile(result.periodIndex)                // ALREADY_CHARGED: see below
else if (result.status === 'CONFIRMING') renewal.stillConfirming(result.txHash)
else switch (result.action) {
  case 'RETRY_LATER': renewal.retryLater(); break
  case 'CUSTOMER_ACTION_REQUIRED': renewal.needsCustomer(result.status); break
  case 'STOP_SUBSCRIPTION': subscription.stop(result.status); break
  case 'INVALID_REQUEST': renewal.needsHuman(result.status); break
}
```

## Charge outcomes

`charge()` returns a `ChargeResult` and **never throws on a payment outcome**. Only transport-level
surprises are exceptional, and those come back as `NETWORK_ERROR` / `RETRY_LATER` rather than as a
verdict — an unreachable API says nothing about whether the charge landed.

| Property | Meaning |
|---|---|
| `status` | The protocol code: `CHARGED`, `ALREADY_CHARGED`, `CONFIRMING`, `NOT_DUE`, … |
| `action` | What your system should do. **Classify on this**, so a code you have never seen still lands in the right branch. |
| `ok` | `CHARGED` or `ALREADY_CHARGED`: the period is collected. |
| `alreadyPaid` | `ALREADY_CHARGED` specifically. |
| `retryable` | `action` is `RETRY_LATER` or `WAIT`. |
| `txHash` | The settling transaction, when this response carries one. |
| `periodIndex`, `nextPeriodAt` | Where the subscription is in its own schedule (`nextPeriodAt` is ISO 8601 UTC). |
| `raw` | The untouched API body. |

| `status` | `action` | What it means |
|---|---|---|
| `CHARGED` | `SUCCESS` | The money moved. `txHash` is present. The one result that pays a period outright. |
| `ALREADY_CHARGED` | `SUCCESS` | The period was already collected — the normal answer to a retry after a timeout. **No `txHash`**: P2Flux stores nothing. To attribute, audit or refund it you need the settlement, which `recoverCharge()` finds. |
| `CONFIRMING` | `WAIT` | Broadcast, not settled to the required depth. **Not final settlement.** Keep the period open, change nothing, ask again. Never send a second charge. |
| `NOT_DUE` | `RETRY_LATER` | The period has not opened. `nextPeriodAt` says when. |
| `INSUFFICIENT_BALANCE` | `CUSTOMER_ACTION_REQUIRED` | The wallet is short of USDC. The authorization is intact; retry after the customer tops up. |
| `INSUFFICIENT_ALLOWANCE` | `CUSTOMER_ACTION_REQUIRED` | The ERC-20 allowance no longer covers the charge. The authorization is intact; the customer needs one `approve()` — see [Restoring an allowance](#restoring-an-allowance). Retrying alone cannot fix it. |
| `PERMISSION_REVOKED` | `STOP_SUBSCRIPTION` | Revoked on chain. Permanent. |
| `SUBSCRIPTION_EXPIRED` | `STOP_SUBSCRIPTION` | Past the signed end date. Permanent. |
| `RPC_ERROR`, `RELAYER_ERROR`, `RATE_LIMITED`, `GAS_TOO_HIGH`, `NETWORK_ERROR`, … | `RETRY_LATER` | Infrastructure. Nothing was spent; the identical call is safe to repeat later. |
| `INVALID_SUBSCRIPTION`, `INVALID_REQUEST` | `INVALID_REQUEST` | Deterministic. Retrying returns the same answer forever; a human has to look. |

The complete `ACTIONS` map in `src/index.ts` is the list this client knows; anything unknown maps
to `RETRY_LATER`. The authoritative catalogue is the
[errors page](https://p2flux.com/docs/errors.html).

## Recovering a lost charge: `recoverCharge()`

```ts
const found = await p2flux.recoverCharge(capability, periodIndex, { attemptedAt })
```

`ALREADY_CHARGED` proves a period was collected and names no transaction. Without the transaction a
paid period cannot be attributed to an order, audited, or refunded — both refund calls start from the
original settlement. `recoverCharge()` finds it.

What it guarantees:

- **The exact `SubscriptionCharged` event is the proof.** A settlement is returned only when the
  contract's own log names this subscription AND this period, and its payer, recipient and amount
  match the signed authorization.
- **The contract's period marker is not proof.** `lastChargedPeriodPlusOne` is monotonic, so a marker
  of 7 says period 6 was collected and says *nothing* about period 5. Skipped periods are ordinary:
  there is no catch-up billing, so a period that was never collected is a normal history.
- **`periodIndex` is required and exact.** There is no "current period" form, because you are
  reconciling one specific collection — today, or a year from now — and the answer must not move
  under you. Take it from the charge result or from `status()`.
- **The hint only narrows the search.** `{ attemptedAt }` (unix seconds) or `{ block }` is where your
  own records say you attempted the charge. It can never turn a miss into a hit, and omitting it is
  always safe. Persist your attempt times; they turn a search over a whole billing period into one
  log query.

| Result | Meaning |
|---|---|
| `found: true` + `txHash`, `blockNumber`, `payer`, `recipient`, `netUnits`, `feeUnits`, `networkFeeUnits`, `amountUnits` | The settlement. Check `subscriptionId`, `periodIndex`, `recipient` and `amountUnits` against what you expected before you act on it. |
| `found: false`, `status: 'PAYMENT_NOT_FOUND'`, `asOfBlock` | No settlement for this period as of that block. Ordinary for a skipped period; a statement about one block height, never a permanent verdict. Returned, not thrown. |
| `status: 'PAYMENT_CONFIRMING'` | A settlement exists and is not deep enough to act on. `txHash` rides along; ask again about that same one. Returned, not thrown. |
| `RECOVERY_UNAVAILABLE` (503) | The search could not be completed within its bounded budget on this deployment. Retryable; throws `P2FluxError`. |
| `PAYMENT_RECOVERY_INCONSISTENT` (502) | A log exists and contradicts the signed terms. Rare and abnormal; throws. Never treat as a payment. |

### Long periods

A charge can land anywhere inside its period, and a period can be 366 days — about 15.8 million
blocks on Base, far more than one request may scan. The API bisects the contract's own marker over
historical state and reads one log range at the crossing block, so a yearly period costs about the
same as an hourly one. On an RPC provider that does not serve historical state it falls back to
scanning the period window under a bounded budget, and when even that cannot finish it answers
`RECOVERY_UNAVAILABLE` — never a wrong `found: true`.

## Restoring an allowance

`INSUFFICIENT_ALLOWANCE` is not a dead subscription. The authorization the customer signed is intact
and you can still collect; what ran short is the ERC-20 allowance, and the fix is one `approve()`
from the customer's own wallet — no new signature, no new subscription.

```ts
const session = await p2flux.createAllowanceRestoreSession(decrypt(subscription.p2fluxRef))
const url = `https://pay-test.p2flux.com/#/approve/${encodeURIComponent(session.approveToken)}`
// Open it for the customer. The checkout posts `p2flux.allowance.restored { tx_hash }` (or
// `{ already_sufficient: true }`), after which charge() the SAME capability again.
```

The `p2approve1` token is the narrowest P2Flux issues: the payer, the spender (the recurring
contract), the token and how much the next charge pulls. It carries no authorization struct and no
signature, so it cannot become a capability, cannot build `revoke()`, cannot prepare a refund and
cannot charge anything. It lives fifteen minutes.

`resolveAllowanceRestore(approveToken)` is the browser-side read the checkout uses to show the
terms; a merchant server has no reason to call it.

## Cancellation and revocation

Two different things, and a customer should be offered both:

- **Stop collecting.** Entirely in your hands: stop calling `charge()`. P2Flux needs no notification
  and has nothing to notify.
- **Revoke the on-chain authorization.** Only the payer's wallet can do this.
  `createCancellationSession()` exchanges the capability for a `p2cancel1` token that is safe to hand
  to a browser — it can build the customer's `revoke()` transaction and nothing else — and
  `<checkout>/#/cancel/<token>` walks the customer through sending it. Afterwards `charge()` answers
  `PERMISSION_REVOKED`.

`prepareSubscriptionCancellation()` and `prepareAllowanceRevocation()` return the unsigned calldata
for integrations that build their own wallet screen. The latter sets the allowance to zero and stops
**every** P2Flux subscription paid in that token from that wallet.

Never send the `p2s2` capability to a browser to arrange any of this. It can charge.

## Refunds

A refund is a plain USDC transfer from the merchant's own wallet to the wallet that paid. P2Flux
derives who and how much from the original settlement, and verifies the transfer afterwards; it
never holds the money, charges no fee and returns none of its original commission.

```ts
// 0. Enforce one-refund-per-payment BEFORE preparing: P2Flux keeps no refund history, so preparing
//    twice happily prepares two valid refunds. Reserve the order row atomically first.

// 1. Prepare. Amounts here are micro-USDC integer strings: 2.50 USDC is '2500000'.
const prep = await p2flux.prepareRefund({ intent, txHash: settlementHash }, '2500000')
// For a renewal: { subscription: capability, txHash, periodIndex: 3 }

// 2. The merchant's wallet sends the transfer, from the hosted page:
const url = `https://pay-test.p2flux.com/#/refund/${encodeURIComponent(prep.refundToken)}`
// The checkout posts `p2flux.refund.sent { tx_hash }` and `p2flux.refund.confirmed { tx_hash }`.

// 3. Verify against the ORIGINAL settlement, not the prepare token - so this works days later.
const verdict = await p2flux.verifyRefund({ intent, txHash: settlementHash }, '2500000', refundHash)
if (verdict.refunded) order.markRefunded(verdict.refundTxHash)
else if (verdict.confirming) { /* on chain, not settled. Poll the SAME hash. Never send another. */ }
```

Record the refund in your own system only after `refunded`.

## Security

- **`p2s2` is a bearer capability.** Whoever holds it can ask P2Flux to collect the customer's next
  period. It can only ever pay the recipient the customer signed for, so it is not a theft
  primitive — but it is the customer's standing permission, and it belongs server-side only.
- Never log it, never put it in HTML, never put it in a URL. The one protocol-defined exception is
  the hosted checkout's own `#/cancel/`, `#/approve/` and `#/refund/` routes, which take the narrow
  session tokens minted for the purpose — never the capability itself.
- Encrypt it at rest. Redact every P2Flux token prefix from anything you log.
- **Browser messages are claims.** `p2flux.payment.completed` and `p2flux.subscription.created` say
  what a wallet did; only your server's `verifyPayment()` / `status()` / `charge()` decides anything.
- Store the environment with every order, and use the stored one for every later call.
- There is no API authentication in v1: a payment is bound to an exact recipient, amount and period
  by the customer's signature, and the contract refuses a second charge in a period. The API
  rate-limits per IP and per subscription to protect itself.

## Errors and retries

| You got | Do |
|---|---|
| `action: 'SUCCESS'` with `txHash` | Mark paid. |
| `action: 'SUCCESS'` without `txHash` (`ALREADY_CHARGED`) | Mark the period collected; `recoverCharge()` for the settlement before you attribute or refund. |
| `action: 'WAIT'` (`CONFIRMING`, `PAYMENT_CONFIRMING`, `REFUND_CONFIRMING`) | Poll the same hash. Never a failure, never a second transaction. |
| `action: 'RETRY_LATER'` | Nothing was spent. Retry the identical call later, on a bounded schedule. Honour `retryAfter` on 429s. |
| `NOT_DUE` | Retry at `nextPeriodAt`, not before. |
| `action: 'CUSTOMER_ACTION_REQUIRED'` | `INSUFFICIENT_BALANCE`: bounded dunning. `INSUFFICIENT_ALLOWANCE`: the approve flow; retrying alone cannot fix it. |
| `action: 'STOP_SUBSCRIPTION'` | Stop billing. The customer must authorize again to resume. |
| `action: 'INVALID_REQUEST'` | Do not retry. Fix the stored reference or the request. |
| `P2FluxError` with `NETWORK_ERROR` | The request never reached the API. Retry; treat as unknown, not as declined. |

## Migrating to v0.6.0

**No change is required** for an existing integration. Every method that existed in v0.4.0 keeps its
name, arguments and return shape.

- The version jumps from 0.4.0 to 0.6.0. 0.5.0 was prepared and never published; from this release
  the JS and PHP SDKs share one version number, so that both at v0.6.0 means the same public
  protocol surface in both.
- New, opt-in: `recoverCharge()`, `createAllowanceRestoreSession()`, `resolveAllowanceRestore()`,
  with the `RecoveredCharge`, `ChargeRecoveryHint`, `AllowanceRestoreSession` and
  `AllowanceRestoreTerms` types.
