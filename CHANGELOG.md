# Changelog

## 0.10.0 - 2026-10-03

### Added

- **Payment links** - `createPaymentLink(terms)`, `paymentLinkStatus({ link } | { manage })`,
  `collectPaymentLink(manage, subscriptionId)`, `stopPaymentLink(manage, subscriptionId)` and, for
  custom checkouts, `openPaymentLink(link, payer?)` and `subscribePaymentLink(link, subscriptionRef)`. Invoices paid once, fixed prices paid many
  times, and subscriptions P2Flux collects for you - no server needed.
  (https://p2flux.com/docs/payment-links.html)
- `checkoutLink('link' | 'links', token)` for the buyer's link and the merchant's overview.
- Error codes `INVALID_LINK`, `LINK_EXPIRED`, `LINK_UNAVAILABLE`, `ALREADY_SUBSCRIBED`.

## 0.9.0 - 2026-10-03

### Added

- **`checkoutLink(page, token)`** — the address that opens a checkout page (`pay`, `subscribe`,
  `cancel`, `refund`, `approve`) for a token the API issued, with the token in the fragment.
- **`checkoutUrl` option** — where buyers open the checkout. Defaults to P2Flux's hosted checkout for
  the API in use; set it when you host the checkout yourself
  (https://p2flux.com/docs/self-hosted-checkout.html). Must be https (http only for localhost).

Nothing else changed.

## 0.8.0 - 2026-10-01

### Added

- **`@p2flux/sdk/paywall`** — charge AI agents for a route over x402 without an x402 library:
  `createPaywall({ apiUrl, recipient, price })` with `express()` middleware, `wrap()` for Fetch-API
  handlers, and the framework-neutral `guard()`. Pay-per-request and prepaid balance; the payment is
  settled before the handler runs and serves one response. A separate entry point: the main client
  is unchanged and byte-identical.
- **Usage pricing** — `paywall.usage({ url, paymentHeader, maxPrice }, work)`: the agent signs for at
  most `maxPrice` (x402 `upto`), you charge what the request cost.
- Requests signed as bots (Web Bot Auth) count as agents under `agentsOnly`; an agent's prepaid
  refund request is answered with its receipt.

## 0.7.2 - 2026-09-07

Packaging, documentation and examples. **No behaviour changed**: every method keeps its name,
arguments and return shape, and `dist/` is byte-identical to a fresh build of the same source.

### Added

- **Published to npm as `@p2flux/sdk`.** Installation is `npm install @p2flux/sdk` — no git tag to
  pin. `package.json` gains the public metadata a registry page needs (homepage, bugs, keywords,
  `engines: node >=18`, `publishConfig.access`) and `sideEffects: false`, which a new test earns
  rather than assumes: importing the module is proven to leave `globalThis` untouched.
- **`docs/payment-flow.md`** — the whole merchant lifecycle in one page, including the browser half
  this SDK never sees: the checkout handshake, why `p2flux.payment.completed` is a claim, and how to
  make the paid transition happen exactly once.
- **`docs/server-and-browser.md`** — which half of a JavaScript application each thing belongs to,
  and how to keep a bearer capability out of a client bundle. `NEXT_PUBLIC_*` and its equivalents
  are named explicitly, because that is how a credential actually escapes.
- **`docs/recovery.md`**, **`docs/testing.md`**, **`docs/production-checklist.md`**, and a recipes
  section in **`docs/errors.md`** covering the situations rather than only the codes.
- **`examples/complete-payment-flow/`** — a runnable merchant integration on `node:http`: order,
  checkout handshake, repeat-safe verification, recovery fallback. It runs against a canned API, so
  no wallet, USDC or chain is involved.
- **`test/stub-api.ts`** — that canned API, exported as `startStubApi()` and runnable standalone. It
  answers `PAYMENT_CONFIRMING` for a hash starting `0xc0` and `TRANSACTION_NOT_FOUND` for one
  starting `0xbad`, so the waiting and rejection paths are reachable offline.
- **Automated documentation and example tests.** `npm test` now also runs every example against the
  canned API, drives the complete-flow demo end to end, checks that `dist/` matches a fresh build,
  and validates every documented method, option, import, snippet, link and error code against the
  source.

### Changed

- **Examples are one operation each**, all reading configuration from the environment and failing
  with the missing variable's name: `create-payment.ts`, `create-sponsored-payment.ts`,
  `verify-payment.ts`, `recover-payment.ts`, `network-fee-in-usdc.ts`, `subscription-signup.ts`,
  `charge-subscription.ts`, `recover-charge.ts`, `renewal-worker.ts`, `refund.ts`, `cancel.ts`.
  The `declare const` stubs are gone, so every example actually runs.
- **The README** leads with the first successful integration: install, a five-minute payment, the
  checkout flow, verify before fulfilling, USDC network fees, subscriptions, runtime support, then
  links. Runtime support is stated plainly: an ESM-only package that CommonJS applications can load
  with a dynamic `import()`, and a server-side client rather than a browser SDK.
- **The integration guide is split** into `getting-started`, `payment-flow`, `payments`,
  `network-fee-in-usdc`, `subscriptions`, `refunds`, `recovery`, `errors`, `testing`,
  `production-checklist` and `server-and-browser`. `docs/guide.md` is now the index.

## 0.7.1 - 2026-09-06

### Added

- `capabilities()` now returns `sponsorContracts` — the contract carrying each sponsored operation,
  which the API has always sent and this client silently dropped. A checkout holds an offer's fee
  recipient against the network's own declaration rather than against the offer itself.
- The guide has a full "Paying the network fee in USDC" section, `docs/protocol-contract.md` lists
  `capabilities()` and the sponsored accounting fields, and `examples/network-fee-in-usdc.ts` is a
  worked end-to-end example.

## 0.7.0 - 2026-09-06

Released with `payment_token` live on Base Mainnet (2026-09-06): `P2FluxSponsoredSplitter`
`0x95E18ec05D4282acB3aab7aD60325bA4EEeEa8df`, `P2FluxGasSponsor` `0xD1DDAaa301403d18fD4A23Fc69493ef48af90285`.

### Added

- **Paying the network fee in the payment currency.** `createPayment({ gasPaymentMode: 'payment_token', ... })` creates a payment a buyer can complete holding only the payment token and
  none of the chain's native currency. The buyer signs one token authorization; P2Flux sends the
  transaction and takes the quoted network cost out of that same authorization, so nothing is
  fronted on credit. The buyer is debited the price plus that network fee and nothing else - P2Flux's
  percentage fee and its fixed network fee both come out of the amount, so the merchant funds them,
  exactly as a subscription does. `resolvePayment()` carries the price and its expiry,
  `sponsorPayment({ intent, quote, payer, signature })` executes it, and `verifyPayment()` returns an
  `accounting` block naming every unit: price, P2Flux fee, network fee, fixed network fee, merchant
  net, buyer total.
- **`capabilities()`** — what a deployment actually supports, per token and per operation. Ask
  before offering a buyer the option: a token that is technically capable is not the same as a
  network P2Flux has deployed and tested, and this reports the second.
- **Zero-native-gas subscription signup.** `resolveSubscription(setupToken, { gasPaymentMode:
  'payment_token', payer })` prices the allowance transaction P2Flux would send for a customer
  holding no native currency and returns the two messages they sign; pass those to
  `finalizeSubscription(setupToken, payer, signature, sponsorship)`. The capability is minted first
  and costs nothing, so a sponsorship that fails is reported in `sponsorship.status` rather than
  thrown - the subscription exists, and the allowance is still repairable from the restore flow.
  `ALREADY_SETTLED` is a repeat of a request that already worked. The mode is asked for at resolve
  rather than at creation because the price is for one specific wallet's allowance.
- **Zero-native-gas allowance repair.** `resolveAllowanceRestore(token, 'payment_token')` returns
  the two messages a customer signs, and `submitAllowanceRestore({ ... })` carries them onto the chain.
  Passing `allowanceUnits: '0'` removes the allowance, which stops collection - it does not
  revoke the recurring authorization, which only the payer's own transaction can do.
- New error codes with actions: `PAYMENT_TOKEN_GAS_UNSUPPORTED` (fall back to native gas),
  `PAYMENT_TOKEN_GAS_QUOTE_EXPIRED` (requote and re-sign), `PAYMENT_TOKEN_GAS_UNAVAILABLE`,
  `PAYMENT_TOKEN_GAS_LIMIT_EXCEEDED`, `INVALID_GAS_QUOTE`, `INSUFFICIENT_PAYMENT_TOKEN_FOR_GAS`,
  `SPONSORED_TRANSACTION_FAILED`, `SPONSORED_PERMIT_FAILED`, `SPONSORSHIP_CONFIRMING`.

### Unchanged

- Every existing call. A payment created without `gas_payment_mode` behaves exactly as before,
  settles through the same contract, and pays the same 1% - there is no fixed network fee outside
  the new mode. Recurring economics are untouched: 2%, the existing fixed network fee, and the buyer's
  gas reimbursement, with no second fixed fee for onboarding without native currency.

## 0.6.0 - 2026-09-02

Version 0.5.0 was never published: from this release the JS and PHP SDKs share one version number,
so that "both SDKs at v0.6.0" means the same public protocol surface in both.

### Added

- **`recoverCharge(ref, periodIndex, hint?)`** — the transaction that charged one recurring period.
  `ALREADY_CHARGED` proves a period was collected and names no transaction, so a worker that lost
  the first response held a paid period it could not attribute, audit or refund (refunds start from
  the original settlement). The period index is required and exact: reconciliation is about one
  specific collection, today or in a year. `found: false` is ordinary rather than an error — there
  is no catch-up billing, so a period that was never collected is normal history — and a settlement
  still confirming keeps its hash, the same rule `recoverPayment()` follows. The optional hint is
  where your own records say you attempted the charge; it narrows the search and is never evidence.
- **`createAllowanceRestoreSession(ref)`** and **`resolveAllowanceRestore(token)`** —
  `INSUFFICIENT_ALLOWANCE` is not a dead subscription: the authorization the customer signed is
  intact and they need one `approve()`. The session names the payer, the spender, the token and the
  amount, and can neither charge nor revoke nor refund. Open `<checkout>/#/approve/<approveToken>`,
  wait for `p2flux.allowance.restored`, then charge the SAME subscription again.

## 0.4.0 - 2026-08-24

Complete public V1 parity. Every merchant/server operation the API exposes is now a first-class
typed method — the former "renewal-job surface" scoping is gone, and no raw REST calls are needed
for a normal integration. Full parity with `p2flux/p2flux-php`.

### Added

- **One-time payments**: `createPayment` (signed intent + the `pay` block a checkout needs),
  `resolvePayment` (authoritative display terms), `verifyPayment` — returning a real discriminated
  union on `valid`, so TypeScript narrows: the confirmed branch carries `txHash`, block data and
  the `settlementReceipt` (present it on a repeat verify and the API answers without re-reading
  the chain); the negative branch carries a typed `code` + `action`, because `PAYMENT_CONFIRMING`
  or `TRANSACTION_REVERTED` are verdicts about the chain, not exceptions.
- **Subscription setup**: `createSubscription` (terms + setup token + the salt that ties a
  returned capability to this checkout), `resolveSubscription` (terms + the exact EIP-712
  `typedData` the customer signs), `finalizeSubscription` (signature → the `p2s2.` charge
  capability).
- **Cancellation**: `createCancellationSession` — the browser-safe cancel token, so the charging
  capability never has to reach a customer's browser.
- **Refunds**: `resolveRefund` — what a refund token authorizes, for the page that holds it.
- **Types**: `PaymentTerms`, `PaymentIntent`, `ResolvedPayment`, `PaymentVerification`,
  `SubscriptionTerms`, `SubscriptionSetup`, `ResolvedSubscription`, `FinalizedSubscription`,
  `CancellationSession`, `ResolvedRefund`. `ChargeStatus` now carries every public API error code,
  and the local action fallback covers the codes the API ships without an `action` (dead tokens →
  `INVALID_REQUEST`, `SIGNATURE_VALIDATION_TOO_EXPENSIVE` → `CUSTOMER_ACTION_REQUIRED`,
  `TRANSACTION_NOT_FOUND` → `RETRY_LATER`).
- **Parity guard**: `test/parity.test.ts` keeps the checked-in list of all 15 public V1 merchant
  operations and fails when any stops being reachable through the SDK. The PHP SDK and
  P2Flux/core carry the same list.
- **Examples**: `one-time.ts`, `subscription-setup.ts`, `refund.ts`.

### Fixed

- **`verifyRefund()` returned `undefined` for `txHash` and `amount` on every successful refund.**
  It read `tx_hash`/`amount` — the keys the *charge* response uses — while the verify response names
  them `refund_tx_hash`/`refund_amount`. Both are now populated.

### Changed

- **`REFUND_CONFIRMING` now arrives as HTTP 409 from the API** (previously 400). No change is
  required: the check is keyed on the error code, not the status, so a confirming refund is still
  returned as a result rather than thrown, and an older deployment answering 400 behaves identically.
