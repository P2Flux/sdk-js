# Refunds

Runnable: [`examples/refund.ts`](../examples/refund.ts).

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


`resolveRefund(refundToken)` is the browser-side read the hosted refund page uses; a merchant server
reconciles with `verifyRefund()`, which needs no token.

## Next

- [Errors and retries](errors.md) · [Recovery](recovery.md)
