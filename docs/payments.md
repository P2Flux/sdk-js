# One-time payments

Runnable: [`examples/create-payment.ts`](../examples/create-payment.ts),
[`examples/verify-payment.ts`](../examples/verify-payment.ts).

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

## When the claim never arrives

The popup closes, the tab crashes, the connection drops — the buyer paid and your page never heard.
`recoverPayment(intent)` finds the settling transaction from the intent alone, and still works long
after the intent expired. See [Recovery](recovery.md).

## Next

- [The payment lifecycle](payment-flow.md) — the same flow with the browser half included
- [Paying the network fee in USDC](network-fee-in-usdc.md) · [Recovery](recovery.md)
- [Refunds](refunds.md) · [Errors and retries](errors.md)
