// 自检：先 node server.js，再运行 node check.js
const base = 'http://127.0.0.1:8787'
const hook = (b) => fetch(base + '/hook', { method: 'POST', body: JSON.stringify(b) })
const id = 'cccccccc-0000-0000-0000-00000000c0de' // 独立的假会话，避免与真实会话互相干扰
const row = (r) => r.cards[0].data.rows.find((x) => x.title === 'cccccccc')
;(async () => {
  await hook({ conversation_id: id, hook_event_name: 'beforeSubmitPrompt', workspace_roots: ['/x/my'] })
  await hook({ conversation_id: id, hook_event_name: 'preToolUse', tool_name: 'Shell', tool_input: { command: 'ls' } })
  let r = await (await fetch(base + '/api/cards')).json()
  console.assert(row(r).tag === '工作中' && row(r).sub.includes('1步'), '应为工作中')
  await hook({ conversation_id: id, hook_event_name: 'stop', status: 'completed' })
  r = await (await fetch(base + '/api/cards')).json()
  console.assert(row(r).done, '完成后应等待确认')
  await hook({ conversation_id: id, hook_event_name: 'beforeSubmitPrompt' })
  await hook({ conversation_id: id, hook_event_name: 'preToolUse', tool_name: 'Read' })
  r = await (await fetch(base + '/api/cards')).json()
  console.assert(row(r).sub.includes('2步'), '新一轮后步数应累计')
  await fetch(base + '/ack/all', { method: 'POST' })
  r = await (await fetch(base + '/api/cards')).json()
  console.assert(!row(r).done, '确认后应清除')
  r.cards.forEach((c) => console.log(c.id, JSON.stringify(c.data).slice(0, 300)))
})()
