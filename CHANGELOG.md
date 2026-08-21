# Changelog

## Unreleased

### Fixed

- **`verifyRefund()` returned `undefined` for `txHash` and `amount` on every successful refund.**
  It read `tx_hash`/`amount` — the keys the *charge* response uses — while the verify response names
  them `refund_tx_hash`/`refund_amount`. Both are now populated.

### Changed

- **`REFUND_CONFIRMING` now arrives as HTTP 409 from the API** (previously 400). No change is
  required: the check is keyed on the error code, not the status, so a confirming refund is still
  returned as a result rather than thrown, and an older deployment answering 400 behaves identically.

### Known gap

- `createSubscription`, `createPayment`, `verifyPayment` and `createCancellationSession` exist in the
  PHP SDK but not here. Tracked as a separate API-surface decision; the documentation states the real
  per-SDK surface rather than promising them.
