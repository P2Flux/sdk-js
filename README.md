# @p2flux/sdk (JavaScript / TypeScript)

Zero-dependency client over the P2Flux HTTP API. See [`../README.md`](../README.md) for the result
table and the integration model — this file is only the mechanics.

```ts
import { createP2Flux } from './index.js'

const p2flux = createP2Flux({ apiUrl: 'https://api.p2flux.example', timeoutMs: 30_000 })

const result = await p2flux.charge(ref)   // never throws; inspect result.status / result.action
const state  = await p2flux.status(ref)   // throws P2FluxError on a bad reference
const cancel = await p2flux.prepareSubscriptionCancellation(ref)
const stop   = await p2flux.prepareAllowanceRevocation()
```

`fetch` is injectable (`createP2Flux({ apiUrl, fetch })`) for tests and for hosts with their own
HTTP stack. There is no build step: it is one TypeScript file with no runtime dependencies.
