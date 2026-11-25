#!/usr/bin/env node
// Cursor hook：把事件转给本地状态服务。失败不影响 Cursor。参数 prompt 时回 continue
const http = require('http')
if (process.argv[2] === 'prompt') process.stdout.write('{"continue":true}\n')
const chunks = []
const done = () => process.exit(0)
setTimeout(done, 1500)
process.stdin.on('data', (c) => chunks.push(c))
process.stdin.on('end', () => {
  const data = Buffer.concat(chunks)
  const req = http.request({
    host: '127.0.0.1', port: 8787, path: '/hook', method: 'POST', timeout: 1000,
    headers: { 'content-type': 'application/json', 'content-length': data.length },
  }, (res) => { res.resume(); res.on('end', done) })
  req.on('error', done)
  req.on('timeout', () => { req.destroy(); done() })
  req.end(data)
})
