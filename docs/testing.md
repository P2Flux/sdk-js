# Testing your integration

Everything below runs offline. No wallet, no USDC, no chain, no API.

`createP2Flux()` takes a `fetch`, so a test replaces the HTTP layer without touching your own code.
That is the whole mechanism — there is nothing else to mock.

```ts
const p2flux = createP2Flux({ apiUrl: 'https://api.example', fetch: myFakeFetch })
```

It receives exactly what the global `fetch` would: a URL, and an init object whose `body` is the
JSON string this client sent.

## A fake fetch

Routes by path suffix and records what was sent, which is usually all a test needs:

```ts
type Answer = { status: number; body: unknown }

export const fakeFetch = (answers: Record<string, Answer | Error>) => {
  const calls: { url: string; body: Record<string, unknown> }[] = []

  const impl = (async (url: string, init: { body: string }) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) })

    for (const [suffix, answer] of Object.entries(answers)) {
      if (!String(url).endsWith(suffix)) continue
      if (answer instanceof Error) throw answer                 // an unreachable API
      return { status: answer.status, json: async () => answer.body }
    }

    return { status: 404, json: async () => ({ error: 'INVALID_REQUEST', action: 'INVALID_REQUEST' }) }
  }) as unknown as typeof fetch

  return { impl, calls }
}
```

## Canned answers

Enough to cover every branch your integration has.

```ts
import { createP2Flux } from '@p2flux/sdk'

const { impl, calls } = fakeFetch({
  '/v1/capabilities': {
    status: 200,
    body: {
      chain_id: 8453,
      tokens: [{
        symbol: 'USDC',
        decimals: 6,
        gas_payment_modes: ['native', 'payment_token'],
        operations: { one_time_payment: true },
        sponsor_contracts: { one_time_payment: '0xaaa' },
      }],
    },
  },
  '/v1/payments': { status: 200, body: { intent: 'p2f1.k1.test.mac', reference: '0xref', amount: '12.500000' } },
  '/v1/payments/verify': {
    status: 200,
    body: { valid: true, tx_hash: '0xabc', block_number: '1', settlement_receipt: 'p2r2.k1.test.mac' },
  },
})

const p2flux = createP2Flux({ apiUrl: 'https://api.example', fetch: impl })
```

The branches integrations get wrong:

```ts
// still confirming: your code must poll, never fulfil and never re-ask the buyer
'/v1/payments/verify': { status: 200, body: { valid: false, code: 'PAYMENT_CONFIRMING', tx_hash: '0xabc' } },

// this transaction settles nothing: the order stays unpaid
'/v1/payments/verify': { status: 200, body: { valid: false, code: 'TRANSACTION_NOT_FOUND' } },

// the buyer's wallet hit the sponsored-transaction limit; nothing was spent
'/v1/payments': { status: 429, body: { error: 'RATE_LIMITED', action: 'RETRY_LATER', retry_after: 120 } },

// sponsorship is not offered here at all: fall back to native, do not retry
'/v1/payments': { status: 400, body: { error: 'PAYMENT_TOKEN_GAS_UNSUPPORTED', action: 'INVALID_REQUEST' } },

// charge outcomes
'/v1/charges': { status: 200, body: { status: 'CHARGED', tx_hash: '0xdef', period_index: 3 } },
'/v1/charges': { status: 200, body: { status: 'ALREADY_CHARGED', period_index: 3 } },
'/v1/charges': { status: 402, body: { error: 'INSUFFICIENT_BALANCE' } },

// a settlement recovered from the chain
'/v1/charges/recover': { status: 200, body: { found: true, tx_hash: '0xdef', period_index: 3, amount_units: '5000000' } },
```

An unreachable API — the case where the answer is "unknown", never "declined":

```ts
const { impl } = fakeFetch({ '/v1/charges': new Error('ECONNREFUSED') })

const result = await createP2Flux({ apiUrl: 'https://api.example', fetch: impl }).charge(capability)
// result.status === 'NETWORK_ERROR', result.action === 'RETRY_LATER' - charge() does not throw
```

## A test

`node:test`, which is what this repository uses and needs no dependency:

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createP2Flux } from '@p2flux/sdk'

test('an order is paid only on a valid verdict', async () => {
  const { impl } = fakeFetch({
    '/v1/payments/verify': { status: 200, body: { valid: false, code: 'PAYMENT_CONFIRMING' } },
  })
  const order = { status: 'pending', intent: 'p2f1.k1.test.mac' }

  await verifyOrder(order, createP2Flux({ apiUrl: 'https://api.example', fetch: impl }), '0xabc')

  assert.equal(order.status, 'pending')
})

test('the recipient is never taken from the request', async () => {
  const { impl, calls } = fakeFetch({
    '/v1/payments': { status: 200, body: { intent: 'p2f1.k1.test.mac', reference: '0x', amount: '12.500000' } },
  })

  await createOrder(createP2Flux({ apiUrl: 'https://api.example', fetch: impl }), { amount: '12.50' })

  assert.equal(calls[0]?.body.recipient, process.env.P2FLUX_RECIPIENT)
})
```

Assert on `calls` for the things that matter: that the recipient came from your configuration, that
the amount matches the order, that `charge()` ran once per period.

Vitest and Jest work identically — the fake is a plain function, so `vi.fn()` or `jest.fn()` can
wrap it if you want call assertions from the framework instead.

## Against a running canned API

For end-to-end tests through your own HTTP layer, this repository ships one. `test/stub-api.ts`
answers like the real API over loopback, and exports `startStubApi()`:

```ts
import { startStubApi } from '@p2flux/sdk/test/stub-api.js'   // in this repo: './stub-api.js'

const stub = await startStubApi()
const p2flux = createP2Flux({ apiUrl: stub.url })
// …
await stub.close()
```

It answers `PAYMENT_CONFIRMING` for a transaction hash starting `0xc0` and `TRANSACTION_NOT_FOUND`
for one starting `0xbad`, so the waiting and rejection paths are reachable without a chain.
[`examples/complete-payment-flow/`](../examples/complete-payment-flow/) runs against exactly this,
driven by `test/complete-flow.test.ts`.

## Against the test environment

When you do want real chain behaviour:

```bash
P2FLUX_API_URL=https://api-test.p2flux.com
P2FLUX_CHECKOUT_URL=https://pay-test.p2flux.com
```

Base Sepolia with faucet USDC. Tokens are bound to the deployment that issued them, so a test
capability is refused by production and the reverse.

## Next

- [Errors and retries](errors.md) — the codes worth a test each
- [Production checklist](production-checklist.md)
