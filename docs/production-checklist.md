# Production checklist

Short, and every line is something that has gone wrong in a real integration.

## Money

- [ ] **Payments are created server-side.** The recipient and the amount come from your
      configuration and your own records, never from a request body.
      → [The payment lifecycle](payment-flow.md)
- [ ] **Nothing is fulfilled on a browser message.** `p2flux.payment.completed` is a claim; the
      server's `verifyPayment()` verdict is the decision. → [Payments](payments.md)
- [ ] **The paid transition happens once**, inside a transaction with a row lock or a unique
      constraint, with the status re-checked inside it. Repeat callbacks are normal.
- [ ] **Your own reference is stored with the intent**, before the buyer leaves the page.
      → [Recovery](recovery.md)
- [ ] **`CONFIRMING` is neither failure nor success.** Poll the same hash; never re-ask the buyer
      and never send a second charge.
- [ ] **`ALREADY_CHARGED` is a success** — the normal answer to a retry after a timeout.
      → [Subscriptions](subscriptions.md)
- [ ] **One refund per payment is enforced by you**, before `prepareRefund()`. P2Flux keeps no
      refund history. → [Refunds](refunds.md)

## Secrets and the browser

- [ ] **The `p2s2` capability is encrypted at rest and server-side only.** It can charge.
- [ ] **The SDK is not reachable from a client bundle**, and no P2Flux value is exposed through
      `NEXT_PUBLIC_*`, `VITE_*` or any other public build variable.
      → [Server and browser](server-and-browser.md)
- [ ] **Logs carry identifiers, not tokens.** Your order id and the transaction hash are useful;
      intents, setup tokens, capabilities and session tokens must be redacted.
- [ ] **Every call goes over HTTPS**, to the API URL you configured. There is no API key to leak,
      because v1 has no API authentication.

## Configuration

- [ ] **The environment is stored per order.** Test tokens are refused by production and the
      reverse. → [Getting started](getting-started.md#environments)
- [ ] **`timeoutMs` is set deliberately.** The default is 60 000 because a charge waits for
      confirmation. A timeout aborts your request, not the operation.
- [ ] **`capabilities()` is checked before offering an optional feature**, such as letting a buyer
      pay the network fee in USDC. Read it at start-up, not per checkout.
      → [Paying the network fee in USDC](network-fee-in-usdc.md)
- [ ] **Node 18 or newer**, or another runtime with a global `fetch`. This is an ESM-only package.

## Failure paths

- [ ] **Errors are classified on `action`, not `status`**, so an unfamiliar code still lands in the
      right branch. → [Errors and retries](errors.md)
- [ ] **An unreachable API is "unknown", never "declined".** Retry; do not cancel a subscription
      that may have just paid.
- [ ] **A recovery sweep exists**: a cron over long-pending orders calling `recoverPayment()`, and
      `recoverCharge()` for periods that answered `ALREADY_CHARGED`. → [Recovery](recovery.md)
- [ ] **Retries are bounded and honour `retry_after`** on `RATE_LIMITED` and `CONCURRENCY_LIMIT`.

## Before launch

- [ ] The whole flow was run against `https://api-test.p2flux.com` on Base Sepolia.
- [ ] Your verify endpoint was called twice with the same payload, and fulfilled once.
- [ ] Your renewal job was run twice in the same period, and charged once.
- [ ] → [Testing](testing.md) covers all three offline.
