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
/** Wire shape: `txHash` is `tx_hash`, and the settlement key stays whatever the caller passed. */
const refundBody = (original) => {
    const { txHash, periodIndex, ...rest } = original;
    return {
        ...rest,
        tx_hash: txHash,
        ...(periodIndex === undefined ? {} : { period_index: periodIndex }),
    };
};
export class P2FluxError extends Error {
    status;
    action;
    raw;
    constructor(status, action, raw = {}) {
        super(status);
        this.status = status;
        this.action = action;
        this.raw = raw;
        this.name = 'P2FluxError';
    }
}
const ACTIONS = {
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
};
/** The wire shape of a quote, in the SDK's camelCase. */
const networkFeeQuote = (raw) => ({
    quotedNetworkFeeUnits: raw.quoted_network_fee_units,
    maxNetworkFeeUnits: raw.max_network_fee_units,
    gasServiceFeeUnits: raw.gas_service_fee_units,
    buyerTotalUnits: raw.buyer_total_units,
    quotedAt: raw.quoted_at,
    expiresAt: raw.expires_at,
    quote: raw.quote,
    raw,
});
export function createP2Flux(options) {
    const base = options.apiUrl.replace(/\/$/, '');
    const timeoutMs = options.timeoutMs ?? 60_000;
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const post = async (path, body) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetchImpl(`${base}${path}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            const parsed = (await res.json().catch(() => ({})));
            return { httpStatus: res.status, body: parsed };
        }
        catch {
            // Unreachable API, DNS failure, timeout: never a payment outcome, always retryable. The
            // charge may or may not have landed - retrying is safe either way, which is the point.
            throw new P2FluxError('NETWORK_ERROR', 'RETRY_LATER');
        }
        finally {
            clearTimeout(timer);
        }
    };
    /** Throwing variant for non-charge calls, where every failure really is exceptional. */
    const postOrThrow = async (path, body) => {
        const { httpStatus, body: payload } = await post(path, body);
        if (httpStatus >= 400) {
            const status = payload.error ?? 'INTERNAL_ERROR';
            throw new P2FluxError(status, ACTIONS[status] ?? 'RETRY_LATER', payload);
        }
        return payload;
    };
    return {
        /**
         * Create a signed one-time payment intent.
         *
         * The intent is a capability for exactly this recipient and amount - nothing else can settle
         * against it. Hand it to the buyer as a checkout link fragment (`#/pay/<intent>`); the fragment
         * never reaches a server log or a Referer header. Store the intent with your order: verify,
         * recovery and refunds all start from it.
         */
        async createPayment(terms) {
            const body = await postOrThrow('/v1/payments', {
                recipient: terms.recipient,
                amount: terms.amount,
                ...(terms.gasPaymentMode === undefined ? {} : { gas_payment_mode: terms.gasPaymentMode }),
            });
            const pay = (body.pay ?? {});
            return {
                intent: body.intent,
                reference: body.reference,
                amount: body.amount,
                expiresAt: body.expires_at,
                pay: {
                    chainId: pay.chain_id,
                    splitter: pay.splitter,
                    token: pay.token,
                    recipient: pay.recipient,
                    amountUnits: pay.amount_units,
                    reference: pay.reference,
                },
                raw: body,
            };
        },
        /** The authoritative terms for a checkout to display, read back from the intent itself. */
        async resolvePayment(intent) {
            const body = await postOrThrow('/v1/payments/resolve', { intent });
            return {
                recipient: body.recipient,
                amount: body.amount,
                amountUnits: body.amount_units,
                token: body.token,
                splitter: body.splitter,
                chainId: body.chain_id,
                reference: body.reference,
                expiresAt: body.expires_at,
                confirmationsRequired: (body.confirmations_required ?? null),
                gasPaymentMode: (body.gas_payment_mode ?? 'native'),
                ...(body.network_fee_quote === undefined
                    ? {}
                    : { networkFeeQuote: networkFeeQuote(body.network_fee_quote) }),
                raw: body,
            };
        },
        /**
         * Settle a payment whose buyer holds no native currency.
         *
         * The buyer signs the token authorization the checkout showed them; this hands that signature to
         * P2Flux, which sends the transaction and takes the quoted network fee out of the same
         * authorization. `CONFIRMING` means it is in flight - ask `verifyPayment` about the hash rather
         * than calling this again, because the buyer's authorization may already be spent.
         */
        async sponsorPayment(args) {
            const body = await postOrThrow('/v1/payments/sponsor', {
                intent: args.intent,
                quote: args.quote,
                payer: args.payer,
                signature: args.signature,
            });
            return {
                status: body.status,
                txHash: body.tx_hash,
                reference: body.reference,
                networkFeeUnits: body.network_fee_units,
                gasServiceFeeUnits: body.gas_service_fee_units,
                buyerTotalUnits: body.buyer_total_units,
                raw: body,
            };
        },
        /**
         * Carry a customer's signed allowance change onto the chain.
         *
         * `allowanceUnits: '0'` removes the allowance, which stops collection - it does NOT revoke the
         * recurring authorization, which only the payer's own transaction can do. Report the two
         * separately to customers.
         */
        async submitAllowanceRestore(args) {
            return postOrThrow('/v1/allowances/restore/submit', {
                approve_token: args.approveToken,
                quote: args.quote,
                permit_signature: args.permitSignature,
                network_fee_signature: args.networkFeeSignature,
                ...(args.allowanceUnits === undefined ? {} : { allowance_units: args.allowanceUnits }),
                ...(args.permitNonce === undefined ? {} : { permit_nonce: args.permitNonce }),
            });
        },
        /**
         * What this deployment supports, before you offer a buyer anything.
         *
         * Read it once at start-up rather than per checkout: it changes only when the deployment does.
         */
        async capabilities() {
            // POST, not GET: the endpoint answers both, and POST is the one shape every transport a host
            // might inject can make.
            const body = await postOrThrow('/v1/capabilities', {});
            return {
                chainId: body.chain_id,
                network: body.network,
                nativeCurrency: body.native_currency,
                supported: Boolean(body.supported),
                tokens: (body.tokens ?? []).map((token) => ({
                    address: token.address,
                    symbol: token.symbol,
                    decimals: token.decimals,
                    gasPaymentModes: token.gas_payment_modes,
                    gasServiceFeeUnits: token.gas_service_fee_units,
                    operations: (token.operations ?? {}),
                    zeroNativeRevoke: Boolean(token.zero_native_revoke),
                })),
                raw: body,
            };
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
        async verifyPayment(intent, txHash, settlementReceipt) {
            const body = await postOrThrow('/v1/payments/verify', {
                intent,
                tx_hash: txHash,
                ...(settlementReceipt === undefined ? {} : { settlement_receipt: settlementReceipt }),
            });
            if (body.valid === true) {
                return {
                    valid: true,
                    txHash: body.tx_hash,
                    reference: body.reference,
                    amount: body.amount,
                    blockNumber: body.block_number,
                    blockHash: body.block_hash,
                    settlementReceipt: body.settlement_receipt,
                    raw: body,
                };
            }
            const code = (body.code ?? 'INTERNAL_ERROR');
            return { valid: false, code, action: ACTIONS[code] ?? 'RETRY_LATER', raw: body };
        },
        /**
         * Create subscription terms and a signed setup token.
         *
         * `period` is seconds - on-chain periods are seconds, however your plans phrase it. Hand the
         * token to the customer as `#/subscribe/<setup_token>`; their wallet authorizes, and the
         * finalize step turns their signature into the `p2s2.` charge capability your renewal job uses.
         * Keep the returned `salt`: it is how you prove a returned capability came from THIS checkout.
         */
        async createSubscription(terms) {
            const body = await postOrThrow('/v1/subscriptions', {
                recipient: terms.recipient,
                amount: terms.amount,
                period: terms.period,
                ...(terms.end === undefined ? {} : { end: terms.end }),
                ...(terms.allowance === undefined ? {} : { allowance: terms.allowance }),
            });
            return {
                setupToken: body.setup_token,
                expiresAt: body.expires_at,
                chainId: body.chain_id,
                contract: body.contract,
                amount: body.amount,
                salt: body.salt,
                raw: body,
            };
        },
        /**
         * The authoritative terms plus the exact EIP-712 payload the customer's wallet must sign.
         *
         * `gasPaymentMode: 'payment_token'` with a `payer` is for a customer holding no native currency:
         * instead of sending an approval they sign one, and this prices the transaction P2Flux will send
         * for them. Both fields or neither - the price is for one specific wallet's allowance, which is
         * why the mode is asked for here rather than when the subscription was created.
         */
        async resolveSubscription(setupToken, options = {}) {
            const sponsored = options.gasPaymentMode === 'payment_token' && options.payer !== undefined;
            const body = await postOrThrow('/v1/subscriptions/resolve', {
                setup_token: setupToken,
                ...(sponsored ? { gas_payment_mode: options.gasPaymentMode, payer: options.payer } : {}),
            });
            return {
                recipient: body.recipient,
                amount: body.amount,
                amountUnits: body.amount_units,
                period: body.period,
                start: body.start,
                end: body.end,
                token: body.token,
                chainId: body.chain_id,
                contract: body.contract,
                salt: body.salt,
                maxGasReimbursement: body.max_gas_reimbursement,
                feeBps: body.fee_bps,
                networkFee: body.network_fee,
                networkFeeUnits: body.network_fee_units,
                networkFeeEstimate: (body.network_fee_estimate ?? null),
                expiresAt: body.expires_at,
                typedData: (body.typed_data ?? {}),
                ...(body.sponsorship_quote === undefined
                    ? {}
                    : {
                        sponsorship: {
                            quote: networkFeeQuote(body.sponsorship_quote),
                            allowancePermit: body.allowance_permit,
                            networkFeeAuthorization: body.network_fee_authorization,
                        },
                    }),
                raw: body,
            };
        },
        /**
         * Exchange the customer's EIP-712 signature for the `p2s2.` charge capability.
         *
         * The capability is the ONE thing your system stores per subscription - treat it like a
         * credential: encrypted at rest, never in a URL, never in a log. Everything else about the
         * subscription is reconstructed from the chain on demand.
         */
        async finalizeSubscription(setupToken, payer, signature, 
        /* For a customer with no native currency: the quote and the two signatures from `resolve`.
         * The capability is minted before any of this is spent, so a sponsorship that fails comes
         * back in `sponsorship` rather than as an error - the subscription is real either way. */
        sponsorship) {
            const body = await postOrThrow('/v1/subscriptions/finalize', {
                setup_token: setupToken,
                payer,
                signature,
                ...(sponsorship
                    ? {
                        sponsorship: {
                            quote: sponsorship.quote,
                            permit_signature: sponsorship.permitSignature,
                            network_fee_signature: sponsorship.networkFeeSignature,
                            ...(sponsorship.permitNonce === undefined ? {} : { permit_nonce: sponsorship.permitNonce }),
                        },
                    }
                    : {}),
            });
            const outcome = body.sponsorship;
            return {
                subscription: body.subscription,
                subscriptionId: body.subscription_id,
                amount: body.amount,
                period: body.period,
                end: body.end,
                ...(outcome === undefined
                    ? {}
                    : {
                        sponsorship: {
                            status: outcome.status,
                            txHash: outcome.tx_hash,
                            code: outcome.code,
                            raw: outcome,
                        },
                    }),
                raw: body,
            };
        },
        /**
         * Attempt one recurring charge. Never throws - inspect `status`/`action`. An unreachable API
         * comes back as NETWORK_ERROR / RETRY_LATER rather than an exception.
         *
         * Safe to retry: the contract allows one charge per billing period, so a repeat call after a
         * timeout or a crash returns ALREADY_CHARGED instead of charging again.
         */
        async charge(subscriptionRef) {
            const body = await post('/v1/charges', { subscription: subscriptionRef })
                .then((res) => res.body)
                // An unreachable API is not a payment outcome, but a merchant loop should not have to
                // try/catch around it either: it comes back as NETWORK_ERROR / RETRY_LATER like any other
                // retryable result. The charge may or may not have landed; retrying is safe either way.
                .catch((err) => err instanceof P2FluxError ? { error: err.status } : Promise.reject(err));
            const status = (body.status ?? body.error ?? 'INTERNAL_ERROR');
            const action = (body.action ?? ACTIONS[status] ?? 'RETRY_LATER');
            return {
                status,
                ok: status === 'CHARGED' || status === 'ALREADY_CHARGED',
                alreadyPaid: status === 'ALREADY_CHARGED',
                action,
                // WAIT is retryable in the only sense that matters here: ask the same question again.
                retryable: action === 'RETRY_LATER' || action === 'WAIT',
                txHash: body.tx_hash,
                amount: body.amount,
                subscriptionId: body.subscription_id,
                periodIndex: body.period_index,
                nextPeriodAt: body.next_period_at,
                raw: body,
            };
        },
        /** Current state, read straight from the chain. Use it to reconcile after downtime. */
        async status(subscriptionRef) {
            const body = await postOrThrow('/v1/subscriptions/status', { subscription: subscriptionRef });
            return {
                active: body.active,
                revoked: body.revoked,
                expired: body.expired,
                due: body.due,
                chargedThisPeriod: body.charged_this_period,
                subscriptionId: body.subscription_id,
                periodIndex: body.period_index,
                periodStart: body.period_start,
                periodEnd: body.period_end,
                nextPeriodAt: body.next_period_at,
                allowanceUnlimited: body.allowance_unlimited,
                raw: body,
            };
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
        async recoverPayment(intent) {
            const { httpStatus, body } = await post('/v1/payments/recover', { intent });
            const status = (body.code ?? body.error ?? undefined);
            /* A payment that has not settled, and one that is still confirming, are both ANSWERS. Only a
             * broken request or a broken deployment throws. */
            if (httpStatus >= 400 && status !== 'PAYMENT_NOT_FOUND' && status !== 'PAYMENT_CONFIRMING') {
                throw new P2FluxError(status ?? 'INTERNAL_ERROR', ACTIONS[status ?? ''] ?? 'RETRY_LATER', body);
            }
            return {
                found: body.found === true,
                txHash: body.tx_hash,
                valid: body.valid === true,
                status,
                action: (status ? (ACTIONS[status] ?? 'RETRY_LATER') : 'SUCCESS'),
                amount: body.amount,
                asOfBlock: body.as_of_block,
                raw: body,
            };
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
        async recoverCharge(subscriptionRef, periodIndex, hint) {
            const payload = { subscription: subscriptionRef, period_index: periodIndex };
            const wire = {
                ...(hint?.attemptedAt === undefined ? {} : { attempted_at: hint.attemptedAt }),
                ...(hint?.block === undefined ? {} : { block: hint.block }),
            };
            if (Object.keys(wire).length > 0)
                payload.hint = wire;
            const { httpStatus, body } = await post('/v1/charges/recover', payload);
            const status = (body.code ?? body.error ?? undefined);
            /* A period that was never collected, and one still confirming, are both ANSWERS - the same
             * rule recoverPayment() follows. Only a broken request or a broken deployment throws. */
            if (httpStatus >= 400 && status !== 'PAYMENT_NOT_FOUND' && status !== 'PAYMENT_CONFIRMING') {
                throw new P2FluxError(status ?? 'INTERNAL_ERROR', ACTIONS[status ?? ''] ?? 'RETRY_LATER', body);
            }
            return {
                found: body.found === true,
                subscriptionId: body.subscription_id,
                periodIndex: body.period_index,
                txHash: body.tx_hash,
                blockNumber: body.block_number,
                payer: body.payer,
                recipient: body.recipient,
                netUnits: body.net_units,
                feeUnits: body.fee_units,
                networkFeeUnits: body.network_fee_units,
                amountUnits: body.amount_units,
                status,
                action: (status ? (ACTIONS[status] ?? 'RETRY_LATER') : 'SUCCESS'),
                asOfBlock: body.as_of_block,
                raw: body,
            };
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
        async createAllowanceRestoreSession(subscriptionRef) {
            const body = await postOrThrow('/v1/allowances/restore/session', { subscription: subscriptionRef });
            return {
                approveToken: body.approve_token,
                expiresAt: body.expires_at,
                payer: body.payer,
                subscriptionId: body.subscription_id,
                raw: body,
            };
        },
        /**
         * Read an allowance-restore session back: what to approve, and who must approve it.
         *
         * Browser-side, like the other resolve calls. The transaction is the customer's own standard
         * ERC-20 `approve()`, and the spender comes from here rather than from anything the page was
         * opened with.
         */
        async resolveAllowanceRestore(approveToken, 
        /* With `payment_token` the response also carries a price and the two messages the customer
         * signs, and P2Flux sends the transaction. Without it, nothing changes: the customer's own
         * wallet sends the `approve()`. */
        gasPaymentMode) {
            const body = await postOrThrow('/v1/allowances/restore/resolve', {
                approve_token: approveToken,
                ...(gasPaymentMode === undefined ? {} : { gas_payment_mode: gasPaymentMode }),
            });
            return {
                chainId: body.chain_id,
                token: body.token,
                spender: body.spender,
                payer: body.payer,
                subscriptionId: body.subscription_id,
                requiredUnits: body.required_units,
                approveUnits: body.approve_units ?? null,
                expiresAt: body.expires_at,
                gasPaymentMode: (body.gas_payment_mode ?? 'native'),
                ...(body.sponsorship_quote === undefined
                    ? {}
                    : { sponsorshipQuote: networkFeeQuote(body.sponsorship_quote) }),
                raw: body,
            };
        },
        /**
         * A short-lived cancel token safe to hand to the customer's BROWSER (`#/cancel/<cancel_token>`).
         *
         * The `p2s2.` capability must never reach the customer's browser - it can charge them. This
         * token can only read the subscription and prepare its cancellation, and it expires on its own.
         */
        async createCancellationSession(subscriptionRef) {
            const body = await postOrThrow('/v1/subscriptions/revoke/session', { subscription: subscriptionRef });
            return {
                cancelToken: body.cancel_token,
                expiresAt: body.expires_at,
                subscriptionId: body.subscription_id,
                payer: body.payer,
                raw: body,
            };
        },
        /** Calldata that cancels this one subscription. Only the customer's wallet can send it. */
        async prepareSubscriptionCancellation(subscriptionRef) {
            const body = await postOrThrow('/v1/subscriptions/revoke/prepare', { subscription: subscriptionRef });
            return {
                chainId: body.chain_id,
                to: body.to,
                data: body.data,
                description: body.description,
                payer: body.payer,
            };
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
        async prepareRefund(original, amountUnits) {
            const body = await postOrThrow('/v1/refunds/prepare', { ...refundBody(original), amount: amountUnits });
            return {
                refundToken: body.refund_token,
                chainId: body.chain_id,
                token: body.token,
                merchant: body.merchant,
                payer: body.payer,
                originalAmount: body.original_amount,
                originalAmountUnits: body.original_amount_units,
                refundAmount: body.refund_amount,
                refundAmountUnits: body.refund_amount_units,
                expiresAt: body.expires_at,
                raw: body,
            };
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
        async verifyRefund(original, amountUnits, refundTxHash) {
            const { httpStatus, body } = await post('/v1/refunds/verify', {
                ...refundBody(original),
                refund_amount: amountUnits,
                refund_tx_hash: refundTxHash,
            });
            const status = (body.status ?? body.error ?? 'INTERNAL_ERROR');
            /* Confirming is not an error, whatever the HTTP status says. A merchant loop that had to
             * catch an exception to learn "wait a moment" is a loop that eventually refunds twice.
             *
             * The API answers 409 for this as of 2026-08-21, matching PAYMENT_CONFIRMING; it previously
             * answered 400. The check stays keyed on the CODE rather than the status so both answers
             * behave identically and an older deployment keeps working. */
            if (httpStatus >= 400 && status !== 'REFUND_CONFIRMING') {
                throw new P2FluxError(status, ACTIONS[status] ?? 'RETRY_LATER', body);
            }
            return {
                refunded: status === 'REFUNDED',
                confirming: status === 'REFUND_CONFIRMING',
                status,
                action: (body.action ?? ACTIONS[status] ?? 'RETRY_LATER'),
                /* The verify response names these `refund_*`. Reading `tx_hash`/`amount` here - the keys the
                 * CHARGE response uses - meant both were silently undefined on every successful refund. */
                txHash: body.refund_tx_hash,
                amount: body.refund_amount,
                raw: body,
            };
        },
        /** What a refund token authorizes, read back by the page that holds it. */
        async resolveRefund(refundToken) {
            const body = await postOrThrow('/v1/refunds/resolve', { refund_token: refundToken });
            return {
                chainId: body.chain_id,
                token: body.token,
                merchant: body.merchant,
                payer: body.payer,
                amount: body.amount,
                amountUnits: body.amount_units,
                expiresAt: body.expires_at,
                raw: body,
            };
        },
        /** Calldata that removes the token allowance entirely - stops every P2Flux subscription. */
        async prepareAllowanceRevocation() {
            const body = await postOrThrow('/v1/allowances/revoke/prepare', {});
            return {
                chainId: body.chain_id,
                to: body.to,
                data: body.data,
                description: body.description,
            };
        },
    };
}
