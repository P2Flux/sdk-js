# Changelog

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
