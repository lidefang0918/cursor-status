// 从 Cursor 账号用量接口取数据（非官方接口，字段变动只需改此文件）
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const crypto = require('crypto')
const os = require('os')

function cursorRoot() {
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Cursor')
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Cursor')
  return path.join(os.homedir(), '.config', 'Cursor')
}
const DB = path.join(cursorRoot(), 'User', 'globalStorage', 'state.vscdb')
const BASE = 'https://cursor.com/api'
let auth = null // { cookie, at }
let db = null
let winKey = null

function sqlite(sql) {
  let DatabaseSync
  try { ({ DatabaseSync } = require('node:sqlite')) } catch {}
  if (DatabaseSync) {
    if (!db) db = new DatabaseSync(DB, { readOnly: true })
    const row = db.prepare(sql).get()
    if (!row) return ''
    const v = Object.values(row)[0]
    return v == null ? '' : String(v)
  }
  const uri = 'file:' + DB.replace(/\\/g, '/') + '?mode=ro'
  try {
    return execFileSync('sqlite3', [uri, sql], { timeout: 10000 }).toString().trim()
  } catch {
    throw new Error('读取 Cursor 数据库失败。请安装 Node.js 22 或更新版本，或把 sqlite3 加到 PATH')
  }
}

function dpapiUnprotect(buf) {
  const b64 = buf.toString('base64')
  const ps = [
    "$ErrorActionPreference='Stop'",
    'Add-Type -AssemblyName System.Security',
    `$bytes=[Convert]::FromBase64String('${b64}')`,
    "$dec=[System.Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
    '[Convert]::ToBase64String($dec)',
  ].join(';')
  const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const out = execFileSync(exe, ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 20000, windowsHide: true })
  return Buffer.from(out.replace(/\s+/g, ''), 'base64')
}

function windowsKey() {
  if (winKey) return winKey
  const parsed = JSON.parse(fs.readFileSync(path.join(cursorRoot(), 'Local State'), 'utf8'))
  const encKey = Buffer.from(parsed.os_crypt.encrypted_key, 'base64')
  if (encKey.subarray(0, 5).toString('latin1') !== 'DPAPI') throw new Error('无法读取 Windows 上的 Cursor 密钥')
  const key = dpapiUnprotect(encKey.subarray(5))
  if (key.length !== 32) throw new Error('Cursor 密钥长度异常')
  winKey = key
  return key
}

function decryptMac(raw) {
  const pw = execFileSync('security', ['find-generic-password', '-w', '-s', 'Cursor Safe Storage']).toString().trim()
  const key = crypto.pbkdf2Sync(pw, 'saltysalt', 1003, 16, 'sha1')
  const d = crypto.createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 32))
  return Buffer.concat([d.update(raw.subarray(3)), d.final()]).toString()
}

function decryptWin(raw) {
  if (raw.subarray(0, 3).toString('latin1') !== 'v10') return dpapiUnprotect(raw).toString('utf8')
  const nonce = raw.subarray(3, 15)
  const tag = raw.subarray(raw.length - 16)
  const data = raw.subarray(15, raw.length - 16)
  const d = crypto.createDecipheriv('aes-256-gcm', windowsKey(), nonce)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(data), d.final()]).toString('utf8')
}

// 登录 token 只留在内存：macOS 走钥匙串，Windows 走当前用户的 DPAPI
function loadAuth() {
  const stored = sqlite("select value from ItemTable where key='cursorAuth/accessToken'").trim()
  let jwt = stored
  if (stored.startsWith('cursor-safe-storage:v1:')) {
    const raw = Buffer.from(stored.slice('cursor-safe-storage:v1:'.length), 'base64')
    if (process.platform === 'darwin') jwt = decryptMac(raw)
    else if (process.platform === 'win32') jwt = decryptWin(raw)
    else throw new Error('当前只支持在 macOS 和 Windows 上读取 Cursor 登录态')
  }
  jwt = jwt.trim()
  const uid = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url')).sub.split('|').pop()
  auth = { cookie: `WorkosCursorSessionToken=${uid}%3A%3A${jwt}`, jwt, at: Date.now() }
}

// 客户端 RPC（Connect JSON），网页接口里没有的数据走这里
async function rpc(method) {
  if (!auth || Date.now() - auth.at > 30 * 60e3) loadAuth()
  const r = await fetch('https://api2.cursor.sh/aiserver.v1.DashboardService/' + method, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + auth.jwt, 'content-type': 'application/json', 'connect-protocol-version': '1' },
    body: '{}',
  })
  if (r.status === 401) auth = null
  if (!r.ok) throw new Error(method + ' ' + r.status)
  return r.json()
}

async function call(path, body) {
  if (!auth || Date.now() - auth.at > 30 * 60e3) loadAuth()
  const r = await fetch(BASE + path, {
    method: body ? 'POST' : 'GET',
    headers: { cookie: auth.cookie, origin: 'https://cursor.com', 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (r.status === 401 || r.status === 403) auth = null
  if (!r.ok) throw new Error(path + ' ' + r.status)
  return r.json()
}

const sum = (t) => ({
  in: +t.inputTokens || 0,
  out: +t.outputTokens || 0,
  cache: (+t.cacheReadTokens || 0) + (+t.cacheWriteTokens || 0),
  cents: +t.totalCents || 0,
})
const dayStart = (offset = 0) => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime() + offset * 864e5
}

// 今日按会话汇总
async function sessionsToday() {
  const start = dayStart(), end = Date.now()
  const map = {}
  for (let page = 1; page <= 10; page++) {
    const r = await call('/dashboard/get-filtered-usage-events', {
      startDate: String(start), endDate: String(end), page, pageSize: 200,
    })
    const list = r.usageEventsDisplay || []
    for (const e of list) {
      const id = e.conversationId || 'unknown'
      const t = sum(e.tokenUsage || {})
      const s = (map[id] ||= { id, in: 0, out: 0, cache: 0, cents: 0, last: 0 })
      s.in += t.in; s.out += t.out; s.cache += t.cache; s.cents += t.cents
      s.last = Math.max(s.last, +e.timestamp)
    }
    if (list.length < 200) break
  }
  return map
}

async function daily(offset) {
  const r = await call('/dashboard/get-aggregated-usage-events', {
    startDate: String(dayStart(offset)), endDate: String(dayStart(offset + 1) - 1),
  })
  return sum({
    inputTokens: r.totalInputTokens, outputTokens: r.totalOutputTokens,
    cacheReadTokens: r.totalCacheReadTokens, cacheWriteTokens: r.totalCacheWriteTokens,
    totalCents: r.totalCostCents,
  })
}

const month = () => call('/usage-summary')

// Grok Bot 周额度：已用 ppm（百万分比）之和 / 1e6
async function grokWeekly() {
  const w = (await rpc('GetGrokBotUsageBreakdown')).weeklyLimitPpm || {}
  const ppm = (w.bySource || []).reduce((a, x) => a + (x.ppm || 0), 0)
  return { pct: ppm / 1e4, end: +w.periodEndMs || 0 }
}

// 会话标题来自本地库
function titleOf(id) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return ''
  try {
    return sqlite(`select json_extract(value,'$.name') from cursorDiskKV where key='composerData:${id}'`)
  } catch { return '' }
}

module.exports = { sessionsToday, daily, month, grokWeekly, titleOf }
