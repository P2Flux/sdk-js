# Server and browser

This SDK is a **server-side client**. It talks to the P2Flux API on your behalf, and almost
everything it can do is something a browser must not be able to do.

JavaScript makes that easy to get wrong: the same import works in a bundle, and a `NEXT_PUBLIC_`
prefix is one keystroke away from shipping a credential to every visitor. So this page is explicit
about which half is which.

## Where each thing runs

| | Server | Browser |
|---|---|---|
| `createP2Flux()` and every method on it | yes | **no** |
| The `p2s2` subscription capability | yes, encrypted at rest | **never** |
| An intent (`p2f1…`) | mints it, stores it | receives it, in the URL fragment only |
| A setup token (`p2setup2…`) | mints it | receives it, in the URL fragment |
| A cancel / approve / refund session token | mints it | receives it, in the URL fragment |
| A transaction hash, a settlement receipt | verifies them | reports them as a claim |
| The `postMessage` handshake with the checkout | — | yes, plain browser JS |

The browser's entire job is: open the hosted checkout with a token in the fragment, listen for
`p2flux.payment.completed`, and post that claim to your server. No P2Flux import is needed for any
of it — see [the payment lifecycle](payment-flow.md#3-the-checkout-reports-back) for the listener.

## The capability is a bearer credential

`finalizeSubscription()` returns `subscription` — a `p2s2…` string. Whoever holds it can ask P2Flux
to collect the customer's next period. It can only ever pay the recipient the customer signed for,
so it is not a theft primitive, but it is the customer's standing permission.

- **Never** put it in HTML, in browser JavaScript, in a URL, or in a query string.
- **Never** expose it through a public build variable: `NEXT_PUBLIC_*`, `VITE_*`, `PUBLIC_*`,
  `REACT_APP_*` and `GATSBY_*` are all inlined into the bundle at build time and shipped to
  everyone.
- **Never** log it, and redact every P2Flux token prefix from anything you do log.
- Encrypt it at rest. It is the one thing your system stores per subscription; everything else is
  read back from the chain.

The session tokens exist precisely so a browser never needs the capability. `createCancellationSession()`
returns a `p2cancel1…` that can build the customer's own `revoke()` and nothing else;
`createAllowanceRestoreSession()` returns a `p2approve1…` that cannot charge, revoke or refund.

## Keeping it out of a bundle

If your project builds a browser bundle from the same repository as its server code, arrange for
this package never to be reachable from a client entry point:

- Import it only from files that cannot be imported by the client. In Next.js that means a Route
  Handler, a Server Action or `getServerSideProps` — never a component that also renders on the
  client. In SvelteKit, `+page.server.ts` or `src/lib/server/`. In Remix, `*.server.ts`.
- Configuration comes from server-only environment variables. `P2FLUX_API_URL` and your payout
  wallet are not secrets, but the habit of reading them server-side keeps the client boundary
  visible.
- If your bundler has an allowlist for server-only modules, add this package to it. A build error is
  a better outcome than a shipped bundle.

Nothing here is enforced by the SDK. It cannot be: a package cannot tell which side of a build it
was imported from.

## What is safe in a browser

- The intent, setup token, cancel token, approve token and refund token — all short-lived, all
  scoped to one operation, all designed for the URL fragment.
- The transaction hash and settlement receipt the checkout hands back. They are claims your server
  will verify anyway.

Fragments never reach a server or a `Referer` header, but they are visible to anything running in
the page, so keep them out of client-side analytics and error reporting.

## Next

- [The payment lifecycle](payment-flow.md) · [Production checklist](production-checklist.md)
- [Subscriptions](subscriptions.md) — where the capability comes from
