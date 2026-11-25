const fs = require('fs')
const os = require('os')
const net = require('net')
const path = require('path')
const vscode = require('vscode')
const server = require('./server')

const ROOT = fs.realpathSync(__dirname)
const HOOK_JS = path.join(ROOT, 'hook.js')
const PORT = server.PORT
const HOME = process.env.CURSOR_STATUS_HOME || path.join(os.homedir(), '.cursor-status')
const LAUNCHER = path.join(HOME, process.platform === 'win32' ? 'hook-run.cmd' : 'hook-run')
let owned = false
let timer = null

function lanIp() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal) return n.address
  }
  return '127.0.0.1'
}

function portUp() {
  return new Promise((resolve) => {
    const s = net.connect({ port: PORT, host: '127.0.0.1' })
    const done = (ok) => { s.destroy(); resolve(ok) }
    s.on('connect', () => done(true))
    s.on('error', () => done(false))
  })
}

function quote(p) {
  if (process.platform === 'win32') return '"' + p.replace(/"/g, '""') + '"'
  return /[\s'"]/.test(p) ? "'" + p.replace(/'/g, "'\\''") + "'" : p
}

// 启动器放在用户目录，扩展升级后路径不变，hooks.json 不用跟着改
function writeLauncher() {
  fs.mkdirSync(HOME, { recursive: true })
  if (process.platform === 'win32') {
    fs.writeFileSync(LAUNCHER, `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n${quote(process.execPath)} ${quote(HOOK_JS)} %*\r\n`)
    return
  }
  fs.writeFileSync(LAUNCHER, `#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec ${quote(process.execPath)} ${quote(HOOK_JS)} "$@"\n`, { mode: 0o755 })
  try { fs.chmodSync(LAUNCHER, 0o755) } catch {}
}

function isOurs(cmd) {
  const n = String(cmd || '').replace(/\\/g, '/')
  if (n.includes('/.cursor-status/hook-run')) return true
  if (n.includes('/cursor-status/hook.sh') || n.includes('/cursor-status/hook.js')) return true
  return /cursor-status[^/]*\/hook\.(js|sh)(\s|"|'|$)/.test(n)
}

function ensureHooks() {
  writeLauncher()
  const file = path.join(os.homedir(), '.cursor', 'hooks.json')
  let cfg
  if (!fs.existsSync(file)) cfg = { version: 1, hooks: {} }
  else {
    try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return }
  }
  cfg.hooks = cfg.hooks || {}
  const base = quote(LAUNCHER)
  const want = { beforeSubmitPrompt: base + ' prompt', preToolUse: base, stop: base }
  let changed = false
  for (const [step, cmd] of Object.entries(want)) {
    const list = (cfg.hooks[step] ||= [])
    const next = list.filter((h) => !(h && isOurs(h.command)))
    if (next.length !== list.length) changed = true
    if (!next.some((h) => h && h.command === cmd)) { next.push({ command: cmd }); changed = true }
    cfg.hooks[step] = next
  }
  if (!changed) return
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n')
}

async function ensureServer() {
  if (owned) return
  if (await portUp()) return // 手动 node server.js 已在跑，就用那一份
  try {
    const httpServer = server.start()
    if (httpServer.listening) { owned = true; return }
    await new Promise((resolve, reject) => {
      httpServer.once('listening', resolve)
      httpServer.once('error', reject)
    })
    owned = true
  } catch { owned = false }
}

function activate(context) {
  try { ensureHooks() } catch {}
  const url = () => 'http://' + lanIp() + ':' + PORT
  const open = () => vscode.env.openExternal(vscode.Uri.parse(url()))
  context.subscriptions.push(vscode.commands.registerCommand('cursorStatus.open', open))
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50)
  bar.text = 'Cursor 状态'
  bar.tooltip = url()
  bar.command = 'cursorStatus.open'
  bar.show()
  context.subscriptions.push(bar)
  ensureServer()
  timer = setInterval(ensureServer, 15000) // 窗口关掉导致服务退出时，其它窗口再拉起
}

function deactivate() {
  clearInterval(timer)
  if (owned) server.stop() // 只停本扩展拉起的服务，不碰手动启动的
}

module.exports = { activate, deactivate }
