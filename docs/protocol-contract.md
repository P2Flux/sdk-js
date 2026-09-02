# @p2flux/sdk — call and result contract

A thin client over the P2Flux HTTP API: it normalizes result codes and nothing else — no
scheduling, no storage, no retry loops. **Your application owns the subscription lifecycle**;
P2Flux executes the payment when you say so. Production API: `https://api.p2flux.com`
(Base Mainnet, real money). Test API: `https://api-test.p2flux.com` (Base Sepolia). Full protocol
documentation lives at [p2flux.com/docs](https://p2flux.com/docs/) and the canonical
[OpenAPI specification](https://p2flux.com/openapi.json) — this file only states what this client
itself guarantees.

## Scope

The **complete public V1 merchant/server API** — the same 18 operations as the PHP SDK
(`p2flux/p2flux-php`), guarded by a checked-in parity test in both repositories
(`test/parity.test.ts` here). The buyer-side wallet experience is the hosted checkout
(`https://pay.p2flux.com`), not an SDK.

## The calls

| Method | Notes |
|---|---|
| `createPayment(terms)` | `{recipient, amount}` → signed intent plus the `pay` block a checkout needs. |
| `resolvePayment(intent)` | Authoritative display terms, read back from the intent. |
| `verifyPayment(intent, txHash, receipt?)` | The trust boundary. Returns a **discriminated union on `valid`** — a rejected payment is a 200-level verdict with a `code`, never an exception. The optional settlement receipt lets the server answer without re-reading the chain; a bad one silently falls back to full verification. |
| `recoverPayment(intent)` | Finds a settlement whose tx hash was lost. Not-found and confirming are results, not exceptions. |
| `createSubscription(terms)` | `{recipient, amount, period}` (seconds) → setup token + the `salt` that ties a returned capability to this checkout. |
| `resolveSubscription(setupToken)` | Terms plus the exact EIP-712 `typedData` the customer signs. |
| `finalizeSubscription(setupToken, payer, signature)` | Signature → the `p2s2.` charge capability. |
| `charge(ref)` | Returns a `ChargeResult`; **never throws** — even an unreachable API is `NETWORK_ERROR` / `RETRY_LATER`. |
| `recoverCharge(ref, periodIndex, hint?)` | The transaction that charged one EXACT period, for when `ALREADY_CHARGED` left you a paid period with no hash. Not-found is ordinary (no catch-up billing means a skipped period is normal history) and confirming keeps its hash; both are results, not exceptions. A `hint` narrows the search and is never evidence. |
| `status(ref)` | Period, due-ness, allowance, revocation — read from chain. Echoes the signed `terms`; check them (and the `salt`) against what you sold before activating anything. |
| `createCancellationSession(ref)` | Cancel token for the hosted cancel page — the capability never reaches a browser. |
| `prepareSubscriptionCancellation(ref)` | Calldata for the customer's own `revoke()`. |
| `prepareAllowanceRevocation()` | Calldata for the global allowance stop. |
| `createAllowanceRestoreSession(ref)` / `resolveAllowanceRestore(token)` | `INSUFFICIENT_ALLOWANCE` is not a dead subscription: the signed authorization is intact and one `approve()` fixes it. The session is the narrowest token P2Flux issues — it cannot charge, revoke or refund — and opens `#/approve/<approveToken>`. |
| `prepareRefund(original, amountUnits)` / `resolveRefund(refundToken)` / `verifyRefund(original, amountUnits, refundTxHash)` | Merchant-sent refunds, verified by P2Flux. |

The two `prepare*` calls return unsigned calldata. P2Flux cannot revoke wallet authority and does
not pretend to: only the payer's wallet can send those transactions.

## Result handling

Every charge returns one `status` plus an `action` telling you what to do about it — `SUCCESS`,
`WAIT` (money moved, poll the same question, never re-send), `RETRY_LATER`,
`CUSTOMER_ACTION_REQUIRED`, `STOP_SUBSCRIPTION`, `INVALID_REQUEST`. `ok` is true for `CHARGED`
and `ALREADY_CHARGED` — branch on `ok` first; treating `ALREADY_CHARGED` as a failure is the
classic integration bug, and it is exactly what a retry after a timeout returns.

The `ACTIONS` map in `src/index.ts` is the complete list the client knows; anything unknown maps
to `RETRY_LATER`. The authoritative catalogue with per-code guidance is the
[errors page](https://p2flux.com/docs/errors.html).

## The checkout handoff (subscriptions)

This client's job ends at HTTP; the hosted checkout talks to your PAGE by `postMessage`. After
`p2flux.subscription.created` delivers the capability, your page attempts the first charge with
`charge()` and must answer the still-open popup: `p2flux.finalized` (optional `txHash` as
`tx_hash`) on success, `p2flux.activation_failed` with a bare CODE for failures your renewal job
will not quietly recover — the `ChargeResult.action` already makes the split
(`CUSTOMER_ACTION_REQUIRED` and `STOP_SUBSCRIPTION` are worth reporting; for
`RETRY_LATER`/`WAIT` send nothing). The checkout owns all customer-facing wording. Full protocol:
[p2flux.com/docs/subscriptions.html#handoff](https://p2flux.com/docs/subscriptions.html#handoff).

## Storing the reference

The `p2s2…` string is bearer authorization for charging that one subscription. Keep it in your
existing subscription record, server-side. Never put it in HTML, a URL, analytics or application
logs; encrypt at rest where your stack makes that practical.
