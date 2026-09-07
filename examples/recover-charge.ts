/**
 * ALREADY_CHARGED proved a period was collected and named no transaction. Find it.
 *
 * P2Flux stores nothing, so the hash lives only in the contract's log. Without it a paid period
 * cannot be attributed to an order, audited, or refunded - both refund calls start from the
 * original settlement.
 *
 * The period index is required and exact: you are reconciling one specific collection, today or a
 * year from now, and the answer must not move under you. Take it from the charge result or status().
 *
 *   P2FLUX_SUBSCRIPTION=p2s2... P2FLUX_PERIOD_INDEX=3 node --import tsx examples/recover-charge.ts
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

// Optional and never evidence: where your own records say the charge was attempted. It narrows the
// search and can never turn a miss into a hit, so omitting it is always safe.
const attemptedAt = process.env.P2FLUX_ATTEMPTED_AT
const hint = attemptedAt ? { attemptedAt: Number(attemptedAt) } : undefined

try {
  const periodIndex = Number(env('P2FLUX_PERIOD_INDEX'))
  const found = await p2flux.recoverCharge(env('P2FLUX_SUBSCRIPTION'), periodIndex, hint)

  if (!found.found) {
    // Ordinary, not an error: there is no catch-up billing, so a period that was never collected is
    // a normal history, and a later period says nothing about an earlier one.
    console.log('NOT FOUND  period', periodIndex, 'as of block', found.asOfBlock)
    process.exit(0)
  }

  // Check the settlement against what you expected before acting on it.
  console.log('FOUND     ', found.txHash, 'block', found.blockNumber)
  console.log('period    ', found.periodIndex)
  console.log('amount    ', found.amountUnits, 'units to', found.recipient)
} catch (error) {
  // RECOVERY_UNAVAILABLE (a bounded search budget) and PAYMENT_RECOVERY_INCONSISTENT arrive here.
  // The second is abnormal: never treat it as a payment.
  const failure = error as P2FluxError
  console.error('recovery could not be completed:', failure.status, `(${failure.action})`)
  process.exit(1)
}
