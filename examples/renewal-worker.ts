/**
 * A renewal pass: check what is due, charge it, and store the outcome.
 *
 * `status()` before `charge()` is optional — charging a subscription that is not due simply returns
 * NOT_DUE — but it costs one cheap read and lets a worker skip the expensive path entirely.
 */
import { createP2Flux } from '@p2flux/sdk'

const p2flux = createP2Flux({ apiUrl: process.env.P2FLUX_API_URL ?? 'https://api.p2flux.example' })

/** Your own storage: whatever you kept when the customer signed up. */
declare const subscriptionsToCheck: string[]

for (const reference of subscriptionsToCheck) {
  const state = await p2flux.status(reference)

  if (state.revoked || state.expired) {
    console.log('stop billing', state.subscriptionId)
    continue
  }
  if (!state.due || state.chargedThisPeriod) continue

  const result = await p2flux.charge(reference)

  // `ok` covers CHARGED and ALREADY_CHARGED alike: both mean this period is paid, and a retry that
  // races an earlier success lands on the second rather than double-charging.
  if (result.ok) {
    console.log('paid', result.subscriptionId, result.txHash ?? '(already charged)')
  } else if (result.retryable) {
    console.log('will retry', result.status)
  } else {
    console.log('needs attention', result.status, result.action)
  }
}
