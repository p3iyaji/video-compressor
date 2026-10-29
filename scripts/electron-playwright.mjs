#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electron = require('electron')
const early = []
const rest = []
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--inspect') || arg.startsWith('--remote-debugging-port')) early.push(arg)
  else rest.push(arg)
}

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, [...rest, ...early], { stdio: 'inherit', env })
child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
