/**
 * P2Flux JS/TS SDK - a thin, dependency-free client over the complete public V1 merchant API.
 *
 * P2Flux executes payments. Your application owns the subscription lifecycle: when a renewal is
 * due, who the customer is, what happens after a failure. There is deliberately no scheduler,
 * no polling and no state here - call `charge()` from your existing renewal job.
 *
 *   const p2flux = createP2Flux({ apiUrl: 'https://api.p2flux.com' })   // production: real USDC
 *   const result = await p2flux.charge(subscriptionRef)
 *   if (result.ok) markRenewalPaid()          // covers CHARGED and ALREADY_CHARGED
 *   else if (result.action === 'STOP_SUBSCRIPTION') cancelLocally()
 *
 * Every public V1 merchant/server operation has a method here - one-time payments, verification
 * with settlement receipts, recovery, subscription setup/finalize/charge/status, cancellation,
 * allowance revocation, refunds. No raw REST calls are needed for a normal integration.
 */

export type ChargeStatus =
  | 'CHARGED'
  | 'ALREADY_CHARGED'
  /* The money moved and the chain has not settled yet. Not a failure and not a success: change
   * nothing, keep the period open, and ask again in a few seconds. Never send a second charge. */
  | 'CONFIRMING'
  | 'PAYMENT_CONFIRMING'
  /* Refunds. A refund is a transfer the MERCHANT's wallet makes directly to the buyer - P2Flux
   * verifies it and never performs it, so these describe evidence rather than an action taken.
   * REFUND_CONFIRMING is a waiting state exactly like PAYMENT_CONFIRMING: poll the same hash. */
  /* Recovery. PAYMENT_NOT_FOUND is a statement about one block height, never a permanent one:
   * the contract does not enforce an intent's expiry, so a slow wallet can still settle after it
   * and a later call will find the payment. Never record it as "never paid". */
  | 'PAYMENT_NOT_FOUND'
  | 'PAYMENT_RECOVERY_INCONSISTENT'
  | 'RECOVERY_UNAVAILABLE'
  | 'REFUNDED'
  | 'REFUND_CONFIRMING'
  | 'REFUND_AMOUNT_INVALID'
  | 'REFUND_WRONG_MERCHANT'
  | 'REFUND_TRANSACTION_MISMATCH'
  | 'REFUND_ORIGINAL_PAYMENT_INVALID'
  | 'INVALID_REFUND_TOKEN'
  | 'REFUND_TOKEN_EXPIRED'
  | 'NOT_DUE'
  | 'INSUFFICIENT_BALANCE'
  | 'INSUFFICIENT_ALLOWANCE'
  | 'PERMISSION_REVOKED'
  | 'SUBSCRIPTION_EXPIRED'
  | 'INVALID_SUBSCRIPTION'
  | 'INVALID_REQUEST'
  | 'AMOUNT_OUT_OF_BOUNDS'
  | 'PERIOD_OUT_OF_BOUNDS'
  | 'RPC_ERROR'
  | 'RELAYER_ERROR'
  | 'TRANSACTION_REVERTED'
  | 'INTERNAL_ERROR'
  | 'NETWORK_ERROR'
  // Infrastructure protection: the request was turned away before any money could move, so the
  // subscription is untouched and the call is safe to repeat.
  | 'RATE_LIMITED'
  | 'CONCURRENCY_LIMIT'
  // Gas could not be priced, or moved above what this subscription authorized. Nothing was spent
  // and nothing about the subscription changed: the charge waits for better conditions.
  | 'GAS_TOO_HIGH'
  | 'GAS_QUOTE_UNAVAILABLE'
  | 'GAS_FEE_TOO_HIGH'
  /* Operator-side limits, not payment outcomes: refused before anything was broadcast, so nothing
   * was spent and the subscription is untouched. Retry later; there is nothing a customer can do
   * about a gas spike or an exhausted relayer budget. */
  | 'RELAYER_TX_COST_TOO_HIGH'
  | 'RELAYER_BUDGET_EXCEEDED'
  | 'RELAYER_NOT_READY'
  /* The service is at its own capacity - not this caller's fault and not permanent. Distinct from
   * RATE_LIMITED, which is per caller: this one means come back shortly, not "you asked too often". */
  | 'RPC_BUSY'
  /* Paying the network fee in the payment token. The first four are answers about what P2Flux can
   * do right now and cost nothing; the last three describe an attempt that reached the chain and
   * moved no money, because the fee and the operation it funds settle together or not at all. */
  | 'PAYMENT_TOKEN_GAS_UNSUPPORTED'
  | 'PAYMENT_TOKEN_GAS_UNAVAILABLE'
  | 'PAYMENT_TOKEN_GAS_QUOTE_EXPIRED'
  | 'PAYMENT_TOKEN_GAS_LIMIT_EXCEEDED'
  | 'INVALID_GAS_QUOTE'
  | 'INSUFFICIENT_PAYMENT_TOKEN_FOR_GAS'
  | 'SPONSORED_TRANSACTION_FAILED'
  | 'SPONSORED_PERMIT_FAILED'
  | 'SPONSORSHIP_CONFIRMING'
  /* Token validity. A capability that is malformed, expired or presented to the wrong endpoint
   * never becomes valid: fix the integration, do not retry the call. */
  | 'INVALID_INTENT'
  | 'INTENT_EXPIRED'
  | 'INVALID_REFERENCE'
  | 'INVALID_SETUP_TOKEN'
  | 'SETUP_TOKEN_EXPIRED'
  | 'INVALID_CANCEL_TOKEN'
  | 'CANCEL_TOKEN_EXPIRED'
  | 'TERMS_MISMATCH'
  /* Verification verdicts: statements about the chain, delivered as `valid: false` codes. */
  | 'PERMISSION_NOT_FOUND'
  | 'TRANSACTION_NOT_FOUND'
  | 'PAYMENT_ALREADY_PROCESSED'
  | 'WRONG_SPENDER'
  | 'WRONG_TOKEN'
  | 'INVALID_EXTRA_DATA'
  /* Finalize: the customer's signature could not be accepted as presented. */
  | 'INVALID_SIGNATURE'
  | 'SIGNATURE_VALIDATION_TOO_EXPENSIVE'
  | 'UNSUPPORTED_SIGNATURE_FORMAT'

export type MerchantAction =
  | 'SUCCESS'
  /* Distinct from RETRY_LATER on purpose: nothing went wrong, so a customer is told the payment
   * arrived and is confirming - not that it failed. */
  | 'WAIT'
  | 'RETRY_LATER'
  | 'CUSTOMER_ACTION_REQUIRED'
  | 'STOP_SUBSCRIPTION'
  | 'INVALID_REQUEST'

export type ChargeResult = {
  status: ChargeStatus
  /** True for CHARGED and ALREADY_CHARGED - both mean "this period is paid". */
  ok: boolean
  /** True when the period was already collected by an earlier call. Retries are safe. */
  alreadyPaid: boolean
  action: MerchantAction
  /** Safe to try the identical call again later. Never true for terminal outcomes. */
  retryable: boolean
  txHash?: string
  amount?: string
  subscriptionId?: string
  periodIndex?: number
  /** ISO timestamp: the earliest the next period can be charged. */
  nextPeriodAt?: string
  /** The raw API body, for logging or fields added after this SDK was written. */
  raw: Record<string, unknown>
}

export type SubscriptionStatus = {
  active: boolean
  revoked: boolean
  expired: boolean
  due: boolean
  chargedThisPeriod: boolean
  subscriptionId: string
  periodIndex: number | null
  periodStart: string | null
  periodEnd: string | null
  nextPeriodAt: string | null
  allowanceUnlimited: boolean
  raw: Record<string, unknown>
}

/** Calldata for the customer's own wallet to send. P2Flux cannot revoke wallet authority. */
export type PreparedTransaction = {
  chainId: number
  to: string
  data: string
  description: string
  payer?: string
}

/**
 * Which settlement is being refunded: a one-time payment, or one period of a subscription.
 *
 * Identifiers only. The payer, the merchant, the token and the refundable maximum are all derived
 * from the chain by P2Flux - a caller cannot name any of them, which is what stops a refund call
 * from being a way to send money to an address of your choosing.
 */
export type RecoveredPayment = {
  /** True when a settling transaction exists on chain and was located. */
  found: boolean
  /** The transaction that settled this intent. Present whenever `found`. */
  txHash?: string
  /** True only once that transaction is settled to the required depth. */
  valid: boolean
  /** `PAYMENT_CONFIRMING` while it is still settling, `PAYMENT_NOT_FOUND` when nothing has. */
  status?: ChargeStatus
  action: MerchantAction
  amount?: string
  /** The block the answer was computed at. A not-found is only true as of this height. */
  asOfBlock?: string
  raw: Record<string, unknown>
}

/**
 * The settlement of one recurring period, recovered from the chain.
 *
 * `found: false` is ordinary rather than an error: there is no catch-up billing, so a period that
 * was never collected is a normal history, and a later period having been charged says nothing
 * about an earlier one. Like a recovered payment, a miss is a statement about one block height.
 */
export type RecoveredCharge = {
  found: boolean
  subscriptionId?: string
  periodIndex?: number
  /** The transaction that charged this exact period. Present whenever `found`. */
  txHash?: string
  blockNumber?: string
  payer?: string
  recipient?: string
  netUnits?: string
  feeUnits?: string
  networkFeeUnits?: string
  /** net + fee + networkFee: the amount the authorization signed for. Check it against your order. */
  amountUnits?: string
  status?: ChargeStatus
  action: MerchantAction
  /** Only on a miss. The head this answer was computed at. */
  asOfBlock?: string
  raw: Record<string, unknown>
}

/** Where your own records say a charge was attempted. Narrows the search; never evidence. */
export type ChargeRecoveryHint = { attemptedAt?: number; block?: number }

/**
 * A session for restoring the token allowance one subscription needs.
 *
 * The narrowest token P2Flux issues: it cannot charge, cannot revoke and cannot refund. Open
 * `<checkout>/#/approve/<approveToken>`.
 */
export type AllowanceRestoreSession = {
  approveToken: string
  expiresAt: number
  payer: string
  subscriptionId: string
  raw: Record<string, unknown>
}

/** What an allowance-restore session authorizes - for the browser holding it. */
export type AllowanceRestoreTerms = {
  gasPaymentMode?: GasPaymentMode
  /** Present only when the repair is sponsored: what the customer pays for the transaction. */
  sponsorshipQuote?: NetworkFeeQuote
  chainId: number
  token: string
  /** The recurring contract. Never a value the page was opened with. */
  spender: string
  payer: string
  subscriptionId: string
  /** The signed amount plus the gas reimbursement the next charge may add. */
  requiredUnits: string
  /** What to approve, in base units; null means unlimited. The setup's own mode, kept on repair. */
  approveUnits: string | null
  expiresAt: number
  raw: Record<string, unknown>
}

export type RefundOriginal =
  | { intent: string; txHash: string }
  | { subscription: string; txHash: string; periodIndex?: number }

export type RefundPreparation = {
  /**
   * Short-lived capability for the merchant's BROWSER, to be put in the checkout fragment.
   *
   * Do not store it. Reconciliation later uses `verifyRefund` with the original settlement, which
   * needs no token - keeping this one alive to work around its expiry would only add a secret at
   * rest without buying anything.
   */
  refundToken: string
  chainId: number
  token: string
  /** The wallet that received the original payment. The only wallet that may send this refund. */
  merchant: string
  /** The wallet that paid. The only possible recipient. */
  payer: string
  /** The commercial amount of the original payment - the refundable maximum. */
  originalAmount: string
  originalAmountUnits: string
  refundAmount: string
  refundAmountUnits: string
  expiresAt: number
  raw: Record<string, unknown>
}

export type RefundVerification = {
  /** True only once the refund transfer is settled to the configured depth. */
  refunded: boolean
  /** True while the transfer exists but has not settled. Poll the SAME hash; never send another. */
  confirming: boolean
  status: ChargeStatus
  action: MerchantAction
  txHash?: string
  amount?: string
  raw: Record<string, unknown>
}

/** Wire shape: `txHash` is `tx_hash`, and the settlement key stays whatever the caller passed. */
const refundBody = (original: RefundOriginal): Record<string, unknown> => {
  const { txHash, periodIndex, ...rest } = original as {
    txHash: string
    periodIndex?: number
    intent?: string
    subscription?: string
  }
  return {
    ...rest,
    tx_hash: txHash,
    ...(periodIndex === undefined ? {} : { period_index: periodIndex }),
  }
}

/** Terms for a one-time payment: who gets paid, and how much USDC (decimal string, "12.50"). */
/**
 * How the buyer pays the chain's network fee.
 *
 * `native` is what has always happened: the buyer sends the transaction and pays gas in the chain's
 * own currency. `payment_token` lets a buyer who holds only the payment token pay - P2Flux sends the
 * transaction and the buyer reimburses the quoted network cost in that same token, plus a flat gas
 * service fee. Ask `capabilities()` before offering it; not every network and token supports it.
 */
export type GasPaymentMode = 'native' | 'payment_token'

export type PaymentTerms = {
  recipient: string
  amount: string
  /** Omit for `native`. Existing integrations keep their current behaviour and fees exactly. */
  gasPaymentMode?: GasPaymentMode
}

/** What one sponsored operation will cost the buyer, and how long the price stands. */
export type NetworkFeeQuote = {
  /** The price the buyer accepts and pays. Not a measurement of gas used. */
  quotedNetworkFeeUnits: string
  /** The ceiling that price may not exceed. */
  maxNetworkFeeUnits: string
  /** Flat P2Flux fee for the gas service. Zero outside one-time payments. */
  gasServiceFeeUnits: string
  /** Price plus fees plus the payment itself, for a one-time payment. */
  buyerTotalUnits?: string
  quotedAt: number
  expiresAt: number
  /** Opaque; hand it back to `sponsorPayment` unchanged. */
  quote: string
  raw: Record<string, unknown>
}

/** Every unit of a settled payment, read from the chain. */
export type PaymentAccounting = {
  paymentUnits: string
  paymentFeeUnits: string
  networkFeeUnits: string
  gasServiceFeeUnits: string
  merchantNetUnits: string
  buyerTotalUnits: string
  payer?: string
}

export type PaymentIntent = {
  /** Signed capability for this exact payment. Put it in the checkout link fragment: `#/pay/<intent>`. */
  intent: string
  /** The on-chain payment reference (bytes32) the settlement will carry. */
  reference: string
  amount: string
  /** Unix seconds. Expiry stops a payment being STARTED; it never makes a settlement unverifiable. */
  expiresAt: number
  /** What a checkout needs to call the splitter. Nothing secret. */
  pay: {
    chainId: number
    splitter: string
    token: string
    recipient: string
    amountUnits: string
    reference: string
  }
  raw: Record<string, unknown>
}

/** The authoritative terms a checkout should display, read back from an intent. */
export type ResolvedPayment = {
  recipient: string
  amount: string
  amountUnits: string
  token: string
  splitter: string
  chainId: number
  reference: string
  expiresAt: number
  /** How many confirmations a verify will wait for; null when the API leaves it to its default. */
  confirmationsRequired: number | null
  gasPaymentMode: GasPaymentMode
  /** Present only in `payment_token` mode: what the buyer will pay for the network, and until when. */
  networkFeeQuote?: NetworkFeeQuote
  raw: Record<string, unknown>
}

/** The result of asking P2Flux to settle a payment the buyer funded with a signature. */
export type SponsoredPaymentResult = {
  /** `SUBMITTED` once it is mined; `CONFIRMING` while its fate is still unknown - never re-send. */
  status: 'SUBMITTED' | 'CONFIRMING'
  txHash: string
  reference: string
  networkFeeUnits: string
  gasServiceFeeUnits: string
  buyerTotalUnits: string
  raw: Record<string, unknown>
}

/** What a deployment can actually do, per token and per operation. */
export type Capabilities = {
  chainId: number
  network?: string
  nativeCurrency?: string
  supported: boolean
  tokens: {
    address: string
    symbol: string
    decimals: number
    gasPaymentModes: GasPaymentMode[]
    gasServiceFeeUnits: string
    operations: Record<string, boolean>
    /** Revoking a recurring authorization is always the payer's own transaction. */
    zeroNativeRevoke: boolean
  }[]
  raw: Record<string, unknown>
}

/**
 * A verification verdict - a real discriminated union, so `if (result.valid)` narrows.
 *
 * `valid: false` is a 200-level ANSWER, not an exception: `PAYMENT_CONFIRMING` while the
 * transaction settles (ask again in a few seconds), `TRANSACTION_REVERTED` / `TERMS_MISMATCH` /
 * `WRONG_TOKEN` and friends when the transaction does not pay this intent. Only a broken request
 * or the API being unreachable throws.
 */
export type PaymentVerification =
  | {
      valid: true
      txHash: string
      reference?: string
      amount?: string
      blockNumber?: string
      blockHash?: string
      /**
       * Sealed proof of this CONFIRMED verdict, valid ~10 minutes. Present it on a repeat verify of
       * the same intent + hash and the API answers without re-reading the chain. Store it only as a
       * short-lived optimization - never as the payment record.
       */
      settlementReceipt?: string
      raw: Record<string, unknown>
    }
  | {
      valid: false
      code: ChargeStatus
      /** Local guidance for the code: WAIT means poll the same hash, INVALID_REQUEST means stop. */
      action: MerchantAction
      raw: Record<string, unknown>
    }

/** Terms for a subscription: USDC per period, period length in seconds, optional end (unix). */
/**
 * How much ERC-20 allowance the hosted checkout asks the customer's wallet for.
 *
 *   'unlimited'     one approval for the life of the subscription. The default.
 *   'until_end'     enough for every period up to `end`; needs an end date.
 *   { periods: N }  enough for N charges (1..1200); your restore flow asks again after that.
 *
 * Whatever you choose, the allowance only reaches the recurring contract, which moves nothing the
 * customer's signed authorization does not permit. The mode bounds how much a broken contract
 * could ever reach, at the cost of a wallet prompt when it runs out.
 */
export type AllowanceMode = 'unlimited' | 'until_end' | { periods: number }

export type SubscriptionTerms = {
  recipient: string
  amount: string
  period: number
  end?: number
  /** Standing allowance the checkout asks for. Omit for unlimited. */
  allowance?: AllowanceMode
}

export type SubscriptionSetup = {
  /** Signed setup token. Put it in the checkout link fragment: `#/subscribe/<setup_token>`. */
  setupToken: string
  /** Unix seconds - the window the customer has to authorize. */
  expiresAt: number
  chainId: number
  /** The recurring contract the customer will authorize. Read from the API, never hard-coded. */
  contract: string
  amount: string
  /** Ties a returned capability back to THIS checkout - compare before attaching it to an order. */
  salt: string
  raw: Record<string, unknown>
}

/** The authoritative terms plus the exact EIP-712 payload the customer's wallet signs. */
export type ResolvedSubscription = {
  recipient: string
  amount: string
  amountUnits: string
  period: number
  start: number
  end: number
  token: string
  chainId: number
  contract: string
  salt: string
  maxGasReimbursement: string
  feeBps: number
  networkFee: string
  networkFeeUnits: string
  networkFeeEstimate: string | null
  expiresAt: number
  typedData: Record<string, unknown>
  raw: Record<string, unknown>
}

export type FinalizedSubscription = {
  /**
   * The charge capability (`p2s2.`). The ONE thing your system stores per subscription -
   * encrypted at rest, never in a URL or a log. Everything else is reconstructed from the chain.
   */
  subscription: string
  subscriptionId: string
  amount: string
  period: number
  end?: number
  raw: Record<string, unknown>
}

export type CancellationSession = {
  /** Short-lived token safe to hand to the customer's BROWSER: `#/cancel/<cancel_token>`. */
  cancelToken: string
  expiresAt: number
  subscriptionId: string
  payer: string
  raw: Record<string, unknown>
}

/** A refund token read back by the browser holding it - what a cancel/refund page displays. */
export type ResolvedRefund = {
  chainId: number
  token: string
  merchant: string
  payer: string
  amount: string
  amountUnits: string
  expiresAt: number
  raw: Record<string, unknown>
}

export class P2FluxError extends Error {
  constructor(
    readonly status: ChargeStatus,
    readonly action: MerchantAction,
    readonly raw: Record<string, unknown> = {},
  ) {
    super(status)
    this.name = 'P2FluxError'
  }
}

const ACTIONS: Record<string, MerchantAction> = {
  CHARGED: 'SUCCESS',
  ALREADY_CHARGED: 'SUCCESS',
  CONFIRMING: 'WAIT',
  PAYMENT_CONFIRMING: 'WAIT',
  PAYMENT_NOT_FOUND: 'RETRY_LATER',
  PAYMENT_RECOVERY_INCONSISTENT: 'RETRY_LATER',
  RECOVERY_UNAVAILABLE: 'RETRY_LATER',
  REFUNDED: 'SUCCESS',
  REFUND_CONFIRMING: 'WAIT',
  REFUND_AMOUNT_INVALID: 'INVALID_REQUEST',
  REFUND_WRONG_MERCHANT: 'INVALID_REQUEST',
  REFUND_TRANSACTION_MISMATCH: 'INVALID_REQUEST',
  REFUND_ORIGINAL_PAYMENT_INVALID: 'INVALID_REQUEST',
  INVALID_REFUND_TOKEN: 'INVALID_REQUEST',
  REFUND_TOKEN_EXPIRED: 'INVALID_REQUEST',
  NOT_DUE: 'RETRY_LATER',
  INSUFFICIENT_BALANCE: 'CUSTOMER_ACTION_REQUIRED',
  INSUFFICIENT_ALLOWANCE: 'CUSTOMER_ACTION_REQUIRED',
  PERMISSION_REVOKED: 'STOP_SUBSCRIPTION',
  SUBSCRIPTION_EXPIRED: 'STOP_SUBSCRIPTION',
  INVALID_SUBSCRIPTION: 'INVALID_REQUEST',
  INVALID_REQUEST: 'INVALID_REQUEST',
  // Permanent: the amount or period is outside what the terms can express. Fix the request, do not
  // retry it - the fallback used to call these retryable, which reads as an outage to a merchant.
  AMOUNT_OUT_OF_BOUNDS: 'INVALID_REQUEST',
  PERIOD_OUT_OF_BOUNDS: 'INVALID_REQUEST',
  RPC_ERROR: 'RETRY_LATER',
  RELAYER_ERROR: 'RETRY_LATER',
  TRANSACTION_REVERTED: 'RETRY_LATER',
  INTERNAL_ERROR: 'RETRY_LATER',
  NETWORK_ERROR: 'RETRY_LATER',
  RATE_LIMITED: 'RETRY_LATER',
  CONCURRENCY_LIMIT: 'RETRY_LATER',
  GAS_TOO_HIGH: 'RETRY_LATER',
  GAS_QUOTE_UNAVAILABLE: 'RETRY_LATER',
  GAS_FEE_TOO_HIGH: 'RETRY_LATER',
  RELAYER_TX_COST_TOO_HIGH: 'RETRY_LATER',
  RELAYER_BUDGET_EXCEEDED: 'RETRY_LATER',
  RELAYER_NOT_READY: 'RETRY_LATER',
  RPC_BUSY: 'RETRY_LATER',
  /* The API ships no `action` for these, so this local fallback is what a merchant sees. A dead or
   * mismatched token never becomes valid by retrying - all of them are integration errors. */
  INVALID_INTENT: 'INVALID_REQUEST',
  INTENT_EXPIRED: 'INVALID_REQUEST',
  INVALID_REFERENCE: 'INVALID_REQUEST',
  INVALID_SETUP_TOKEN: 'INVALID_REQUEST',
  SETUP_TOKEN_EXPIRED: 'INVALID_REQUEST',
  INVALID_CANCEL_TOKEN: 'INVALID_REQUEST',
  CANCEL_TOKEN_EXPIRED: 'INVALID_REQUEST',
  TERMS_MISMATCH: 'INVALID_REQUEST',
  PERMISSION_NOT_FOUND: 'INVALID_REQUEST',
  INVALID_SIGNATURE: 'INVALID_REQUEST',
  UNSUPPORTED_SIGNATURE_FORMAT: 'INVALID_REQUEST',
  WRONG_SPENDER: 'INVALID_REQUEST',
  WRONG_TOKEN: 'INVALID_REQUEST',
  INVALID_EXTRA_DATA: 'INVALID_REQUEST',
  // A settled intent cannot settle twice; retrying will not change the answer.
  PAYMENT_ALREADY_PROCESSED: 'INVALID_REQUEST',
  // The transaction may still be propagating or mining - the same question can have a new answer.
  TRANSACTION_NOT_FOUND: 'RETRY_LATER',
  /* The customer's contract wallet costs more to validate than the API will spend. Only the
   * customer can fix that, by authorizing from an ordinary wallet. */
  SIGNATURE_VALIDATION_TOO_EXPENSIVE: 'CUSTOMER_ACTION_REQUIRED',
  /* Paying the network fee in the payment token. Unsupported is a fact about the deployment, so it
   * is INVALID_REQUEST rather than something to wait out - fall back to native gas. An expired quote
   * needs a fresh price and a fresh signature, which only the customer can give. */
  PAYMENT_TOKEN_GAS_UNSUPPORTED: 'INVALID_REQUEST',
  PAYMENT_TOKEN_GAS_UNAVAILABLE: 'RETRY_LATER',
  PAYMENT_TOKEN_GAS_QUOTE_EXPIRED: 'CUSTOMER_ACTION_REQUIRED',
  PAYMENT_TOKEN_GAS_LIMIT_EXCEEDED: 'RETRY_LATER',
  INVALID_GAS_QUOTE: 'INVALID_REQUEST',
  INSUFFICIENT_PAYMENT_TOKEN_FOR_GAS: 'CUSTOMER_ACTION_REQUIRED',
  SPONSORED_TRANSACTION_FAILED: 'RETRY_LATER',
  SPONSORED_PERMIT_FAILED: 'RETRY_LATER',
  /* In flight: the buyer's authorization may already be spent, so the answer is to look the
   * settlement up, never to send another one. */
  SPONSORSHIP_CONFIRMING: 'WAIT',
}

export type P2FluxOptions = {
  apiUrl: string
  /**
   * Milliseconds before a request is abandoned as NETWORK_ERROR. Default 60 s: a charge waits for
   * on-chain confirmation, which on a busy public RPC can take tens of seconds. Abandoning it early
   * is safe but noisy - the payment may still land, and the next call returns ALREADY_CHARGED.
   */
  timeoutMs?: number
  /** Injectable for tests; defaults to global fetch. */
  fetch?: typeof fetch
}

/** The wire shape of a quote, in the SDK's camelCase. */
const networkFeeQuote = (raw: Record<string, unknown>): NetworkFeeQuote => ({
  quotedNetworkFeeUnits: raw.quoted_network_fee_units as string,
  maxNetworkFeeUnits: raw.max_network_fee_units as string,
  gasServiceFeeUnits: raw.gas_service_fee_units as string,
  buyerTotalUnits: raw.buyer_total_units as string | undefined,
  quotedAt: raw.quoted_at as number,
  expiresAt: raw.expires_at as number,
  quote: raw.quote as string,
  raw,
})

export function createP2Flux(options: P2FluxOptions) {
  const base = options.apiUrl.replace(/\/$/, '')
  const timeoutMs = options.timeoutMs ?? 60_000
  const fetchImpl = options.fetch ?? globalThis.fetch

  const post = async (path: string, body: unknown): Promise<{ httpStatus: number; body: Record<string, unknown> }> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetchImpl(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>
      return { httpStatus: res.status, body: parsed }
    } catch {
      // Unreachable API, DNS failure, timeout: never a payment outcome, always retryable. The
      // charge may or may not have landed - retrying is safe either way, which is the point.
      throw new P2FluxError('NETWORK_ERROR', 'RETRY_LATER')
    } finally {
      clearTimeout(timer)
    }
  }

  /** Throwing variant for non-charge calls, where every failure really is exceptional. */
  const postOrThrow = async (path: string, body: unknown) => {
    const { httpStatus, body: payload } = await post(path, body)
    if (httpStatus >= 400) {
      const status = (payload.error as ChargeStatus) ?? 'INTERNAL_ERROR'
      throw new P2FluxError(status, ACTIONS[status] ?? 'RETRY_LATER', payload)
    }
    return payload
  }

  return {
    /**
     * Create a signed one-time payment intent.
     *
     * The intent is a capability for exactly this recipient and amount - nothing else can settle
     * against it. Hand it to the buyer as a checkout link fragment (`#/pay/<intent>`); the fragment
     * never reaches a server log or a Referer header. Store the intent with your order: verify,
     * recovery and refunds all start from it.
     */
    async createPayment(terms: PaymentTerms): Promise<PaymentIntent> {
      const body = await postOrThrow('/v1/payments', {
        recipient: terms.recipient,
        amount: terms.amount,
        ...(terms.gasPaymentMode === undefined ? {} : { gas_payment_mode: terms.gasPaymentMode }),
      })
      const pay = (body.pay ?? {}) as Record<string, unknown>
      return {
        intent: body.intent as string,
        reference: body.reference as string,
        amount: body.amount as string,
        expiresAt: body.expires_at as number,
        pay: {
          chainId: pay.chain_id as number,
          splitter: pay.splitter as string,
          token: pay.token as string,
          recipient: pay.recipient as string,
          amountUnits: pay.amount_units as string,
          reference: pay.reference as string,
        },
        raw: body,
      }
    },

    /** The authoritative terms for a checkout to display, read back from the intent itself. */
    async resolvePayment(intent: string): Promise<ResolvedPayment> {
      const body = await postOrThrow('/v1/payments/resolve', { intent })
      return {
        recipient: body.recipient as string,
        amount: body.amount as string,
        amountUnits: body.amount_units as string,
        token: body.token as string,
        splitter: body.splitter as string,
        chainId: body.chain_id as number,
        reference: body.reference as string,
        expiresAt: body.expires_at as number,
        confirmationsRequired: (body.confirmations_required ?? null) as number | null,
        gasPaymentMode: (body.gas_payment_mode ?? 'native') as GasPaymentMode,
        ...(body.network_fee_quote === undefined
          ? {}
          : { networkFeeQuote: networkFeeQuote(body.network_fee_quote as Record<string, unknown>) }),
        raw: body,
      }
    },

    /**
     * Settle a payment whose buyer holds no native currency.
     *
     * The buyer signs the token authorization the checkout showed them; this hands that signature to
     * P2Flux, which sends the transaction and takes the quoted network fee out of the same
     * authorization. `CONFIRMING` means it is in flight - ask `verifyPayment` about the hash rather
     * than calling this again, because the buyer's authorization may already be spent.
     */
    async sponsorPayment(args: {
      intent: string
      quote: string
      payer: string
      signature: string
    }): Promise<SponsoredPaymentResult> {
      const body = await postOrThrow('/v1/payments/sponsor', {
        intent: args.intent,
        quote: args.quote,
        payer: args.payer,
        signature: args.signature,
      })
      return {
        status: body.status as 'SUBMITTED' | 'CONFIRMING',
        txHash: body.tx_hash as string,
        reference: body.reference as string,
        networkFeeUnits: body.network_fee_units as string,
        gasServiceFeeUnits: body.gas_service_fee_units as string,
        buyerTotalUnits: body.buyer_total_units as string,
        raw: body,
      }
    },

    /**
     * Carry a customer's signed allowance change onto the chain.
     *
     * `allowanceUnits: '0'` removes the allowance, which stops collection - it does NOT revoke the
     * recurring authorization, which only the payer's own transaction can do. Report the two
     * separately to customers.
     */
    async submitAllowanceRestore(args: {
      approveToken: string
      quote: string
      permitSignature: string
      networkFeeSignature: string
      allowanceUnits?: string
      permitNonce?: string
    }): Promise<Record<string, unknown>> {
      return postOrThrow('/v1/allowances/restore/submit', {
        approve_token: args.approveToken,
        quote: args.quote,
        permit_signature: args.permitSignature,
        network_fee_signature: args.networkFeeSignature,
        ...(args.allowanceUnits === undefined ? {} : { allowance_units: args.allowanceUnits }),
        ...(args.permitNonce === undefined ? {} : { permit_nonce: args.permitNonce }),
      })
    },

    /**
     * What this deployment supports, before you offer a buyer anything.
     *
     * Read it once at start-up rather than per checkout: it changes only when the deployment does.
     */
    async capabilities(): Promise<Capabilities> {
      // POST, not GET: the endpoint answers both, and POST is the one shape every transport a host
      // might inject can make.
      const body = await postOrThrow('/v1/capabilities', {})
      return {
        chainId: body.chain_id as number,
        network: body.network as string | undefined,
        nativeCurrency: body.native_currency as string | undefined,
        supported: Boolean(body.supported),
        tokens: ((body.tokens ?? []) as Record<string, unknown>[]).map((token) => ({
          address: token.address as string,
          symbol: token.symbol as string,
          decimals: token.decimals as number,
          gasPaymentModes: token.gas_payment_modes as GasPaymentMode[],
          gasServiceFeeUnits: token.gas_service_fee_units as string,
          operations: (token.operations ?? {}) as Record<string, boolean>,
          zeroNativeRevoke: Boolean(token.zero_native_revoke),
        })),
        raw: body,
      }
    },

    /**
     * Verify a payment against the chain. Returns a verdict, not an exception: `valid: false` with
     * `PAYMENT_CONFIRMING` means ask again in a few seconds about the SAME hash; the other codes
     * mean this transaction does not settle this intent. Only a malformed request, rate limiting or
     * an unreachable API throws.
     *
     * Pass back the `settlementReceipt` from an earlier confirmed verdict and the repeat answer
     * costs the API no chain reads. Verify deliberately ignores intent expiry: a settlement that
     * happened is a fact, however late you ask about it.
     */
    async verifyPayment(intent: string, txHash: string, settlementReceipt?: string): Promise<PaymentVerification> {
      const body = await postOrThrow('/v1/payments/verify', {
        intent,
        tx_hash: txHash,
        ...(settlementReceipt === undefined ? {} : { settlement_receipt: settlementReceipt }),
      })
      if (body.valid === true) {
        return {
          valid: true,
          txHash: body.tx_hash as string,
          reference: body.reference as string | undefined,
          amount: body.amount as string | undefined,
          blockNumber: body.block_number as string | undefined,
          blockHash: body.block_hash as string | undefined,
          settlementReceipt: body.settlement_receipt as string | undefined,
          raw: body,
        }
      }
      const code = ((body.code as string) ?? 'INTERNAL_ERROR') as ChargeStatus
      return { valid: false, code, action: ACTIONS[code] ?? 'RETRY_LATER', raw: body }
    },

    /**
     * Create subscription terms and a signed setup token.
     *
     * `period` is seconds - on-chain periods are seconds, however your plans phrase it. Hand the
     * token to the customer as `#/subscribe/<setup_token>`; their wallet authorizes, and the
     * finalize step turns their signature into the `p2s2.` charge capability your renewal job uses.
     * Keep the returned `salt`: it is how you prove a returned capability came from THIS checkout.
     */
    async createSubscription(terms: SubscriptionTerms): Promise<SubscriptionSetup> {
      const body = await postOrThrow('/v1/subscriptions', {
        recipient: terms.recipient,
        amount: terms.amount,
        period: terms.period,
        ...(terms.end === undefined ? {} : { end: terms.end }),
        ...(terms.allowance === undefined ? {} : { allowance: terms.allowance }),
      })
      return {
        setupToken: body.setup_token as string,
        expiresAt: body.expires_at as number,
        chainId: body.chain_id as number,
        contract: body.contract as string,
        amount: body.amount as string,
        salt: body.salt as string,
        raw: body,
      }
    },

    /** The authoritative terms plus the exact EIP-712 payload the customer's wallet must sign. */
    async resolveSubscription(setupToken: string): Promise<ResolvedSubscription> {
      const body = await postOrThrow('/v1/subscriptions/resolve', { setup_token: setupToken })
      return {
        recipient: body.recipient as string,
        amount: body.amount as string,
        amountUnits: body.amount_units as string,
        period: body.period as number,
        start: body.start as number,
        end: body.end as number,
        token: body.token as string,
        chainId: body.chain_id as number,
        contract: body.contract as string,
        salt: body.salt as string,
        maxGasReimbursement: body.max_gas_reimbursement as string,
        feeBps: body.fee_bps as number,
        networkFee: body.network_fee as string,
        networkFeeUnits: body.network_fee_units as string,
        networkFeeEstimate: (body.network_fee_estimate ?? null) as string | null,
        expiresAt: body.expires_at as number,
        typedData: (body.typed_data ?? {}) as Record<string, unknown>,
        raw: body,
      }
    },

    /**
     * Exchange the customer's EIP-712 signature for the `p2s2.` charge capability.
     *
     * The capability is the ONE thing your system stores per subscription - treat it like a
     * credential: encrypted at rest, never in a URL, never in a log. Everything else about the
     * subscription is reconstructed from the chain on demand.
     */
    async finalizeSubscription(setupToken: string, payer: string, signature: string): Promise<FinalizedSubscription> {
      const body = await postOrThrow('/v1/subscriptions/finalize', {
        setup_token: setupToken,
        payer,
        signature,
      })
      return {
        subscription: body.subscription as string,
        subscriptionId: body.subscription_id as string,
        amount: body.amount as string,
        period: body.period as number,
        end: body.end as number | undefined,
        raw: body,
      }
    },

    /**
     * Attempt one recurring charge. Never throws - inspect `status`/`action`. An unreachable API
     * comes back as NETWORK_ERROR / RETRY_LATER rather than an exception.
     *
     * Safe to retry: the contract allows one charge per billing period, so a repeat call after a
     * timeout or a crash returns ALREADY_CHARGED instead of charging again.
     */
    async charge(subscriptionRef: string): Promise<ChargeResult> {
      const body = await post('/v1/charges', { subscription: subscriptionRef })
        .then((res) => res.body)
        // An unreachable API is not a payment outcome, but a merchant loop should not have to
        // try/catch around it either: it comes back as NETWORK_ERROR / RETRY_LATER like any other
        // retryable result. The charge may or may not have landed; retrying is safe either way.
        .catch((err: unknown) =>
          err instanceof P2FluxError ? ({ error: err.status } as Record<string, unknown>) : Promise.reject(err),
        )
      const status = ((body.status as string) ?? (body.error as string) ?? 'INTERNAL_ERROR') as ChargeStatus
      const action = ((body.action as MerchantAction) ?? ACTIONS[status] ?? 'RETRY_LATER') as MerchantAction
      return {
        status,
        ok: status === 'CHARGED' || status === 'ALREADY_CHARGED',
        alreadyPaid: status === 'ALREADY_CHARGED',
        action,
        // WAIT is retryable in the only sense that matters here: ask the same question again.
        retryable: action === 'RETRY_LATER' || action === 'WAIT',
        txHash: body.tx_hash as string | undefined,
        amount: body.amount as string | undefined,
        subscriptionId: body.subscription_id as string | undefined,
        periodIndex: body.period_index as number | undefined,
        nextPeriodAt: body.next_period_at as string | undefined,
        raw: body,
      }
    },

    /** Current state, read straight from the chain. Use it to reconcile after downtime. */
    async status(subscriptionRef: string): Promise<SubscriptionStatus> {
      const body = await postOrThrow('/v1/subscriptions/status', { subscription: subscriptionRef })
      return {
        active: body.active as boolean,
        revoked: body.revoked as boolean,
        expired: body.expired as boolean,
        due: body.due as boolean,
        chargedThisPeriod: body.charged_this_period as boolean,
        subscriptionId: body.subscription_id as string,
        periodIndex: body.period_index as number | null,
        periodStart: body.period_start as string | null,
        periodEnd: body.period_end as string | null,
        nextPeriodAt: body.next_period_at as string | null,
        allowanceUnlimited: body.allowance_unlimited as boolean,
        raw: body,
      }
    },

    /**
     * Find the transaction that settled an intent, when its hash was lost.
     *
     * The failure this is for: the checkout window dies between the wallet returning a hash and
     * your server recording it. The money has moved, your order looks unpaid, and you have no
     * transaction to reconcile against. Give this the intent and it finds the settlement on chain -
     * you supply no hash and no hint of any kind, and the match is bound to the exact payment the
     * intent describes, so it can never hand you somebody else's transaction.
     *
     * Safe to call on a schedule for any order you are unsure about; it is pure reads and
     * idempotent. It also works long after the intent expired, because expiry stops a payment being
     * STARTED and says nothing about one that already happened.
     *
     * `found: false` with `PAYMENT_NOT_FOUND` means no settlement existed as of the block this was
     * computed at - NOT that the buyer will never pay. The contract does not enforce your intent's
     * expiry, so a slow wallet can still settle afterwards and a later call will find it. Stop
     * polling when your own business rules say to, never on the strength of one not-found.
     */
    async recoverPayment(intent: string): Promise<RecoveredPayment> {
      const { httpStatus, body } = await post('/v1/payments/recover', { intent })
      const status = ((body.code as string) ?? (body.error as string) ?? undefined) as ChargeStatus | undefined

      /* A payment that has not settled, and one that is still confirming, are both ANSWERS. Only a
       * broken request or a broken deployment throws. */
      if (httpStatus >= 400 && status !== 'PAYMENT_NOT_FOUND' && status !== 'PAYMENT_CONFIRMING') {
        throw new P2FluxError(status ?? 'INTERNAL_ERROR', ACTIONS[status ?? ''] ?? 'RETRY_LATER', body)
      }

      return {
        found: body.found === true,
        txHash: body.tx_hash as string | undefined,
        valid: body.valid === true,
        status,
        action: (status ? (ACTIONS[status] ?? 'RETRY_LATER') : 'SUCCESS') as MerchantAction,
        amount: body.amount as string | undefined,
        asOfBlock: body.as_of_block as string | undefined,
        raw: body,
      }
    },

    /**
     * The transaction that charged one recurring period, when its hash was lost.
     *
     * `ALREADY_CHARGED` proves a period was collected and names no transaction: P2Flux stores
     * nothing, so the hash lives only in the contract's log. Without it a paid period cannot be
     * attributed to an order, audited, or refunded - refunds start from the original settlement.
     *
     * The period index is required and exact. There is no "current period" form, because you are
     * reconciling one specific collection - today, or a year from now - and the answer must not
     * move under you. Take it from the charge result or from `status()`.
     *
     * A `hint` (your own attempt time or block) narrows the search and can never turn a miss into a
     * hit. Omitting it is always safe.
     */
    async recoverCharge(
      subscriptionRef: string,
      periodIndex: number,
      hint?: ChargeRecoveryHint,
    ): Promise<RecoveredCharge> {
      const payload: Record<string, unknown> = { subscription: subscriptionRef, period_index: periodIndex }
      const wire = {
        ...(hint?.attemptedAt === undefined ? {} : { attempted_at: hint.attemptedAt }),
        ...(hint?.block === undefined ? {} : { block: hint.block }),
      }
      if (Object.keys(wire).length > 0) payload.hint = wire

      const { httpStatus, body } = await post('/v1/charges/recover', payload)
      const status = ((body.code as string) ?? (body.error as string) ?? undefined) as ChargeStatus | undefined

      /* A period that was never collected, and one still confirming, are both ANSWERS - the same
       * rule recoverPayment() follows. Only a broken request or a broken deployment throws. */
      if (httpStatus >= 400 && status !== 'PAYMENT_NOT_FOUND' && status !== 'PAYMENT_CONFIRMING') {
        throw new P2FluxError(status ?? 'INTERNAL_ERROR', ACTIONS[status ?? ''] ?? 'RETRY_LATER', body)
      }

      return {
        found: body.found === true,
        subscriptionId: body.subscription_id as string | undefined,
        periodIndex: body.period_index as number | undefined,
        txHash: body.tx_hash as string | undefined,
        blockNumber: body.block_number as string | undefined,
        payer: body.payer as string | undefined,
        recipient: body.recipient as string | undefined,
        netUnits: body.net_units as string | undefined,
        feeUnits: body.fee_units as string | undefined,
        networkFeeUnits: body.network_fee_units as string | undefined,
        amountUnits: body.amount_units as string | undefined,
        status,
        action: (status ? (ACTIONS[status] ?? 'RETRY_LATER') : 'SUCCESS') as MerchantAction,
        asOfBlock: body.as_of_block as string | undefined,
        raw: body,
      }
    },

    /**
     * A session for restoring the token allowance one subscription needs.
     *
     * `INSUFFICIENT_ALLOWANCE` is not a dead subscription: the authorization the customer signed is
     * intact and you can still collect. What ran short is the ERC-20 allowance, and the fix is one
     * `approve()` from the customer's own wallet - no new signature, no new subscription. Hand them
     * `<checkout>/#/approve/<approveToken>`, wait for `p2flux.allowance.restored`, then charge the
     * SAME subscription again.
     */
    async createAllowanceRestoreSession(subscriptionRef: string): Promise<AllowanceRestoreSession> {
      const body = await postOrThrow('/v1/allowances/restore/session', { subscription: subscriptionRef })
      return {
        approveToken: body.approve_token as string,
        expiresAt: body.expires_at as number,
        payer: body.payer as string,
        subscriptionId: body.subscription_id as string,
        raw: body,
      }
    },

    /**
     * Read an allowance-restore session back: what to approve, and who must approve it.
     *
     * Browser-side, like the other resolve calls. The transaction is the customer's own standard
     * ERC-20 `approve()`, and the spender comes from here rather than from anything the page was
     * opened with.
     */
    async resolveAllowanceRestore(
      approveToken: string,
      /* With `payment_token` the response also carries a price and the two messages the customer
       * signs, and P2Flux sends the transaction. Without it, nothing changes: the customer's own
       * wallet sends the `approve()`. */
      gasPaymentMode?: GasPaymentMode,
    ): Promise<AllowanceRestoreTerms> {
      const body = await postOrThrow('/v1/allowances/restore/resolve', {
        approve_token: approveToken,
        ...(gasPaymentMode === undefined ? {} : { gas_payment_mode: gasPaymentMode }),
      })
      return {
        chainId: body.chain_id as number,
        token: body.token as string,
        spender: body.spender as string,
        payer: body.payer as string,
        subscriptionId: body.subscription_id as string,
        requiredUnits: body.required_units as string,
        approveUnits: (body.approve_units as string | null | undefined) ?? null,
        expiresAt: body.expires_at as number,
        gasPaymentMode: (body.gas_payment_mode ?? 'native') as GasPaymentMode,
        ...(body.sponsorship_quote === undefined
          ? {}
          : { sponsorshipQuote: networkFeeQuote(body.sponsorship_quote as Record<string, unknown>) }),
        raw: body,
      }
    },

    /**
     * A short-lived cancel token safe to hand to the customer's BROWSER (`#/cancel/<cancel_token>`).
     *
     * The `p2s2.` capability must never reach the customer's browser - it can charge them. This
     * token can only read the subscription and prepare its cancellation, and it expires on its own.
     */
    async createCancellationSession(subscriptionRef: string): Promise<CancellationSession> {
      const body = await postOrThrow('/v1/subscriptions/revoke/session', { subscription: subscriptionRef })
      return {
        cancelToken: body.cancel_token as string,
        expiresAt: body.expires_at as number,
        subscriptionId: body.subscription_id as string,
        payer: body.payer as string,
        raw: body,
      }
    },

    /** Calldata that cancels this one subscription. Only the customer's wallet can send it. */
    async prepareSubscriptionCancellation(subscriptionRef: string): Promise<PreparedTransaction> {
      const body = await postOrThrow('/v1/subscriptions/revoke/prepare', { subscription: subscriptionRef })
      return {
        chainId: body.chain_id as number,
        to: body.to as string,
        data: body.data as string,
        description: body.description as string,
        payer: body.payer as string,
      }
    },

    /**
     * Lock the terms of a refund, so the merchant's wallet can send it.
     *
     * A refund is a plain USDC transfer from the merchant's own wallet to the buyer's own wallet.
     * There is no refund contract, no relayer and no P2Flux custody in the path; P2Flux charges no
     * refund fee and returns none of its original commission, and the merchant pays the gas.
     *
     * `amountUnits` is micro-USDC as an integer string - `'2500000'` for 2.50. Floats are refused,
     * because a partial refund computed in floating point is a rounding bug waiting for an audit.
     * The maximum is the commercial amount the buyer actually paid, so a full refund means the
     * merchant absorbs the original P2Flux fee.
     *
     * **P2Flux keeps no refund history.** It cannot tell you whether this payment was already
     * refunded, and calling this twice will happily prepare two valid refunds. Enforcing one refund
     * per payment is your integration's job, and the safe place to do it is BEFORE this call:
     * reserve the order row atomically, then prepare.
     */
    async prepareRefund(original: RefundOriginal, amountUnits: string): Promise<RefundPreparation> {
      const body = await postOrThrow('/v1/refunds/prepare', { ...refundBody(original), amount: amountUnits })
      return {
        refundToken: body.refund_token as string,
        chainId: body.chain_id as number,
        token: body.token as string,
        merchant: body.merchant as string,
        payer: body.payer as string,
        originalAmount: body.original_amount as string,
        originalAmountUnits: body.original_amount_units as string,
        refundAmount: body.refund_amount as string,
        refundAmountUnits: body.refund_amount_units as string,
        expiresAt: body.expires_at as number,
        raw: body,
      }
    },

    /**
     * Did the refund actually happen, and has it settled?
     *
     * Takes the ORIGINAL settlement rather than the prepare token, deliberately: a refund may need
     * reconciling hours or days later - after a crash, or a support ticket - and a fifteen-minute
     * bearer token cannot answer that. Everything is re-derived from the chain on every call.
     *
     * A transaction hash is not a refund. This checks the receipt carries exactly one USDC transfer
     * from the original merchant to the original payer for exactly this amount, matched by EVENT
     * rather than by transaction sender - so a Safe or a smart account executing on the merchant's
     * behalf verifies correctly.
     *
     * Never throws for a refund that is merely still confirming: that comes back as
     * `confirming: true`, and the correct response is to poll this same hash.
     */
    async verifyRefund(
      original: RefundOriginal,
      amountUnits: string,
      refundTxHash: string,
    ): Promise<RefundVerification> {
      const { httpStatus, body } = await post('/v1/refunds/verify', {
        ...refundBody(original),
        refund_amount: amountUnits,
        refund_tx_hash: refundTxHash,
      })
      const status = ((body.status as string) ?? (body.error as string) ?? 'INTERNAL_ERROR') as ChargeStatus

      /* Confirming is not an error, whatever the HTTP status says. A merchant loop that had to
       * catch an exception to learn "wait a moment" is a loop that eventually refunds twice.
       *
       * The API answers 409 for this as of 2026-08-21, matching PAYMENT_CONFIRMING; it previously
       * answered 400. The check stays keyed on the CODE rather than the status so both answers
       * behave identically and an older deployment keeps working. */
      if (httpStatus >= 400 && status !== 'REFUND_CONFIRMING') {
        throw new P2FluxError(status, ACTIONS[status] ?? 'RETRY_LATER', body)
      }

      return {
        refunded: status === 'REFUNDED',
        confirming: status === 'REFUND_CONFIRMING',
        status,
        action: ((body.action as MerchantAction) ?? ACTIONS[status] ?? 'RETRY_LATER') as MerchantAction,
        /* The verify response names these `refund_*`. Reading `tx_hash`/`amount` here - the keys the
         * CHARGE response uses - meant both were silently undefined on every successful refund. */
        txHash: body.refund_tx_hash as string | undefined,
        amount: body.refund_amount as string | undefined,
        raw: body,
      }
    },

    /** What a refund token authorizes, read back by the page that holds it. */
    async resolveRefund(refundToken: string): Promise<ResolvedRefund> {
      const body = await postOrThrow('/v1/refunds/resolve', { refund_token: refundToken })
      return {
        chainId: body.chain_id as number,
        token: body.token as string,
        merchant: body.merchant as string,
        payer: body.payer as string,
        amount: body.amount as string,
        amountUnits: body.amount_units as string,
        expiresAt: body.expires_at as number,
        raw: body,
      }
    },

    /** Calldata that removes the token allowance entirely - stops every P2Flux subscription. */
    async prepareAllowanceRevocation(): Promise<PreparedTransaction> {
      const body = await postOrThrow('/v1/allowances/revoke/prepare', {})
      return {
        chainId: body.chain_id as number,
        to: body.to as string,
        data: body.data as string,
        description: body.description as string,
      }
    },
  }
}

export type P2Flux = ReturnType<typeof createP2Flux>
