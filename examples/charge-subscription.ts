/**
 * Collect one period, from your own renewal job.
 *
 * charge() never throws on a payment outcome. Classify on `action`, not on `status`, so a code this
 * client has never seen still lands in the right branch. The contract allows one charge per billing
 * period, so a repeat after a timeout or a crashed worker answers ALREADY_CHARGED rather than
 * charging twice.
 *
 *   P2FLUX_SUBSCRIPTION=p2s2... node --import tsx examples/charge-subscription.ts
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

// Decrypt it from your own storage. In production this is never a value kept in the environment.
const result = await p2flux.charge(env('P2FLUX_SUBSCRIPTION'))

if (result.ok && result.txHash) {
  // CHARGED. The money moved.
  console.log('CHARGED   period', result.periodIndex, result.txHash)
  console.log('next due  ', result.nextPeriodAt)
} else if (result.ok) {
  // ALREADY_CHARGED: this period is collected and names no transaction. That is the normal answer
  // to a retry. examples/recover-charge.ts finds the settlement when you need one.
  console.log('ALREADY   period', result.periodIndex, 'collected; recover the hash if you need it')
} else if (result.status === 'CONFIRMING') {
  // On chain, not settled to the required depth. Keep the period open, change nothing, ask again.
  console.log('CONFIRMING', result.txHash, '- never send a second charge')
} else {
  switch (result.action) {
    case 'RETRY_LATER':
      console.log('RETRY     ', result.status, '- nothing was spent')
      break
    case 'CUSTOMER_ACTION_REQUIRED':
      console.log('CUSTOMER  ', result.status, '- top up or restore the allowance')
      break
    case 'STOP_SUBSCRIPTION':
      console.log('STOP      ', result.status, '- revoked or expired, final')
      break
    default:
      console.log('HUMAN     ', result.status, '- do not retry, fix the request')
  }
}
