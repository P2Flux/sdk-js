/**
 * A refund, end to end: prepare the terms, the MERCHANT's own wallet sends the transfer, verify
 * it settled.
 *
 * A refund is a plain USDC transfer from your wallet back to the wallet that paid - no contract,
 * no relayer, no P2Flux custody, no fee. P2Flux derives the payer and the refundable maximum from
 * the original settlement, so this flow can never send money anywhere else.
 *
 * P2Flux keeps NO refund history: enforcing one-refund-per-payment is your job, and the safe
 * place is BEFORE prepare - reserve the order row atomically, then call this.
 */
import { createP2Flux } from '@p2flux/sdk'

const p2flux = createP2Flux({ apiUrl: process.env.P2FLUX_API_URL ?? 'https://api.p2flux.com' })

// The original settlement, from your order records. Amounts are micro-USDC integer strings.
declare const originalIntent: string
declare const originalTxHash: string
const refundUnits = '2500000' // 2.50 USDC

// 1. Prepare: P2Flux locks the terms and names the only allowed sender and recipient.
const prep = await p2flux.prepareRefund({ intent: originalIntent, txHash: originalTxHash }, refundUnits)
console.log(`send ${prep.refundAmount} USDC from ${prep.merchant} to ${prep.payer}`)
// For a browser-assisted refund, hand `prep.refundToken` to your admin page's checkout fragment.

// 2. YOUR wallet sends the transfer - P2Flux never moves the money. Record the hash.
declare const refundTxHash: string

// 3. Verify from the original settlement (no token needed - this works days later, after
//    crashes, from support tooling). Confirming means poll the SAME hash; never send another.
const verdict = await p2flux.verifyRefund({ intent: originalIntent, txHash: originalTxHash }, refundUnits, refundTxHash)
if (verdict.refunded) {
  console.log('refund settled:', verdict.txHash)
} else if (verdict.confirming) {
  console.log('on chain, not yet settled - ask again shortly')
}
