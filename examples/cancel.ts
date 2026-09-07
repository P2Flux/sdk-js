/**
 * Cancellation is the customer's transaction, not ours.
 *
 * P2Flux cannot revoke a customer's on-chain authority - it can only tell you what their wallet
 * must send. Two different things, and a customer should be offered both: stopping collection is
 * entirely in your hands (stop calling charge()), while revoking the authorization is theirs.
 *
 *   P2FLUX_SUBSCRIPTION=p2s2... node --import tsx examples/cancel.ts
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
const capability = env('P2FLUX_SUBSCRIPTION')

try {
  // The browser-safe route: a session token that can build the customer's revoke() and nothing
  // else. NEVER hand a browser the capability itself - it can charge.
  const session = await p2flux.createCancellationSession(capability)
  console.log('cancel page', `${checkoutUrl}/#/cancel/${encodeURIComponent(session.cancelToken)}`)

  // Or build your own wallet screen from the calldata:
  const cancellation = await p2flux.prepareSubscriptionCancellation(capability)
  console.log(`${cancellation.description}\n  to:   ${cancellation.to}\n  data: ${cancellation.data}`)

  // Belt and braces: this zeroes the token allowance, ending ANY future collection from this wallet
  // for every P2Flux subscription paid in that token.
  const revocation = await p2flux.prepareAllowanceRevocation()
  console.log(`${revocation.description}\n  to:   ${revocation.to}`)
} catch (error) {
  const failure = error as P2FluxError
  console.error('P2Flux refused the request:', failure.status, `(${failure.action})`)
  process.exit(1)
}
