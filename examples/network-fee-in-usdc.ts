/**
 * What the buyer actually paid when the network fee was paid in USDC.
 *
 * Verification is the same call as always; the verdict simply carries more. Every figure is in USDC
 * base units, where 1 USDC = 1_000_000.
 *
 *   P2FLUX_INTENT=p2f1... P2FLUX_TX_HASH=0x... node --import tsx examples/network-fee-in-usdc.ts
 *
 * Create such a payment with examples/create-sponsored-payment.ts.
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

try {
  const verdict = await p2flux.verifyPayment(env('P2FLUX_INTENT'), env('P2FLUX_TX_HASH'))

  if (!verdict.valid) {
    if (verdict.code === 'RATE_LIMITED') {
      // Per buyer wallet: 10 sponsored transactions in any rolling hour, 20 in any rolling day,
      // across every merchant and operation. Nothing was spent - the buyer retries later, or pays
      // the network fee with ETH if their wallet holds any. charge() calls are never counted.
      console.log('buyer hit the per-wallet limit; retry later')
    } else {
      console.log('not settled:', verdict.code)
    }
    process.exit(0)
  }

  console.log('paid via', verdict.gasPaymentMode ?? 'native')

  if (!verdict.accounting) {
    // A payment created without gasPaymentMode settles through the same contract and carries no
    // accounting block. Nothing is wrong; there is simply no network fee to attribute.
    console.log('no accounting block: this payment used native gas')
    process.exit(0)
  }

  const a = verdict.accounting
  console.log({
    price: a.paymentUnits,
    buyerPaid: a.buyerTotalUnits, //      price + the quoted network fee, and nothing else
    youReceive: a.merchantNetUnits, //    price - 1% - the fixed 0.10 network fee
    p2fluxFee: a.paymentFeeUnits,
    fixedNetworkFee: a.fixedNetworkFeeUnits, // merchant-funded, out of the amount, as on a renewal
    buyerNetworkFee: a.networkFeeUnits, //  quoted before signing; exactly what was charged
    payer: a.payer,
  })
} catch (error) {
  const failure = error as P2FluxError
  console.error('verification could not be completed:', failure.status, `(${failure.action})`)
  process.exit(1)
}
