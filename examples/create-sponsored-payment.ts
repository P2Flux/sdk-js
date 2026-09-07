/**
 * A payment a buyer can complete holding USDC and no ETH.
 *
 * With `gasPaymentMode: 'payment_token'` the buyer signs a token authorization instead of sending a
 * transaction. P2Flux submits it and pays the Base network fee in ETH; the buyer reimburses that
 * exact cost in USDC inside the same transaction. Nothing is waived - the fee is quoted before the
 * buyer signs, and they pay it in USDC rather than in ETH.
 *
 *   P2FLUX_RECIPIENT=0xYourPayoutWallet node --import tsx examples/create-sponsored-payment.ts
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

const checkoutUrl = env('P2FLUX_CHECKOUT_URL', 'https://pay.p2flux.com')
const p2flux = createP2Flux({ apiUrl: env('P2FLUX_API_URL', 'https://api.p2flux.com') })

try {
  // 1. Ask what this deployment supports, and never assume. A token that implements the right
  //    standards on a network P2Flux has not deployed to reports false here, and the request is
  //    refused with PAYMENT_TOKEN_GAS_UNSUPPORTED before a buyer sees anything.
  const caps = await p2flux.capabilities()
  const usdc = caps.tokens.find((token) => token.symbol === 'USDC')
  const sponsored = (usdc?.gasPaymentModes.includes('payment_token') ?? false) && usdc?.operations.one_time_payment === true

  console.log('chain', caps.chainId, '| buyer can pay without ETH:', sponsored)
  if (usdc) console.log('sponsor contract', usdc.sponsorContracts.one_time_payment)

  // 2. Create the payment. Fall back to 'native' when sponsorship is unavailable: that is the
  //    ordinary path, where the buyer sends the transaction and pays the fee in ETH.
  const payment = await p2flux.createPayment({
    recipient: env('P2FLUX_RECIPIENT'),
    amount: env('P2FLUX_AMOUNT', '12.50'),
    gasPaymentMode: sponsored ? 'payment_token' : 'native',
  })

  console.log('intent   ', payment.intent)
  console.log('mode     ', sponsored ? 'payment_token' : 'native')

  // 3. Nothing else changes. Same checkout URL, same server-side verification. The checkout prices
  //    the network fee, shows the buyer the total before anything is signed, and re-checks it at
  //    the moment they click.
  console.log('checkout ', `${checkoutUrl}/#/pay/${encodeURIComponent(payment.intent)}`)
  console.log('next     ', 'verify server-side, then read the accounting block:')
  console.log('          ', 'examples/network-fee-in-usdc.ts')
} catch (error) {
  const failure = error as P2FluxError
  console.error('P2Flux refused the request:', failure.status, `(${failure.action})`)
  process.exit(1)
}
