// Debug: attach terminal + kirim input, dump semua term:out
import { io } from 'socket.io-client'
const URL = process.env.RP_URL || 'http://127.0.0.1:3003'
const token = process.env.RP_TOKEN
const s = io(URL, { forceNew: true, path: '/socket.io', transports: ['polling'], reconnection: false, extraHeaders: { Cookie: `tp_token=${token}` } })
function rpc(event, payload) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout ' + event)), 8000)
    s.emit(event, payload, (res) => { clearTimeout(t); resolve(res) })
  })
}
s.on('connect', async () => {
  const list = await rpc('servers:list', {})
  const target = list[list.length - 1]
  console.log('target:', target?.id, target?.name)
  const att = await rpc('terminal:attach', { id: target.id })
  console.log('attach:', JSON.stringify({ ok: att.ok, node: att.node, cols: att.cols, rows: att.rows, backlogLen: (att.backlog || '').length }))
  s.on('term:out', ({ id, data }) => { if (id === target.id) process.stdout.write('OUT:' + JSON.stringify(data) + '\n') })
  s.on('term:closed', ({ id }) => console.log('CLOSED', id))
  await new Promise((r) => setTimeout(r, 800))
  s.emit('terminal:input', { id: target.id, data: 'echo DBG_$((6*7))\n' })
  await new Promise((r) => setTimeout(r, 2500))
  const rs = await rpc('terminal:resize', { id: target.id, cols: 120, rows: 35 })
  console.log('resize:', JSON.stringify(rs))
  s.emit('terminal:input', { id: target.id, data: 'printf "A\\rB\\n"\n' })
  await new Promise((r) => setTimeout(r, 2000))
  process.exit(0)
})
s.on('connect_error', (e) => { console.log('ERR', e.message); process.exit(1) })
setTimeout(() => { console.log('timeout global'); process.exit(2) }, 20000)
