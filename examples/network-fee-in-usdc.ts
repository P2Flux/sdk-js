/**
 * A one-time payment a buyer can complete holding USDC and no ETH.
 *
 * The buyer signs a token authorization instead of sending a transaction; P2Flux submits it and
 * pays the Base network fee in ETH, and the buyer pays that cost in USDC inside the same
 * transaction. Your share still settles directly to your wallet. USDC is never converted to ETH.
 *
 * Production is real USDC on Base Mainnet. Point P2FLUX_API_URL at https://api-test.p2flux.com
 * (Base Sepolia, faucet money) while integrating.
 */
import { createP2Flux } from '@p2flux/sdk'

const p2flux = createP2Flux({ apiUrl: process.env.P2FLUX_API_URL ?? 'https://api.p2flux.com' })

// 1. Ask what this deployment supports. Architectural possibility is not support: a token that
//    implements the right standards on a network P2Flux has not deployed to reports false, and
//    every request for it is refused with PAYMENT_TOKEN_GAS_UNSUPPORTED.
const caps = await p2flux.capabilities()
const usdc = caps.tokens.find((token) => token.symbol === 'USDC')
const noEthPath = usdc?.gasPaymentModes.includes('payment_token') ?? false

console.log('chain', caps.chainId, '| network fee payable in USDC:', noEthPath)
if (usdc) console.log('sponsored contracts', usdc.sponsorContracts)

// 2. Create the payment. Without the field nothing changes: the buyer sends the transaction and
//    pays the network fee in ETH, exactly as before. This is opt-in, per payment.
const payment = await p2flux.createPayment({
  recipient: '0x1111111111111111111111111111111111111111', // example address - use your own wallet
  amount: '12.50',
  gasPaymentMode: noEthPath ? 'payment_token' : 'native',
})

// 3. The hosted checkout does the rest. It prices the network fee, shows the buyer the total before
//    anything is signed, re-checks the price at the moment they click, and asks them to confirm if
//    it moved. A wallet that can pay its own gas is offered the ordinary path instead.
console.log('send buyer to', `https://pay.p2flux.com/#/pay/${payment.intent}`)

// 4. Verify on your server, as always. The verdict now carries how it was paid and every figure.
const txHash = process.env.TX_HASH ?? '0x' // the checkout posts this to your page
const verdict = await p2flux.verifyPayment(payment.intent, txHash)

if (verdict.valid) {
  console.log('paid via', verdict.gasPaymentMode) // 'payment_token' or 'native'
  if (verdict.accounting) {
    const a = verdict.accounting // USDC base units: 1 USDC = 1_000_000
    console.log({
      buyerPaid: a.buyerTotalUnits, //  price + the quoted network fee, and nothing else
      youReceive: a.merchantNetUnits, //  price - 1% - the fixed 0.10 network fee (merchant-funded)
      p2fluxFee: a.paymentFeeUnits,
      fixedNetworkFee: a.fixedNetworkFeeUnits, //  0.10 USDC, out of the amount, as on a renewal
      buyerNetworkFee: a.networkFeeUnits, //  quoted before they signed; exactly what was charged
    })
  }
} else if (verdict.code === 'RATE_LIMITED') {
  // Per buyer wallet: 10 sponsored transactions in any rolling hour, 20 in any rolling day, across
  // every merchant and operation. Nothing was spent - the buyer can retry later, or pay the network
  // fee with ETH if their wallet holds any. Your charge() calls are never counted against this.
  console.log('buyer hit the per-wallet limit; retry later')
}
