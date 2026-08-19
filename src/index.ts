/**
 * P2Flux JS/TS SDK - a thin, dependency-free client over the HTTP API.
 *
 * P2Flux executes payments. Your application owns the subscription lifecycle: when a renewal is
 * due, who the customer is, what happens after a failure. There is deliberately no scheduler,
 * no polling and no state here - call `charge()` from your existing renewal job.
 *
 *   const p2flux = createP2Flux({ apiUrl: 'https://api.p2flux.example' })
 *   const result = await p2flux.charge(subscriptionRef)
 *   if (result.ok) markRenewalPaid()          // covers CHARGED and ALREADY_CHARGED
 *   else if (result.action === 'STOP_SUBSCRIPTION') cancelLocally()
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
       * catch an exception to learn "wait a moment" is a loop that eventually refunds twice. */
      if (httpStatus >= 400 && status !== 'REFUND_CONFIRMING') {
        throw new P2FluxError(status, ACTIONS[status] ?? 'RETRY_LATER', body)
      }

      return {
        refunded: status === 'REFUNDED',
        confirming: status === 'REFUND_CONFIRMING',
        status,
        action: ((body.action as MerchantAction) ?? ACTIONS[status] ?? 'RETRY_LATER') as MerchantAction,
        txHash: body.tx_hash as string | undefined,
        amount: body.amount as string | undefined,
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
