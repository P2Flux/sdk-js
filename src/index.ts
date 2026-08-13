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
  | 'NOT_DUE'
  | 'INSUFFICIENT_BALANCE'
  | 'INSUFFICIENT_ALLOWANCE'
  | 'PERMISSION_REVOKED'
  | 'SUBSCRIPTION_EXPIRED'
  | 'INVALID_SUBSCRIPTION'
  | 'INVALID_REQUEST'
  | 'RPC_ERROR'
  | 'RELAYER_ERROR'
  | 'TRANSACTION_REVERTED'
  | 'INTERNAL_ERROR'
  | 'NETWORK_ERROR'
  // Infrastructure protection: the request was turned away before any money could move, so the
  // subscription is untouched and the call is safe to repeat.
  | 'RATE_LIMITED'
  | 'CONCURRENCY_LIMIT'

export type MerchantAction =
  | 'SUCCESS'
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
  NOT_DUE: 'RETRY_LATER',
  INSUFFICIENT_BALANCE: 'CUSTOMER_ACTION_REQUIRED',
  INSUFFICIENT_ALLOWANCE: 'CUSTOMER_ACTION_REQUIRED',
  PERMISSION_REVOKED: 'STOP_SUBSCRIPTION',
  SUBSCRIPTION_EXPIRED: 'STOP_SUBSCRIPTION',
  INVALID_SUBSCRIPTION: 'INVALID_REQUEST',
  INVALID_REQUEST: 'INVALID_REQUEST',
  RPC_ERROR: 'RETRY_LATER',
  RELAYER_ERROR: 'RETRY_LATER',
  TRANSACTION_REVERTED: 'RETRY_LATER',
  INTERNAL_ERROR: 'RETRY_LATER',
  NETWORK_ERROR: 'RETRY_LATER',
  RATE_LIMITED: 'RETRY_LATER',
  CONCURRENCY_LIMIT: 'RETRY_LATER',
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
        retryable: action === 'RETRY_LATER',
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
