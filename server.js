const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const usage = require('./usage')

const PORT = 8787
const DIR = process.env.CURSOR_STATUS_HOME || path.join(os.homedir(), '.cursor-status')
const FILE = path.join(DIR, 'sessions.json')
const sessions = {} // conversation_id -> hook 状态，落盘到 FILE，重启后恢复
let saveTimer = null
const dayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }
function writeNow() {
  const start = dayStart()
  for (const id of Object.keys(sessions)) if (sessions[id].last < start) delete sessions[id] // 跨天清掉昨天
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(sessions))
}
const save = () => saveTimer ||= setTimeout(() => { saveTimer = null; writeNow() }, 1000) // 合并高频事件，最多每秒写一次
function loadSessions() {
  const legacy = path.join(__dirname, 'data', 'sessions.json')
  let src = FILE
  try { fs.accessSync(FILE) } catch { src = legacy }
  try {
    const day0 = new Date(); day0.setHours(0, 0, 0, 0)
    for (const [id, x] of Object.entries(JSON.parse(fs.readFileSync(src)))) if (x.last >= day0.getTime()) sessions[id] = x // 只恢复今天的
  } catch {}
  if (src !== FILE && Object.keys(sessions).length) writeNow()
}
loadSessions()
let cache = { today: {}, days: [], month: null, err: '', at: 0 }
let lastHook = 0

// ---------- hooks ----------
function onHook(p) {
  const id = p.conversation_id
  if (!id) return
  lastHook = Date.now()
  const s = (sessions[id] ||= { id, steps: 0, worked: 0, turnStart: Date.now(), last: Date.now(), status: 'running', ack: true })
  if (s.status === 'running' && Date.now() - s.last > 300e3) { s.worked += s.last - s.turnStart; s.turnStart = Date.now() } // 长时间无事件：空档不计入用时
  s.last = Date.now()
  s.project = path.basename((p.workspace_roots || [])[0] || s.project || '')
  const ev = p.hook_event_name
  if (ev === 'beforeSubmitPrompt') {
    if (s.status !== 'running') s.turnStart = Date.now()
    Object.assign(s, { status: 'running', ack: true, action: '思考中' }) // 步数、用时按会话累计，不清零
  }
  else if (ev === 'preToolUse') {
    if (s.status !== 'running') s.turnStart = Date.now()
    s.status = 'running'; s.steps++
    const i = p.tool_input || {}
    s.action = [p.tool_name, i.command || i.path || i.file_path || i.pattern || ''].join(' ').replace(/\s+/g, ' ').trim().slice(0, 60)
  } else if (ev === 'stop') {
    if (s.status === 'running') s.worked += Date.now() - s.turnStart // 只累计工作时间，不含等你输入的间隔
    s.status = p.status || 'completed' // completed | aborted | error
    s.action = ''
    s.ack = s.status !== 'completed' ? true : false // 仅“完成”需要点击确认
  }
  save()
}

// ---------- 用量刷新 ----------
async function refresh() {
  try {
    const [today, month] = await Promise.all([usage.sessionsToday(), usage.month()])
    cache.today = today; cache.month = month; cache.err = ''; cache.at = Date.now()
  } catch (e) { cache.err = e.message }
  try { cache.grok = await usage.grokWeekly() } catch (e) { cache.err = e.message }
}
async function refreshDays() {
  try {
    cache.days = await Promise.all([-6, -5, -4, -3, -2, -1, 0].map((o) => usage.daily(o).then((d) => ({ ...d, day: new Date(Date.now() + o * 864e5).getDate() }))))
  } catch (e) { cache.err = e.message }
}

// ---------- 卡片 ----------
const tk = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n))
const dur = (ms) => { const m = Math.floor(ms / 6e4); return m >= 60 ? Math.floor(m / 60) + 'h' + (m % 60) + 'm' : m + 'm' }
const total = (s) => s.in + s.out + s.cache
const STATUS = { running: '工作中', completed: '已完成', aborted: '已中断', error: '出错' }

function sessionsCard() {
  const now = Date.now(), start = dayStart()
  // 只显示今天：今日有用量，或今天有过 hook 事件
  const ids = new Set([
    ...Object.keys(cache.today),
    ...Object.keys(sessions).filter((id) => sessions[id].last >= start),
  ])
  const rows = [...ids].map((id) => {
    const h = sessions[id] && sessions[id].last >= start ? sessions[id] : null, u = cache.today[id]
    // 运行中但 5 分钟没有事件，视为空闲（stop 事件可能丢失）
    const st = h ? (h.status === 'running' && now - h.last > 300e3 ? 'idle' : h.status) : 'idle'
    const at = Math.max(h ? h.last : 0, u ? u.last : 0)
    const sub = h
      ? [h.project, `${h.steps}步`, dur(h.worked + (h.status === 'running' ? (st === 'idle' ? h.last : now) - h.turnStart : 0)), st === 'running' ? h.action : ''].filter(Boolean).join(' · ')
      : '最近 ' + new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    return {
      title: usage.titleOf(id) || id.slice(0, 8),
      tag: STATUS[st] || '空闲',
      token: u ? tk(total(u)) : '--',
      sub, at, hot: st === 'running', done: st === 'completed' && !h.ack,
    }
  }).sort((a, b) => b.at - a.at).slice(0, 6)
  const all = Object.values(cache.today).reduce((a, s) => a + total(s), 0)
  const pending = rows.filter((r) => r.done).length
  return {
    id: 'sessions', title: `今日 ${tk(all)} · ${Object.keys(cache.today).length} 个会话`, type: 'sessions',
    data: {
      banner: pending ? `${pending} 个会话已完成，点屏幕任意位置确认` : '',
      rows,
    },
  }
}

function todayCard() {
  const t = cache.days[cache.days.length - 1] || { in: 0, out: 0, cache: 0, cents: 0 }
  const max = Math.max(1, ...cache.days.map(total))
  return {
    id: 'today', title: '今日与趋势', type: 'chart',
    data: {
      grid: [
        { k: '总 Token', v: tk(total(t)) }, { k: '输入', v: tk(t.in) },
        { k: '输出', v: tk(t.out) }, { k: '会话数', v: String(Object.keys(cache.today).length) },
      ],
      cols: cache.days.map((d) => ({ label: String(d.day), frac: total(d) / max, v: tk(total(d)) })),
    },
  }
}

function monthCard() {
  const m = cache.month
  if (!m) return { id: 'month', title: '月额度', type: 'big', data: { big: '--', lines: [{ k: '提示', v: cache.err || '加载中' }] } }
  const p = m.individualUsage.plan
  const start = Date.parse(m.billingCycleStart), end = Date.parse(m.billingCycleEnd)
  const elapsed = Math.min(1, (Date.now() - start) / (end - start))
  const md = (t) => new Date(t).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  const item = (label, pct, sub) => ({ label, value: pct.toFixed(1) + '%', sub, frac: Math.min(1, pct / 100) })
  const fc = (pct) => (elapsed > 0.02 ? pct / elapsed : pct)
  const monthly = (label, pct) => item(label, pct, `月底预计 ${fc(pct).toFixed(0)}%${fc(pct) > 100 ? ' 超额!' : ''} · ${md(end)} 重置`)
  const g = cache.grok
  return {
    id: 'month', title: '额度消耗', type: 'list',
    data: [
      monthly('Cursor 模型（月）', p.autoPercentUsed),
      monthly('其他模型（月）', p.apiPercentUsed),
      g ? item('Grok Bot（周）', g.pct, `${md(g.end)} 重置`) : { label: 'Grok Bot（周）', value: '--', frac: 0 },
    ],
  }
}

function deviceCard() {
  return {
    id: 'device', title: '连接与设备', type: 'big',
    data: {
      big: '在线',
      lines: [
        { k: '最近 hook', v: lastHook ? new Date(lastHook).toLocaleTimeString('zh-CN') : '无' },
        { k: '用量更新', v: cache.at ? new Date(cache.at).toLocaleTimeString('zh-CN') : '无' },
        ...(cache.err ? [{ k: '用量错误', v: cache.err }] : []),
      ],
      device: true, // 前端补充手机电量等
    },
  }
}

const INDEX = path.join(__dirname, 'public/index.html')
const cards = () => ({ ver: fs.statSync(INDEX).mtimeMs, cards: [sessionsCard(), todayCard(), monthCard(), deviceCard()] })

// ---------- HTTP ----------
const read = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)) })

async function onRequest(req, res) {
  const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type + '; charset=utf-8', 'cache-control': 'no-store' }); res.end(body) }
  if (req.method === 'POST' && req.url === '/hook') {
    try { onHook(JSON.parse(await read(req))) } catch {}
    return send(200, '{}')
  }
  if (req.method === 'POST' && req.url.startsWith('/ack/')) {
    for (const s of Object.values(sessions)) s.ack = true
    save()
    return send(200, '{}')
  }
  const p = req.url.split('?')[0]
  if (p === '/api/cards') return send(200, JSON.stringify(cards()))
  if (p === '/' || p === '/index.html') return send(200, fs.readFileSync(INDEX), 'text/html')
  if (p === '/app.apk') {
    const apk = [path.join(__dirname, 'build', 'cursor-status.apk'), path.join(__dirname, 'cursor-status.apk')].find((f) => {
      try { return fs.statSync(f).isFile() } catch { return false }
    })
    if (!apk) return send(404, 'apk 不在这个包里')
    res.writeHead(200, { 'content-type': 'application/vnd.android.package-archive', 'content-disposition': 'attachment; filename=cursor-status.apk' })
    return res.end(fs.readFileSync(apk))
  }
  send(404, '{}')
}

let server = null
const timers = []
function start() {
  if (server) return server
  server = http.createServer(onRequest)
  server.on('error', (err) => {
    const failed = server && !server.listening
    if (failed) {
      for (const t of timers) clearInterval(t)
      timers.length = 0
      server = null
    }
    if (failed && require.main === module) {
      console.error(err.message)
      process.exit(1)
    }
  })
  server.listen(PORT, '0.0.0.0', () => {
    console.log('cursor-status on :' + PORT)
    if (timers.length) return
    refresh(); refreshDays()
    timers.push(setInterval(refresh, 45e3), setInterval(refreshDays, 10 * 60e3))
  })
  return server
}
function stop() {
  for (const t of timers) clearInterval(t)
  timers.length = 0
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; writeNow() }
  if (server) { const s = server; server = null; s.close() }
}
if (require.main === module) start()
module.exports = { start, stop, PORT }
