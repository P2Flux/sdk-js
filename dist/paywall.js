/**
 * Charge AI agents for a route, in USDC, over x402 - without an x402 library.
 *
 *   import { createPaywall } from '@p2flux/sdk/paywall'
 *   const paywall = createPaywall({ apiUrl: 'https://api.p2flux.com', recipient: '0xYourWallet', price: '0.05' })
 *   app.get('/report', paywall.express(), (req, res) => res.json(report))          // Express
 *   export default { fetch: paywall.wrap((request) => new Response('paid content')) }  // Workers, Bun, Hono, Next
 *
 * You say who is paid and how much. P2Flux builds what the agent signs and settles what it sends
 * (pay-per-request, and prepaid balance when the deployment offers it). The payment is settled BEFORE
 * your handler runs: one payment, one response. Money goes to your wallet; P2Flux keeps its fee on
 * chain and never holds it.
 */
/** AI crawlers and assistants, and HTTP libraries agents are built on. Same list as the WordPress plugin. */
export const AGENT_SIGNATURES = [
    'GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'anthropic-ai', 'PerplexityBot',
    'Perplexity-User', 'CCBot', 'Bytespider', 'Amazonbot', 'meta-externalagent', 'meta-externalfetcher', 'cohere-ai',
    'cohere-training-data-crawler', 'Diffbot', 'YouBot', 'DuckAssistBot', 'MistralAI-User', 'AI2Bot', 'Timpibot', 'ImagesiftBot',
    'Omgilibot', 'Google-CloudVertexBot', 'Kangaroo Bot', 'PanguBot', 'Novellum',
    'P2Flux-MCP', 'x402', 'python-requests', 'python-httpx', 'aiohttp', 'axios/', 'node-fetch', 'undici', 'Go-http-client', 'okhttp', 'curl/', 'Wget/', 'Scrapy', 'libwww-perl',
];
/** Never asked to pay under `agentsOnly`: search engines and link previews. */
const NEVER = ['Googlebot', 'bingbot', 'DuckDuckBot', 'Applebot', 'YandexBot', 'Baiduspider', 'Slackbot', 'facebookexternalhit', 'Twitterbot', 'LinkedInBot', 'Discordbot', 'WhatsApp', 'TelegramBot'];
/** Whether a request is an AI agent or a program rather than a person's browser. */
export function isAgent(userAgent, hasPayment) {
    if (hasPayment)
        return true;
    const ua = (userAgent ?? '').trim();
    if (ua === '' || ua.toLowerCase() === 'node')
        return true;
    const lower = ua.toLowerCase();
    if (NEVER.some((n) => lower.includes(n.toLowerCase())))
        return false;
    return AGENT_SIGNATURES.some((s) => lower.includes(s.toLowerCase()));
}
const MAX_HEADER = 8192;
const USED_TTL_MS = 600_000;
const MAX_USED = 10_000;
const b64 = (value) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = '';
    for (const b of bytes)
        binary += String.fromCharCode(b);
    return btoa(binary);
};
const NO_STORE = { 'cache-control': 'no-store, private' };
export function createPaywall(options) {
    const base = options.apiUrl.replace(/\/$/, '');
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const timeoutMs = options.timeoutMs ?? 25_000;
    const challenges = new Map();
    // Payments this process already took: refused without asking P2Flux (which would refuse them too).
    const used = new Map();
    const post = async (path, body) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetchImpl(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
            return { status: res.status, body: (await res.json().catch(() => ({}))) };
        }
        catch {
            return null;
        }
        finally {
            clearTimeout(timer);
        }
    };
    const unavailable = () => options.onUnavailable === 'free'
        ? { allow: true, paid: false, headers: {} }
        : { allow: false, status: 503, headers: { 'retry-after': '60', ...NO_STORE }, body: { error: 'payment_service_unavailable' } };
    const accepts = async (price) => {
        const hit = challenges.get(price);
        if (hit && hit.until > Date.now())
            return hit.accepts;
        const res = await post('/x402/paywall/challenge', { recipient: options.recipient, price });
        if (res?.status === 400)
            throw new Error(`P2Flux refused the paywall configuration (recipient ${options.recipient}, price ${price}): ${String(res.body.error ?? 'INVALID_REQUEST')}`);
        if (!res || res.status !== 200 || !Array.isArray(res.body.accepts))
            return null;
        const list = options.prepaid === false ? res.body.accepts.filter((a) => a?.scheme !== 'batch-settlement') : res.body.accepts;
        const ttl = Math.min(3600, Math.max(60, Number(res.body.ttl) || 600));
        challenges.set(price, { accepts: list, until: Date.now() + ttl * 1000 });
        return list;
    };
    const required = async (input, price, error) => {
        const list = await accepts(price);
        if (!list)
            return unavailable();
        const body = { x402Version: 2, ...(error ? { error } : {}), resource: { url: input.url, mimeType: input.mimeType ?? 'application/json' }, accepts: list };
        return { allow: false, status: 402, headers: { 'payment-required': b64(body), ...NO_STORE }, body };
    };
    /** The framework-neutral core: decide one request. */
    async function guard(input) {
        const price = input.price ?? options.price;
        const header = input.paymentHeader ?? null;
        if (options.agentsOnly && !isAgent(input.userAgent, header !== null))
            return { allow: true, paid: false, headers: {} };
        if (header === null)
            return required(input, price);
        if (header.length > MAX_HEADER || !/^[A-Za-z0-9+/]+={0,2}$/.test(header))
            return required(input, price, 'invalid_payload');
        const now = Date.now();
        if ((used.get(header) ?? 0) > now)
            return required(input, price, 'invalid_transaction_state');
        const res = await post('/x402/paywall/redeem', { recipient: options.recipient, price, payment: header, resource: input.url.slice(0, 2048) });
        if (res?.status === 400)
            throw new Error(`P2Flux refused the paywall configuration: ${String(res.body.error ?? 'INVALID_REQUEST')}`);
        if (!res || res.status !== 200)
            return unavailable();
        const answer = res.body;
        const remember = () => {
            // Bounded: the oldest entry goes first (a Map keeps insertion order).
            while (used.size >= MAX_USED)
                used.delete(used.keys().next().value);
            used.set(header, now + USED_TTL_MS);
        };
        if (answer.paid === true) {
            remember();
            return {
                allow: true,
                paid: true,
                headers: { ...(typeof answer.payment_response === 'string' ? { 'payment-response': answer.payment_response } : {}), ...NO_STORE },
                ...(typeof answer.payer === 'string' ? { payer: answer.payer } : {}),
                ...(typeof answer.transaction === 'string' ? { transaction: answer.transaction } : {}),
                ...(typeof answer.receipt === 'string' ? { receipt: answer.receipt } : {}),
                ...(typeof answer.scheme === 'string' ? { scheme: answer.scheme } : {}),
            };
        }
        const reason = typeof answer.reason === 'string' ? answer.reason : 'payment_refused';
        if (reason === 'invalid_transaction_state')
            remember();
        // A prepaid refusal carries P2Flux's own 402: the channel state the agent resynchronises to.
        if (typeof answer.payment_required === 'string') {
            let body = { error: reason };
            try {
                body = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(answer.payment_required), (c) => c.charCodeAt(0))));
            }
            catch {
                /* the header is forwarded as it is */
            }
            return { allow: false, status: 402, headers: { 'payment-required': answer.payment_required, ...NO_STORE }, body };
        }
        return required(input, price, reason);
    }
    const headerOf = (get) => get('payment-signature') ?? get('x-payment') ?? null;
    return {
        guard,
        /** Wrap a Fetch-API handler (Workers, Bun, Deno, Hono, Next route handlers). */
        wrap(handler, overrides = {}) {
            return async (request, ...rest) => {
                const result = await guard({ url: request.url, paymentHeader: headerOf((n) => request.headers.get(n)), userAgent: request.headers.get('user-agent'), ...overrides });
                if (!result.allow)
                    return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'content-type': 'application/json', ...result.headers } });
                const response = await handler(request, ...rest);
                if (!Object.keys(result.headers).length)
                    return response;
                const headers = new Headers(response.headers);
                for (const [k, v] of Object.entries(result.headers))
                    headers.set(k, v);
                return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
            };
        },
        /** Express / Connect middleware. */
        express(overrides = {}) {
            return async (req, res, next) => {
                try {
                    const one = (v) => (Array.isArray(v) ? v[0] : v);
                    const host = one(req.headers.host) ?? 'localhost';
                    const result = await guard({
                        url: `${req.protocol ?? 'http'}://${host}${req.originalUrl ?? req.url ?? '/'}`,
                        paymentHeader: headerOf((n) => one(req.headers[n])),
                        userAgent: one(req.headers['user-agent']),
                        ...overrides,
                    });
                    for (const [k, v] of Object.entries(result.headers))
                        res.set(k, v);
                    if (result.allow)
                        return next();
                    res.status(result.status).json(result.body);
                }
                catch (err) {
                    next(err);
                }
            };
        },
    };
}
