#!/usr/bin/env node
/**
 * Pre-flight port check, executed by start.js before any service is started.
 *
 * The UI backend always listens on a fixed port (3001) because the port is
 * hardcoded on the frontend (components/RightSidebar.tsx and
 * components/SongDropdownMenu.tsx build absolute URLs with it) and because the
 * vite preview proxy targets it. The port therefore cannot be made dynamic.
 *
 * When 3001 is already taken by a stale process, the backend dies with a bare
 * EADDRINUSE and the launcher goes on with a half-started stack. This script
 * turns that into an upfront failure with an actionable message.
 *
 * Usage: node check_port.js [port]   (default: 3001)
 * Exit:  0 = port is free, 1 = port is busy or cannot be verified.
 *
 * Note about the "error:" prefix in the failure message: Pinokio detects a
 * failed shell.run by matching the command output against /error:/i (and
 * /errno /i) - a non-zero exit code alone is not detected, because the
 * launcher talks to a persistent shell session. Keeping "error:" in the output
 * is what actually aborts the launcher before it starts any service.
 */

"use strict"

const net = require("net")

const DEFAULT_PORT = 3001

// The UI backend binds the wildcard address (server/src/index.ts:
// app.listen(config.port, '0.0.0.0')), so we probe the same address. A
// listener on any specific address (127.0.0.1, a LAN IP, ...) conflicts with
// the wildcard and is therefore detected here as well.
const HOST = "0.0.0.0"

function parsePort (raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return DEFAULT_PORT
  }
  const value = Number(String(raw).trim())
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    return null
  }
  return value
}

function probe (port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once("error", (err) => {
      server.close()
      resolve({ ok: false, code: err.code, message: err.message })
    })
    server.listen({ host: HOST, port, exclusive: true }, () => {
      server.close(() => resolve({ ok: true }))
    })
  })
}

async function main () {
  const port = parsePort(process.argv[2])
  if (port === null) {
    console.error("")
    console.error(`[check_port] error: invalid port "${process.argv[2]}". Expected an integer between 1 and 65535.`)
    console.error("")
    process.exitCode = 1
    return
  }

  const result = await probe(port)

  if (result.ok) {
    console.log(`[check_port] Port ${port} is free.`)
    process.exitCode = 0
    return
  }

  if (result.code === "EADDRINUSE") {
    console.error("")
    console.error(`[check_port] error: port ${port} is already in use.`)
    console.error(`[check_port] The ACE-Step UI backend has to run on port ${port}, and the port is hardcoded in the frontend, so the launcher cannot pick a different one.`)
    console.error(`[check_port] Release the port and start the launcher again:`)
    console.error(`[check_port]   - if it is a leftover ACE-Step UI server, stop it from the Pinokio menu (the running instance must be stopped first)`)
    console.error(`[check_port]   - otherwise find the owner with "lsof -i :${port}" (macOS/Linux) or "netstat -ano | findstr :${port}" (Windows) and terminate it`)
    console.error("")
    process.exitCode = 1
    return
  }

  console.error("")
  console.error(`[check_port] error: could not verify port ${port} (${result.code || result.message}).`)
  console.error("")
  process.exitCode = 1
}

main()
