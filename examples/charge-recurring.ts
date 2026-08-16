/**
 * Charge a due subscription, and act on the result.
 *
 * The whole merchant contract is in the switch: `charge()` does not throw on a payment outcome, so
 * every branch here is an answer you decide what to do with. Only STOP_SUBSCRIPTION is terminal.
 */
import { createP2Flux } from '@p2flux/sdk'

const p2flux = createP2Flux({ apiUrl: process.env.P2FLUX_API_URL ?? 'https://api.p2flux.example' })

const result = await p2flux.charge(process.argv[2] ?? '')

switch (result.action) {
  case 'SUCCESS':
    console.log('paid:', result.txHash)
    break
  case 'WAIT':
    // Already broadcast and waiting on confirmation. The money moved; do not retry as a new charge.
    console.log('confirming, check again shortly')
    break
  case 'RETRY_LATER':
    // Transient: capacity, a busy chain, or an unreachable API. Safe to retry on your own schedule.
    console.log('retry later:', result.status)
    break
  case 'CUSTOMER_ACTION_REQUIRED':
    // The customer must top up or re-approve. Email them; do not cancel.
    console.log('needs the customer:', result.status)
    break
  case 'STOP_SUBSCRIPTION':
    // Revoked or expired on chain. This one is final - stop billing.
    console.log('stop billing:', result.status)
    break
  default:
    console.log(result.status, result.action)
}
