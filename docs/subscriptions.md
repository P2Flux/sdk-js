# Subscriptions

Runnable: [`examples/subscription-signup.ts`](../examples/subscription-signup.ts),
[`examples/charge-subscription.ts`](../examples/charge-subscription.ts),
[`examples/renewal-worker.ts`](../examples/renewal-worker.ts),
[`examples/cancel.ts`](../examples/cancel.ts).

## How it fits together

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

// Optional: bound the standing allowance the checkout asks for. The default is unlimited, which
// means renewals never need the wallet again. `{ periods: 12 }` asks for twelve charges' worth
// and your restore flow (below) asks again when it runs out; 'until_end' needs an `end` date.
// const setup = await p2flux.createSubscription({ ..., allowance: { periods: 12 } })
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
[errors page](errors.md).


## Recovering a lost charge

`ALREADY_CHARGED` proves a period was collected and names no transaction. Without it a paid period
cannot be attributed, audited or refunded — both refund calls start from the original settlement.
`recoverCharge(capability, periodIndex)` finds it. See [Recovery](recovery.md).

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


## Next

- [Recovery](recovery.md) · [Errors and retries](errors.md) · [Refunds](refunds.md)
- [Server and browser](server-and-browser.md) — where the capability may and may not go
