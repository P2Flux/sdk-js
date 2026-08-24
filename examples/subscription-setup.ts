/**
 * A subscription, end to end: create the terms, let the customer authorize on the hosted
 * checkout, store the capability, charge each period from your own renewal job, and hand the
 * customer a safe way to cancel.
 *
 * Production is real USDC on Base Mainnet. Point P2FLUX_API_URL at https://api-test.p2flux.com
 * (Base Sepolia, faucet money) while integrating.
 */
import { createP2Flux } from '@p2flux/sdk'

const p2flux = createP2Flux({ apiUrl: process.env.P2FLUX_API_URL ?? 'https://api.p2flux.com' })

// 1. Create the terms when the customer picks a plan. Period is SECONDS (30 days here).
const setup = await p2flux.createSubscription({
  recipient: '0x1111111111111111111111111111111111111111', // example address - use your own wallet
  amount: '5.00',
  period: 30 * 24 * 3600,
})

// 2. Keep `setup.salt` with your pending order, then send the customer to the hosted checkout.
//    Their wallet approves USDC and signs one EIP-712 authorization; no further prompts ever.
console.log('send customer to', `https://pay.p2flux.com/#/subscribe/${setup.setupToken}`)

// 3. The checkout returns the finalized subscription to your success handler. If you run your own
//    checkout instead, finalize server-side with the signature your page collected:
declare const payerAddress: string
declare const eip712Signature: string
const finalized = await p2flux.finalizeSubscription(setup.setupToken, payerAddress, eip712Signature)

// 4. Store `finalized.subscription` (the p2s2 capability) - encrypted at rest, never in a URL or
//    log. It is the ONE thing you keep; everything else is read back from the chain on demand.
console.log('store capability for subscription', finalized.subscriptionId)

// 5. Your renewal job - yours, on your schedule; P2Flux has no scheduler - charges each period:
const result = await p2flux.charge(finalized.subscription)
if (result.ok) {
  console.log('period', result.periodIndex, 'paid', result.alreadyPaid ? '(recovered)' : result.txHash)
} else if (result.status === 'CONFIRMING') {
  console.log('on chain, not yet settled - keep the period open and ask again; never charge twice')
} else if (result.action === 'STOP_SUBSCRIPTION') {
  console.log('customer revoked or subscription ended:', result.status)
} else if (result.action === 'CUSTOMER_ACTION_REQUIRED') {
  console.log('customer must top up or restore the allowance:', result.status)
} else {
  console.log('retry later:', result.status)
}

// 6. Reconcile any time from the chain - after downtime, before dunning, in support tooling:
const state = await p2flux.status(finalized.subscription)
console.log('due:', state.due, 'charged this period:', state.chargedThisPeriod)

// 7. Cancellation: never give the browser the capability - it can charge. Hand it a session:
const session = await p2flux.createCancellationSession(finalized.subscription)
console.log('cancel page:', `https://pay.p2flux.com/#/cancel/${session.cancelToken}`)
// Only the customer's own wallet can actually revoke; P2Flux prepares the calldata for it.
