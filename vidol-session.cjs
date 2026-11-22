'use strict'
// DivaVidol 会话：把 lobe-vidol 作为独立服务拉起来（Next 前台进程），面板只拿一个地址。
//
// 依赖要先装一次（apps/diva-vidol 里 `npm install --legacy-peer-deps`）；
// 没装时明确报错，不偷偷跑安装。
const { spawn } = require('node:child_process')
const net = require('node:net')
const path = require('node:path')
const fs = require('node:fs')

const APP_DIR = path.join(__dirname, 'apps', 'diva-vidol')
const NEXT_BIN = path.join(APP_DIR, 'node_modules', 'next', 'dist', 'bin', 'next')
const READY_TIMEOUT_MS = 240000

let session = null
let pending = null

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.unref()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

async function reachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) })
    return response.ok
  } catch {
    return false
  }
}

async function boot() {
  if (!fs.existsSync(NEXT_BIN)) {
    throw new Error('DivaVidol 还没装依赖：在 apps/diva-vidol 里跑一次 npm install --legacy-peer-deps')
  }

  const port = await freePort()
  const url = `http://127.0.0.1:${port}/`
  // Electron 里 execPath 是 electron.exe：让子进程退化成 node 才能跑 next。
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1', PORT: String(port) }
  delete env.NODE_OPTIONS
  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1'

  const child = spawn(process.execPath, [NEXT_BIN, 'dev', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: APP_DIR,
    windowsHide: true,
    stdio: 'ignore',
    env,
  })

  let exitCode = null
  child.once('exit', (code) => { exitCode = code ?? -1 })
  child.once('error', (error) => { exitCode = error.message })

  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (exitCode !== null) throw new Error(`DivaVidol 进程退出了（${exitCode}）`)
    if (await reachable(url)) {
      return {
        url,
        port,
        pid: child.pid,
        stop() {
          try { child.kill() } catch { /* 已经退了 */ }
        },
      }
    }
    await delay(1000)
  }
  try { child.kill() } catch { /* ignore */ }
  throw new Error('DivaVidol 在 4 分钟内没有就绪（首次启动要编译页面）')
}

async function ensureVidol() {
  if (session) {
    if (await reachable(session.url)) return session
    session = null
  }
  if (!pending) {
    pending = boot()
      .then((result) => { session = result; return result })
      .finally(() => { pending = null })
  }
  return pending
}

function stopVidol() {
  if (session) {
    session.stop()
    session = null
  }
}

module.exports = { ensureVidol, stopVidol, APP_DIR }
