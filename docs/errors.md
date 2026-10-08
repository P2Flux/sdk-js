# Errors and retries

Two shapes, and the difference matters:

- **`charge()` never throws on a payment outcome.** It returns a `ChargeResult`; "the customer has
  no funds" is an answer, not an error.
- **Everything else throws `P2FluxError`**, carrying `status` (the protocol code), `action` (what to
  do about it) and `raw` (the API body). `verifyPayment()`, `recoverPayment()` and `recoverCharge()`
  are the deliberate exceptions: their rejections and misses are answers, not throws.

**Classify on `action`, never on `status`.** A code this client has never seen maps to
`RETRY_LATER`, which is the safe default; a `switch` on status alone breaks the day the API grows a
code.

## What to do

| You got | Do |
|---|---|
| `action: 'SUCCESS'` with `txHash` | Mark paid. |
| `action: 'SUCCESS'` without `txHash` (`ALREADY_CHARGED`) | Mark the period collected; `recoverCharge()` for the settlement before you attribute or refund. |
| `action: 'WAIT'` (`CONFIRMING`, `PAYMENT_CONFIRMING`, `REFUND_CONFIRMING`) | Poll the same hash. Never a failure, never a second transaction. |
| `action: 'RETRY_LATER'` | Nothing was spent. Retry the identical call later, on a bounded schedule. Honour `retryAfter` on 429s. |
| `RATE_LIMITED` on a payment whose network fee is paid in USDC | The buyer wallet reached its sponsored-transaction limit (10 per rolling hour, 20 per rolling day, across all merchants). Nothing was spent. Retry after `retryAfter`, or let the buyer pay the network fee with ETH. |
| `NOT_DUE` | Retry at `nextPeriodAt`, not before. |
| `action: 'CUSTOMER_ACTION_REQUIRED'` | `INSUFFICIENT_BALANCE`: bounded dunning. `INSUFFICIENT_ALLOWANCE`: the approve flow; retrying alone cannot fix it. |
| `action: 'STOP_SUBSCRIPTION'` | Stop billing. The customer must authorize again to resume. |
| `action: 'INVALID_REQUEST'` | Do not retry. Fix the stored reference or the request. |
| `P2FluxError` with `NETWORK_ERROR` | The request never reached the API. Retry; treat as unknown, not as declined. |


## Recipes

Each one is a real situation, what it means, and the only safe move.

### The API was unreachable

A thrown `P2FluxError` with `NETWORK_ERROR`, or — from `charge()` — a result carrying it. A timeout
looks identical: `timeoutMs` aborts the request, it does not cancel the operation.

**The answer is "unknown", never "declined".**

```ts
try {
  const verdict = await p2flux.verifyPayment(intent, txHash)
} catch (error) {
  // Reads are free to repeat: verification changes nothing.
  return retryLater(error instanceof P2FluxError ? error.status : 'NETWORK_ERROR')
}
```

Retry reads immediately. For a write that may have landed, ask again rather than sending a second
one — [Recovery](recovery.md#after-an-ambiguous-request) has the table per operation. Never cancel a
subscription on this.

### The request was invalid

`action: 'INVALID_REQUEST'` — `INVALID_REQUEST`, `AMOUNT_OUT_OF_BOUNDS`, `PERIOD_OUT_OF_BOUNDS`,
`TERMS_MISMATCH`, `INVALID_SUBSCRIPTION`, a malformed or expired token.

**Do not retry.** The same call returns the same answer forever. An expired token needs a new one —
but expiry never makes an existing settlement unverifiable, so check [Recovery](recovery.md) before
assuming nothing happened.

### `RATE_LIMITED`

Infrastructure protection: refused before anything could move. Two different limits wear this code.

| Where | Who is limited | What to do |
|---|---|---|
| Ordinary calls | Per IP and per subscription | Back off, honour `retry_after` in `raw`, repeat the identical call |
| A payment whose network fee is paid in USDC | Per **buyer wallet**: 10 per rolling hour, 20 per rolling day, across all merchants | Tell the buyer to try later, or offer the ordinary path where their wallet holds ETH |

Nothing was spent either way, and your `charge()` calls are never counted against the buyer limit.

### `CONCURRENCY_LIMIT`

Too many simultaneous requests about the same subject — usually one of your own workers racing
another over the same subscription. Serialize per subscription, then repeat the identical call.

### Payment links

| Code | Meaning | Move |
|---|---|---|
| `INVALID_LINK` | Not a link this deployment signed, or a link used where its manage token belongs | Use the `link` or `manage` token exactly as `createPaymentLink()` returned it |
| `LINK_EXPIRED` | The link's date has passed | Create a new link. Payments made before stay valid; subscriptions already signed keep being collected. |
| `LINK_UNAVAILABLE` | This deployment does not offer that kind of link, the contract it was made for was replaced, or the subscription store is full (`reason`) | Create a new link, or use a direct payment |
| `ALREADY_SUBSCRIBED` | This wallet already has a live subscription through this link | Nothing to do - the buyer manages it from the link |

### Sanctions screening

Nothing was submitted when either code is returned. Show buyers a neutral message such as "This
wallet cannot be used with P2Flux. No transaction was submitted." - do not explain the rule.

| Code | Meaning | What to do |
|---|---|---|
| `PAYER_SANCTIONED` | The paying wallet is on the U.S. OFAC list, or restricted by the token issuer | Stop charging that subscription; do not retry with this wallet |
| `RECIPIENT_SANCTIONED` | The receiving (merchant) wallet is on the U.S. OFAC list: nothing is created for it or sent to it | Do not retry - the answer is the same; check the configured wallet |

### Sponsorship is unavailable

| Code | Meaning | Move |
|---|---|---|
| `PAYMENT_TOKEN_GAS_UNSUPPORTED` | This deployment does not sponsor that token or operation | Fall back to `'native'`. A fact about the deployment: retrying cannot change it. Check `capabilities()` first and the buyer never sees it. |
| `PAYMENT_TOKEN_GAS_UNAVAILABLE` | Temporarily off | Retry later, or offer the native path now |
| `PAYMENT_TOKEN_GAS_LIMIT_EXCEEDED` | An operator-side ceiling | Retry later |
| `INSUFFICIENT_PAYMENT_TOKEN_FOR_GAS` | The wallet cannot cover price plus network fee | The buyer tops up |
| `SPONSORSHIP_CONFIRMING` | In flight | Look the settlement up. Never send another. |

```ts
const caps = await p2flux.capabilities()
const usdc = caps.tokens.find((token) => token.symbol === 'USDC')
const mode = usdc?.gasPaymentModes.includes('payment_token') ? 'payment_token' : 'native'
```

### The gas price moved

`PAYMENT_TOKEN_GAS_QUOTE_EXPIRED` — the quoted network fee is stale, so the signature no longer
matches what it would cost. Only the buyer can fix it: requote and sign again, which the hosted
checkout does for them.

`GAS_TOO_HIGH`, `GAS_FEE_TOO_HIGH`, `GAS_QUOTE_UNAVAILABLE` on a recurring charge — gas could not be
priced, or rose above what the subscription authorized. **Nothing was spent and the subscription is
untouched.** Retry later on a bounded schedule; there is nothing for the customer to do.

### It already happened

| Code | Where | What it means |
|---|---|---|
| `ALREADY_CHARGED` | `charge()` | Success. The period is collected. No `txHash` — [recover it](recovery.md#a-lost-recurring-charge) to attribute or refund it. |
| `PAYMENT_ALREADY_PROCESSED` | one-time payments | The intent is settled. Verify it rather than creating another. |
| `ALREADY_SETTLED` | sponsored operations | A repeat of a request that already worked. Not an error. |

The mistake to avoid is treating any of these as a failure and issuing a second operation.

### The response never arrived

See [Recovery: after an ambiguous request](recovery.md#after-an-ambiguous-request). In short: read
again, never write again — except `charge()`, whose repeat is itself the safe read.

## Codes by action

Straight from the `ACTIONS` map in `src/index.ts` — the complete list this client knows. Anything
unknown maps to `RETRY_LATER`.

| `action` | Codes |
|---|---|
| `SUCCESS` | `CHARGED`, `ALREADY_CHARGED`, `REFUNDED` |
| `WAIT` | `CONFIRMING`, `PAYMENT_CONFIRMING`, `REFUND_CONFIRMING`, `SPONSORSHIP_CONFIRMING` |
| `RETRY_LATER` | `PAYMENT_NOT_FOUND`, `PAYMENT_RECOVERY_INCONSISTENT`, `RECOVERY_UNAVAILABLE`, `NOT_DUE`, `RPC_ERROR`, `RELAYER_ERROR`, `TRANSACTION_REVERTED`, `INTERNAL_ERROR`, `NETWORK_ERROR`, `RATE_LIMITED`, `CONCURRENCY_LIMIT`, `GAS_TOO_HIGH`, `GAS_QUOTE_UNAVAILABLE`, `GAS_FEE_TOO_HIGH`, `RELAYER_TX_COST_TOO_HIGH`, `RELAYER_BUDGET_EXCEEDED`, `RELAYER_NOT_READY`, `RPC_BUSY`, `TRANSACTION_NOT_FOUND`, `PAYMENT_TOKEN_GAS_UNAVAILABLE`, `PAYMENT_TOKEN_GAS_LIMIT_EXCEEDED`, `SPONSORED_TRANSACTION_FAILED`, `SPONSORED_PERMIT_FAILED` |
| `CUSTOMER_ACTION_REQUIRED` | `INSUFFICIENT_BALANCE`, `INSUFFICIENT_ALLOWANCE`, `SIGNATURE_VALIDATION_TOO_EXPENSIVE`, `PAYMENT_TOKEN_GAS_QUOTE_EXPIRED`, `INSUFFICIENT_PAYMENT_TOKEN_FOR_GAS` |
| `STOP_SUBSCRIPTION` | `PERMISSION_REVOKED`, `SUBSCRIPTION_EXPIRED`, `PAYER_SANCTIONED` |
| `INVALID_REQUEST` | `REFUND_AMOUNT_INVALID`, `REFUND_WRONG_MERCHANT`, `REFUND_TRANSACTION_MISMATCH`, `REFUND_ORIGINAL_PAYMENT_INVALID`, `INVALID_REFUND_TOKEN`, `REFUND_TOKEN_EXPIRED`, `INVALID_SUBSCRIPTION`, `INVALID_REQUEST`, `AMOUNT_OUT_OF_BOUNDS`, `PERIOD_OUT_OF_BOUNDS`, `INVALID_INTENT`, `INTENT_EXPIRED`, `INVALID_REFERENCE`, `INVALID_SETUP_TOKEN`, `SETUP_TOKEN_EXPIRED`, `INVALID_CANCEL_TOKEN`, `CANCEL_TOKEN_EXPIRED`, `TERMS_MISMATCH`, `PERMISSION_NOT_FOUND`, `INVALID_SIGNATURE`, `UNSUPPORTED_SIGNATURE_FORMAT`, `WRONG_SPENDER`, `WRONG_TOKEN`, `INVALID_EXTRA_DATA`, `PAYMENT_ALREADY_PROCESSED`, `PAYMENT_TOKEN_GAS_UNSUPPORTED`, `INVALID_GAS_QUOTE`, `INVALID_LINK`, `LINK_EXPIRED`, `LINK_UNAVAILABLE`, `ALREADY_SUBSCRIBED`, `RECIPIENT_SANCTIONED` |

The authoritative catalogue with per-code guidance is the
[errors page](https://p2flux.com/docs/errors.html).

### Who acts, at a glance

| `action` | Who | When |
|---|---|---|
| `SUCCESS` | you | Mark it paid |
| `WAIT` | nobody | Poll the same hash; change nothing |
| `RETRY_LATER` | your scheduler | Bounded retry of the identical call |
| `CUSTOMER_ACTION_REQUIRED` | the customer | Top up, approve again, or requote |
| `STOP_SUBSCRIPTION` | you | Stop billing; it is final |
| `INVALID_REQUEST` | a human | Fix the call; retrying is pointless |

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


## Next

- [Recovery](recovery.md) · [Testing](testing.md) — a canned response per code above
- [Production checklist](production-checklist.md)
