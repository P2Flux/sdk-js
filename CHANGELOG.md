# Changelog

## 0.6.0 - 2026-09-02

Version 0.5.0 was never published: from this release the JS and PHP SDKs share one version number,
so that "both SDKs at v0.6.0" means the same public protocol surface in both.

### Added

- **`recoverCharge(ref, periodIndex, hint?)`** — the transaction that charged one recurring period.
  `ALREADY_CHARGED` proves a period was collected and names no transaction, so a worker that lost
  the first response held a paid period it could not attribute, audit or refund (refunds start from
  the original settlement). The period index is required and exact: reconciliation is about one
  specific collection, today or in a year. `found: false` is ordinary rather than an error — there
  is no catch-up billing, so a period that was never collected is normal history — and a settlement
  still confirming keeps its hash, the same rule `recoverPayment()` follows. The optional hint is
  where your own records say you attempted the charge; it narrows the search and is never evidence.
- **`createAllowanceRestoreSession(ref)`** and **`resolveAllowanceRestore(token)`** —
  `INSUFFICIENT_ALLOWANCE` is not a dead subscription: the authorization the customer signed is
  intact and they need one `approve()`. The session names the payer, the spender, the token and the
  amount, and can neither charge nor revoke nor refund. Open `<checkout>/#/approve/<approveToken>`,
  wait for `p2flux.allowance.restored`, then charge the SAME subscription again.

## 0.4.0 - 2026-08-24

Complete public V1 parity. Every merchant/server operation the API exposes is now a first-class
typed method — the former "renewal-job surface" scoping is gone, and no raw REST calls are needed
for a normal integration. Full parity with `p2flux/p2flux-php`.

### Added

- **One-time payments**: `createPayment` (signed intent + the `pay` block a checkout needs),
  `resolvePayment` (authoritative display terms), `verifyPayment` — returning a real discriminated
  union on `valid`, so TypeScript narrows: the confirmed branch carries `txHash`, block data and
  the `settlementReceipt` (present it on a repeat verify and the API answers without re-reading
  the chain); the negative branch carries a typed `code` + `action`, because `PAYMENT_CONFIRMING`
  or `TRANSACTION_REVERTED` are verdicts about the chain, not exceptions.
- **Subscription setup**: `createSubscription` (terms + setup token + the salt that ties a
  returned capability to this checkout), `resolveSubscription` (terms + the exact EIP-712
  `typedData` the customer signs), `finalizeSubscription` (signature → the `p2s2.` charge
  capability).
- **Cancellation**: `createCancellationSession` — the browser-safe cancel token, so the charging
  capability never has to reach a customer's browser.
- **Refunds**: `resolveRefund` — what a refund token authorizes, for the page that holds it.
- **Types**: `PaymentTerms`, `PaymentIntent`, `ResolvedPayment`, `PaymentVerification`,
  `SubscriptionTerms`, `SubscriptionSetup`, `ResolvedSubscription`, `FinalizedSubscription`,
  `CancellationSession`, `ResolvedRefund`. `ChargeStatus` now carries every public API error code,
  and the local action fallback covers the codes the API ships without an `action` (dead tokens →
  `INVALID_REQUEST`, `SIGNATURE_VALIDATION_TOO_EXPENSIVE` → `CUSTOMER_ACTION_REQUIRED`,
  `TRANSACTION_NOT_FOUND` → `RETRY_LATER`).
- **Parity guard**: `test/parity.test.ts` keeps the checked-in list of all 15 public V1 merchant
  operations and fails when any stops being reachable through the SDK. The PHP SDK and
  P2Flux/core carry the same list.
- **Examples**: `one-time.ts`, `subscription-setup.ts`, `refund.ts`.

### Fixed

- **`verifyRefund()` returned `undefined` for `txHash` and `amount` on every successful refund.**
  It read `tx_hash`/`amount` — the keys the *charge* response uses — while the verify response names
  them `refund_tx_hash`/`refund_amount`. Both are now populated.

### Changed

- **`REFUND_CONFIRMING` now arrives as HTTP 409 from the API** (previously 400). No change is
  required: the check is keyed on the error code, not the status, so a confirming refund is still
  returned as a result rather than thrown, and an older deployment answering 400 behaves identically.
