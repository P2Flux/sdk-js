/**
 * The accounting statement, against a recorded-log JSON-RPC stub: no network, no chain.
 *
 * The stub serves blocks 2 s apart, answers eth_getLogs with real topic/range filtering (and refuses
 * ranges over 5,000 blocks, so the halving path runs), and receipts for native payments.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NETWORKS, statement, statementOn, toCsv, TOPICS, type StatementRow } from '../src/statement.js'
import { keccak256 } from '../src/keccak.js'

const net = NETWORKS['base-sepolia']
const GENESIS = 1_790_000_000
const LATEST = 46_500_000
const tsOf = (n: number) => GENESIS + 2 * n

const addr = (c: string) => '0x' + c.repeat(40)
const topic = (a: string) => '0x' + a.slice(2).padStart(64, '0')
const word = (n: bigint) => n.toString(16).padStart(64, '0')
const data = (...n: bigint[]) => '0x' + n.map(word).join('')
const hash = (c: string) => '0x' + c.repeat(64)

const WALLET = addr('a')
const OTHER = addr('b')
const P1 = addr('1') // native payer
const P2 = addr('2') // sponsored payer
const P3 = addr('3') // subscriber
const STRANGER = addr('9')
const REF1 = hash('e')
const REF2 = hash('f')
const SUB = hash('d')

type Log = { address: string; topics: string[]; data: string; blockNumber: string; transactionHash: string; logIndex: string }
const log = (address: string, topics: string[], d: string, block: number, tx: string, index = 0): Log => ({
  address,
  topics,
  data: d,
  blockNumber: '0x' + block.toString(16),
  transactionHash: tx,
  logIndex: '0x' + index.toString(16),
})
const transfer = (from: string, to: string, units: bigint, block: number, tx: string, index = 0) =>
  log(net.usdc, [TOPICS.transfer, topic(from), topic(to)], data(units), block, tx, index)

const B1 = 46_440_000 // native payment, 10.00
const B2 = 46_441_000 // sponsored payment, 12.50
const B3 = 46_442_000 // subscription charge, 5.00
const B4 = 46_443_000 // refund 1.00 to P1 (listed)
const B5 = 46_444_000 // transfer to a stranger (not listed), and one to P2 above its payment (not listed)
const BS = 46_300_000 // "September": a payment by P4, before every window below (~3.4 days before B6)
const B6 = 46_445_000 // "October": refund 5.00 to P4
const P4 = addr('4')
const REF3 = hash('b')

const LOGS: Log[] = [
  log(net.splitter, [TOPICS.paid, REF1, topic(WALLET), topic(net.usdc)], data(9_900_000n, 100_000n), B1, hash('1'), 3),
  log(net.splitter, [TOPICS.paid, hash('0'), topic(OTHER), topic(net.usdc)], data(1n, 0n), B1, hash('7')),
  log(net.sponsoredSplitter, [TOPICS.sponsoredPaid, REF2, topic(WALLET), topic(P2)], data(12_275_000n, 125_000n, 4_147n, 100_000n), B2, hash('2')),
  log(net.recurring, [TOPICS.subscriptionCharged, SUB, topic(P3), topic(WALLET)], data(4n, 4_900_000n, 50_000n, 50_000n, 3_000n), B3, hash('3')),
  transfer(WALLET, P1, 1_000_000n, B4, hash('4')),
  transfer(WALLET, STRANGER, 2_000_000n, B5, hash('5')),
  transfer(WALLET, P2, 99_000_000n, B5, hash('6'), 1),
  log(net.splitter, [TOPICS.paid, REF3, topic(WALLET), topic(net.usdc)], data(19_800_000n, 200_000n), BS, hash('9'), 2),
  transfer(WALLET, P4, 5_000_000n, B6, hash('a')),
  // Before the window: must not appear.
  log(net.splitter, [TOPICS.paid, hash('c'), topic(WALLET), topic(net.usdc)], data(1n, 0n), 46_000_000, hash('8')),
]
const RECEIPTS: Record<string, unknown> = {
  [hash('9')]: { from: P4, logs: [transfer(P4, WALLET, 19_800_000n, BS, hash('9'), 1)] },
  [hash('1')]: { from: addr('5'), logs: [transfer(P1, WALLET, 9_900_000n, B1, hash('1'), 1), transfer(P1, addr('f'), 100_000n, B1, hash('1'), 2)] },
}

const matches = (want: unknown, got: string | undefined) =>
  want === null || want === undefined || (Array.isArray(want) ? want.some((w) => w.toLowerCase() === got?.toLowerCase()) : String(want).toLowerCase() === got?.toLowerCase())

const rpcStub = () => {
  const seen: { method: string; params: unknown[] }[] = []
  const answer = (method: string, params: unknown[]): { result?: unknown; error?: unknown } => {
    seen.push({ method, params })
    if (method === 'eth_getBlockByNumber') {
      const n = params[0] === 'latest' ? LATEST : parseInt(params[0] as string, 16)
      return { result: { number: '0x' + n.toString(16), timestamp: '0x' + tsOf(n).toString(16) } }
    }
    if (method === 'eth_getLogs') {
      const f = params[0] as { address: string; fromBlock: string; toBlock: string; topics: unknown[] }
      const from = parseInt(f.fromBlock, 16)
      const to = parseInt(f.toBlock, 16)
      if (to - from > 5_000) return { error: { code: -32005, message: 'query exceeds max block range 5000' } }
      return {
        result: LOGS.filter((l) => {
          const n = parseInt(l.blockNumber, 16)
          return l.address.toLowerCase() === f.address.toLowerCase() && n >= from && n <= to && f.topics.every((t, i) => matches(t, l.topics[i]))
        }),
      }
    }
    if (method === 'eth_getTransactionReceipt') return { result: RECEIPTS[params[0] as string] ?? null }
    return { error: { code: -32601, message: `no ${method}` } }
  }
  const impl = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { id: number; method: string; params: unknown[] } | { id: number; method: string; params: unknown[] }[]
    const one = (r: { id: number; method: string; params: unknown[] }) => ({ jsonrpc: '2.0', id: r.id, ...answer(r.method, r.params) })
    const out = Array.isArray(body) ? body.map(one).reverse() : one(body) // batches may come back in any order
    return { ok: true, status: 200, json: async () => out } as never
  }) as unknown as typeof fetch
  return { impl, seen }
}

const intent = (payload: Record<string, unknown>) => `p2f1.k1.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`

const run = (extra: Partial<Parameters<typeof statement>[0]> = {}) =>
  statement({
    wallet: WALLET,
    from: new Date(tsOf(B1 - 50_000) * 1000),
    to: tsOf(B5 + 10),
    network: 'base-sepolia',
    rpcUrls: ['https://rpc.example'],
    fetch: rpcStub().impl,
    ...extra,
  })

test('the event topics are the keccak of the contracts\' event signatures', () => {
  const k = (s: string) => keccak256(new TextEncoder().encode(s))
  assert.equal(TOPICS.paid, k('Paid(bytes32,address,address,uint256,uint256)'))
  assert.equal(TOPICS.sponsoredPaid, k('SponsoredPaid(bytes32,address,address,uint256,uint256,uint256,uint256)'))
  assert.equal(TOPICS.subscriptionCharged, k('SubscriptionCharged(bytes32,address,address,uint256,uint256,uint256,uint256,uint256)'))
  assert.equal(TOPICS.transfer, k('Transfer(address,address,uint256)'))
})

test('statement: native, sponsored, subscription and a refund to a known payer, in block order', async () => {
  const rows = await run({ intents: [intent({ v: 1, reference: REF1, mr: 'INV-1042' }), 'not-an-intent'] })
  assert.deepEqual(rows, [
    {
      date: new Date(tsOf(B1) * 1000).toISOString(),
      tx_hash: hash('1'),
      kind: 'payment',
      payer: P1,
      reference: REF1,
      merchant_ref: 'INV-1042',
      gross: '10.000000',
      p2flux_fee: '0.100000',
      network_fee: '0.000000',
      net: '9.900000',
    },
    {
      date: new Date(tsOf(B2) * 1000).toISOString(),
      tx_hash: hash('2'),
      kind: 'payment',
      payer: P2,
      reference: REF2,
      merchant_ref: '',
      gross: '12.500000',
      p2flux_fee: '0.125000',
      network_fee: '0.100000',
      net: '12.275000',
    },
    {
      date: new Date(tsOf(B3) * 1000).toISOString(),
      tx_hash: hash('3'),
      kind: 'subscription',
      payer: P3,
      reference: SUB,
      merchant_ref: '',
      gross: '5.000000',
      p2flux_fee: '0.050000',
      network_fee: '0.050000',
      net: '4.900000',
    },
    {
      date: new Date(tsOf(B4) * 1000).toISOString(),
      tx_hash: hash('4'),
      kind: 'refund?',
      payer: P1,
      reference: REF1,
      merchant_ref: 'INV-1042',
      gross: '-1.000000',
      p2flux_fee: '0.000000',
      network_fee: '0.000000',
      net: '-1.000000',
    },
  ] satisfies StatementRow[])
})

test('statement: the window is by date, and a big range is split until the node accepts it', async () => {
  const stub = rpcStub()
  const rows = await run({ from: tsOf(B2), to: tsOf(B3), fetch: stub.impl })
  assert.deepEqual(rows.map((r) => r.tx_hash), [hash('2'), hash('3')])
  const logCalls = stub.seen.filter((c) => c.method === 'eth_getLogs')
  assert.ok(logCalls.every((c) => { const f = c.params[0] as { fromBlock: string; toBlock: string }; return parseInt(f.toBlock, 16) >= parseInt(f.fromBlock, 16) }))
  // No reads below a contract's deploy block - nor below the window: the wallet sent nothing, so there is no refund to look back for.
  assert.ok(logCalls.every((c) => parseInt((c.params[0] as { fromBlock: string }).fromBlock, 16) >= net.splitterDeployBlock))
  assert.ok(logCalls.every((c) => parseInt((c.params[0] as { fromBlock: string }).fromBlock, 16) >= B2 - 10))
})

test('statement: September payment, October refund - the October statement shows the refund, not the payment', async () => {
  const october = { from: tsOf(B6 - 1_000), to: tsOf(B6 + 10) }
  assert.deepEqual(await run({ ...october, intents: [intent({ v: 1, reference: REF3, mr: 'INV-0930' })] }), [
    {
      date: new Date(tsOf(B6) * 1000).toISOString(),
      tx_hash: hash('a'),
      kind: 'refund?',
      payer: P4,
      reference: REF3,
      merchant_ref: 'INV-0930',
      gross: '-5.000000',
      p2flux_fee: '0.000000',
      network_fee: '0.000000',
      net: '-5.000000',
    },
  ] satisfies StatementRow[])
  // The payment is ~3.4 days before the window: a 1-day look-back (or none) does not reach it.
  assert.deepEqual(await run({ ...october, lookbackDays: 1 }), [])
  assert.deepEqual(await run({ ...october, lookbackDays: 0 }), [])
})

test('statementOn: the same rows from contracts and endpoints named by the caller (no network table)', async () => {
  const { chainId: _c, rpcUrls: _r, retired: _x, ...contracts } = net
  const window = { wallet: WALLET, from: tsOf(B2), to: tsOf(B3) }
  assert.deepEqual(
    await statementOn(contracts, { ...window, rpcUrls: ['https://rpc.example'], fetch: rpcStub().impl }),
    await run(window),
  )
  await assert.rejects(statementOn(contracts, { ...window, rpcUrls: [] }), TypeError)
})

test('statement: a wallet with nothing in the window is an empty list; bad input is a TypeError', async () => {
  assert.deepEqual(await run({ wallet: addr('c') }), [])
  await assert.rejects(run({ wallet: 'nope' }), TypeError)
  await assert.rejects(run({ from: tsOf(B2), to: tsOf(B1) }), TypeError)
  await assert.rejects(run({ network: 'mars' as never }), TypeError)
  await assert.rejects(run({ lookbackDays: -1 }), TypeError)
})

test('statement: an RPC that keeps failing is an error, not a short statement', async () => {
  const dead = (async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch
  await assert.rejects(run({ fetch: dead }))
})

const ROWS: StatementRow[] = [
  { date: '2026-10-01T12:00:00.000Z', tx_hash: hash('1'), kind: 'payment', payer: P1, reference: REF1, merchant_ref: '-INV,"1"', gross: '10.000000', p2flux_fee: '0.100000', network_fee: '0.000000', net: '9.900000' },
  { date: '2026-10-02T08:30:00.000Z', tx_hash: hash('4'), kind: 'refund?', payer: P1, reference: REF1, merchant_ref: '', gross: '-1.000000', p2flux_fee: '0.000000', network_fee: '0.000000', net: '-1.000000' },
]

test('toCsv: generic, xero and quickbooks', () => {
  assert.equal(
    toCsv(ROWS),
    [
      'date,tx_hash,kind,payer,reference,merchant_ref,gross,p2flux_fee,network_fee,net',
      `2026-10-01T12:00:00.000Z,${hash('1')},payment,${P1},${REF1},"'-INV,""1""",10.000000,0.100000,0.000000,9.900000`,
      `2026-10-02T08:30:00.000Z,${hash('4')},refund?,${P1},${REF1},,-1.000000,0.000000,0.000000,-1.000000`,
    ].join('\r\n') + '\r\n',
  )
  assert.equal(
    toCsv(ROWS, 'xero'),
    [
      'Date,Amount,Payee,Description,Reference',
      `01/10/2026,9.900000,${P1},"P2Flux payment ${hash('1')}: gross 10.000000, P2Flux fee 0.100000, network fee 0.000000","'-INV,""1"""`,
      `02/10/2026,-1.000000,${P1},"P2Flux refund? ${hash('4')}: gross -1.000000, P2Flux fee 0.000000, network fee 0.000000",${REF1}`,
    ].join('\r\n') + '\r\n',
  )
  assert.equal(
    toCsv(ROWS, 'quickbooks'),
    [
      'Date,Description,Amount',
      `10/01/2026,"P2Flux payment -INV,""1"" ${hash('1')}: gross 10.000000, P2Flux fee 0.100000, network fee 0.000000",9.900000`,
      `10/02/2026,"P2Flux refund? ${REF1} ${hash('4')}: gross -1.000000, P2Flux fee 0.000000, network fee 0.000000",-1.000000`,
    ].join('\r\n') + '\r\n',
  )
  assert.throws(() => toCsv(ROWS, 'excel' as never), TypeError)
})
