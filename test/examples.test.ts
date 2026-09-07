/**
 * Every public example runs, against a canned API on loopback.
 *
 * Documentation that is never executed is documentation that drifts. No network, no chain, no
 * money: the examples talk to test/stub-api.ts, and the branches that must NOT read as success -
 * a settlement still confirming, a transaction that settles nothing - are asserted too.
 */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { execFile } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { startStubApi, CONFIRMING_TX, PAID_TX, REJECTED_TX } from './stub-api.js'

const run = promisify(execFile)
const root = new URL('..', import.meta.url).pathname
const examplesDir = join(root, 'examples')

const stub = await startStubApi()
after(() => stub.close())

const baseEnv = {
  ...process.env,
  P2FLUX_API_URL: stub.url,
  P2FLUX_CHECKOUT_URL: 'https://pay-test.p2flux.com',
  P2FLUX_RECIPIENT: '0x' + 'e'.repeat(40),
  P2FLUX_INTENT: 'p2f1.k1.stub.mac',
  P2FLUX_TX_HASH: PAID_TX,
  P2FLUX_SUBSCRIPTION: 'p2s2.k1.stub.mac',
  P2FLUX_SUBSCRIPTIONS: 'p2s2.k1.stub.mac',
  P2FLUX_SALT: '12345',
  P2FLUX_PERIOD_INDEX: '3',
  P2FLUX_REFUND_UNITS: '2500000',
  P2FLUX_REFUND_TX_HASH: '0x' + '3'.repeat(64),
}

const example = (name: string, env: NodeJS.ProcessEnv = baseEnv) =>
  run(process.execPath, ['--import', 'tsx', join(examplesDir, name)], { cwd: root, env })

/** What each example must actually print, so a silent no-op cannot pass. */
const expected: Record<string, string> = {
  'create-payment.ts': 'p2f1.k1.stub.mac',
  'create-sponsored-payment.ts': 'buyer can pay without ETH: true',
  'verify-payment.ts': 'PAID',
  'recover-payment.ts': 'RECOVERED',
  'network-fee-in-usdc.ts': 'paid via payment_token',
  'subscription-signup.ts': 'terms ok',
  'charge-subscription.ts': 'CHARGED',
  'recover-charge.ts': 'FOUND',
  'refund.ts': 'REFUNDED',
  'cancel.ts': 'cancel page',
  'renewal-worker.ts': 'PAID',
}

test('every example is covered by this test', () => {
  const onDisk = readdirSync(examplesDir).filter((name) => name.endsWith('.ts'))
  assert.deepEqual(onDisk.sort(), Object.keys(expected).sort())
})

test('examples import the package, never its internals', () => {
  for (const [name] of Object.entries(expected)) {
    const source = readFileSync(join(examplesDir, name), 'utf8')
    assert.match(source, /from '@p2flux\/sdk'/, `${name} must import the public entry point`)
    assert.doesNotMatch(source, /from '\.\.\/(src|dist)/, `${name} must not import internal source`)
  }

  const flow = readFileSync(join(examplesDir, 'complete-payment-flow', 'server.ts'), 'utf8')
  assert.match(flow, /from '@p2flux\/sdk'/)
  assert.doesNotMatch(flow, /from '\.\.\/(src|dist)/)
})

for (const [name, needle] of Object.entries(expected)) {
  test(`${name} runs and prints its result`, async () => {
    const { stdout } = await example(name)
    assert.ok(stdout.includes(needle), `expected "${needle}" in:\n${stdout}`)
  })
}

test('a settlement that is still confirming never reads as paid', async () => {
  const { stdout } = await example('verify-payment.ts', { ...baseEnv, P2FLUX_TX_HASH: CONFIRMING_TX })
  assert.match(stdout, /CONFIRMING/)
  assert.doesNotMatch(stdout, /PAID/)
})

test('a transaction that settles nothing never reads as paid', async () => {
  const { stdout } = await example('verify-payment.ts', { ...baseEnv, P2FLUX_TX_HASH: REJECTED_TX })
  assert.match(stdout, /REJECTED/)
  assert.doesNotMatch(stdout, /PAID/)
})

const required: Record<string, string> = {
  'create-payment.ts': 'P2FLUX_RECIPIENT',
  'verify-payment.ts': 'P2FLUX_INTENT',
  'charge-subscription.ts': 'P2FLUX_SUBSCRIPTION',
  'recover-charge.ts': 'P2FLUX_PERIOD_INDEX',
  'subscription-signup.ts': 'P2FLUX_SALT',
  'refund.ts': 'P2FLUX_TX_HASH',
  'renewal-worker.ts': 'P2FLUX_SUBSCRIPTIONS',
}

for (const [name, variable] of Object.entries(required)) {
  test(`${name} fails clearly without ${variable}`, async () => {
    const env = { ...baseEnv, [variable]: '' }
    await assert.rejects(
      () => example(name, env),
      (error: { code?: number; stderr?: string }) => {
        assert.notEqual(error.code, 0)
        assert.match(String(error.stderr), new RegExp(variable))
        return true
      },
    )
  })
}
