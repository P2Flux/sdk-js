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
};
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
