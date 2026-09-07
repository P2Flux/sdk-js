/**
 * A renewal pass: check what is due, charge it, and act on the outcome.
 *
 * status() before charge() is optional - charging a subscription that is not due simply returns
 * NOT_DUE - but it costs one cheap read and lets a worker skip the expensive path entirely.
 *
 *   P2FLUX_SUBSCRIPTIONS=p2s2...,p2s2... node --import tsx examples/renewal-worker.ts
 */
import { createP2Flux } from '@p2flux/sdk'

const env = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback
  if (!value) {
    console.error(`Missing required environment variable ${name}`)
    process.exit(1)
  }
  return value
}

const p2flux = createP2Flux({ apiUrl: env('P2FLUX_API_URL', 'https://api.p2flux.com'), timeoutMs: 60_000 })

/** Your own storage: the capabilities you kept at signup, decrypted here. */
const subscriptions = env('P2FLUX_SUBSCRIPTIONS').split(',').filter(Boolean)

for (const reference of subscriptions) {
  const state = await p2flux.status(reference)

  if (state.revoked || state.expired) {
    console.log('STOP      ', state.subscriptionId)
    continue
  }
  if (!state.due || state.chargedThisPeriod) {
    console.log('SKIP      ', state.subscriptionId, '- not due')
    continue
  }

  const result = await p2flux.charge(reference)

  // `ok` covers CHARGED and ALREADY_CHARGED alike: both mean this period is paid, and a retry that
  // races an earlier success lands on the second rather than double-charging.
  if (result.ok) {
    console.log('PAID      ', result.subscriptionId, result.txHash ?? '(already charged)')
  } else if (result.retryable) {
    console.log('RETRY     ', result.status)
  } else {
    console.log('ATTENTION ', result.status, result.action)
  }
}
