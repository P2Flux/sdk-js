/**
 * The documentation is checked against the code it documents.
 *
 * Every method named in prose exists, every option is real, every snippet parses, every relative
 * link resolves, and nothing claims a feature this product does not have. Prose that is never
 * checked is prose that drifts - and in a payments SDK the drift lands in someone's integration.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'
import * as sdk from '../src/index.js'
import { createP2Flux, type P2FluxOptions } from '../src/index.js'

const root = new URL('..', import.meta.url).pathname
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string; name: string }

/** Every markdown page a developer can read in this repository. */
const pages = (): string[] => {
  const found = [join(root, 'README.md')]
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.md')) found.push(path)
    }
  }
  walk(join(root, 'docs'))
  walk(join(root, 'examples'))
  return found
}

const client = createP2Flux({ apiUrl: 'https://api.example' })
const methods = new Set(Object.keys(client))
const exported = new Set(Object.keys(sdk))
const options: Record<keyof P2FluxOptions, true> = { apiUrl: true, timeoutMs: true, fetch: true }
const optionNames = new Set(Object.keys(options))

const documents = pages().map((path) => ({
  name: relative(root, path),
  path,
  text: readFileSync(path, 'utf8'),
}))

test('the documentation set is complete', () => {
  const names = documents.map((d) => d.name)
  for (const required of [
    'README.md',
    'docs/getting-started.md',
    'docs/payment-flow.md',
    'docs/payments.md',
    'docs/network-fee-in-usdc.md',
    'docs/subscriptions.md',
    'docs/refunds.md',
    'docs/recovery.md',
    'docs/errors.md',
    'docs/testing.md',
    'docs/production-checklist.md',
    'docs/server-and-browser.md',
  ]) {
    assert.ok(names.includes(required), `${required} is missing`)
  }
})

for (const { name, text, path } of documents) {
  test(`${name}: every documented method exists`, () => {
    for (const [, method] of text.matchAll(/p2flux\.([a-zA-Z]+)\(/g)) {
      assert.ok(methods.has(method!), `${name} documents p2flux.${method}(), which does not exist`)
    }
  })

  test(`${name}: every documented import is exported`, () => {
    for (const [, names] of text.matchAll(/import \{([^}]+)\} from '@p2flux\/sdk'/g)) {
      for (const binding of names!.split(',')) {
        const clean = binding.replace(/\btype\b/, '').trim()
        if (clean) assert.ok(exported.has(clean), `${name} imports ${clean}, which the package does not export`)
      }
    }
  })

  test(`${name}: every client option is real`, () => {
    /* Only the keys of the options literal itself. A nested object - a fake fetch's response, say -
     * has its own keys, and those are not client options. */
    for (const start of [...text.matchAll(/createP2Flux\(\{/g)].map((m) => m.index! + m[0].length)) {
      let depth = 1
      let end = start
      while (end < text.length && depth > 0) {
        if (text[end] === '{') depth++
        else if (text[end] === '}') depth--
        if (depth > 0) end++
      }

      /* Blank out string literals first: a URL value carries a colon of its own. */
      const literal = text.slice(start, end).replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''")
      let level = 0
      for (let i = 0; i < literal.length; i++) {
        const char = literal[i]!
        if ('{(['.includes(char)) level++
        else if ('})]'.includes(char)) level--
        else if (char === ':' && level === 0) {
          const key = /(\w+)\s*$/.exec(literal.slice(0, i))?.[1]
          if (key) assert.ok(optionNames.has(key), `${name} passes createP2Flux({ ${key} }), which is not an option`)
        }
      }
    }
  })

  test(`${name}: every TypeScript snippet parses`, () => {
    const fences = [...text.matchAll(/```(ts|js|javascript|typescript)\n([\s\S]*?)```/g)]
    for (const [index, fence] of fences.entries()) {
      const source = fence[2]!
      /* Snippets are fragments of different shapes - statements, an object slice, a function body.
       * Try each context and accept the first that parses; one that parses in none is broken. */
      const candidates = [source, `async function snippet() {\n${source}\n}`, `const snippet = {\n${source}\n}`]
      const parsed = candidates.some((candidate) => {
        const file = ts.createSourceFile('snippet.ts', candidate, ts.ScriptTarget.ES2022, true)
        return (file as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length === 0
      })
      assert.ok(parsed, `${name}: snippet ${index + 1} does not parse:\n${source.slice(0, 200)}`)
    }
  })

  test(`${name}: every relative link resolves`, () => {
    for (const [, link] of text.matchAll(/\]\((?!https?:|#|mailto:)([^)#]+)(?:#[^)]*)?\)/g)) {
      const target = resolve(dirname(path), link!)
      assert.ok(existsSync(target), `${name} links to ${link}, which does not exist`)
    }
  })

  test(`${name}: no stale package name or version`, () => {
    /* Install routes that are no longer current. Both packages are on their own registry, and a page
     * that still points at a git tag sends a developer down a route nobody maintains. */
    for (const stale of [
      'github:P2Flux/sdk-js#',
      'npm install github:P2Flux/sdk-js',
      'not on npm',
      'not on packagist',
      'p2flux/p2flux-php',
      'composer require p2flux/p2flux-php',
    ]) {
      assert.ok(!text.toLowerCase().includes(stale.toLowerCase()), `${name} contains "${stale}"`)
    }

    for (const [, version] of text.matchAll(/v?(0\.7\.\d+)\b/g)) {
      assert.equal(version, pkg.version, `${name} mentions ${version}; this repository is ${pkg.version}`)
    }
  })

  test(`${name}: claims no feature this product lacks`, () => {
    /* Targeted phrases, not sentence parsing: each is something a reader would act on, and none can
     * be true of P2Flux. There are no webhooks, there is no API key, and the sponsored path is a
     * fee paid in USDC rather than a fee waived. */
    for (const phrase of [
      'webhook secret', 'webhook signature', 'verify the webhook', 'register a webhook',
      'webhook url', 'webhook endpoint', 'configure a webhook', 'webhook handler',
      'your api key', 'apikey', "'api_key'", 'authorization: bearer', 'x-api-key',
      'gas-free', 'gas free', 'free transaction', 'no network fee',
    ]) {
      assert.ok(!text.toLowerCase().includes(phrase), `${name} contains "${phrase}"`)
    }
  })
}

test('the two facts a developer must not guess are stated', () => {
  const says = (file: string, phrase: string) =>
    readFileSync(join(root, file), 'utf8').toLowerCase().includes(phrase)

  assert.ok(says('README.md', 'no webhooks'))
  assert.ok(says('docs/payment-flow.md', 'no webhooks'))
  assert.ok(says('docs/getting-started.md', 'no api key'))
})

test('the install command matches the package name', () => {
  assert.match(readFileSync(join(root, 'README.md'), 'utf8'), new RegExp(`npm install ${pkg.name}`))
})

test('the documented error codes are the ones the client knows', () => {
  const source = readFileSync(join(root, 'src/index.ts'), 'utf8')
  const block = source.slice(source.indexOf('const ACTIONS'), source.indexOf('\n}', source.indexOf('const ACTIONS')))
  const known = [...block.matchAll(/^\s*([A-Z_]+):\s*'([A-Z_]+)'/gm)].map(([, code]) => code!)
  const documented = readFileSync(join(root, 'docs/errors.md'), 'utf8')

  for (const code of known) {
    assert.ok(documented.includes(`\`${code}\``), `docs/errors.md never mentions ${code}`)
  }
  /* And nothing invented: every SHOUTING_CODE in the codes table must be one the client knows. */
  const table = documented.slice(documented.indexOf('## Codes by action'))
  for (const [, code] of table.matchAll(/`([A-Z][A-Z_]{4,})`/g)) {
    /* The table also names the actions themselves and the map they come from. Those are prose. */
    const notACode = ['SUCCESS', 'WAIT', 'RETRY_LATER', 'CUSTOMER_ACTION_REQUIRED', 'STOP_SUBSCRIPTION', 'INVALID_REQUEST', 'ACTIONS']
    if (notACode.includes(code!)) continue
    assert.ok(known.includes(code!), `docs/errors.md documents ${code}, which the client does not know`)
  }
})
