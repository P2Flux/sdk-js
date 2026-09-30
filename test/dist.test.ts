/**
 * The published artefact is the committed one, and importing it does nothing.
 *
 * dist/ is committed because P2Flux/core pins this repository by git commit and reads dist/index.js
 * directly. That makes a stale dist a silent way to publish source nobody reviewed, so the build is
 * checked rather than trusted. The side-effect test is what earns `"sideEffects": false` in
 * package.json: a bundler is allowed to drop this module entirely if nothing imports a binding, and
 * that is only safe while import time does nothing at all.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname

test('dist matches a fresh build of src', () => {
  const out = mkdtempSync(join(tmpdir(), 'p2flux-build-'))
  try {
    execFileSync('npx', ['tsc', '-p', 'tsconfig.build.json', '--outDir', out], { cwd: root, stdio: 'pipe' })

    for (const file of ['index.js', 'index.d.ts', 'paywall.js', 'paywall.d.ts']) {
      assert.equal(
        readFileSync(join(out, file), 'utf8'),
        readFileSync(join(root, 'dist', file), 'utf8'),
        `dist/${file} is stale - run npm run build and commit it`,
      )
    }
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

test('importing the package has no side effects', () => {
  /* Run in a child process: snapshot the globals, import dist, compare. A module that patched a
   * global, opened a handle or read a file would show up here - and would make `sideEffects: false`
   * a lie that only breaks under a bundler, far from this repository. */
  const probe = `
    const before = Object.keys(globalThis).sort().join(',')
    await import(${JSON.stringify(join(root, 'dist', 'index.js'))})
    const after = Object.keys(globalThis).sort().join(',')
    if (before !== after) { console.error('globals changed'); process.exit(1) }
    console.log('clean')
  `
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8' })
  assert.equal(output.trim(), 'clean')
})

test('dist has no top-level statement that could run at import', () => {
  const dist = readFileSync(join(root, 'dist', 'index.js'), 'utf8')
  const topLevel = dist.split('\n').filter((line) => line.length > 0 && !/^[\s})\]]/.test(line))
  const offenders = topLevel.filter((line) => !/^(const |export |class |function |\/\*|\*|\/\/)/.test(line))

  assert.deepEqual(offenders, [], 'a top-level statement other than a declaration runs at import time')
})
