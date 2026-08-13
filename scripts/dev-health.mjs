#!/usr/bin/env node
/**
 * Protocol-agnostic health probe for a running Switch UI server.
 *
 * Why this exists: the dev server's scheme is not fixed. `vite.config.ts`
 * applies `vite-plugin-mkcert` only when `command === 'serve' && mode !==
 * 'production'`, so:
 *
 *   pnpm dev / pnpm start:dev  → HTTPS   (mkcert, self-signed local CA)
 *   pnpm start                 → HTTP    (node .output/server/index.mjs)
 *   pnpm preview               → HTTP    (vite preview runs in production mode)
 *
 * A probe hardcoded to one scheme misreports the other as dead, and the
 * failure mode is genuinely misleading rather than obviously wrong: an
 * `http://` request to the HTTPS dev server completes *instantly* with an
 * empty reply (curl exit 52), which looks exactly like a wedged process. That
 * misdiagnosis is what this script exists to prevent — it distinguishes
 *
 *   • nothing listening            (ECONNREFUSED)
 *   • listening, wrong scheme      (TLS/parse error → retry the other one)
 *   • listening and serving        (HTTP status)
 *
 * Vite also auto-increments the port when the configured one is taken, so a
 * second `pnpm dev` silently lands on 3001. With no arguments this scans a
 * small range and reports every server it finds, which makes stray instances
 * visible instead of leaving you to wonder which one you are looking at.
 *
 * Node builtins only, no dependencies. Exits 0 when at least one server
 * answered, 1 otherwise (so it is usable as a CI/preflight gate).
 *
 *   node scripts/dev-health.mjs            # scan 3000-3005
 *   node scripts/dev-health.mjs 3001       # probe one port
 *   node scripts/dev-health.mjs 3000 9119  # probe several
 */
import net from 'node:net'
import http from 'node:http'
import https from 'node:https'

const DEFAULT_SCAN = [3000, 3001, 3002, 3003, 3004, 3005]
const TCP_TIMEOUT_MS = 1000
// Generous: a cold Vite server compiles the SSR graph on the first request,
// which can take tens of seconds on this app. Timing out early here is how a
// healthy-but-warming server gets called dead.
const HTTP_TIMEOUT_MS = 90_000
/** Gap before the one retry — long enough for a server restart to bind again. */
const RETRY_DELAY_MS = 1500

/**
 * Path to request per known service. The Switch UI serves a page at `/`, but
 * the backends do not: the Hermes gateway's route table begins at `/health`
 * and `/v1/*` with nothing registered at the root, so probing `/` there
 * returns a perfectly healthy 404. Reporting that as the result is technically
 * true and practically alarming, so ask each service where it actually lives.
 */
const HEALTH_PATHS = {
  8642: '/health', // Hermes gateway (aiohttp) — no route at /
  9119: '/', // Hermes dashboard (FastAPI) — serves the SPA at /
}

const pathFor = (port) => HEALTH_PATHS[port] ?? '/'

/** Resolve true when something accepts a TCP connection on the port. */
function isListening(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host })
    const done = (result) => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(TCP_TIMEOUT_MS)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/**
 * One request on one scheme. Never throws — returns a discriminated result so
 * the caller can tell "wrong scheme" apart from "actually broken".
 *
 * `rejectUnauthorized: false` is required and safe here: mkcert issues a
 * locally-trusted cert, but the CA is only installed in the user's browser
 * trust store, not Node's. Refusing it would report every HTTPS dev server as
 * unhealthy.
 */
function request(scheme, port, host) {
  const client = scheme === 'https' ? https : http
  const url = `${scheme}://${host}:${port}${pathFor(port)}`
  return new Promise((resolve) => {
    const started = Date.now()
    const req = client.get(
      url,
      { rejectUnauthorized: false, timeout: HTTP_TIMEOUT_MS },
      (res) => {
        // Drain: leaving the socket open keeps the event loop alive.
        res.resume()
        resolve({ ok: true, status: res.statusCode, ms: Date.now() - started })
      },
    )
    req.once('timeout', () => {
      req.destroy()
      resolve({ ok: false, kind: 'timeout' })
    })
    req.once('error', (error) => {
      resolve({ ok: false, kind: classify(error), detail: error.message })
    })
  })
}

/**
 * Map a socket error to a cause. The two we must not conflate:
 *   `wrong-scheme` — the port is alive, we just spoke the wrong language.
 *   `closed`       — nothing is there.
 */
function classify(error) {
  const code = error.code ?? ''
  if (code === 'ECONNREFUSED') return 'closed'
  if (
    code === 'EPROTO' ||
    code === 'ECONNRESET' ||
    code === 'ERR_SSL_WRONG_VERSION_NUMBER' ||
    code === 'ERR_SSL_PACKET_LENGTH_TOO_LONG' ||
    code.startsWith('ERR_SSL') ||
    /parse error|wrong version number|socket hang up/i.test(error.message)
  ) {
    return 'wrong-scheme'
  }
  return 'error'
}

/** One pass over both schemes, HTTPS first (the `pnpm dev` default here). */
async function attempt(port, host) {
  for (const scheme of ['https', 'http']) {
    const result = await request(scheme, port, host)
    if (result.ok) {
      return {
        port,
        state: 'serving',
        scheme,
        status: result.status,
        ms: result.ms,
      }
    }
    if (result.kind === 'timeout') {
      return { port, state: 'timeout', scheme }
    }
    // 'wrong-scheme' / 'error' → fall through and try the other scheme.
  }
  return { port, state: 'unresponsive' }
}

/**
 * Probe a port, retrying once before calling it unresponsive.
 *
 * The retry is not defensive padding — a restarting dev server holds the
 * listening socket while refusing to serve, and this repo restarts on its own:
 * the `restart-on-package-json` plugin in `vite.config.ts` bounces the server
 * whenever package.json changes. Without the retry a routine restart is
 * reported as "wedged", which is precisely the false alarm this script exists
 * to stop. Observed live while adding the `dev:health` script itself.
 */
async function probe(port, host = '127.0.0.1') {
  if (!(await isListening(port, host))) {
    return { port, state: 'closed' }
  }

  const first = await attempt(port, host)
  if (first.state !== 'unresponsive') return first

  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
  if (!(await isListening(port, host))) return { port, state: 'closed' }
  return attempt(port, host)
}

function render(result) {
  const port = String(result.port).padEnd(5)
  switch (result.state) {
    case 'serving':
      return `  ${port} ${result.scheme}://127.0.0.1:${result.port}${pathFor(result.port)} → HTTP ${result.status} (${result.ms}ms)`
    case 'closed':
      return `  ${port} nothing listening`
    case 'timeout':
      return `  ${port} listening (${result.scheme}) but no response in ${HTTP_TIMEOUT_MS / 1000}s — still compiling, or stuck`
    default:
      return `  ${port} listening but answered neither HTTPS nor HTTP — likely wedged`
  }
}

const args = process.argv.slice(2).filter((a) => /^\d+$/.test(a))
const ports = args.length > 0 ? args.map(Number) : DEFAULT_SCAN

const results = await Promise.all(ports.map((port) => probe(port)))
const found = results.filter((r) => r.state !== 'closed')

console.log(
  args.length > 0
    ? 'Switch UI health probe'
    : `Switch UI health probe (scanning ${DEFAULT_SCAN[0]}-${DEFAULT_SCAN.at(-1)})`,
)
for (const result of results) {
  // When scanning, stay quiet about ports that were never expected to be up.
  if (args.length === 0 && result.state === 'closed') continue
  console.log(render(result))
}

if (found.length === 0) {
  console.log('  no server found — start one with `pnpm dev`')
  process.exit(1)
}

const serving = found.filter((r) => r.state === 'serving')
// Only meaningful while scanning the dev-server range: several *explicitly
// requested* ports being up is normal (gateway + dashboard + UI), whereas two
// servers inside 3000-3005 almost always means a stray `pnpm dev`.
if (args.length === 0 && serving.length > 1) {
  console.log(
    `\n  ${serving.length} dev servers are running (${serving.map((r) => r.port).join(', ')}).` +
      ' Vite auto-increments when a port is taken, so extras are usually strays.',
  )
}

process.exit(serving.length > 0 ? 0 : 1)
