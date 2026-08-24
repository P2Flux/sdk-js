/**
 * A one-time payment, end to end: create the intent, hand the buyer to the hosted checkout,
 * verify the settlement, keep the receipt.
 *
 * Production is real USDC on Base Mainnet. Point P2FLUX_API_URL at https://api-test.p2flux.com
 * (Base Sepolia, faucet money) while integrating.
 */
import { createP2Flux } from '@p2flux/sdk'

const p2flux = createP2Flux({ apiUrl: process.env.P2FLUX_API_URL ?? 'https://api.p2flux.com' })

// 1. Create the intent when the buyer chooses to pay. The recipient is YOUR payout wallet.
const payment = await p2flux.createPayment({
  recipient: '0x1111111111111111111111111111111111111111', // example address - use your own wallet
  amount: '12.50',
})

// 2. Store `payment.intent` on your order row, then send the buyer to the hosted checkout.
//    The intent rides in the URL fragment, which never reaches a server log.
const checkoutUrl = `https://pay.p2flux.com/#/pay/${payment.intent}`
console.log('send buyer to', checkoutUrl, '- intent expires', new Date(payment.expiresAt * 1000))

// 3. The checkout hands your success page the transaction hash. Verify it server-side -
//    the verdict, not the redirect, is what marks the order paid.
declare const txHashFromCheckout: string
const verdict = await p2flux.verifyPayment(payment.intent, txHashFromCheckout)

if (verdict.valid) {
  // 4. Paid and settled. Keep the settlement receipt with the order for ~10 minutes: presenting
  //    it on a repeat verify (double-submitted success page, queue retry) answers instantly.
  console.log('paid in block', verdict.blockNumber, '- receipt:', verdict.settlementReceipt)
} else if (verdict.code === 'PAYMENT_CONFIRMING') {
  // On chain but not settled to the required depth. Ask again in a few seconds - same hash.
  console.log('confirming, poll again shortly')
} else {
  // A verdict about the chain: this transaction does not settle this intent.
  console.log('not a settlement of this payment:', verdict.code)
}

// Lost the hash entirely (closed popup, dead callback)? The intent alone can find it:
//   const recovered = await p2flux.recoverPayment(payment.intent)
//   if (recovered.found && recovered.valid) markPaid(recovered.txHash)
