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
 * refund: a USDC transfer from the wallet back to a payer, after their payment and no larger than what is
 * left of it (each payment is refunded at most up to its gross) (`kind: 'refund?'` - a transfer cannot say why it was sent, so it is marked as a guess). The payment
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
        retired: { splitters: [], sponsoredSplitters: [] },
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
        retired: { splitters: [], sponsoredSplitters: [] },
    },
};
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
};
const LOG_SPAN = 10_000; // mainnet.base.org serves 10,000 blocks per eth_getLogs
const BATCH = 20;
const hexNum = (n) => '0x' + n.toString(16);
const topicOf = (address) => '0x' + address.slice(2).toLowerCase().padStart(64, '0');
const addressOf = (topic) => '0x' + topic.slice(-40);
const words = (data) => (data.slice(2).match(/.{64}/g) ?? []).map((w) => BigInt('0x' + w));
const seconds = (t) => (t instanceof Date ? Math.floor(t.getTime() / 1000) : t);
const usdc = (units) => {
    const sign = units < 0n ? '-' : '';
    const s = (units < 0n ? -units : units).toString().padStart(7, '0');
    return `${sign}${s.slice(0, -6)}.${s.slice(-6)}`;
};
class RateLimited extends Error {
}
const RETRIES = 3; // rounds after every URL answered HTTP 429
const BACKOFF_MS = 200; // doubled each round: 200, 400, 800
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * Batched JSON-RPC over `urls` (20 calls a batch), the next URL on any failure; an error inside a batch
 * fails the batch (unless `each`). When every URL answered HTTP 429 the round is retried after a backoff.
 */
const rpcOver = (urls, fetchImpl, timeoutMs) => {
    const post = async (url, body) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: controller.signal });
            if (res.status === 429)
                throw new RateLimited(`RPC ${url}: HTTP 429`);
            if (!res.ok)
                throw new Error(`RPC ${url}: HTTP ${res.status}`);
            const replies = (await res.json());
            if (!Array.isArray(replies))
                throw new Error(`RPC ${url}: not a batch answer`);
            return new Map(replies.map((r) => [r.id, r]));
        }
        finally {
            clearTimeout(timer);
        }
    };
    const batch = async (chunk, each) => {
        const body = JSON.stringify(chunk.map(([method, params], id) => ({ jsonrpc: '2.0', id, method, params })));
        let lastError = new Error('no RPC URL');
        for (let round = 0;; round++) {
            let limited = false;
            for (const url of urls) {
                try {
                    const byId = await post(url, body);
                    return chunk.map((_, id) => {
                        const r = byId.get(id);
                        if (r && !r.error && 'result' in r)
                            return r.result;
                        const err = new Error(`RPC ${url}: ${r?.error?.message ?? 'no answer'}`);
                        if (each)
                            return err;
                        throw err;
                    });
                }
                catch (err) {
                    lastError = err;
                    limited ||= err instanceof RateLimited;
                }
            }
            if (!limited || round >= RETRIES)
                throw lastError;
            await sleep(BACKOFF_MS * 2 ** round);
        }
    };
    return (async (calls, each = false) => {
        const out = [];
        for (let i = 0; i < calls.length; i += BATCH)
            out.push(...(await batch(calls.slice(i, i + BATCH), each === true)));
        return out;
    });
};
const byPosition = (x, y) => parseInt(x.blockNumber, 16) - parseInt(y.blockNumber, 16) || parseInt(x.logIndex, 16) - parseInt(y.logIndex, 16);
/**
 * Every log matching `topics` on `address` in [from, to], oldest first: LOG_SPAN-block spans, 20 to a
 * batch; a span the node refuses (its own JSON-RPC error, e.g. range too large) is halved and asked again.
 */
const getLogs = async (rpc, address, topics, from, to) => {
    const out = [];
    let spans = [];
    for (let a = from; a <= to; a += LOG_SPAN)
        spans.push([a, Math.min(to, a + LOG_SPAN - 1)]);
    while (spans.length) {
        const answers = await rpc(spans.map(([a, b]) => ['eth_getLogs', [{ address, topics, fromBlock: hexNum(a), toBlock: hexNum(b) }]]), true);
        const refused = [];
        answers.forEach((logs, i) => {
            const [a, b] = spans[i];
            if (!(logs instanceof Error))
                out.push(...logs);
            else if (a === b || PRUNED.test(logs.message))
                throw logs; // pruned history: no half of it is served either
            else
                refused.push([a, Math.floor((a + b) / 2)], [Math.floor((a + b) / 2) + 1, b]);
        });
        spans = refused;
    }
    return out.sort(byPosition);
};
const block = async (rpc, tag) => {
    const [b] = (await rpc([['eth_getBlockByNumber', [tag === 'latest' ? tag : hexNum(tag), false]]]));
    return { n: parseInt(b.number, 16), ts: parseInt(b.timestamp, 16) };
};
/**
 * The first block at or after `ts` (latest.n + 1 when none), never below `floor`. No block time is
 * assumed (Base Sepolia went from 2 s to 0.2 s a block): an estimate from the chain's own recent pace
 * (`pace`, seconds a block), then galloped and bisected until two neighbouring blocks bracket `ts`.
 */
const firstBlockAt = async (rpc, ts, latest, pace, floor) => {
    if (ts > latest.ts)
        return latest.n + 1;
    const at = async (n) => (await block(rpc, n)).ts;
    let lo = floor - 1; // invariant: block lo is before ts (floor - 1: below what may be read), block hi at or after it
    let hi = latest.n;
    const est = Math.min(latest.n, Math.max(floor, latest.n - Math.floor((latest.ts - ts) / pace)));
    if ((await at(est)) >= ts) {
        hi = est;
        for (let step = 1; hi > floor; step *= 2) {
            const n = Math.max(floor, hi - step);
            if ((await at(n)) < ts) {
                lo = n;
                break;
            }
            hi = n;
        }
    }
    else {
        lo = est;
        for (let step = 1;; step *= 2) {
            const n = Math.min(latest.n, lo + step);
            if (n === latest.n || (await at(n)) >= ts) {
                hi = n;
                break;
            }
            lo = n;
        }
    }
    while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if ((await at(mid)) >= ts)
            hi = mid;
        else
            lo = mid;
    }
    return hi;
};
/** A node's refusal to serve blocks it no longer keeps (its "earliest available" block, when it says). */
const PRUNED = /prun|earliest available|history (is )?(not |un)available/i;
/** The API's merchant_ref rule (index.ts MERCHANT_REF; kept here so this entry point imports nothing). */
const MERCHANT_REF = /^[A-Za-z0-9._:\/#-]{1,64}$/;
/**
 * reference (lowercase) -> merchant_ref, read from the intents' own payloads. Decoded without checking
 * the signature, so only a value the API itself could have signed (MERCHANT_REF) is kept.
 */
const merchantRefs = (intents = []) => {
    const map = new Map();
    for (const intent of intents) {
        try {
            const b64 = (intent.split('.')[2] ?? '').replace(/-/g, '+').replace(/_/g, '/');
            const p = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
            if (typeof p.reference === 'string' && typeof p.mr === 'string' && MERCHANT_REF.test(p.mr))
                map.set(p.reference.toLowerCase(), p.mr);
        }
        catch {
            /* not an intent: nothing to join */
        }
    }
    return map;
};
/** The statement rows for `wallet` between `from` and `to`, oldest first. */
export async function statement(options) {
    const net = NETWORKS[options.network ?? 'base'];
    if (!net)
        throw new TypeError(`unknown network: ${options.network}`);
    return statementOn(net, { ...options, rpcUrls: options.rpcUrls?.length ? options.rpcUrls : [...net.rpcUrls] });
}
/**
 * `statement()` over contracts and RPC endpoints you name, without the built-in network table - for
 * a bundle that must carry one network only (the P2Flux checkout passes its pinned network).
 */
export async function statementOn(net, options) {
    if (!options.rpcUrls.length)
        throw new TypeError('rpcUrls must name at least one endpoint');
    if (!/^0x[0-9a-fA-F]{40}$/.test(options.wallet))
        throw new TypeError('wallet must be a 0x address');
    const fromTs = seconds(options.from);
    const toTs = seconds(options.to);
    if (!Number.isFinite(fromTs) || !Number.isFinite(toTs) || fromTs > toTs)
        throw new TypeError('from must be a time before to');
    const lookbackDays = options.lookbackDays ?? 90;
    const currencies = options.currencies ?? [];
    if (!Array.isArray(currencies) || currencies.some((c) => c !== 'EUR' && c !== 'GBP'))
        throw new TypeError("currencies may name 'EUR' and 'GBP'");
    if (!Number.isInteger(lookbackDays) || lookbackDays < 0)
        throw new TypeError('lookbackDays must be a whole number of days, 0 or more');
    const timeoutMs = options.timeoutMs ?? 30_000;
    if (typeof timeoutMs !== 'number' || !(timeoutMs > 0))
        throw new TypeError('timeoutMs must be a positive number');
    const rpc = rpcOver(options.rpcUrls, options.fetch ?? globalThis.fetch, timeoutMs);
    const wallet = options.wallet.toLowerCase();
    const walletTopic = topicOf(wallet);
    const refs = merchantRefs(options.intents);
    const latest = await block(rpc, 'latest');
    // Nothing settles below the oldest contract's deploy block: no search or scan goes there.
    const floor = Math.min(...[net.splitterDeployBlock, net.sponsoredSplitterDeployBlock, net.recurringDeployBlock], ...[...(net.retired?.splitters ?? []), ...(net.retired?.sponsoredSplitters ?? [])].map((c) => c.deployBlock));
    const back = Math.min(10_000, latest.n - floor);
    const recent = back > 0 ? await block(rpc, latest.n - back) : latest;
    const pace = recent.ts < latest.ts ? (latest.ts - recent.ts) / back : 1;
    const fromBlock = await firstBlockAt(rpc, fromTs, latest, pace, floor);
    const toBlock = (await firstBlockAt(rpc, toTs + 1, latest, pace, floor)) - 1;
    const scanIn = (lo, hi) => async (c, topics) => {
        const a = Math.max(lo, c.deployBlock);
        return a > hi ? [] : getLogs(rpc, c.address, topics, a, hi);
    };
    const entries = [];
    const at = (l) => ({ block: parseInt(l.blockNumber, 16), index: parseInt(l.logIndex, 16) });
    const row = (l, kind, payer, reference, gross, fee, networkFee, netUnits) => ({
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
    });
    /** Payments and subscription charges to the wallet in blocks [lo, hi]. */
    const settlements = async (lo, hi) => {
        const scan = scanIn(lo, hi);
        // One-time payments through the splitter: the payer is whoever's USDC reached the wallet in that transaction.
        const paid = (await Promise.all([{ address: net.splitter, deployBlock: net.splitterDeployBlock }, ...(net.retired?.splitters ?? [])].map((c) => scan(c, [TOPICS.paid, null, walletTopic])))).flat();
        /* The payer: the sender of the USDC transfer of `net` to the wallet in that transaction - one Transfer
         * scan over the payments' blocks; a transaction without one (none seen yet) falls back to its receipt. */
        const payerIn = (logs, netUnits) => logs.find((r) => r.address.toLowerCase() === net.usdc.toLowerCase() && r.topics[0] === TOPICS.transfer && addressOf(r.topics[2] ?? '') === wallet && words(r.data)[0] === netUnits);
        const blocksOf = paid.map((l) => parseInt(l.blockNumber, 16));
        const incoming = paid.length ? await getLogs(rpc, net.usdc, [TOPICS.transfer, null, walletTopic], Math.min(...blocksOf), Math.max(...blocksOf)) : [];
        const byTx = new Map();
        for (const t of incoming)
            byTx.set(t.transactionHash.toLowerCase(), [...(byTx.get(t.transactionHash.toLowerCase()) ?? []), t]);
        const unmatched = paid.filter((l) => !payerIn(byTx.get(l.transactionHash.toLowerCase()) ?? [], words(l.data)[0] ?? 0n));
        const receipts = (await rpc(unmatched.map((l) => ['eth_getTransactionReceipt', [l.transactionHash]])));
        const receiptOf = new Map(unmatched.map((l, i) => [l, receipts[i]]));
        paid.forEach((l) => {
            const [netUnits = 0n, fee = 0n] = words(l.data);
            const receipt = receiptOf.get(l);
            const t = payerIn(receipt ? (receipt.logs ?? []) : (byTx.get(l.transactionHash.toLowerCase()) ?? []), netUnits);
            entries.push(row(l, 'payment', t ? addressOf(t.topics[1]) : (receipt?.from ?? ''), l.topics[1], netUnits + fee, fee, 0n, netUnits));
        });
        // Sponsored: the merchant funds the fee and the fixed network fee out of the amount; the buyer's quoted network fee is on top.
        const sponsored = (await Promise.all([{ address: net.sponsoredSplitter, deployBlock: net.sponsoredSplitterDeployBlock }, ...(net.retired?.sponsoredSplitters ?? [])].map((c) => scan(c, [TOPICS.sponsoredPaid, null, walletTopic])))).flat();
        for (const l of sponsored) {
            const [netUnits = 0n, fee = 0n, , fixed = 0n] = words(l.data);
            entries.push(row(l, 'payment', addressOf(l.topics[3]), l.topics[1], netUnits + fee + fixed, fee, fixed, netUnits));
        }
        // Subscription charges: net + fee + networkFee is the amount; the payer's gas reimbursement is on top.
        for (const l of await scan({ address: net.recurring, deployBlock: net.recurringDeployBlock }, [TOPICS.subscriptionCharged, null, null, walletTopic])) {
            const [, netUnits = 0n, fee = 0n, networkFee = 0n] = words(l.data);
            entries.push(row(l, 'subscription', addressOf(l.topics[2]), l.topics[1], netUnits + fee + networkFee, fee, networkFee, netUnits));
        }
    };
    await settlements(fromBlock, toBlock);
    // Probable refunds: USDC from the wallet in the window to a payer, later than one of their payments and no
    // larger. Only when the wallet sent anything are the look-back's payments read (they match, they are not rows).
    const sent = await getLogs(rpc, net.usdc, [TOPICS.transfer, walletTopic], fromBlock, toBlock);
    if (sent.length && lookbackDays > 0) {
        /* A node that no longer keeps the look-back's oldest blocks shortens it to what it has (its "earliest
         * available" block; without one, no look-back): a refund of a payment older than that is unmatched -
         * not a row - instead of failing the statement. */
        let lookFrom = await firstBlockAt(rpc, fromTs - lookbackDays * 86_400, latest, pace, floor);
        const kept = entries.length;
        while (lookFrom < fromBlock) {
            try {
                await settlements(lookFrom, fromBlock - 1);
                break;
            }
            catch (err) {
                if (!(err instanceof Error) || !PRUNED.test(err.message))
                    throw err;
                entries.length = kept;
                const earliest = Number(/earliest available:? *(\d+)/i.exec(err.message)?.[1] ?? NaN);
                lookFrom = earliest > lookFrom ? earliest : fromBlock;
            }
        }
    }
    /* Each payment can be refunded up to its gross, once: a transfer matches only a payment with that much
     * left (the one with exactly that much left first, else the most recent with room), and uses it up. */
    const room = new Map(entries.map((e) => [e, e.gross]));
    const settled = entries.slice();
    for (const l of sent.slice().sort((x, y) => at(x).block - at(y).block || at(x).index - at(y).index)) {
        const to = addressOf(l.topics[2]);
        const amount = words(l.data)[0] ?? 0n;
        const { block: b, index } = at(l);
        const candidates = settled
            .filter((e) => e.row.payer === to && (e.block < b || (e.block === b && e.index < index)) && room.get(e) >= amount)
            .sort((x, y) => y.block - x.block || y.index - x.index);
        const original = candidates.find((e) => room.get(e) === amount) ?? candidates[0];
        if (!original)
            continue;
        room.set(original, room.get(original) - amount);
        entries.push(row(l, 'refund?', to, original.row.reference, -amount, 0n, 0n, -amount));
    }
    // Dates, one batched read per distinct block (the look-back's payments are below the window: no rows).
    const inWindow = entries.filter((e) => e.block >= fromBlock);
    const blocks = [...new Set(inWindow.map((e) => e.block))];
    const times = (await rpc(blocks.map((n) => ['eth_getBlockByNumber', [hexNum(n), false]])));
    const tsByBlock = new Map(blocks.map((n, i) => [n, parseInt(times[i].timestamp, 16)]));
    const rows = inWindow
        .filter((e) => {
        const ts = tsByBlock.get(e.block);
        return ts >= fromTs && ts <= toTs;
    })
        .sort((x, y) => x.block - y.block || x.index - y.index)
        .map((e) => ({ date: new Date(tsByBlock.get(e.block) * 1000).toISOString(), ...e.row }));
    return currencies.length ? withValues(rows, currencies, options.apiUrl ?? 'https://api.p2flux.com', options.fetch ?? globalThis.fetch) : rows;
}
/** `units * num / den`, rounded half away from zero (same integers and rounding as the PHP SDK). */
const roundDiv = (n, d) => {
    const q = ((n < 0n ? -n : n) * 2n + d) / (2n * d);
    return n < 0n ? -q : q;
};
const cents = (c) => {
    const a = (c < 0n ? -c : c).toString().padStart(3, '0');
    return `${c < 0n ? '-' : ''}${a.slice(0, -2)}.${a.slice(-2)}`;
};
/** A rate as published (at most 5 decimals) in 1e-5 units. */
const rate5 = (r) => {
    if (typeof r !== 'number' || !(r > 0))
        throw new Error('P2Flux /v1/rates: not a rate');
    return BigInt(Math.round(r * 1e5));
};
/** The rows with value_usd/eur/gbp and rate_date, rates from the API in chunks of at most 366 days. */
const withValues = async (rows, currencies, apiUrl, fetchImpl) => {
    if (!rows.length)
        return rows;
    const days = {};
    const first = Date.parse(rows[0].date.slice(0, 10));
    const last = Date.parse(rows.at(-1).date.slice(0, 10));
    for (let a = first; a <= last; a += 366 * 86_400_000) {
        const range = { from: new Date(a).toISOString().slice(0, 10), to: new Date(Math.min(last, a + 365 * 86_400_000)).toISOString().slice(0, 10) };
        const res = await fetchImpl(`${apiUrl.replace(/\/$/, '')}/v1/rates`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(range) });
        const body = (await res.json().catch(() => ({})));
        if (!res.ok || !body.rates)
            throw new Error(`P2Flux /v1/rates: ${body.error ?? `HTTP ${res.status}`}`);
        Object.assign(days, body.rates);
    }
    return rows.map((r) => {
        const day = days[r.date.slice(0, 10)];
        if (!day)
            throw new Error(`no ECB rate for ${r.date.slice(0, 10)}`);
        const usd = rate5(day.USD);
        const units = BigInt(r.net.replace('.', ''));
        return {
            ...r,
            value_usd: cents(roundDiv(units, 10000n)),
            ...(currencies.includes('EUR') ? { value_eur: cents(roundDiv(units * 100000n, usd * 10000n)) } : {}),
            ...(currencies.includes('GBP') ? { value_gbp: cents(roundDiv(units * rate5(day.GBP), usd * 10000n)) } : {}),
            rate_date: day.rate_date,
        };
    });
};
/** A CSV cell: quoted when needed; a text cell that a spreadsheet would run as a formula gets a leading '. */
const cell = (value, text = true) => {
    const v = text && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};
const COLUMNS = ['date', 'tx_hash', 'kind', 'payer', 'reference', 'merchant_ref', 'gross', 'p2flux_fee', 'network_fee', 'net'];
const VALUE_COLUMNS = ['value_usd', 'value_eur', 'value_gbp', 'rate_date'];
const AMOUNTS = new Set(['gross', 'p2flux_fee', 'network_fee', 'net', 'value_usd', 'value_eur', 'value_gbp']);
/**
 * The rows as CSV (CRLF line ends).
 *
 * - `generic`: every column, as in the rows.
 * - `xero`: a bank-statement import - Date (dd/mm/yyyy), Amount (net), Payee, Description, Reference
 *   (merchant_ref, else the on-chain reference).
 * - `quickbooks`: the 3-column bank upload - Date (mm/dd/yyyy), Description, Amount (net).
 *
 * The amount booked is `net`, what reached the wallet: 6 decimals in generic; Xero and QuickBooks take
 * 2, so their Amount is `net` rounded to cents (half away from zero, as the currency columns) and the
 * description keeps the exact 6-decimal gross, fees and net. Rows
 * with `currencies` values: generic adds the value columns; xero and quickbooks keep their layout (amount
 * in USD) and name the EUR/GBP values and the ECB day in the description.
 */
export function toCsv(rows, format = 'generic') {
    const day = (r) => r.date.slice(8, 10);
    const month = (r) => r.date.slice(5, 7);
    const year = (r) => r.date.slice(0, 4);
    const fx = (r) => r.rate_date ? `${r.value_eur ? `, EUR ${r.value_eur}` : ''}${r.value_gbp ? `, GBP ${r.value_gbp}` : ''} (ECB ${r.rate_date})` : '';
    const describe = (r) => `${r.tx_hash}: gross ${r.gross}, P2Flux fee ${r.p2flux_fee}, network fee ${r.network_fee}, net ${r.net}${fx(r)}`;
    /** net to cents, half away from zero, as the currency columns. */
    const amount = (r) => cents(roundDiv(BigInt(r.net.replace('.', '')), 10000n));
    let lines;
    if (format === 'generic') {
        const columns = [...COLUMNS, ...VALUE_COLUMNS.filter((c) => rows[0]?.[c] !== undefined)];
        lines = [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c] ?? '', !AMOUNTS.has(c))).join(','))];
    }
    else if (format === 'xero') {
        lines = [
            'Date,Amount,Payee,Description,Reference',
            ...rows.map((r) => [`${day(r)}/${month(r)}/${year(r)}`, amount(r), cell(r.payer), cell(`P2Flux ${r.kind} ${describe(r)}`), cell(r.merchant_ref || r.reference)].join(',')),
        ];
    }
    else if (format === 'quickbooks') {
        lines = [
            'Date,Description,Amount',
            ...rows.map((r) => [`${month(r)}/${day(r)}/${year(r)}`, cell(`P2Flux ${r.kind} ${r.merchant_ref || r.reference} ${describe(r)}`), amount(r)].join(',')),
        ];
    }
    else {
        throw new TypeError(`unknown CSV format: ${format}`);
    }
    return lines.join('\r\n') + '\r\n';
}
