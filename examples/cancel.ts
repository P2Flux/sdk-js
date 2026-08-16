/**
 * Cancellation is the customer's transaction, not ours.
 *
 * P2Flux cannot revoke a customer's on-chain authority — it can only tell you what the customer's
 * wallet must send. You surface this calldata; their wallet signs it.
 */
import { createP2Flux } from '@p2flux/sdk'

const p2flux = createP2Flux({ apiUrl: process.env.P2FLUX_API_URL ?? 'https://api.p2flux.example' })

const cancellation = await p2flux.prepareSubscriptionCancellation(process.argv[2] ?? '')
console.log(`${cancellation.description}\n  to:   ${cancellation.to}\n  data: ${cancellation.data}`)

// Belt and braces: this also zeroes the token allowance, ending ANY future spending authority.
const revocation = await p2flux.prepareAllowanceRevocation()
console.log(`${revocation.description}\n  to:   ${revocation.to}`)
