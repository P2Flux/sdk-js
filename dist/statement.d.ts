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
export type StatementNetwork = 'base' | 'base-sepolia';
export type StatementRow = {
    /** Block time, ISO 8601 UTC. */
    date: string;
    tx_hash: string;
    kind: 'payment' | 'subscription' | 'refund?';
    payer: string;
    /** The payment's on-chain reference; a subscription's id; for a refund, the payment it matched. */
    reference: string;
    merchant_ref: string;
    /** What the buyer was charged for (a sponsored payment's buyer-paid network fee is not in it). */
    gross: string;
    p2flux_fee: string;
    /** Network fees the merchant funded out of `gross` (fixed fee of a sponsored payment, a charge's network fee). */
    network_fee: string;
    /** What reached the wallet. */
    net: string;
    /** With `currencies`: `net` in USD (USDC 1:1), EUR and GBP, 2 decimals, and the ECB publication day used. */
    value_usd?: string;
    value_eur?: string;
    value_gbp?: string;
    rate_date?: string;
};
export type StatementCurrency = 'EUR' | 'GBP';
type Contract = {
    address: string;
    deployBlock: number;
};
/** A network's settlement contracts and their deploy blocks (the floor of every log search), for `statementOn`. */
export type StatementContracts = {
    usdc: string;
    splitter: string;
    splitterDeployBlock: number;
    sponsoredSplitter: string;
    sponsoredSplitterDeployBlock: number;
    recurring: string;
    recurringDeployBlock: number;
    retired?: {
        splitters: readonly Contract[];
        sponsoredSplitters: readonly Contract[];
    };
};
/**
 * Addresses and deploy blocks (the floor of every log search), as pinned in the P2Flux checkout and
 * the API's registry. `retired` lists settlement contracts replaced by a rotation (none yet).
 */
export declare const NETWORKS: {
    readonly base: {
        readonly chainId: 8453;
        readonly rpcUrls: readonly ["https://mainnet.base.org", "https://base-rpc.publicnode.com"];
        readonly usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
        readonly splitter: "0x5A3bD0945cd0C80B124870881dE49a717D20E0D0";
        readonly splitterDeployBlock: 50362015;
        readonly sponsoredSplitter: "0x95E18ec05D4282acB3aab7aD60325bA4EEeEa8df";
        readonly sponsoredSplitterDeployBlock: 50966621;
        readonly recurring: "0xb415A9910Ef627e3bEF10F5Cb9DC92a3271e0975";
        readonly recurringDeployBlock: 50362127;
        readonly retired: {
            readonly splitters: Contract[];
            readonly sponsoredSplitters: Contract[];
        };
    };
    readonly 'base-sepolia': {
        readonly chainId: 84532;
        readonly rpcUrls: readonly ["https://sepolia.base.org", "https://base-sepolia-rpc.publicnode.com"];
        readonly usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
        readonly splitter: "0x3120aa022437db5c6d0439ac7f7852ce8b38e70f";
        readonly splitterDeployBlock: 45512197;
        readonly sponsoredSplitter: "0x876f7b98e8c06291ec916a3223a92038b0a8774f";
        readonly sponsoredSplitterDeployBlock: 46433064;
        readonly recurring: "0x394c3fe285168f333ebf29e8f3585039328f2a73";
        readonly recurringDeployBlock: 45635698;
        readonly retired: {
            readonly splitters: Contract[];
            readonly sponsoredSplitters: Contract[];
        };
    };
};
/** keccak256 of each event signature (checked against the signatures in test/statement.test.ts). */
export declare const TOPICS: {
    /** Paid(bytes32 indexed ref, address indexed recipient, address indexed token, uint256 net, uint256 fee) */
    readonly paid: "0xa35447e6a2d0a89ecfb9d70336046be4a4ab0c579634503abd6ae7b4891dfc3c";
    /** SponsoredPaid(bytes32 indexed ref, address indexed recipient, address indexed payer, net, fee, networkFee, fixedNetworkFee) */
    readonly sponsoredPaid: "0x416cb67c4e5d87dd0e97ed23f9840596617678f78a7476b9c32f6d5521124ff6";
    /** SubscriptionCharged(bytes32 indexed id, address indexed payer, address indexed recipient, periodIndex, net, fee, networkFee, gasReimbursement) */
    readonly subscriptionCharged: "0x5b2b67b5b5878335a49150eeee6843fb39976a9d48ab7015c6dc3d0136795ff3";
    /** Transfer(address indexed from, address indexed to, uint256 value) */
    readonly transfer: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
};
export type StatementOptions = {
    /** The receiving wallet (the `recipient` of your payments). */
    wallet: string;
    /** Inclusive; a Date or unix seconds. */
    from: Date | number;
    to: Date | number;
    /** Default 'base'. */
    network?: StatementNetwork;
    /** JSON-RPC endpoints, tried in order. Default: the network's public, keyless ones. */
    rpcUrls?: string[];
    /** Your intents (from createPayment), to fill `merchant_ref`. Decoded locally, never sent. */
    intents?: string[];
    /**
     * How far before `from` to look for the payment a refund in the window returns (default 90; 0 = only
     * payments in the window). Read only when the wallet sent USDC in the window; those payments are not rows.
     */
    lookbackDays?: number;
    /** Add value_usd, value_eur and/or value_gbp and rate_date to each row (see the module comment). Default none. */
    currencies?: StatementCurrency[];
    /** Where the exchange rates come from (`currencies` only). Default 'https://api.p2flux.com'. */
    apiUrl?: string;
    /** Injectable for tests; defaults to global fetch. */
    fetch?: typeof fetch;
};
/** The statement rows for `wallet` between `from` and `to`, oldest first. */
export declare function statement(options: StatementOptions): Promise<StatementRow[]>;
/**
 * `statement()` over contracts and RPC endpoints you name, without the built-in network table - for
 * a bundle that must carry one network only (the P2Flux checkout passes its pinned network).
 */
export declare function statementOn(net: StatementContracts, options: Omit<StatementOptions, 'network' | 'rpcUrls'> & {
    rpcUrls: string[];
}): Promise<StatementRow[]>;
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
export declare function toCsv(rows: StatementRow[], format?: 'generic' | 'xero' | 'quickbooks'): string;
export {};
