/**
 * An accounting statement for one receiving wallet, read straight from the chain.
 *
 *   import { statement, toCsv } from '@p2flux/sdk/statement'
 *   const rows = await statement({ wallet: '0xYourWallet', from: new Date('2026-10-01'), to: new Date('2026-11-01') })
 *   writeFileSync('october.csv', toCsv(rows, 'xero'))
 *
 * No API call, no key, no dependency: raw JSON-RPC to public endpoints (or your own), so the numbers
 * do not depend on P2Flux being up - or honest. One row per settlement to the wallet (one-time
 * payments through the splitter and the sponsored splitter, subscription charges) and per probable
 * refund: a USDC transfer from the wallet back to a payer, after their payment and no larger than it
 * (`kind: 'refund?'` - a transfer cannot say why it was sent, so it is marked as a guess). The payment
 * may be up to `lookbackDays` (default 90) before `from`: a September payment refunded in October is
 * on the October statement as a refund, without the September payment as a row. Amounts are decimal
 * USDC; a refund is negative.
 *
 * `merchant_ref` is filled from the intents you pass (`intents`): they are decoded here, never sent
 * anywhere. Empty when unknown.
 *
 * `currencies: ['EUR', 'GBP']` adds the value of `net` in USD (USDC booked 1:1), EUR and GBP, rounded to
 * cents, at the ECB euro reference rate of the row's day (UTC) - `rate_date` is the ECB publication day
 * used (the last one before a weekend or holiday). The rates come from the P2Flux API's /v1/rates
 * (`apiUrl`): public data, and only the dates are sent.
 */

export type StatementNetwork = 'base' | 'base-sepolia'

export type StatementRow = {
  /** Block time, ISO 8601 UTC. */
  date: string
  tx_hash: string
  kind: 'payment' | 'subscription' | 'refund?'
  payer: string
  /** The payment's on-chain reference; a subscription's id; for a refund, the payment it matched. */
  reference: string
  merchant_ref: string
  /** What the buyer was charged for (a sponsored payment's buyer-paid network fee is not in it). */
  gross: string
  p2flux_fee: string
  /** Network fees the merchant funded out of `gross` (fixed fee of a sponsored payment, a charge's network fee). */
  network_fee: string
  /** What reached the wallet. */
  net: string
  /** With `currencies`: `net` in USD (USDC 1:1), EUR and GBP, 2 decimals, and the ECB publication day used. */
  value_usd?: string
  value_eur?: string
  value_gbp?: string
  rate_date?: string
}

export type StatementCurrency = 'EUR' | 'GBP'

type Contract = { address: string; deployBlock: number }

/** A network's settlement contracts and their deploy blocks (the floor of every log search), for `statementOn`. */
export type StatementContracts = {
  usdc: string
  splitter: string
  splitterDeployBlock: number
  sponsoredSplitter: string
  sponsoredSplitterDeployBlock: number
  recurring: string
  recurringDeployBlock: number
  retired?: { splitters: readonly Contract[]; sponsoredSplitters: readonly Contract[] }
}

/**
 * Addresses and deploy blocks (the floor of every log search), as pinned in the P2Flux checkout and
 * the API's registry. `retired` lists settlement contracts replaced by a rotation (none yet).
 */
export const NETWORKS = {
  base: {
    chainId: 8453,
    rpcUrls: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'],
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    splitter: '0x5A3bD0945cd0C80B124870881dE49a717D20E0D0',
    splitterDeployBlock: 50362015,
    sponsoredSplitter: '0x95E18ec05D4282acB3aab7aD60325bA4EEeEa8df',
    sponsoredSplitterDeployBlock: 50966621,
    recurring: '0xb415A9910Ef627e3bEF10F5Cb9DC92a3271e0975',
    recurringDeployBlock: 50362127,
    retired: { splitters: [] as Contract[], sponsoredSplitters: [] as Contract[] },
  },
  'base-sepolia': {
    chainId: 84532,
    rpcUrls: ['https://sepolia.base.org', 'https://base-sepolia-rpc.publicnode.com'],
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    splitter: '0x3120aa022437db5c6d0439ac7f7852ce8b38e70f',
    splitterDeployBlock: 45512197,
    sponsoredSplitter: '0x876f7b98e8c06291ec916a3223a92038b0a8774f',
    sponsoredSplitterDeployBlock: 46433064,
    recurring: '0x394c3fe285168f333ebf29e8f3585039328f2a73',
    recurringDeployBlock: 45635698,
    retired: { splitters: [] as Contract[], sponsoredSplitters: [] as Contract[] },
  },
} as const

/** keccak256 of each event signature (checked against the signatures in test/statement.test.ts). */
export const TOPICS = {
  /** Paid(bytes32 indexed ref, address indexed recipient, address indexed token, uint256 net, uint256 fee) */
  paid: '0xa35447e6a2d0a89ecfb9d70336046be4a4ab0c579634503abd6ae7b4891dfc3c',
  /** SponsoredPaid(bytes32 indexed ref, address indexed recipient, address indexed payer, net, fee, networkFee, fixedNetworkFee) */
  sponsoredPaid: '0x416cb67c4e5d87dd0e97ed23f9840596617678f78a7476b9c32f6d5521124ff6',
  /** SubscriptionCharged(bytes32 indexed id, address indexed payer, address indexed recipient, periodIndex, net, fee, networkFee, gasReimbursement) */
  subscriptionCharged: '0x5b2b67b5b5878335a49150eeee6843fb39976a9d48ab7015c6dc3d0136795ff3',
  /** Transfer(address indexed from, address indexed to, uint256 value) */
  transfer: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
} as const

export type StatementOptions = {
  /** The receiving wallet (the `recipient` of your payments). */
  wallet: string
  /** Inclusive; a Date or unix seconds. */
  from: Date | number
  to: Date | number
  /** Default 'base'. */
  network?: StatementNetwork
  /** JSON-RPC endpoints, tried in order. Default: the network's public, keyless ones. */
  rpcUrls?: string[]
  /** Your intents (from createPayment), to fill `merchant_ref`. Decoded locally, never sent. */
  intents?: string[]
  /**
   * How far before `from` to look for the payment a refund in the window returns (default 90; 0 = only
   * payments in the window). Read only when the wallet sent USDC in the window; those payments are not rows.
   */
  lookbackDays?: number
  /** Add value_usd, value_eur and/or value_gbp and rate_date to each row (see the module comment). Default none. */
  currencies?: StatementCurrency[]
  /** Where the exchange rates come from (`currencies` only). Default 'https://api.p2flux.com'. */
  apiUrl?: string
  /** Injectable for tests; defaults to global fetch. */
  fetch?: typeof fetch
}

type Log = { address: string; topics: string[]; data: string; blockNumber: string; transactionHash: string; logIndex: string }
type Rpc = (calls: [string, unknown[]][]) => Promise<unknown[]>

const LOG_SPAN = 10_000 // mainnet.base.org serves 10,000 blocks per eth_getLogs
const BATCH = 20

const hexNum = (n: number) => '0x' + n.toString(16)
const topicOf = (address: string) => '0x' + address.slice(2).toLowerCase().padStart(64, '0')
const addressOf = (topic: string) => '0x' + topic.slice(-40)
const words = (data: string) => (data.slice(2).match(/.{64}/g) ?? []).map((w) => BigInt('0x' + w))
const seconds = (t: Date | number) => (t instanceof Date ? Math.floor(t.getTime() / 1000) : t)

const usdc = (units: bigint) => {
  const sign = units < 0n ? '-' : ''
  const s = (units < 0n ? -units : units).toString().padStart(7, '0')
  return `${sign}${s.slice(0, -6)}.${s.slice(-6)}`
}

/** Batched JSON-RPC over `urls`, the next URL on any failure; an error inside a batch fails the batch. */
const rpcOver = (urls: string[], fetchImpl: typeof fetch): Rpc => async (calls) => {
  const out: unknown[] = []
  for (let i = 0; i < calls.length; i += BATCH) {
    const chunk = calls.slice(i, i + BATCH)
    const body = JSON.stringify(chunk.map(([method, params], id) => ({ jsonrpc: '2.0', id, method, params })))
    let lastError: unknown = new Error('no RPC URL')
    let answers: unknown[] | undefined
    for (const url of urls) {
      try {
        const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
        if (!res.ok) throw new Error(`RPC ${url}: HTTP ${res.status}`)
        const replies = (await res.json()) as { id: number; result?: unknown; error?: { message?: string } }[]
        if (!Array.isArray(replies)) throw new Error(`RPC ${url}: not a batch answer`)
        const byId = new Map(replies.map((r) => [r.id, r]))
        answers = chunk.map((_, id) => {
          const r = byId.get(id)
          if (!r || r.error || !('result' in r)) throw new Error(`RPC ${url}: ${r?.error?.message ?? 'no answer'}`)
          return r.result
        })
        break
      } catch (err) {
        lastError = err
      }
    }
    if (!answers) throw lastError
    out.push(...answers)
  }
  return out
}

/** Every log matching `topics` on `address` in [from, to], halving any range the node refuses. */
const getLogs = async (rpc: Rpc, address: string, topics: unknown[], from: number, to: number): Promise<Log[]> => {
  const out: Log[] = []
  const range = async (a: number, b: number): Promise<void> => {
    try {
      const [logs] = await rpc([['eth_getLogs', [{ address, topics, fromBlock: hexNum(a), toBlock: hexNum(b) }]]])
      out.push(...(logs as Log[]))
    } catch (err) {
      if (a === b) throw err
      const mid = Math.floor((a + b) / 2)
      await range(a, mid)
      await range(mid + 1, b)
    }
  }
  for (let a = from; a <= to; a += LOG_SPAN) await range(a, Math.min(to, a + LOG_SPAN - 1))
  return out
}

const block = async (rpc: Rpc, tag: number | 'latest') => {
  const [b] = (await rpc([['eth_getBlockByNumber', [tag === 'latest' ? tag : hexNum(tag), false]]])) as { number: string; timestamp: string }[]
  return { n: parseInt(b!.number, 16), ts: parseInt(b!.timestamp, 16) }
}

/** The block near `ts`: an estimate at Base's 2 s per block, corrected twice. Callers widen and filter by date. */
const blockNear = async (rpc: Rpc, ts: number, latest: { n: number; ts: number }) => {
  if (ts >= latest.ts) return latest.n
  let n = Math.max(0, latest.n - Math.ceil((latest.ts - ts) / 2))
  for (let i = 0; i < 2; i++) {
    const b = await block(rpc, n)
    if (b.ts === ts) break
    n = Math.min(latest.n, Math.max(0, n + Math.round((ts - b.ts) / 2)))
  }
  return n
}

/** The API's merchant_ref rule (index.ts MERCHANT_REF; kept here so this entry point imports nothing). */
const MERCHANT_REF = /^[A-Za-z0-9._:\/#-]{1,64}$/

/**
 * reference (lowercase) -> merchant_ref, read from the intents' own payloads. Decoded without checking
 * the signature, so only a value the API itself could have signed (MERCHANT_REF) is kept.
 */
const merchantRefs = (intents: string[] = []) => {
  const map = new Map<string, string>()
  for (const intent of intents) {
    try {
      const b64 = (intent.split('.')[2] ?? '').replace(/-/g, '+').replace(/_/g, '/')
      const p = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as { reference?: unknown; mr?: unknown }
      if (typeof p.reference === 'string' && typeof p.mr === 'string' && MERCHANT_REF.test(p.mr)) map.set(p.reference.toLowerCase(), p.mr)
    } catch {
      /* not an intent: nothing to join */
    }
  }
  return map
}

type Entry = { block: number; index: number; row: Omit<StatementRow, 'date'>; gross: bigint }

/** The statement rows for `wallet` between `from` and `to`, oldest first. */
export async function statement(options: StatementOptions): Promise<StatementRow[]> {
  const net = NETWORKS[options.network ?? 'base']
  if (!net) throw new TypeError(`unknown network: ${options.network}`)
  return statementOn(net, { ...options, rpcUrls: options.rpcUrls?.length ? options.rpcUrls : [...net.rpcUrls] })
}

/**
 * `statement()` over contracts and RPC endpoints you name, without the built-in network table - for
 * a bundle that must carry one network only (the P2Flux checkout passes its pinned network).
 */
export async function statementOn(net: StatementContracts, options: Omit<StatementOptions, 'network' | 'rpcUrls'> & { rpcUrls: string[] }): Promise<StatementRow[]> {
  if (!options.rpcUrls.length) throw new TypeError('rpcUrls must name at least one endpoint')
  if (!/^0x[0-9a-fA-F]{40}$/.test(options.wallet)) throw new TypeError('wallet must be a 0x address')
  const fromTs = seconds(options.from)
  const toTs = seconds(options.to)
  if (!Number.isFinite(fromTs) || !Number.isFinite(toTs) || fromTs > toTs) throw new TypeError('from must be a time before to')
  const lookbackDays = options.lookbackDays ?? 90
  const currencies = options.currencies ?? []
  if (!Array.isArray(currencies) || currencies.some((c) => c !== 'EUR' && c !== 'GBP')) throw new TypeError("currencies may name 'EUR' and 'GBP'")
  if (!Number.isInteger(lookbackDays) || lookbackDays < 0) throw new TypeError('lookbackDays must be a whole number of days, 0 or more')
  const rpc = rpcOver(options.rpcUrls, options.fetch ?? globalThis.fetch)
  const wallet = options.wallet.toLowerCase()
  const walletTopic = topicOf(wallet)
  const refs = merchantRefs(options.intents)

  const latest = await block(rpc, 'latest')
  // Widened by a few blocks either way; rows are then held to the dates themselves.
  const fromBlock = Math.max(0, (await blockNear(rpc, fromTs, latest)) - 5)
  const toBlock = Math.min(latest.n, (await blockNear(rpc, toTs, latest)) + 5)
  const scanIn = (lo: number, hi: number) => async (c: Contract, topics: unknown[]) => {
    const a = Math.max(lo, c.deployBlock)
    return a > hi ? [] : getLogs(rpc, c.address, topics, a, hi)
  }

  const entries: Entry[] = []
  const at = (l: Log) => ({ block: parseInt(l.blockNumber, 16), index: parseInt(l.logIndex, 16) })
  const row = (l: Log, kind: StatementRow['kind'], payer: string, reference: string, gross: bigint, fee: bigint, networkFee: bigint, netUnits: bigint): Entry => ({
    ...at(l),
    gross,
    row: {
      tx_hash: l.transactionHash,
      kind,
      payer: payer.toLowerCase(),
      reference: reference.toLowerCase(),
      merchant_ref: refs.get(reference.toLowerCase()) ?? '',
      gross: usdc(gross),
      p2flux_fee: usdc(fee),
      network_fee: usdc(networkFee),
      net: usdc(netUnits),
    },
  })

  /** Payments and subscription charges to the wallet in blocks [lo, hi]. */
  const settlements = async (lo: number, hi: number) => {
    const scan = scanIn(lo, hi)
    // One-time payments through the splitter: the payer is whoever's USDC reached the wallet in that transaction.
    const paid = (
      await Promise.all([{ address: net.splitter, deployBlock: net.splitterDeployBlock }, ...(net.retired?.splitters ?? [])].map((c) => scan(c, [TOPICS.paid, null, walletTopic])))
    ).flat()
    const receipts = (await rpc(paid.map((l) => ['eth_getTransactionReceipt', [l.transactionHash]]))) as ({ from?: string; logs?: Log[] } | null)[]
    paid.forEach((l, i) => {
      const [netUnits = 0n, fee = 0n] = words(l.data)
      const receipt = receipts[i]
      const t = receipt?.logs?.find(
        (r) => r.address.toLowerCase() === net.usdc.toLowerCase() && r.topics[0] === TOPICS.transfer && addressOf(r.topics[2] ?? '') === wallet && words(r.data)[0] === netUnits,
      )
      entries.push(row(l, 'payment', t ? addressOf(t.topics[1]!) : (receipt?.from ?? ''), l.topics[1]!, netUnits + fee, fee, 0n, netUnits))
    })

    // Sponsored: the merchant funds the fee and the fixed network fee out of the amount; the buyer's quoted network fee is on top.
    const sponsored = (
      await Promise.all(
        [{ address: net.sponsoredSplitter, deployBlock: net.sponsoredSplitterDeployBlock }, ...(net.retired?.sponsoredSplitters ?? [])].map((c) =>
          scan(c, [TOPICS.sponsoredPaid, null, walletTopic]),
        ),
      )
    ).flat()
    for (const l of sponsored) {
      const [netUnits = 0n, fee = 0n, , fixed = 0n] = words(l.data)
      entries.push(row(l, 'payment', addressOf(l.topics[3]!), l.topics[1]!, netUnits + fee + fixed, fee, fixed, netUnits))
    }

    // Subscription charges: net + fee + networkFee is the amount; the payer's gas reimbursement is on top.
    for (const l of await scan({ address: net.recurring, deployBlock: net.recurringDeployBlock }, [TOPICS.subscriptionCharged, null, null, walletTopic])) {
      const [, netUnits = 0n, fee = 0n, networkFee = 0n] = words(l.data)
      entries.push(row(l, 'subscription', addressOf(l.topics[2]!), l.topics[1]!, netUnits + fee + networkFee, fee, networkFee, netUnits))
    }
  }
  await settlements(fromBlock, toBlock)

  // Probable refunds: USDC from the wallet in the window to a payer, later than one of their payments and no
  // larger. Only when the wallet sent anything are the look-back's payments read (they match, they are not rows).
  const sent = await getLogs(rpc, net.usdc, [TOPICS.transfer, walletTopic], fromBlock, toBlock)
  if (sent.length && lookbackDays > 0) {
    const lookFrom = Math.max(0, (await blockNear(rpc, fromTs - lookbackDays * 86_400, latest)) - 5)
    if (lookFrom < fromBlock) await settlements(lookFrom, fromBlock - 1)
  }
  const settled = entries.slice()
  for (const l of sent) {
    const to = addressOf(l.topics[2]!)
    const amount = words(l.data)[0] ?? 0n
    const { block: b, index } = at(l)
    const original = settled
      .filter((e) => e.row.payer === to && (e.block < b || (e.block === b && e.index < index)) && e.gross >= amount)
      .sort((x, y) => y.block - x.block || y.index - x.index)[0]
    if (original) entries.push(row(l, 'refund?', to, original.row.reference, -amount, 0n, 0n, -amount))
  }

  // Dates, one batched read per distinct block (the look-back's payments are below the window: no rows).
  const inWindow = entries.filter((e) => e.block >= fromBlock)
  const blocks = [...new Set(inWindow.map((e) => e.block))]
  const times = (await rpc(blocks.map((n) => ['eth_getBlockByNumber', [hexNum(n), false]]))) as { timestamp: string }[]
  const tsByBlock = new Map(blocks.map((n, i) => [n, parseInt(times[i]!.timestamp, 16)]))

  const rows: StatementRow[] = inWindow
    .filter((e) => {
      const ts = tsByBlock.get(e.block)!
      return ts >= fromTs && ts <= toTs
    })
    .sort((x, y) => x.block - y.block || x.index - y.index)
    .map((e) => ({ date: new Date(tsByBlock.get(e.block)! * 1000).toISOString(), ...e.row }))
  return currencies.length ? withValues(rows, currencies, options.apiUrl ?? 'https://api.p2flux.com', options.fetch ?? globalThis.fetch) : rows
}

/** `units * num / den`, rounded half away from zero (same integers and rounding as the PHP SDK). */
const roundDiv = (n: bigint, d: bigint) => {
  const q = ((n < 0n ? -n : n) * 2n + d) / (2n * d)
  return n < 0n ? -q : q
}
const cents = (c: bigint) => {
  const a = (c < 0n ? -c : c).toString().padStart(3, '0')
  return `${c < 0n ? '-' : ''}${a.slice(0, -2)}.${a.slice(-2)}`
}
/** A rate as published (at most 5 decimals) in 1e-5 units. */
const rate5 = (r: unknown) => {
  if (typeof r !== 'number' || !(r > 0)) throw new Error('P2Flux /v1/rates: not a rate')
  return BigInt(Math.round(r * 1e5))
}

/** The rows with value_usd/eur/gbp and rate_date, rates from the API in chunks of at most 366 days. */
const withValues = async (rows: StatementRow[], currencies: StatementCurrency[], apiUrl: string, fetchImpl: typeof fetch): Promise<StatementRow[]> => {
  if (!rows.length) return rows
  const days: Record<string, { USD: unknown; GBP: unknown; rate_date: string }> = {}
  const first = Date.parse(rows[0]!.date.slice(0, 10))
  const last = Date.parse(rows.at(-1)!.date.slice(0, 10))
  for (let a = first; a <= last; a += 366 * 86_400_000) {
    const range = { from: new Date(a).toISOString().slice(0, 10), to: new Date(Math.min(last, a + 365 * 86_400_000)).toISOString().slice(0, 10) }
    const res = await fetchImpl(`${apiUrl.replace(/\/$/, '')}/v1/rates`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(range) })
    const body = (await res.json().catch(() => ({}))) as { error?: string; rates?: typeof days }
    if (!res.ok || !body.rates) throw new Error(`P2Flux /v1/rates: ${body.error ?? `HTTP ${res.status}`}`)
    Object.assign(days, body.rates)
  }
  return rows.map((r) => {
    const day = days[r.date.slice(0, 10)]
    if (!day) throw new Error(`no ECB rate for ${r.date.slice(0, 10)}`)
    const usd = rate5(day.USD)
    const units = BigInt(r.net.replace('.', ''))
    return {
      ...r,
      value_usd: cents(roundDiv(units, 10_000n)),
      ...(currencies.includes('EUR') ? { value_eur: cents(roundDiv(units * 100_000n, usd * 10_000n)) } : {}),
      ...(currencies.includes('GBP') ? { value_gbp: cents(roundDiv(units * rate5(day.GBP), usd * 10_000n)) } : {}),
      rate_date: day.rate_date,
    }
  })
}

/** A CSV cell: quoted when needed; a text cell that a spreadsheet would run as a formula gets a leading '. */
const cell = (value: string, text = true) => {
  const v = text && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

const COLUMNS: (keyof StatementRow)[] = ['date', 'tx_hash', 'kind', 'payer', 'reference', 'merchant_ref', 'gross', 'p2flux_fee', 'network_fee', 'net']
const VALUE_COLUMNS: (keyof StatementRow)[] = ['value_usd', 'value_eur', 'value_gbp', 'rate_date']
const AMOUNTS = new Set<keyof StatementRow>(['gross', 'p2flux_fee', 'network_fee', 'net', 'value_usd', 'value_eur', 'value_gbp'])

/**
 * The rows as CSV (CRLF line ends).
 *
 * - `generic`: every column, as in the rows.
 * - `xero`: a bank-statement import - Date (dd/mm/yyyy), Amount (net), Payee, Description, Reference
 *   (merchant_ref, else the on-chain reference).
 * - `quickbooks`: the 3-column bank upload - Date (mm/dd/yyyy), Description, Amount (net).
 *
 * The amount booked is `net`, what reached the wallet; gross and fees are in the description. Rows
 * with `currencies` values: generic adds the value columns; xero and quickbooks keep their layout (amount
 * in USD) and name the EUR/GBP values and the ECB day in the description.
 */
export function toCsv(rows: StatementRow[], format: 'generic' | 'xero' | 'quickbooks' = 'generic'): string {
  const day = (r: StatementRow) => r.date.slice(8, 10)
  const month = (r: StatementRow) => r.date.slice(5, 7)
  const year = (r: StatementRow) => r.date.slice(0, 4)
  const fx = (r: StatementRow) =>
    r.rate_date ? `${r.value_eur ? `, EUR ${r.value_eur}` : ''}${r.value_gbp ? `, GBP ${r.value_gbp}` : ''} (ECB ${r.rate_date})` : ''
  const describe = (r: StatementRow) => `${r.tx_hash}: gross ${r.gross}, P2Flux fee ${r.p2flux_fee}, network fee ${r.network_fee}${fx(r)}`
  let lines: string[]
  if (format === 'generic') {
    const columns = [...COLUMNS, ...VALUE_COLUMNS.filter((c) => rows[0]?.[c] !== undefined)]
    lines = [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c] ?? '', !AMOUNTS.has(c))).join(','))]
  } else if (format === 'xero') {
    lines = [
      'Date,Amount,Payee,Description,Reference',
      ...rows.map((r) => [`${day(r)}/${month(r)}/${year(r)}`, r.net, cell(r.payer), cell(`P2Flux ${r.kind} ${describe(r)}`), cell(r.merchant_ref || r.reference)].join(',')),
    ]
  } else if (format === 'quickbooks') {
    lines = [
      'Date,Description,Amount',
      ...rows.map((r) => [`${month(r)}/${day(r)}/${year(r)}`, cell(`P2Flux ${r.kind} ${r.merchant_ref || r.reference} ${describe(r)}`), r.net].join(',')),
    ]
  } else {
    throw new TypeError(`unknown CSV format: ${format}`)
  }
  return lines.join('\r\n') + '\r\n'
}
