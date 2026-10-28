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
export type ChargeStatus = 'CHARGED' | 'ALREADY_CHARGED' | 'CONFIRMING' | 'PAYMENT_CONFIRMING' | 'PAYMENT_NOT_FOUND' | 'PAYMENT_RECOVERY_INCONSISTENT' | 'RECOVERY_UNAVAILABLE' | 'REFUNDED' | 'REFUND_CONFIRMING' | 'REFUND_AMOUNT_INVALID' | 'REFUND_WRONG_MERCHANT' | 'REFUND_TRANSACTION_MISMATCH' | 'REFUND_ORIGINAL_PAYMENT_INVALID' | 'INVALID_REFUND_TOKEN' | 'REFUND_TOKEN_EXPIRED' | 'NOT_DUE' | 'INSUFFICIENT_BALANCE' | 'INSUFFICIENT_ALLOWANCE' | 'PERMISSION_REVOKED' | 'SUBSCRIPTION_EXPIRED' | 'INVALID_SUBSCRIPTION' | 'INVALID_REQUEST' | 'AMOUNT_OUT_OF_BOUNDS' | 'PERIOD_OUT_OF_BOUNDS' | 'RPC_ERROR' | 'RELAYER_ERROR' | 'TRANSACTION_REVERTED' | 'INTERNAL_ERROR' | 'NETWORK_ERROR' | 'RATE_LIMITED' | 'CONCURRENCY_LIMIT' | 'GAS_TOO_HIGH' | 'GAS_QUOTE_UNAVAILABLE' | 'GAS_FEE_TOO_HIGH' | 'RELAYER_TX_COST_TOO_HIGH' | 'RELAYER_BUDGET_EXCEEDED' | 'RELAYER_NOT_READY' | 'RPC_BUSY' | 'PAYMENT_TOKEN_GAS_UNSUPPORTED' | 'PAYMENT_TOKEN_GAS_UNAVAILABLE' | 'PAYMENT_TOKEN_GAS_QUOTE_EXPIRED' | 'PAYMENT_TOKEN_GAS_LIMIT_EXCEEDED' | 'INVALID_GAS_QUOTE' | 'INSUFFICIENT_PAYMENT_TOKEN_FOR_GAS' | 'SPONSORED_TRANSACTION_FAILED' | 'SPONSORED_PERMIT_FAILED' | 'SPONSORSHIP_CONFIRMING' | 'INVALID_INTENT' | 'INTENT_EXPIRED' | 'INVALID_REFERENCE' | 'INVALID_LINK' | 'LINK_EXPIRED' | 'LINK_UNAVAILABLE' | 'ALREADY_SUBSCRIBED' | 'PAYER_SANCTIONED' | 'RECIPIENT_SANCTIONED' | 'INVALID_SETUP_TOKEN' | 'SETUP_TOKEN_EXPIRED' | 'INVALID_CANCEL_TOKEN' | 'CANCEL_TOKEN_EXPIRED' | 'TERMS_MISMATCH' | 'PERMISSION_NOT_FOUND' | 'TRANSACTION_NOT_FOUND' | 'PAYMENT_ALREADY_PROCESSED' | 'WRONG_SPENDER' | 'WRONG_TOKEN' | 'INVALID_EXTRA_DATA' | 'INVALID_SIGNATURE' | 'SIGNATURE_VALIDATION_TOO_EXPENSIVE' | 'UNSUPPORTED_SIGNATURE_FORMAT' | 'WEBHOOK_SIGNATURE_INVALID' | 'WEBHOOK_TOO_OLD';
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
    /** The charge's own merchant_ref (`charge(ref, { merchantRef })`), else the subscription's, when the API echoes one. */
    merchantRef?: string;
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
    /** Present when created with `merchantRef`. */
    merchantRef?: string;
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
    /** Present when the intent was created with `merchantRef`; `referenceSalt` proves it (`checkMerchantRef`). */
    merchantRef?: string;
    referenceSalt?: string;
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
    /** Present when the API echoes the charge's (or subscription's) merchant_ref. */
    merchantRef?: string;
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
    gasPaymentMode?: GasPaymentMode;
    /** Present only when the repair is sponsored: what the customer pays for the transaction. */
    sponsorshipQuote?: NetworkFeeQuote;
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
    /** Present when the original payment was created with `merchantRef`. */
    merchantRef?: string;
    raw: Record<string, unknown>;
};
/** Terms for a one-time payment: who gets paid, and how much USDC (decimal string, "12.50"). */
/**
 * How the buyer pays the chain's network fee.
 *
 * `native` is what has always happened: the buyer sends the transaction and pays gas in the chain's
 * own currency. `payment_token` lets a buyer who holds only the payment token pay - P2Flux sends the
 * transaction and the buyer reimburses the quoted network cost in that same token, plus a flat gas
 * service fee. Ask `capabilities()` before offering it; not every network and token supports it.
 */
export type GasPaymentMode = 'native' | 'payment_token';
export type PaymentTerms = {
    recipient: string;
    amount: string;
    /** Omit for `native`. Existing integrations keep their current behaviour and fees exactly. */
    gasPaymentMode?: GasPaymentMode;
    /**
     * Optional webhook: a public https URL P2Flux POSTs a `payment.paid` event to once this payment is
     * verified on chain. Omit it and nothing changes. Answer it with `handleNotification`.
     */
    notifyUrl?: string;
    /**
     * Optional: where the hosted checkout sends the buyer after paying (https; http on the test network
     * only). The buyer arrives with `p2flux_reference`, `p2flux_tx` and `p2flux_status` (`paid` or
     * `confirming`) in the query. A convenience, never proof: confirm with `verifyPayment` or a webhook.
     */
    returnUrl?: string;
    /**
     * Optional, Base only: also offer the buyer "Pay privately with Hinkal" on the hosted checkout (paid
     * from the buyer's Hinkal private balance). Settlement and fees to you are unchanged; such a payment
     * cannot be refunded automatically (`refundable: false`). Native gas only.
     */
    privatePayment?: 'hinkal';
    /**
     * Optional: your own order or invoice number, echoed by verify, recover, webhooks and refunds.
     * ASCII letters, digits and `. _ : / # -`, 1-64 characters (no spaces, no `@`). Signed, not
     * encrypted: the buyer can read it, so never personal data. The on-chain reference then commits to
     * it (`referenceSalt`, `checkMerchantRef`). Needs an API with merchant_ref (older ones refuse it).
     */
    merchantRef?: string;
};
/** What one sponsored operation will cost the buyer, and how long the price stands. */
export type NetworkFeeQuote = {
    /** The price the buyer accepts and pays. Not a measurement of gas used. */
    quotedNetworkFeeUnits: string;
    /** The ceiling that price may not exceed. */
    maxNetworkFeeUnits: string;
    /**
     * The fixed network fee on a one-time payment, in base units. Zero outside one-time payments.
     *
     * MERCHANT-funded: it comes out of the amount, like the percentage fee, and is paid to the gas
     * treasury - the same arrangement a subscription has. It is not part of `buyerTotalUnits`; a
     * buyer is debited the price plus the quoted network fee and never a P2Flux fee on top.
     */
    fixedNetworkFeeUnits: string;
    /** Price plus fees plus the payment itself, for a one-time payment. */
    buyerTotalUnits?: string;
    quotedAt: number;
    expiresAt: number;
    /** Opaque; hand it back to `sponsorPayment` unchanged. */
    quote: string;
    raw: Record<string, unknown>;
};
/** Every unit of a settled payment, read from the chain. */
export type PaymentAccounting = {
    paymentUnits: string;
    paymentFeeUnits: string;
    networkFeeUnits: string;
    /** Merchant-funded, out of the amount. Not part of `buyerTotalUnits`. */
    fixedNetworkFeeUnits: string;
    merchantNetUnits: string;
    buyerTotalUnits: string;
    payer?: string;
    /**
     * `false` when the payment came through a privacy service (e.g. Hinkal): on chain the payer is that
     * service's contract, so P2Flux will not prepare a refund - return it to an address the buyer gives
     * you. Absent means refundable as usual (and on older API builds).
     */
    refundable?: false;
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
    /** Present when the payment was created with `notifyUrl`. */
    notifyUrl?: string;
    /** Present when the payment was created with `returnUrl`. */
    returnUrl?: string;
    /** Present when the payment offers "Pay privately with Hinkal". */
    privatePayment?: 'hinkal';
    /**
     * P2Flux's hosted payment page for this payment (pay.p2flux.com): send the buyer here. Absent from
     * older APIs. A self-hosted checkout builds its own address with `checkoutLink()` instead.
     */
    checkoutUrl?: string;
    /** Present when created with `merchantRef`, with the salt that proves `reference` commits to it (`checkMerchantRef`). */
    merchantRef?: string;
    referenceSalt?: string;
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
    gasPaymentMode: GasPaymentMode;
    /** Present only in `payment_token` mode: what the buyer will pay for the network, and until when. */
    networkFeeQuote?: NetworkFeeQuote;
    /** Present when the payment carries a return URL. */
    returnUrl?: string;
    /** Present when the payment offers "Pay privately with Hinkal". */
    privatePayment?: 'hinkal';
    /** Present when created with `merchantRef`. */
    merchantRef?: string;
    raw: Record<string, unknown>;
};
/** The result of asking P2Flux to settle a payment the buyer funded with a signature. */
export type SponsoredPaymentResult = {
    /** `SUBMITTED` once it is mined; `CONFIRMING` while its fate is still unknown - never re-send. */
    status: 'SUBMITTED' | 'CONFIRMING';
    txHash: string;
    reference: string;
    networkFeeUnits: string;
    fixedNetworkFeeUnits: string;
    buyerTotalUnits: string;
    /** What the transaction actually cost P2Flux, for reconciliation. The buyer paid the quote. */
    nativeGasSpentWei?: string;
    blockNumber?: string;
    raw: Record<string, unknown>;
};
/**
 * ECB euro reference rates (`rates()`): units of USD and GBP per 1 EUR, per calendar day. A day the ECB
 * did not publish carries the last published day's rates, named in `rateDate`.
 */
/** From `createMerchantToken()`: send `merchantToken` as `createP2Flux({ merchantToken })`. */
export type MerchantToken = {
    merchantToken: string;
    wallet: string;
    expiresAt: number;
    raw: Record<string, unknown>;
};
export type Rates = {
    source: 'ECB';
    base: 'EUR';
    /** Unix seconds: when P2Flux last downloaded the rates from the ECB. */
    fetchedAt: number;
    rates: Record<string, {
        USD: number;
        GBP: number;
        rateDate: string;
    }>;
};
/** What a deployment can actually do, per token and per operation. */
export type Capabilities = {
    chainId: number;
    network?: string;
    nativeCurrency?: string;
    supported: boolean;
    tokens: {
        address: string;
        symbol: string;
        decimals: number;
        gasPaymentModes: GasPaymentMode[];
        fixedNetworkFeeUnits: string;
        operations: Record<string, boolean>;
        /**
         * The contract that carries each sponsored operation, or null where it is not offered.
         *
         * A checkout holds an offer's fee recipient against this rather than against the offer itself:
         * the network's own declaration, from a different endpoint than the one that made the offer.
         */
        sponsorContracts: Record<string, string | null>;
        /** Revoking a recurring authorization is always the payer's own transaction. */
        zeroNativeRevoke: boolean;
    }[];
    /** The public keys webhooks are signed with (see `verifyWebhook`). Absent when the API sends no webhooks, and on older APIs. */
    webhookSigningKeys?: WebhookSigningKey[];
    raw: Record<string, unknown>;
};
/** One Ed25519 key P2Flux signs webhooks with: `publicKey` is the raw 32 bytes, base64url. */
export type WebhookSigningKey = {
    kid: string;
    alg: 'Ed25519';
    publicKey: string;
};
export type VerifyWebhookOptions = {
    /** kid -> base64url public key. Default: the API's own, from `capabilities()`, fetched once and cached. */
    keys?: Record<string, string>;
    /** How far the signature's time may be from now, in seconds. Default 300. */
    toleranceSec?: number;
    /** Unix seconds, for tests. Default: the clock. */
    now?: number;
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
    /**
     * Every unit of this payment, read off the chain. Present on a sponsored settlement, where a
     * merchant reconciles what it funded against what the buyer paid; absent on older API builds.
     */
    accounting?: PaymentAccounting;
    gasPaymentMode?: GasPaymentMode;
    /**
     * Sanctions screening of the wallet that paid (and the one that signed) against the U.S. OFAC
     * list: `sanctioned` - the payment stays valid, but P2Flux will not prepare a refund to that
     * wallet; `unknown` - no list was loaded at that moment. Absent on older API builds.
     */
    screening?: 'clear' | 'sanctioned' | 'unknown';
    /** Present when the intent was created with `merchantRef`; `referenceSalt` proves it (`checkMerchantRef`). */
    merchantRef?: string;
    referenceSalt?: string;
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
    /** Your own order/invoice number (`MERCHANT_REF`: ASCII letters, digits and `. _ : / # -`, 1-64; signed, not encrypted - the buyer can read it, so never personal data). Needs an API with merchant_ref. */
    merchantRef?: string;
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
    /** Present when created with `merchantRef`. */
    merchantRef?: string;
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
    /** Only when resolved in `payment_token` mode: what the customer signs instead of approving. */
    sponsorship?: SubscriptionSponsorship;
    /** Present when created with `merchantRef`. */
    merchantRef?: string;
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
    /**
     * Only when a sponsorship was sent. The subscription exists whatever this says: the capability is
     * minted from a signature that costs nothing, and an allowance that did not get set is repairable
     * from the restore flow. `ALREADY_SETTLED` is a repeat of a request that already worked.
     */
    sponsorship?: {
        status: 'SETTLED' | 'SPONSORSHIP_CONFIRMING' | 'ALREADY_SETTLED' | 'FAILED';
        txHash?: string;
        code?: string;
        raw: Record<string, unknown>;
    };
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
/** Payment links: an invoice paid once, a fixed price paid many times, or a subscription P2Flux collects. */
export type PaymentLinkKind = 'once' | 'reusable' | 'subscription';
export type PaymentLinkTerms = {
    kind: PaymentLinkKind;
    recipient: string;
    /** Decimal USDC, e.g. "10.00". */
    amount: string;
    /** Optional note for the buyer, up to 60 characters, no web or mail addresses. */
    label?: string;
    /** Unix seconds. Default 7 days for an invoice, a year otherwise. */
    expiresAt?: number;
    /** One-time kinds: the buyer pays the network fee in USDC (no ETH needed). Fixed for the link's life. */
    gasPaymentMode?: GasPaymentMode;
    /** Subscriptions: seconds between charges, at least one day; the amount at least 1 USDC. */
    period?: number;
    /** Subscriptions: number of charges; omit for until cancelled. */
    periods?: number;
    /** Subscriptions: days without a payment after which a subscriber is paused (1..90, default 7). */
    suspendAfterDays?: number;
    /**
     * Optional webhook for every payment through the link: `payment.paid` (one-time kinds) or
     * `subscription.charged` / `subscription.updated`. Answer it with `handleNotification`.
     */
    notifyUrl?: string;
    /** Optional: where the hosted checkout sends the buyer after paying, as for a payment (subscriptions: `p2flux_subscription` instead of `p2flux_reference`). */
    returnUrl?: string;
    /** `once` and `reusable` links (not subscriptions), Base only: also offer "Pay privately with Hinkal" (see `PaymentTerms.privatePayment`). */
    privatePayment?: 'hinkal';
    /** Your own order/invoice number (`MERCHANT_REF`: ASCII letters, digits and `. _ : / # -`, 1-64; signed, not encrypted - the buyer can read it, so never personal data). Needs an API with merchant_ref. */
    merchantRef?: string;
};
/** A link's terms, as the API states them. */
export type PaymentLinkTermsView = {
    kind: PaymentLinkKind;
    id: string;
    chainId: number;
    recipient: string;
    amount: string;
    amountUnits: string;
    label?: string;
    returnUrl?: string;
    createdAt: number;
    expiresAt: number;
    /** One-time kinds. */
    gasPaymentMode?: GasPaymentMode;
    /** `once` / `reusable` links that offer "Pay privately with Hinkal". */
    privatePayment?: 'hinkal';
    /** Subscriptions. */
    period?: number;
    periods?: number;
    suspendAfterDays?: number;
    /** Present when created with `merchantRef`. */
    merchantRef?: string;
};
export type PaymentLink = PaymentLinkTermsView & {
    /** The public link token. Send `checkoutLink('link', link)` to buyers. */
    link: string;
    /** The private manage token. Your overview: `checkoutLink('links', manage)`. Keep it private. */
    manage: string;
    /** Present when the link was created with `notifyUrl`. */
    notifyUrl?: string;
    /** P2Flux's hosted payment page for this link. Absent from older APIs; self-hosted: `checkoutLink()`. */
    checkoutUrl?: string;
    raw: Record<string, unknown>;
};
/** What `handleNotification` concluded about one webhook. Fulfil only when `confirmed`. */
export type NotificationResult = {
    confirmed: boolean;
    /** The event's own id, as sent. Informational only: anyone can make one up - deduplicate on `dedupeKey`. */
    eventId: string;
    /**
     * When confirmed: what to fulfil idempotently on, built from the verified answer - `reference:txHash`
     * for a payment, `subscriptionId:lastPeriod` for a charge. Absent for `subscription.updated`: apply
     * `subscriber.state`.
     */
    dedupeKey?: string;
    type: 'payment.paid' | 'subscription.charged' | 'subscription.updated' | string;
    /** Why it is not confirmed: a verify code (e.g. TERMS_MISMATCH), NOT_YOUR_ORDER, NOT_FOUND, NOT_CURRENT, NOT_CHARGED, MALFORMED, UNKNOWN_EVENT. */
    reason?: string;
    /** payment.paid: the API's own verdict. */
    payment?: PaymentVerification;
    /** payment.paid confirmed, created with `merchantRef`: from the verdict (never from the event body). */
    merchantRef?: string;
    referenceSalt?: string;
    /** subscription.*: the subscriber as the manage view shows it now. */
    subscriber?: PaymentLinkSubscriber;
};
/** One webhook event's delivery record (`webhookDeliveries`). */
export type WebhookDelivery = {
    id: string;
    type: string;
    createdAt: number;
    /** `status` 0 means no HTTP answer (timeout, refused connection). */
    attempts: {
        at: number;
        status: number;
        durationMs: number;
    }[];
    /** Unix seconds of the next try; null when finished. */
    nextAt: number | null;
    outcome: string;
};
export type WebhookDeliveries = {
    events: WebhookDelivery[];
    raw: Record<string, unknown>;
};
export type PaymentLinkPayment = {
    txHash: string;
    blockNumber: string;
    reference: string;
    amountUnits: string;
    payer?: string;
    timestamp?: number;
    /** Manage view: `false` when paid through a privacy service (not refundable to `payer`). */
    refundable?: false;
    /** Manage view: `sanctioned`, or `unknown` for a privacy-service payment (not screened). */
    screening?: 'sanctioned' | 'unknown';
};
export type PaymentLinkSubscriber = {
    subscriptionId: string;
    payer: string;
    state: 'active' | 'stopped' | 'suspended' | 'ended';
    startedAt: number;
    /** The last period collected (counting from 0). */
    lastPeriod: number;
    /** Periods collected so far (0.10+ API; absent from older ones). */
    paidCount?: number;
    lastTx?: string;
    nextAttemptAt?: number;
    lastCode?: string;
};
export type PaymentLinkStatus = PaymentLinkTermsView & {
    state: 'open' | 'expired';
    /** Manage view only: the public link, to share again. */
    link?: string;
    /** Invoices: why a payment found on chain is not counted yet (e.g. PAYMENT_CONFIRMING). */
    code?: string;
    /** Reusable links: no later payment is possible. */
    final?: boolean;
    /** Reusable links: more than 5,000 payments; the list stops there. */
    truncated?: boolean;
    /** Invoices: paid or not. */
    paid?: boolean;
    payment?: PaymentLinkPayment;
    /** Reusable links, with the manage token: payments read from the chain so far. */
    payments?: PaymentLinkPayment[];
    /** Everything up to the chain's safe block has been read; ask again for more when false. */
    complete?: boolean;
    subscribers?: PaymentLinkSubscriber[];
    raw: Record<string, unknown>;
};
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
    /**
     * Where buyers open the checkout, for `checkoutLink()`. Defaults to P2Flux's hosted checkout for
     * the API you use (`api.p2flux.com` -> `https://pay.p2flux.com`, `api-test.p2flux.com` ->
     * `https://pay-test.p2flux.com`). Set it to your own address when you host the checkout yourself,
     * for example `https://pay.yourcompany.com` or `https://yourcompany.com/pay`.
     */
    checkoutUrl?: string;
    /**
     * A token from `createMerchantToken()`, sent as the `p2flux-merchant-token` header. Requests paying
     * the token's wallet are then rate limited per wallet (higher) instead of per IP. Capacity only.
     */
    merchantToken?: string;
    /** For confirmed partners: `<kid>.<secret>`, sent as the `p2flux-partner-key` header. */
    partnerKey?: string;
};
/** The pages of the checkout a link can open. */
/** `link` opens a payment link for a buyer; `links` is the merchant's private overview of one. */
export type CheckoutPage = 'pay' | 'subscribe' | 'cancel' | 'refund' | 'approve' | 'link' | 'links';
/**
 * The two messages a customer with no native currency signs to set their allowance, and the price
 * of the transaction that carries them. Both are complete EIP-712 payloads - pass them to the
 * wallet as they are, and add the standard's own `EIP712Domain` type.
 */
export type SubscriptionSponsorship = {
    quote: NetworkFeeQuote;
    allowancePermit: Record<string, unknown>;
    networkFeeAuthorization: Record<string, unknown>;
};
/** The rule the API applies to a merchant_ref. */
export declare const MERCHANT_REF: RegExp;
/**
 * The exact text a receiving wallet signs with `personal_sign` for `createMerchantToken()`. `chainId` is
 * the API's network (`capabilities().chainId`); `issuedAt` unix seconds, at most 5 minutes old when sent;
 * `apiUrl` the API you send it to (the same `apiUrl` as `createP2Flux`) - its origin is in the text, so
 * the signature is good at that deployment only.
 */
export declare function merchantTokenMessage(chainId: number, wallet: string, issuedAt: number, apiUrl: string): string;
/**
 * Does this on-chain `reference` commit to your `merchantRef`? True exactly when
 * `reference == keccak256("p2flux.merchant_ref.v1" || salt || merchantRef)`, computed here with no
 * call to P2Flux - so you, or an auditor you hand the salt to, can prove which order a payment on
 * chain settled. `salt` is the `referenceSalt` the payment came back with. Malformed input is false.
 */
export declare function checkMerchantRef(reference: string, salt: string, merchantRef: string): boolean;
export declare function createP2Flux(options: P2FluxOptions): {
    /**
     * Check a webhook's `p2flux-signature` header and return the parsed event.
     *
     * Pass the body EXACTLY as received (the raw string or bytes, before any JSON parsing) and the
     * header's value. Throws P2FluxError `WEBHOOK_SIGNATURE_INVALID` (not signed by P2Flux, or
     * changed) or `WEBHOOK_TOO_OLD` (signed more than `toleranceSec` from now - a replay, or a
     * clock to fix); both have action INVALID_REQUEST. Fetching the keys can throw NETWORK_ERROR.
     *
     * A valid signature proves P2Flux sent this event, not that money moved: still decide on
     * money with `verifyPayment` (or `handleNotification`, which does both).
     */
    verifyWebhook(rawBody: string | Uint8Array, header: string, options?: VerifyWebhookOptions): Promise<Record<string, unknown>>;
    /**
     * The address that opens a checkout page for a token the API issued: `pay` for a payment intent,
     * `subscribe` for a setup token, `cancel`, `refund` and `approve` for theirs. The token goes in
     * the fragment, which browsers never send to a server or put in a Referer header.
     *
     * Uses `checkoutUrl`, or P2Flux's hosted checkout for the API you use; throws when neither is
     * known (an API address of your own needs an explicit `checkoutUrl`).
     */
    checkoutLink(page: CheckoutPage, token: string): string;
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
     * Settle a payment whose buyer holds no native currency.
     *
     * The buyer signs the token authorization the checkout showed them; this hands that signature to
     * P2Flux, which sends the transaction and takes the quoted network fee out of the same
     * authorization. `CONFIRMING` means it is in flight - ask `verifyPayment` about the hash rather
     * than calling this again, because the buyer's authorization may already be spent.
     */
    sponsorPayment(args: {
        intent: string;
        quote: string;
        payer: string;
        signature: string;
    }): Promise<SponsoredPaymentResult>;
    /**
     * Carry a customer's signed allowance change onto the chain.
     *
     * `allowanceUnits: '0'` removes the allowance, which stops collection - it does NOT revoke the
     * recurring authorization, which only the payer's own transaction can do. Report the two
     * separately to customers.
     */
    submitAllowanceRestore(args: {
        approveToken: string;
        quote: string;
        permitSignature: string;
        networkFeeSignature: string;
        allowanceUnits?: string;
        permitNonce?: string;
    }): Promise<Record<string, unknown>>;
    /**
     * ECB daily euro reference rates for USD and GBP, `from`..`to` (YYYY-MM-DD, at most 366 days), from
     * P2Flux's own copy. For statements in EUR or GBP; USDC counts as USD 1:1.
     */
    rates(range: {
        from: string;
        to: string;
    }): Promise<Rates>;
    /**
     * Prove your receiving wallet once for higher limits: sign `merchantTokenMessage(chainId, wallet,
     * issuedAt, apiUrl)` with that wallet (`personal_sign`; a Safe works too), then pass the token back as
     * `createP2Flux({ merchantToken })`. Valid 30 days; it moves no money and opens no data.
     */
    createMerchantToken(input: {
        wallet: string;
        signature: string;
        issuedAt: number;
    }): Promise<MerchantToken>;
    /**
     * What this deployment supports, before you offer a buyer anything.
     *
     * Read it once at start-up rather than per checkout: it changes only when the deployment does.
     */
    capabilities(): Promise<Capabilities>;
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
    /**
     * The authoritative terms plus the exact EIP-712 payload the customer's wallet must sign.
     *
     * `gasPaymentMode: 'payment_token'` with a `payer` is for a customer holding no native currency:
     * instead of sending an approval they sign one, and this prices the transaction P2Flux will send
     * for them. Both fields or neither - the price is for one specific wallet's allowance, which is
     * why the mode is asked for here rather than when the subscription was created.
     */
    resolveSubscription(setupToken: string, options?: {
        gasPaymentMode?: GasPaymentMode;
        payer?: string;
    }): Promise<ResolvedSubscription>;
    /**
     * Exchange the customer's EIP-712 signature for the `p2s2.` charge capability.
     *
     * The capability is the ONE thing your system stores per subscription - treat it like a
     * credential: encrypted at rest, never in a URL, never in a log. Everything else about the
     * subscription is reconstructed from the chain on demand.
     */
    finalizeSubscription(setupToken: string, payer: string, signature: string, sponsorship?: {
        quote: string;
        permitSignature: string;
        networkFeeSignature: string;
        permitNonce?: string;
    }): Promise<FinalizedSubscription>;
    /**
     * Attempt one recurring charge. Never throws - inspect `status`/`action`. An unreachable API
     * comes back as NETWORK_ERROR / RETRY_LATER rather than an exception.
     *
     * Safe to retry: the contract allows one charge per billing period, so a repeat call after a
     * timeout or a crash returns ALREADY_CHARGED instead of charging again.
     *
     * `merchantRef`: this charge's own invoice number (same rules as `PaymentTerms.merchantRef`),
     * echoed on the result and by `recoverCharge`. Needs an API with merchant_ref.
     */
    charge(subscriptionRef: string, options?: {
        merchantRef?: string;
    }): Promise<ChargeResult>;
    /**
     * Create a payment link - nothing is stored. Send `checkoutLink('link', link.link)` to buyers
     * (e-mail, chat, QR); keep `link.manage` for yourself.
     */
    createPaymentLink(terms: PaymentLinkTerms): Promise<PaymentLink>;
    /**
     * What a buyer's checkout does with a link: an intent (one-time kinds) or a setup token
     * (subscriptions). Only needed for a checkout of your own; the P2Flux checkout calls it itself.
     */
    openPaymentLink(link: string, payer?: string): Promise<Record<string, unknown>>;
    /**
     * For a checkout of your own: join a subscription link with the capability the buyer just signed
     * (finalizeSubscription). P2Flux charges the first period at once and keeps the subscription only
     * when that charge landed or is on its way. Same answers as `charge()`, never throws.
     */
    subscribePaymentLink(link: string, subscriptionRef: string): Promise<ChargeResult & {
        collectedBy?: "p2flux" | "merchant";
    }>;
    /** What a link has collected. With `{ manage }`: who paid, every payment, every subscriber. */
    paymentLinkStatus(token: {
        link: string;
    } | {
        manage: string;
    }): Promise<PaymentLinkStatus>;
    /** "Collect now" for one subscriber of your subscription link. Same answers as `charge()`. */
    collectPaymentLink(manage: string, subscriptionId: string): Promise<ChargeResult>;
    /** Stop collecting one subscriber (reversible with `collectPaymentLink`). Only the buyer can revoke on chain. */
    stopPaymentLink(manage: string, subscriptionId: string): Promise<{
        subscriptionId: string;
        state: string;
    }>;
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
    resolveAllowanceRestore(approveToken: string, gasPaymentMode?: GasPaymentMode): Promise<AllowanceRestoreTerms>;
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
    /**
     * What P2Flux did with the webhooks of one payment (`{ intent }`) or one payment link
     * (`{ manage }`): every event, every attempt's time, HTTP status (0 = no answer) and duration,
     * and when the next try is due. Kept 7 days; no bodies, no URLs.
     */
    webhookDeliveries(token: {
        intent: string;
    } | {
        manage: string;
    }): Promise<WebhookDeliveries>;
    /**
     * "Retry now" for one webhook event that is still pending (see `webhookDeliveries`): P2Flux
     * sends it at once instead of at its next scheduled try. At most 3 times per event per hour.
     */
    redeliverWebhook(token: {
        intent: string;
    } | {
        manage: string;
    }, eventId: string): Promise<Record<string, unknown>>;
    /** Calldata that removes the token allowance entirely - stops every P2Flux subscription. */
    prepareAllowanceRevocation(): Promise<PreparedTransaction>;
    /**
     * Answer a webhook from P2Flux (the body of the POST to your `notifyUrl`, as a string or parsed).
     *
     * A notification is a hint, never a proof: it carries no secret. This asks the API again - verify
     * for a payment, the manage view for a subscription - and checks the answer belongs to YOUR order:
     * pass the `reference` you stored with the order (createPayment), or your payment link's `linkId`
     * (plus its `manage` token for subscription events).
     *
     * - `payment.paid` confirmed: fulfil idempotently on `dedupeKey` (`reference:txHash`, from the API's
     *   verdict - never the event's own id, which anyone can make up).
     * - `subscription.charged` confirmed: the subscriber is paid through `subscriber.lastPeriod`; grant
     *   access up to there (idempotent on `dedupeKey`), never "one more period per event".
     * - `subscription.updated` confirmed: apply `subscriber.state` as it is now (no `dedupeKey`: setting a
     *   state twice is harmless, skipping one is not).
     *
     * Answer the POST with a 2xx when this returns. It THROWS when the answer is not final yet (a payment
     * still confirming, the API busy or unreachable): answer with a 5xx then, and P2Flux sends it again.
     * A wrong, forged or replayed event returns `confirmed: false`, and when the event does not even name
     * your order nothing is asked of the API. TypeError on a missing or malformed `expect`.
     *
     * Optional `expect.signature`: the `p2flux-signature` header. Given, the raw body (a string) is
     * checked first (`verifyWebhook`, with `keys` / `toleranceSec` as there) and a bad or stale one
     * returns `confirmed: false` with reason WEBHOOK_SIGNATURE_INVALID / WEBHOOK_TOO_OLD.
     */
    handleNotification(notification: string | Record<string, unknown>, expect: {
        reference?: string;
        linkId?: string;
        manage?: string;
        signature?: string;
    } & Omit<VerifyWebhookOptions, "now">): Promise<NotificationResult>;
};
export type P2Flux = ReturnType<typeof createP2Flux>;
