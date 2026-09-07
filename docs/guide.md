# P2Flux JavaScript SDK — documentation

`@p2flux/sdk` v0.7.2. A thin, zero-dependency client over the P2Flux HTTP API: it normalizes result
codes and nothing else. No scheduler, no storage, no retry loops — your application owns all three.

This page is the index. The guide was split into one page per topic in 0.7.2.

## Start here

| Page | What it covers |
|---|---|
| [Getting started](getting-started.md) | Install, the vocabulary, configuration, your own `fetch`, environments |
| [The payment lifecycle](payment-flow.md) | The whole merchant flow end to end, and which step may mark an order paid |
| [Server and browser](server-and-browser.md) | What runs where, and what must never reach a bundle |

## Operations

| Page | What it covers |
|---|---|
| [One-time payments](payments.md) | Create an intent, hosted checkout, server-side verification |
| [Paying the network fee in USDC](network-fee-in-usdc.md) | `gasPaymentMode: 'payment_token'`: buyers who hold no ETH, accounting, limits |
| [Subscriptions](subscriptions.md) | Setup, the checkout handoff, charging, outcomes, allowance repair, cancellation |
| [Refunds](refunds.md) | Merchant-sent transfers, verified by P2Flux |
| [Recovery](recovery.md) | A lost payment, a lost charge, and the ambiguous request |

## Building it

| Page | What it covers |
|---|---|
| [Testing](testing.md) | A fake `fetch`, a canned answer per outcome, the canned API |
| [Errors and retries](errors.md) | Every public code, grouped by action, with a recipe per situation |
| [Production checklist](production-checklist.md) | What to confirm before real money |
| [Call and result contract](protocol-contract.md) | All 21 operations in one table |

## Examples

| File | |
|---|---|
| [`create-payment.ts`](../examples/create-payment.ts) | Intent → hosted checkout URL |
| [`verify-payment.ts`](../examples/verify-payment.ts) | The trust boundary |
| [`recover-payment.ts`](../examples/recover-payment.ts) | Find a settlement whose hash was lost |
| [`create-sponsored-payment.ts`](../examples/create-sponsored-payment.ts) | A buyer paying with USDC and no ETH |
| [`network-fee-in-usdc.ts`](../examples/network-fee-in-usdc.ts) | The accounting block, figure by figure |
| [`subscription-signup.ts`](../examples/subscription-signup.ts) | Terms → checkout → prove the capability |
| [`charge-subscription.ts`](../examples/charge-subscription.ts) | One period, every outcome |
| [`recover-charge.ts`](../examples/recover-charge.ts) | The settlement behind an `ALREADY_CHARGED` |
| [`renewal-worker.ts`](../examples/renewal-worker.ts) | A renewal pass over many subscriptions |
| [`refund.ts`](../examples/refund.ts) | Prepare, send from your wallet, verify |
| [`cancel.ts`](../examples/cancel.ts) | A browser-safe cancellation session |
| [`complete-payment-flow/`](../examples/complete-payment-flow/) | A runnable merchant integration |

The PHP SDK (`p2flux/sdk-php`) covers the identical public protocol surface. The full protocol
documentation lives at [p2flux.com/docs](https://p2flux.com/docs/), with the canonical
[OpenAPI specification](https://p2flux.com/openapi.json).
