# Paying the network fee in USDC

**Nothing is waived here.** The network fee is real, it is quoted before the buyer signs, and the
buyer pays it — in USDC rather than in ETH. P2Flux fronts the ETH and is reimbursed in the same
transaction.

Runnable: [`examples/create-sponsored-payment.ts`](../examples/create-sponsored-payment.ts),
[`examples/network-fee-in-usdc.ts`](../examples/network-fee-in-usdc.ts).

Live on Base Mainnet and Base Sepolia. A buyer holding USDC and no ETH signs a token authorization
instead of sending a transaction; P2Flux submits it and pays the Base network fee in ETH, and the
buyer pays that cost in USDC inside the same transaction. USDC is never converted, nothing is fronted
on credit, and settlement stays direct — your share moves from the buyer's wallet to yours in that
one transaction.

```ts
// Ask first. A token that implements the right standards on a network P2Flux has not deployed to
// reports false, and the request is refused with PAYMENT_TOKEN_GAS_UNSUPPORTED before a buyer sees
// anything.
const caps = await p2flux.capabilities()
const usdc = caps.tokens.find((t) => t.symbol === 'USDC')
const noEthPath = usdc?.gasPaymentModes.includes('payment_token') ?? false

const payment = await p2flux.createPayment({
  recipient: merchantWallet,
  amount: '12.50',
  gasPaymentMode: noEthPath ? 'payment_token' : 'native',
})
```

Everything else is unchanged: the same intent, the same hosted checkout URL, the same
`verifyPayment()`. The checkout prices the network fee, shows the buyer the total before anything is
signed, re-checks the price at the moment they click, and asks them to confirm if it moved. A wallet
that can pay its own gas is offered the ordinary path instead.

The verdict tells you how it was paid and names every figure, in USDC base units:

```ts
const verdict = await p2flux.verifyPayment(payment.intent, txHash)
if (verdict.valid && verdict.accounting) {
  verdict.gasPaymentMode      // 'payment_token' | 'native'
  verdict.accounting.buyerTotalUnits       // price + the quoted network fee, and nothing else
  verdict.accounting.merchantNetUnits      // price - 1% - the fixed 0.10 network fee
  verdict.accounting.paymentFeeUnits       // the 1%
  verdict.accounting.fixedNetworkFeeUnits  // 0.10 USDC, merchant-funded, as on a renewal
  verdict.accounting.networkFeeUnits       // quoted before the buyer signed; exactly what was charged
}
```

**Who funds what does not change.** The 1% and the fixed 0.10 USDC network fee come out of the
amount, exactly as a subscription collection works. The buyer is debited the price plus the quoted
network fee and nothing else.

**Subscriptions take the same path automatically.** A customer with no ETH can complete signup, and
repair or remove an allowance, from the hosted checkout — no change on your side, and no additional
fee, because a subscription already pays its fixed network fee on every collection.

**Per-wallet limits.** A buyer wallet may ask P2Flux to send at most 10 sponsored transactions in any
rolling hour and 20 in any rolling day, counted across every merchant and operation. Over that the
API answers `RATE_LIMITED` (HTTP 429) with `retryAfter` and nothing is spent; the checkout tells the
buyer to try later, or to pay the network fee with ETH where their wallet can. Your `charge()` calls
are never sponsored transactions and are never counted.

`capabilities()` also returns `sponsorContracts` — the contract carrying each operation. On Base
Mainnet: `P2FluxSponsoredSplitter` `0x95E18ec05D4282acB3aab7aD60325bA4EEeEa8df` for one-time
payments, `P2FluxGasSponsor` `0xD1DDAaa301403d18fD4A23Fc69493ef48af90285` for signup, allowance
restore and removal. Read them from the API rather than pinning constants.

Worked example: [`examples/network-fee-in-usdc.ts`](../examples/network-fee-in-usdc.ts).


## Next

- [Payments](payments.md) · [Errors and retries](errors.md)
