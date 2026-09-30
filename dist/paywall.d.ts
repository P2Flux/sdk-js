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
export type PaywallOptions = {
    /** `https://api.p2flux.com` (real USDC on Base) or `https://api-test.p2flux.com` (Base Sepolia). */
    apiUrl: string;
    /** Your wallet on Base. Every payment goes to it. */
    recipient: string;
    /** Price per request in USDC, e.g. `'0.05'`. At least 0.01. */
    price: string;
    /**
     * `true`: only requests that look like AI agents or programs pay; browsers and search engines pass
     * free. `false` (default): every request pays - the right choice for an API.
     */
    agentsOnly?: boolean;
    /** Offer the prepaid balance (x402 batch-settlement) next to pay-per-request. Default true. */
    prepaid?: boolean;
    /** When P2Flux cannot be reached: `'refuse'` (default, 503) or `'free'` (serve without payment). */
    onUnavailable?: 'refuse' | 'free';
    timeoutMs?: number;
    fetch?: typeof fetch;
};
export type GuardInput = {
    /** The full URL the client asked for. */
    url: string;
    /** The `PAYMENT-SIGNATURE` header (or legacy `X-PAYMENT`), if the client sent one. */
    paymentHeader?: string | null;
    userAgent?: string | null;
    /** A different price for this request. */
    price?: string;
    mimeType?: string;
};
export type GuardResult = {
    allow: true;
    paid: boolean;
    headers: Record<string, string>;
    payer?: string;
    transaction?: string;
    receipt?: string;
    scheme?: string;
} | {
    allow: false;
    status: 402 | 503;
    headers: Record<string, string>;
    body: Record<string, unknown>;
};
/** AI crawlers and assistants, and HTTP libraries agents are built on. Same list as the WordPress plugin. */
export declare const AGENT_SIGNATURES: readonly ["GPTBot", "ChatGPT-User", "OAI-SearchBot", "ClaudeBot", "Claude-User", "Claude-SearchBot", "anthropic-ai", "PerplexityBot", "Perplexity-User", "CCBot", "Bytespider", "Amazonbot", "meta-externalagent", "meta-externalfetcher", "cohere-ai", "cohere-training-data-crawler", "Diffbot", "YouBot", "DuckAssistBot", "MistralAI-User", "AI2Bot", "Timpibot", "ImagesiftBot", "Omgilibot", "Google-CloudVertexBot", "Kangaroo Bot", "PanguBot", "Novellum", "P2Flux-MCP", "x402", "python-requests", "python-httpx", "aiohttp", "axios/", "node-fetch", "undici", "Go-http-client", "okhttp", "curl/", "Wget/", "Scrapy", "libwww-perl"];
/** Whether a request is an AI agent or a program rather than a person's browser. */
export declare function isAgent(userAgent: string | null | undefined, hasPayment: boolean): boolean;
/** The parts of an Express request and response the middleware uses. */
export type ExpressRequest = {
    protocol?: string;
    originalUrl?: string;
    url?: string;
    headers: Record<string, string | string[] | undefined>;
};
export type ExpressResponse = {
    status(code: number): ExpressResponse;
    set(name: string, value: string): ExpressResponse;
    json(body: unknown): unknown;
};
export declare function createPaywall(options: PaywallOptions): {
    guard: (input: GuardInput) => Promise<GuardResult>;
    /** Wrap a Fetch-API handler (Workers, Bun, Deno, Hono, Next route handlers). */
    wrap<A extends unknown[]>(handler: (request: Request, ...rest: A) => Response | Promise<Response>, overrides?: {
        price?: string;
        mimeType?: string;
    }): (request: Request, ...rest: A) => Promise<Response>;
    /** Express / Connect middleware. */
    express(overrides?: {
        price?: string;
        mimeType?: string;
    }): (req: ExpressRequest, res: ExpressResponse, next: (err?: unknown) => void) => Promise<void>;
};
