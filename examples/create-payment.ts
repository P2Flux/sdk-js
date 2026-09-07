/**
 * A one-time payment: create the intent, hand the buyer to the hosted checkout.
 *
 *   P2FLUX_RECIPIENT=0xYourPayoutWallet node --import tsx examples/create-payment.ts
 *
 * Production is real USDC on Base Mainnet. Point P2FLUX_API_URL at https://api-test.p2flux.com
 * (Base Sepolia, faucet money) while integrating.
 */
import { createP2Flux, P2FluxError } from '@p2flux/sdk'

/** Configuration from the environment. Wallets and capabilities never belong in source. */
const env = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback
  if (!value) {
    console.error(`Missing required environment variable ${name}`)
    process.exit(1)
  }
  return value
}

const checkoutUrl = env('P2FLUX_CHECKOUT_URL', 'https://pay.p2flux.com')
const p2flux = createP2Flux({ apiUrl: env('P2FLUX_API_URL', 'https://api.p2flux.com'), timeoutMs: 30_000 })

try {
  // 1. Mint the intent when the buyer chooses to pay, and store it on the order row: verification
  //    and recovery both need it, and recovery still works after the intent expires.
  const payment = await p2flux.createPayment({
    recipient: env('P2FLUX_RECIPIENT'), // YOUR payout wallet
    amount: env('P2FLUX_AMOUNT', '12.50'),
  })

  console.log('intent   ', payment.intent)
  console.log('expires  ', new Date(payment.expiresAt * 1000).toISOString())

  // 2. Send the buyer to the hosted checkout. The intent rides in the URL fragment, which browsers
  //    never put in a request or a Referer header.
  console.log('checkout ', `${checkoutUrl}/#/pay/${encodeURIComponent(payment.intent)}`)

  // 3. The checkout posts `p2flux.payment.completed { tx_hash, settlement_receipt }` to your page.
  //    That is a claim: verify it server-side - see examples/verify-payment.ts.
  console.log('next     ', 'verify the transaction hash server-side before marking the order paid')
} catch (error) {
  const failure = error as P2FluxError
  console.error('P2Flux refused the request:', failure.status, `(${failure.action})`)
  process.exit(1)
}
