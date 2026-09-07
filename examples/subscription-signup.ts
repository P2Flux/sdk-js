/**
 * Start a subscription: create the terms, send the customer to the hosted checkout, then prove the
 * capability that comes back belongs to this order.
 *
 * P2Flux schedules nothing. The capability (`p2s2...`) is the one thing your system stores per
 * subscription. Treat it as a credential: server-side only, encrypted at rest, never in a URL, a
 * log or a browser. Charging it is examples/charge-subscription.ts.
 *
 *   P2FLUX_RECIPIENT=0xYourPayoutWallet node --import tsx examples/subscription-signup.ts
 *   P2FLUX_SUBSCRIPTION=p2s2... P2FLUX_SALT=12345 node --import tsx examples/subscription-signup.ts
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
const capability = process.env.P2FLUX_SUBSCRIPTION

try {
  if (!capability) {
    // 1. Terms. `period` is in SECONDS. Keep the salt with your pending order: it is how you prove
    //    later that the capability you were handed came from this exact setup.
    const setup = await p2flux.createSubscription({
      recipient: env('P2FLUX_RECIPIENT'),
      amount: env('P2FLUX_AMOUNT', '5.00'),
      period: Number(env('P2FLUX_PERIOD', String(30 * 86400))),
      // Optional: bound the standing allowance the checkout asks for. Unlimited by default, so
      // renewals never need the wallet again.
      // allowance: { periods: 12 },
    })

    console.log('salt     ', setup.salt)
    console.log('checkout ', `${checkoutUrl}/#/subscribe/${encodeURIComponent(setup.setupToken)}`)
    console.log('next     ', 'the checkout posts p2flux.subscription.created { subscription };')
    console.log('          ', `re-run with P2FLUX_SUBSCRIPTION=<capability> P2FLUX_SALT=${setup.salt}`)
    process.exit(0)
  }

  // 2. A cryptographically valid capability can still be the WRONG one. Read the terms back from
  //    the chain and compare them to what you sold before you store anything.
  const state = await p2flux.status(capability)
  const terms = state.raw.terms as { salt?: string; amount_units?: string; recipient?: string } | undefined

  if (terms?.salt !== env('P2FLUX_SALT')) {
    console.error('SETUP_MISMATCH: this capability is not the one this order set up')
    process.exit(1)
  }

  console.log('terms ok ', terms.amount_units, 'units to', terms.recipient)
  console.log('due      ', state.due, '| charged this period:', state.chargedThisPeriod)
  console.log('next     ', 'store the capability encrypted, then charge it from your renewal job')
} catch (error) {
  const failure = error as P2FluxError
  console.error('P2Flux refused the request:', failure.status, `(${failure.action})`)
  process.exit(1)
}
