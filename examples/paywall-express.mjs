/**
 * Charge AI agents for an Express route, in USDC, over x402.
 *
 * A request without payment gets 402 with the price; the agent pays and repeats it; the payment is
 * settled on Base before the handler runs. Plain JavaScript, so it needs Express and nothing else:
 *
 *   npm install express @p2flux/sdk
 *   P2FLUX_RECIPIENT=0x... node examples/paywall-express.mjs
 *
 * The default is Base Sepolia (test USDC). Production: P2FLUX_API_URL=https://api.p2flux.com, with a
 * mainnet wallet you control as P2FLUX_RECIPIENT. Test the 402 -> pay -> 200 cycle here first.
 */
import express from 'express'
import { createPaywall } from '@p2flux/sdk/paywall'

const env = (name, fallback) => {
  const value = process.env[name] ?? fallback
  if (!value) {
    console.error(`Missing required environment variable ${name}`)
    process.exit(1)
  }
  return value
}

const paywall = createPaywall({
  apiUrl: env('P2FLUX_API_URL', 'https://api-test.p2flux.com'),
  recipient: env('P2FLUX_RECIPIENT'), // your wallet on Base; every payment goes to it
  price: '0.01', // USDC per request, at least 0.01
  // A decision, not a default to forget: 'refuse' answers 503 while P2Flux is unreachable,
  // 'free' serves the route unpaid.
  onUnavailable: 'refuse',
})

const app = express()

// Every request pays.
app.get('/weather', paywall.express(), (req, res) => {
  res.json({ sunny: true })
})

// A dearer route: the same paywall, another price.
app.get('/forecast', paywall.express({ price: '0.05' }), (req, res) => {
  res.json({ days: [{ sunny: true }, { sunny: false }] })
})

// People read free; AI agents and programs pay.
const agentsOnly = createPaywall({
  apiUrl: env('P2FLUX_API_URL', 'https://api-test.p2flux.com'),
  recipient: env('P2FLUX_RECIPIENT'),
  price: '0.01',
  agentsOnly: true,
})
app.get('/article', agentsOnly.express({ mimeType: 'text/html' }), (req, res) => {
  res.type('html').send('<h1>The article</h1>')
})

const port = Number(env('PORT', '8100'))
app.listen(port, () => console.log(`listening on http://localhost:${port}`))
