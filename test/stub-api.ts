/**
 * A canned P2Flux API for validating the examples and the documentation offline.
 *
 *   node --import tsx test/stub-api.ts        # standalone, prints its URL
 *
 * It replays the shapes the real API answers and touches no network, no chain and no money. A
 * fixture, not a simulator: it decides nothing, it only answers.
 */
import { createServer, type Server } from 'node:http'

const hex = (prefix: string, char: string) => prefix + char.repeat(66 - prefix.length)

export const PAID_TX = hex('0x', '1')
/** Answers PAYMENT_CONFIRMING, so the waiting path is reachable without a chain. */
export const CONFIRMING_TX = hex('0xc0', '1')
/** Answers a verdict that settles nothing, so the rejection path is reachable too. */
export const REJECTED_TX = hex('0xbad', '1')

const CAPABILITIES = {
  chain_id: 8453,
  network: 'Base',
  native_currency: 'ETH',
  supported: true,
  tokens: [
    {
      address: '0x' + 'c'.repeat(40),
      symbol: 'USDC',
      decimals: 6,
      gas_payment_modes: ['native', 'payment_token'],
      fixed_network_fee_units: '100000',
      operations: {
        one_time_payment: true,
        subscription_signup: true,
        allowance_restore: true,
        allowance_removal: true,
      },
      sponsor_contracts: {
        one_time_payment: '0x' + 'a'.repeat(40),
        subscription_signup: '0x' + 'b'.repeat(40),
        allowance_restore: '0x' + 'b'.repeat(40),
        allowance_removal: '0x' + 'b'.repeat(40),
      },
      zero_native_revoke: false,
    },
  ],
}

const ACCOUNTING = {
  payment_units: '12500000',
  payment_fee_units: '125000',
  network_fee_units: '4147',
  fixed_network_fee_units: '100000',
  merchant_net_units: '12275000',
  buyer_total_units: '12504147',
  payer: '0x' + 'd'.repeat(40),
}

const inAnHour = () => Math.floor(Date.now() / 1000) + 3600

const RESPONSES: Record<string, (body: Record<string, unknown>) => unknown> = {
  '/v1/capabilities': () => CAPABILITIES,
  '/v1/payments': () => ({
    intent: 'p2f1.k1.stub.mac',
    reference: '0x' + 'f'.repeat(64),
    amount: '12.500000',
    expires_at: inAnHour(),
    pay: {
      chain_id: 8453,
      splitter: '0x' + 'a'.repeat(40),
      token: '0x' + 'c'.repeat(40),
      recipient: '0x' + 'e'.repeat(40),
      amount_units: '12500000',
      reference: '0x' + 'f'.repeat(64),
    },
  }),
  '/v1/payments/resolve': () => ({
    recipient: '0x' + 'e'.repeat(40),
    amount: '12.500000',
    amount_units: '12500000',
    token: '0x' + 'c'.repeat(40),
    splitter: '0x' + 'a'.repeat(40),
    chain_id: 8453,
    reference: '0x' + 'f'.repeat(64),
    expires_at: inAnHour(),
    gas_payment_mode: 'native',
  }),
  '/v1/payments/verify': (body) => {
    const txHash = String(body.tx_hash ?? '')
    if (txHash.startsWith('0xc0')) return { valid: false, code: 'PAYMENT_CONFIRMING', tx_hash: txHash }
    if (txHash.startsWith('0xbad')) return { valid: false, code: 'TRANSACTION_NOT_FOUND' }
    return {
      valid: true,
      tx_hash: txHash || PAID_TX,
      block_number: '50966621',
      reference: '0x' + 'f'.repeat(64),
      amount: '12.500000',
      settlement_receipt: 'p2r2.k1.stub.mac',
      gas_payment_mode: 'payment_token',
      accounting: ACCOUNTING,
    }
  },
  '/v1/payments/recover': () => ({
    found: true,
    valid: true,
    tx_hash: PAID_TX,
    amount: '12.500000',
    as_of_block: '50966700',
  }),
  '/v1/payments/sponsor': () => ({
    status: 'SUBMITTED',
    tx_hash: PAID_TX,
    reference: '0x' + 'f'.repeat(64),
    network_fee_units: '4147',
    fixed_network_fee_units: '100000',
    buyer_total_units: '12504147',
  }),
  '/v1/subscriptions': () => ({
    setup_token: 'p2setup2.k1.stub.mac',
    expires_at: inAnHour(),
    chain_id: 8453,
    contract: '0x' + 'b'.repeat(40),
    amount: '5.000000',
    salt: '12345',
  }),
  '/v1/subscriptions/status': () => ({
    active: true,
    revoked: false,
    expired: false,
    due: true,
    charged_this_period: false,
    subscription_id: '0x' + '9'.repeat(64),
    period_index: 3,
    next_period_at: '2026-10-07T00:00:00Z',
    allowance_unlimited: true,
    terms: {
      salt: '12345',
      amount_units: '5000000',
      recipient: '0x' + 'e'.repeat(40),
      period: 2592000,
    },
  }),
  '/v1/charges': () => ({
    status: 'CHARGED',
    tx_hash: hex('0x', '2'),
    amount: '5.000000',
    subscription_id: '0x' + '9'.repeat(64),
    period_index: 3,
    next_period_at: '2026-10-07T00:00:00Z',
  }),
  '/v1/charges/recover': () => ({
    found: true,
    subscription_id: '0x' + '9'.repeat(64),
    period_index: 3,
    tx_hash: hex('0x', '2'),
    block_number: '50966800',
    payer: '0x' + 'd'.repeat(40),
    recipient: '0x' + 'e'.repeat(40),
    amount_units: '5000000',
    net_units: '4890000',
    fee_units: '100000',
    network_fee_units: '10000',
  }),
  '/v1/subscriptions/revoke/session': () => ({
    cancel_token: 'p2cancel1.k1.stub.mac',
    expires_at: inAnHour(),
    subscription_id: '0x' + '9'.repeat(64),
    payer: '0x' + 'd'.repeat(40),
  }),
  '/v1/subscriptions/revoke/prepare': () => ({
    chain_id: 8453,
    to: '0x' + 'b'.repeat(40),
    data: '0xdeadbeef',
    description: 'Revoke this subscription',
  }),
  '/v1/allowances/revoke/prepare': () => ({
    chain_id: 8453,
    to: '0x' + 'c'.repeat(40),
    data: '0xdeadbeef',
    description: 'Set the USDC allowance to zero',
  }),
  '/v1/allowances/restore/session': () => ({
    approve_token: 'p2approve1.k1.stub.mac',
    expires_at: inAnHour(),
    payer: '0x' + 'd'.repeat(40),
    subscription_id: '0x' + '9'.repeat(64),
  }),
  '/v1/refunds/prepare': () => ({
    refund_token: 'p2refund1.k1.stub.mac',
    chain_id: 8453,
    token: '0x' + 'c'.repeat(40),
    merchant: '0x' + 'e'.repeat(40),
    payer: '0x' + 'd'.repeat(40),
    original_amount: '12.500000',
    original_amount_units: '12500000',
    refund_amount: '2.500000',
    refund_amount_units: '2500000',
    expires_at: inAnHour(),
  }),
  '/v1/refunds/verify': () => ({
    status: 'REFUNDED',
    refund_tx_hash: hex('0x', '3'),
    refund_amount: '2.500000',
  }),
}

/** Starts the canned API on an ephemeral port and resolves its base URL. */
export async function startStubApi(): Promise<{ url: string; server: Server; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const path = (req.url ?? '/').split('?')[0] ?? '/'
      const answer = RESPONSES[path]
      res.setHeader('content-type', 'application/json')

      if (!answer) {
        res.statusCode = 404
        res.end(JSON.stringify({ error: 'INVALID_REQUEST', action: 'INVALID_REQUEST' }))
        return
      }

      let body: Record<string, unknown> = {}
      try {
        body = JSON.parse(Buffer.concat(chunks).toString() || '{}') as Record<string, unknown>
      } catch {
        body = {}
      }
      res.end(JSON.stringify(answer(body)))
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  return {
    url: `http://127.0.0.1:${port}`,
    server,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

if (process.argv[1]?.endsWith('stub-api.ts')) {
  const { url } = await startStubApi()
  console.log(`canned P2Flux API on ${url}`)
}
