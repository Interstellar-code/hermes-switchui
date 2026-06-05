#!/usr/bin/env node
/**
 * Pre-start port preflight for `pnpm start:all`.
 *
 * `concurrently` launches the gateway and the dev server together; if either
 * port is already bound, the failing process gets swallowed in the combined
 * output and the user is left with a half-working stack. Fail fast instead.
 *
 * Node builtins only. Respects process.env.PORT (UI) and
 * process.env.GATEWAY_PORT (gateway).
 */
import net from 'node:net'

const CHECKS = [
  {
    label: 'Hermes gateway',
    port: Number(process.env.GATEWAY_PORT) || 8642,
    envVar: 'GATEWAY_PORT',
  },
  {
    label: 'Switch UI dev server',
    port: Number(process.env.PORT) || 3000,
    envVar: 'PORT',
  },
]

/** Resolve true if the port is free, false if something is already listening. */
function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', (err) => {
      server.close()
      resolve(err.code !== 'EADDRINUSE' ? true : false)
    })
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '0.0.0.0')
  })
}

let inUse = false
for (const { label, port, envVar } of CHECKS) {
  const free = await isPortFree(port)
  if (!free) {
    inUse = true
    console.error(
      `\x1b[31m✗ Port ${port} (${label}) is already in use.\x1b[0m\n` +
        `  Stop whatever is on :${port}, or override with ${envVar}=<port> before 'pnpm start:all'.`,
    )
  }
}

if (inUse) {
  process.exit(1)
}

console.log('\x1b[32m✓ Ports free — starting.\x1b[0m')
