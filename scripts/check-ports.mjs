#!/usr/bin/env node
/**
 * Pre-start port preflight for `pnpm start:all`.
 *
 * `concurrently` launches the gateway and the dev server together; if either
 * port is already bound, the failing process gets swallowed in the combined
 * output and the user is left with a half-working stack. Fail fast instead.
 *
 * Node builtins only. Ports owned by `start:all` fail fast when occupied.
 * Companion services are reported but reused when already running.
 */
import net from 'node:net'

const OWNED_PORTS = [
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

const COMPANION_PORTS = [
  {
    label: 'Hermes dashboard',
    port:
      Number(
        process.env.HERMES_DASHBOARD_PORT ?? process.env.CLAUDE_DASHBOARD_PORT,
      ) || 9119,
    envVar: 'HERMES_DASHBOARD_PORT',
  },
  {
    label: 'Hermes A2A fleet',
    port: Number(process.env.HERMES_A2A_PORT ?? process.env.A2A_PORT) || 9219,
    envVar: 'HERMES_A2A_PORT',
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

/** Resolve true when a loopback service accepts TCP connections on the port. */
function isPortListening(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    socket.setTimeout(500)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
  })
}

let inUse = false
for (const { label, port, envVar } of OWNED_PORTS) {
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

console.log('\x1b[32m✓ Gateway and Switch UI ports are free.\x1b[0m')

for (const { label, port, envVar } of COMPANION_PORTS) {
  const listening = await isPortListening(port)
  if (!listening) {
    console.warn(
      `\x1b[33m! Port ${port} (${label}) is not listening.\x1b[0m\n` +
        `  Switch UI can start, but related features remain unavailable until the service starts. ` +
        `Override discovery with ${envVar}=<port>.`,
    )
    continue
  }

  console.log(
    `\x1b[32m✓ Port ${port} (${label}) is already serving; Switch UI will reuse it.\x1b[0m`,
  )
}

console.log('\x1b[32m✓ Port preflight complete — starting.\x1b[0m')
