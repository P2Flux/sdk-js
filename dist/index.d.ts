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
export type ChargeStatus = 'CHARGED' | 'ALREADY_CHARGED' | 'CONFIRMING' | 'PAYMENT_CONFIRMING' | 'NOT_DUE' | 'INSUFFICIENT_BALANCE' | 'INSUFFICIENT_ALLOWANCE' | 'PERMISSION_REVOKED' | 'SUBSCRIPTION_EXPIRED' | 'INVALID_SUBSCRIPTION' | 'INVALID_REQUEST' | 'AMOUNT_OUT_OF_BOUNDS' | 'PERIOD_OUT_OF_BOUNDS' | 'RPC_ERROR' | 'RELAYER_ERROR' | 'TRANSACTION_REVERTED' | 'INTERNAL_ERROR' | 'NETWORK_ERROR' | 'RATE_LIMITED' | 'CONCURRENCY_LIMIT' | 'GAS_TOO_HIGH' | 'GAS_QUOTE_UNAVAILABLE' | 'GAS_FEE_TOO_HIGH' | 'RELAYER_TX_COST_TOO_HIGH' | 'RELAYER_BUDGET_EXCEEDED' | 'RELAYER_NOT_READY' | 'RPC_BUSY';
export type MerchantAction = 'SUCCESS' | 'WAIT' | 'RETRY_LATER' | 'CUSTOMER_ACTION_REQUIRED' | 'STOP_SUBSCRIPTION' | 'INVALID_REQUEST';
export type ChargeResult = {
    status: ChargeStatus;
    /** True for CHARGED and ALREADY_CHARGED - both mean "this period is paid". */
    ok: boolean;
    /** True when the period was already collected by an earlier call. Retries are safe. */
    alreadyPaid: boolean;
    action: MerchantAction;
    /** Safe to try the identical call again later. Never true for terminal outcomes. */
    retryable: boolean;
    txHash?: string;
    amount?: string;
    subscriptionId?: string;
    periodIndex?: number;
    /** ISO timestamp: the earliest the next period can be charged. */
    nextPeriodAt?: string;
    /** The raw API body, for logging or fields added after this SDK was written. */
    raw: Record<string, unknown>;
};
export type SubscriptionStatus = {
    active: boolean;
    revoked: boolean;
    expired: boolean;
    due: boolean;
    chargedThisPeriod: boolean;
    subscriptionId: string;
    periodIndex: number | null;
    periodStart: string | null;
    periodEnd: string | null;
    nextPeriodAt: string | null;
    allowanceUnlimited: boolean;
    raw: Record<string, unknown>;
};
/** Calldata for the customer's own wallet to send. P2Flux cannot revoke wallet authority. */
export type PreparedTransaction = {
    chainId: number;
    to: string;
    data: string;
    description: string;
    payer?: string;
};
export declare class P2FluxError extends Error {
    readonly status: ChargeStatus;
    readonly action: MerchantAction;
    readonly raw: Record<string, unknown>;
    constructor(status: ChargeStatus, action: MerchantAction, raw?: Record<string, unknown>);
}
export type P2FluxOptions = {
    apiUrl: string;
    /**
     * Milliseconds before a request is abandoned as NETWORK_ERROR. Default 60 s: a charge waits for
     * on-chain confirmation, which on a busy public RPC can take tens of seconds. Abandoning it early
     * is safe but noisy - the payment may still land, and the next call returns ALREADY_CHARGED.
     */
    timeoutMs?: number;
    /** Injectable for tests; defaults to global fetch. */
    fetch?: typeof fetch;
};
export declare function createP2Flux(options: P2FluxOptions): {
    /**
     * Attempt one recurring charge. Never throws - inspect `status`/`action`. An unreachable API
     * comes back as NETWORK_ERROR / RETRY_LATER rather than an exception.
     *
     * Safe to retry: the contract allows one charge per billing period, so a repeat call after a
     * timeout or a crash returns ALREADY_CHARGED instead of charging again.
     */
    charge(subscriptionRef: string): Promise<ChargeResult>;
    /** Current state, read straight from the chain. Use it to reconcile after downtime. */
    status(subscriptionRef: string): Promise<SubscriptionStatus>;
    /** Calldata that cancels this one subscription. Only the customer's wallet can send it. */
    prepareSubscriptionCancellation(subscriptionRef: string): Promise<PreparedTransaction>;
    /** Calldata that removes the token allowance entirely - stops every P2Flux subscription. */
    prepareAllowanceRevocation(): Promise<PreparedTransaction>;
};
export type P2Flux = ReturnType<typeof createP2Flux>;
