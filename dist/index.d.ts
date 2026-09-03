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
export type ChargeStatus = 'CHARGED' | 'ALREADY_CHARGED' | 'CONFIRMING' | 'PAYMENT_CONFIRMING' | 'PAYMENT_NOT_FOUND' | 'PAYMENT_RECOVERY_INCONSISTENT' | 'RECOVERY_UNAVAILABLE' | 'REFUNDED' | 'REFUND_CONFIRMING' | 'REFUND_AMOUNT_INVALID' | 'REFUND_WRONG_MERCHANT' | 'REFUND_TRANSACTION_MISMATCH' | 'REFUND_ORIGINAL_PAYMENT_INVALID' | 'INVALID_REFUND_TOKEN' | 'REFUND_TOKEN_EXPIRED' | 'NOT_DUE' | 'INSUFFICIENT_BALANCE' | 'INSUFFICIENT_ALLOWANCE' | 'PERMISSION_REVOKED' | 'SUBSCRIPTION_EXPIRED' | 'INVALID_SUBSCRIPTION' | 'INVALID_REQUEST' | 'AMOUNT_OUT_OF_BOUNDS' | 'PERIOD_OUT_OF_BOUNDS' | 'RPC_ERROR' | 'RELAYER_ERROR' | 'TRANSACTION_REVERTED' | 'INTERNAL_ERROR' | 'NETWORK_ERROR' | 'RATE_LIMITED' | 'CONCURRENCY_LIMIT' | 'GAS_TOO_HIGH' | 'GAS_QUOTE_UNAVAILABLE' | 'GAS_FEE_TOO_HIGH' | 'RELAYER_TX_COST_TOO_HIGH' | 'RELAYER_BUDGET_EXCEEDED' | 'RELAYER_NOT_READY' | 'RPC_BUSY' | 'INVALID_INTENT' | 'INTENT_EXPIRED' | 'INVALID_REFERENCE' | 'INVALID_SETUP_TOKEN' | 'SETUP_TOKEN_EXPIRED' | 'INVALID_CANCEL_TOKEN' | 'CANCEL_TOKEN_EXPIRED' | 'TERMS_MISMATCH' | 'PERMISSION_NOT_FOUND' | 'TRANSACTION_NOT_FOUND' | 'PAYMENT_ALREADY_PROCESSED' | 'WRONG_SPENDER' | 'WRONG_TOKEN' | 'INVALID_EXTRA_DATA' | 'INVALID_SIGNATURE' | 'SIGNATURE_VALIDATION_TOO_EXPENSIVE' | 'UNSUPPORTED_SIGNATURE_FORMAT';
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
export type RecoveredPayment = {
    /** True when a settling transaction exists on chain and was located. */
    found: boolean;
    /** The transaction that settled this intent. Present whenever `found`. */
    txHash?: string;
    /** True only once that transaction is settled to the required depth. */
    valid: boolean;
    /** `PAYMENT_CONFIRMING` while it is still settling, `PAYMENT_NOT_FOUND` when nothing has. */
    status?: ChargeStatus;
    action: MerchantAction;
    amount?: string;
    /** The block the answer was computed at. A not-found is only true as of this height. */
    asOfBlock?: string;
    raw: Record<string, unknown>;
};
/**
 * The settlement of one recurring period, recovered from the chain.
 *
 * `found: false` is ordinary rather than an error: there is no catch-up billing, so a period that
 * was never collected is a normal history, and a later period having been charged says nothing
 * about an earlier one. Like a recovered payment, a miss is a statement about one block height.
 */
export type RecoveredCharge = {
    found: boolean;
    subscriptionId?: string;
    periodIndex?: number;
    /** The transaction that charged this exact period. Present whenever `found`. */
    txHash?: string;
    blockNumber?: string;
    payer?: string;
    recipient?: string;
    netUnits?: string;
    feeUnits?: string;
    networkFeeUnits?: string;
    /** net + fee + networkFee: the amount the authorization signed for. Check it against your order. */
    amountUnits?: string;
    status?: ChargeStatus;
    action: MerchantAction;
    /** Only on a miss. The head this answer was computed at. */
    asOfBlock?: string;
    raw: Record<string, unknown>;
};
/** Where your own records say a charge was attempted. Narrows the search; never evidence. */
export type ChargeRecoveryHint = {
    attemptedAt?: number;
    block?: number;
};
/**
 * A session for restoring the token allowance one subscription needs.
 *
 * The narrowest token P2Flux issues: it cannot charge, cannot revoke and cannot refund. Open
 * `<checkout>/#/approve/<approveToken>`.
 */
export type AllowanceRestoreSession = {
    approveToken: string;
    expiresAt: number;
    payer: string;
    subscriptionId: string;
    raw: Record<string, unknown>;
};
/** What an allowance-restore session authorizes - for the browser holding it. */
export type AllowanceRestoreTerms = {
    chainId: number;
    token: string;
    /** The recurring contract. Never a value the page was opened with. */
    spender: string;
    payer: string;
    subscriptionId: string;
    /** The signed amount plus the gas reimbursement the next charge may add. */
    requiredUnits: string;
    /** What to approve, in base units; null means unlimited. The setup's own mode, kept on repair. */
    approveUnits: string | null;
    expiresAt: number;
    raw: Record<string, unknown>;
};
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
/** Terms for a one-time payment: who gets paid, and how much USDC (decimal string, "12.50"). */
export type PaymentTerms = {
    recipient: string;
    amount: string;
};
export type PaymentIntent = {
    /** Signed capability for this exact payment. Put it in the checkout link fragment: `#/pay/<intent>`. */
    intent: string;
    /** The on-chain payment reference (bytes32) the settlement will carry. */
    reference: string;
    amount: string;
    /** Unix seconds. Expiry stops a payment being STARTED; it never makes a settlement unverifiable. */
    expiresAt: number;
    /** What a checkout needs to call the splitter. Nothing secret. */
    pay: {
        chainId: number;
        splitter: string;
        token: string;
        recipient: string;
        amountUnits: string;
        reference: string;
    };
    raw: Record<string, unknown>;
};
/** The authoritative terms a checkout should display, read back from an intent. */
export type ResolvedPayment = {
    recipient: string;
    amount: string;
    amountUnits: string;
    token: string;
    splitter: string;
    chainId: number;
    reference: string;
    expiresAt: number;
    /** How many confirmations a verify will wait for; null when the API leaves it to its default. */
    confirmationsRequired: number | null;
    raw: Record<string, unknown>;
};
/**
 * A verification verdict - a real discriminated union, so `if (result.valid)` narrows.
 *
 * `valid: false` is a 200-level ANSWER, not an exception: `PAYMENT_CONFIRMING` while the
 * transaction settles (ask again in a few seconds), `TRANSACTION_REVERTED` / `TERMS_MISMATCH` /
 * `WRONG_TOKEN` and friends when the transaction does not pay this intent. Only a broken request
 * or the API being unreachable throws.
 */
export type PaymentVerification = {
    valid: true;
    txHash: string;
    reference?: string;
    amount?: string;
    blockNumber?: string;
    blockHash?: string;
    /**
     * Sealed proof of this CONFIRMED verdict, valid ~10 minutes. Present it on a repeat verify of
     * the same intent + hash and the API answers without re-reading the chain. Store it only as a
     * short-lived optimization - never as the payment record.
     */
    settlementReceipt?: string;
    raw: Record<string, unknown>;
} | {
    valid: false;
    code: ChargeStatus;
    /** Local guidance for the code: WAIT means poll the same hash, INVALID_REQUEST means stop. */
    action: MerchantAction;
    raw: Record<string, unknown>;
};
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
export type AllowanceMode = 'unlimited' | 'until_end' | {
    periods: number;
};
export type SubscriptionTerms = {
    recipient: string;
    amount: string;
    period: number;
    end?: number;
    /** Standing allowance the checkout asks for. Omit for unlimited. */
    allowance?: AllowanceMode;
};
export type SubscriptionSetup = {
    /** Signed setup token. Put it in the checkout link fragment: `#/subscribe/<setup_token>`. */
    setupToken: string;
    /** Unix seconds - the window the customer has to authorize. */
    expiresAt: number;
    chainId: number;
    /** The recurring contract the customer will authorize. Read from the API, never hard-coded. */
    contract: string;
    amount: string;
    /** Ties a returned capability back to THIS checkout - compare before attaching it to an order. */
    salt: string;
    raw: Record<string, unknown>;
};
/** The authoritative terms plus the exact EIP-712 payload the customer's wallet signs. */
export type ResolvedSubscription = {
    recipient: string;
    amount: string;
    amountUnits: string;
    period: number;
    start: number;
    end: number;
    token: string;
    chainId: number;
    contract: string;
    salt: string;
    maxGasReimbursement: string;
    feeBps: number;
    networkFee: string;
    networkFeeUnits: string;
    networkFeeEstimate: string | null;
    expiresAt: number;
    typedData: Record<string, unknown>;
    raw: Record<string, unknown>;
};
export type FinalizedSubscription = {
    /**
     * The charge capability (`p2s2.`). The ONE thing your system stores per subscription -
     * encrypted at rest, never in a URL or a log. Everything else is reconstructed from the chain.
     */
    subscription: string;
    subscriptionId: string;
    amount: string;
    period: number;
    end?: number;
    raw: Record<string, unknown>;
};
export type CancellationSession = {
    /** Short-lived token safe to hand to the customer's BROWSER: `#/cancel/<cancel_token>`. */
    cancelToken: string;
    expiresAt: number;
    subscriptionId: string;
    payer: string;
    raw: Record<string, unknown>;
};
/** A refund token read back by the browser holding it - what a cancel/refund page displays. */
export type ResolvedRefund = {
    chainId: number;
    token: string;
    merchant: string;
    payer: string;
    amount: string;
    amountUnits: string;
    expiresAt: number;
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
     * Create a signed one-time payment intent.
     *
     * The intent is a capability for exactly this recipient and amount - nothing else can settle
     * against it. Hand it to the buyer as a checkout link fragment (`#/pay/<intent>`); the fragment
     * never reaches a server log or a Referer header. Store the intent with your order: verify,
     * recovery and refunds all start from it.
     */
    createPayment(terms: PaymentTerms): Promise<PaymentIntent>;
    /** The authoritative terms for a checkout to display, read back from the intent itself. */
    resolvePayment(intent: string): Promise<ResolvedPayment>;
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
    verifyPayment(intent: string, txHash: string, settlementReceipt?: string): Promise<PaymentVerification>;
    /**
     * Create subscription terms and a signed setup token.
     *
     * `period` is seconds - on-chain periods are seconds, however your plans phrase it. Hand the
     * token to the customer as `#/subscribe/<setup_token>`; their wallet authorizes, and the
     * finalize step turns their signature into the `p2s2.` charge capability your renewal job uses.
     * Keep the returned `salt`: it is how you prove a returned capability came from THIS checkout.
     */
    createSubscription(terms: SubscriptionTerms): Promise<SubscriptionSetup>;
    /** The authoritative terms plus the exact EIP-712 payload the customer's wallet must sign. */
    resolveSubscription(setupToken: string): Promise<ResolvedSubscription>;
    /**
     * Exchange the customer's EIP-712 signature for the `p2s2.` charge capability.
     *
     * The capability is the ONE thing your system stores per subscription - treat it like a
     * credential: encrypted at rest, never in a URL, never in a log. Everything else about the
     * subscription is reconstructed from the chain on demand.
     */
    finalizeSubscription(setupToken: string, payer: string, signature: string): Promise<FinalizedSubscription>;
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
    recoverPayment(intent: string): Promise<RecoveredPayment>;
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
    recoverCharge(subscriptionRef: string, periodIndex: number, hint?: ChargeRecoveryHint): Promise<RecoveredCharge>;
    /**
     * A session for restoring the token allowance one subscription needs.
     *
     * `INSUFFICIENT_ALLOWANCE` is not a dead subscription: the authorization the customer signed is
     * intact and you can still collect. What ran short is the ERC-20 allowance, and the fix is one
     * `approve()` from the customer's own wallet - no new signature, no new subscription. Hand them
     * `<checkout>/#/approve/<approveToken>`, wait for `p2flux.allowance.restored`, then charge the
     * SAME subscription again.
     */
    createAllowanceRestoreSession(subscriptionRef: string): Promise<AllowanceRestoreSession>;
    /**
     * Read an allowance-restore session back: what to approve, and who must approve it.
     *
     * Browser-side, like the other resolve calls. The transaction is the customer's own standard
     * ERC-20 `approve()`, and the spender comes from here rather than from anything the page was
     * opened with.
     */
    resolveAllowanceRestore(approveToken: string): Promise<AllowanceRestoreTerms>;
    /**
     * A short-lived cancel token safe to hand to the customer's BROWSER (`#/cancel/<cancel_token>`).
     *
     * The `p2s2.` capability must never reach the customer's browser - it can charge them. This
     * token can only read the subscription and prepare its cancellation, and it expires on its own.
     */
    createCancellationSession(subscriptionRef: string): Promise<CancellationSession>;
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
    /** What a refund token authorizes, read back by the page that holds it. */
    resolveRefund(refundToken: string): Promise<ResolvedRefund>;
    /** Calldata that removes the token allowance entirely - stops every P2Flux subscription. */
    prepareAllowanceRevocation(): Promise<PreparedTransaction>;
};
export type P2Flux = ReturnType<typeof createP2Flux>;
