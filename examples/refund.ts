/**
 * A refund: prepare the terms, the MERCHANT's own wallet sends the transfer, verify it settled.
 *
 * A refund is a plain USDC transfer from your wallet back to the wallet that paid - no contract, no
 * relayer, no P2Flux custody, no fee. P2Flux derives the payer and the refundable maximum from the
 * original settlement, so this flow can never send money anywhere else.
 *
 * P2Flux keeps NO refund history: enforcing one refund per payment is your job, and the safe place
 * is BEFORE prepare - reserve the order row atomically, then call this.
 *
 *   P2FLUX_INTENT=p2f1... P2FLUX_TX_HASH=0x... node --import tsx examples/refund.ts
 */
import { createP2Flux, P2FluxError } from '@p2flux/sdk'

const env = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback
  if (!value) {
    console.error(`Missing required environment variable ${name}`)
    process.exit(1)
  }
  return value
}

const p2flux = createP2Flux({ apiUrl: env('P2FLUX_API_URL', 'https://api.p2flux.com') })

// The original settlement, from your order records. Amounts are micro-USDC integer strings:
// "2500000" is 2.50 USDC. Decimals are refused - a partial refund in floating point is a rounding bug.
const original = { intent: env('P2FLUX_INTENT'), txHash: env('P2FLUX_TX_HASH') }
// For a renewal instead: { subscription: capability, txHash, periodIndex: 3 }
const refundUnits = env('P2FLUX_REFUND_UNITS', '2500000')

try {
  // 1. Prepare: P2Flux locks the terms and names the only allowed sender and recipient.
  const prep = await p2flux.prepareRefund(original, refundUnits)
  console.log(`send ${prep.refundAmount} USDC from ${prep.merchant} to ${prep.payer}`)
  // For a browser-assisted refund, put prep.refundToken in your admin page's checkout fragment.

  // 2. YOUR wallet sends the transfer - P2Flux never moves the money. Record the hash.
  const refundTxHash = process.env.P2FLUX_REFUND_TX_HASH
  if (!refundTxHash) {
    console.log('set P2FLUX_REFUND_TX_HASH once the transfer is sent to verify it')
    process.exit(0)
  }

  // 3. Verify from the ORIGINAL settlement, not the prepare token - so this still works days later,
  //    after a crash or from support tooling.
  const verdict = await p2flux.verifyRefund(original, refundUnits, refundTxHash)

  if (verdict.refunded) {
    console.log('REFUNDED  ', verdict.txHash)
  } else if (verdict.confirming) {
    // On chain, not settled. Poll the SAME hash. Never send another transfer.
    console.log('CONFIRMING poll the same hash shortly')
  } else {
    console.log('not a refund of this payment:', verdict.status)
  }
} catch (error) {
  const failure = error as P2FluxError
  console.error('P2Flux refused the request:', failure.status, `(${failure.action})`)
  process.exit(1)
}
