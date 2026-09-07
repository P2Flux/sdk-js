/**
 * The complete-payment-flow demo, end to end, against the canned API.
 *
 * Two servers on loopback and no chain anywhere. What this proves is the part a merchant
 * integration gets wrong: only a valid server-side verdict marks an order paid, and verifying twice
 * fulfils once.
 */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { spawn, type ChildProcess } from 'node:child_process'
import { startStubApi, CONFIRMING_TX, PAID_TX, REJECTED_TX } from './stub-api.js'

const root = new URL('..', import.meta.url).pathname

const stub = await startStubApi()

const port = 8100 + (process.pid % 500)
const demo: ChildProcess = spawn(
  process.execPath,
  ['--import', 'tsx', 'examples/complete-payment-flow/server.ts'],
  {
    cwd: root,
    stdio: 'ignore',
    env: {
      ...process.env,
      PORT: String(port),
      P2FLUX_API_URL: stub.url,
      P2FLUX_CHECKOUT_URL: 'https://pay-test.p2flux.com',
      P2FLUX_RECIPIENT: '0x' + 'e'.repeat(40),
    },
  },
)

after(async () => {
  demo.kill()
  await stub.close()
})

const base = `http://127.0.0.1:${port}`

for (let attempt = 0; attempt < 100; attempt++) {
  try {
    await fetch(base)
    break
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

const newOrder = async (): Promise<string> => {
  const page = await (await fetch(`${base}/create`, { method: 'POST' })).text()
  const id = /const ORDER = "([a-f0-9]+)"/.exec(page)?.[1]
  assert.ok(id, `no order id in the page:\n${page.slice(0, 200)}`)
  return id
}

const verify = async (order: string, txHash?: string) => {
  const res = await fetch(`${base}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order, txHash }),
  })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

const statusOf = async (order: string) =>
  (await (await fetch(`${base}/status?order=${order}`)).json()) as Record<string, unknown>

test('the demo shop is up', async () => {
  const page = await (await fetch(base)).text()
  assert.match(page, /P2Flux demo shop/)
})

test('creating an order mints an intent and marks nothing paid', async () => {
  const page = await (await fetch(`${base}/create`, { method: 'POST' })).text()
  assert.match(page, /p2f1\.k1\.stub\.mac/)
  assert.match(page, /#\/pay\//)
  assert.doesNotMatch(page, /"status":"paid"/)
})

test('a valid verdict pays the order, and a repeat is safe', async () => {
  const order = await newOrder()
  assert.equal((await statusOf(order)).status, 'pending')

  const first = await verify(order, PAID_TX)
  assert.equal(first.status, 200)
  assert.equal(first.body.status, 'paid')
  assert.equal(first.body.txHash, PAID_TX)

  const second = await verify(order, PAID_TX)
  assert.equal(second.status, 200)
  assert.equal(second.body.status, 'paid')
  assert.equal(second.body.repeat, true, 'a repeat verification must be recognised, not re-applied')
  assert.equal(second.body.txHash, PAID_TX)

  assert.equal((await statusOf(order)).status, 'paid')
})

test('a confirming settlement leaves the order unpaid', async () => {
  const order = await newOrder()
  const answer = await verify(order, CONFIRMING_TX)

  assert.equal(answer.status, 202)
  assert.equal(answer.body.status, 'confirming')
  assert.equal((await statusOf(order)).status, 'pending')
})

test('a transaction that settles nothing leaves the order unpaid', async () => {
  const order = await newOrder()
  const answer = await verify(order, REJECTED_TX)

  assert.equal(answer.body.status, 'unsettled')
  assert.equal(answer.body.code, 'TRANSACTION_NOT_FOUND')
  assert.equal((await statusOf(order)).status, 'pending')
})

test('a claim with no hash falls back to recovery', async () => {
  const order = await newOrder()
  const answer = await verify(order)

  assert.equal(answer.body.status, 'paid')
  assert.equal((await statusOf(order)).status, 'paid')
})

test('an unknown order is refused', async () => {
  const answer = await verify('nope', PAID_TX)
  assert.equal(answer.status, 404)
  assert.equal(answer.body.status, 'unknown_order')
})
