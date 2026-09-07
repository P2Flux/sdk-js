/**
 * Server-side verification: the only thing that may mark an order paid.
 *
 * P2Flux sends no webhooks. Completion reaches you as a browser message from the hosted checkout,
 * and a browser message is a claim, not a fact. This is where the claim meets the chain.
 *
 *   P2FLUX_INTENT=p2f1... P2FLUX_TX_HASH=0x... node --import tsx examples/verify-payment.ts
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

const intent = env('P2FLUX_INTENT') // stored on your order row
const txHash = env('P2FLUX_TX_HASH') // claimed by the browser
const settlementReceipt = process.env.P2FLUX_SETTLEMENT_RECEIPT // couriered by the checkout, optional

// Your own idempotency guard belongs here: if this order is already paid, stop. Verifying twice is
// safe; crediting the customer twice is not.

try {
  // The verdict is a discriminated union on `valid` - a rejection is an answer with a code, not an
  // exception. Passing the settlement receipt lets the API answer without re-reading the chain; a
  // broken one silently falls back to the full check.
  const verdict = await p2flux.verifyPayment(intent, txHash, settlementReceipt)

  if (verdict.valid) {
    console.log('PAID      ', verdict.txHash, 'block', verdict.blockNumber)
    console.log('amount    ', verdict.amount)
    // Keep verdict.settlementReceipt with the order: a repeat verification answers instantly.
    // Mark the order paid HERE, inside your own transaction, and only once.
  } else if (verdict.code === 'PAYMENT_CONFIRMING') {
    // On chain, not settled deep enough yet. Poll the SAME hash. Never ask the buyer to pay again.
    console.log('CONFIRMING poll the same hash shortly')
  } else {
    // A verdict about the chain: this transaction does not settle this intent.
    console.log('REJECTED  ', verdict.code, `(${verdict.action})`)
  }
} catch (error) {
  // Transport-level only. An unreachable API says nothing about whether the payment landed - retry,
  // and never treat this as a rejection.
  const failure = error as P2FluxError
  console.error('verification could not be completed:', failure.status, `(${failure.action})`)
  process.exit(1)
}
