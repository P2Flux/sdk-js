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
export type ChargeStatus = 'CHARGED' | 'ALREADY_CHARGED' | 'CONFIRMING' | 'PAYMENT_CONFIRMING' | 'REFUNDED' | 'REFUND_CONFIRMING' | 'REFUND_AMOUNT_INVALID' | 'REFUND_WRONG_MERCHANT' | 'REFUND_TRANSACTION_MISMATCH' | 'REFUND_ORIGINAL_PAYMENT_INVALID' | 'INVALID_REFUND_TOKEN' | 'REFUND_TOKEN_EXPIRED' | 'NOT_DUE' | 'INSUFFICIENT_BALANCE' | 'INSUFFICIENT_ALLOWANCE' | 'PERMISSION_REVOKED' | 'SUBSCRIPTION_EXPIRED' | 'INVALID_SUBSCRIPTION' | 'INVALID_REQUEST' | 'AMOUNT_OUT_OF_BOUNDS' | 'PERIOD_OUT_OF_BOUNDS' | 'RPC_ERROR' | 'RELAYER_ERROR' | 'TRANSACTION_REVERTED' | 'INTERNAL_ERROR' | 'NETWORK_ERROR' | 'RATE_LIMITED' | 'CONCURRENCY_LIMIT' | 'GAS_TOO_HIGH' | 'GAS_QUOTE_UNAVAILABLE' | 'GAS_FEE_TOO_HIGH' | 'RELAYER_TX_COST_TOO_HIGH' | 'RELAYER_BUDGET_EXCEEDED' | 'RELAYER_NOT_READY' | 'RPC_BUSY';
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
/**
 * Which settlement is being refunded: a one-time payment, or one period of a subscription.
 *
 * Identifiers only. The payer, the merchant, the token and the refundable maximum are all derived
 * from the chain by P2Flux - a caller cannot name any of them, which is what stops a refund call
 * from being a way to send money to an address of your choosing.
 */
export type RefundOriginal = {
    intent: string;
    txHash: string;
} | {
    subscription: string;
    txHash: string;
    periodIndex?: number;
};
export type RefundPreparation = {
    /**
     * Short-lived capability for the merchant's BROWSER, to be put in the checkout fragment.
     *
     * Do not store it. Reconciliation later uses `verifyRefund` with the original settlement, which
     * needs no token - keeping this one alive to work around its expiry would only add a secret at
     * rest without buying anything.
     */
    refundToken: string;
    chainId: number;
    token: string;
    /** The wallet that received the original payment. The only wallet that may send this refund. */
    merchant: string;
    /** The wallet that paid. The only possible recipient. */
    payer: string;
    /** The commercial amount of the original payment - the refundable maximum. */
    originalAmount: string;
    originalAmountUnits: string;
    refundAmount: string;
    refundAmountUnits: string;
    expiresAt: number;
    raw: Record<string, unknown>;
};
export type RefundVerification = {
    /** True only once the refund transfer is settled to the configured depth. */
    refunded: boolean;
    /** True while the transfer exists but has not settled. Poll the SAME hash; never send another. */
    confirming: boolean;
    status: ChargeStatus;
    action: MerchantAction;
    txHash?: string;
    amount?: string;
    raw: Record<string, unknown>;
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
    prepareRefund(original: RefundOriginal, amountUnits: string): Promise<RefundPreparation>;
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
    verifyRefund(original: RefundOriginal, amountUnits: string, refundTxHash: string): Promise<RefundVerification>;
    /** Calldata that removes the token allowance entirely - stops every P2Flux subscription. */
    prepareAllowanceRevocation(): Promise<PreparedTransaction>;
};
export type P2Flux = ReturnType<typeof createP2Flux>;
