/**
 * The buyer paid and your page never heard: find the settlement from the intent alone.
 *
 * The popup closed, the tab crashed, the callback died. recoverPayment() reads the contract's own
 * logs for the exact payment the intent describes, so it can never hand you somebody else's
 * transaction. Pure reads and idempotent - safe to run from a cron over every pending order.
 *
 *   P2FLUX_INTENT=p2f1... node --import tsx examples/recover-payment.ts
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
  const found = await p2flux.recoverPayment(env('P2FLUX_INTENT'))

  if (!found.found) {
    // PAYMENT_NOT_FOUND is a statement about one block height, not a permanent verdict: a slow
    // wallet can still settle afterwards. Stop retrying on your own business rules, and never mint
    // a second intent for the same order.
    console.log('NOT FOUND  as of block', found.asOfBlock)
  } else if (found.valid) {
    console.log('RECOVERED ', found.txHash, 'amount', found.amount)
    // Mark the order paid here, once, exactly as your verify path does.
  } else {
    // Located but still confirming. Keep the hash and poll it - the work is already done.
    console.log('CONFIRMING', found.txHash)
  }
} catch (error) {
  const failure = error as P2FluxError
  console.error('recovery could not be completed:', failure.status, `(${failure.action})`)
  process.exit(1)
}
