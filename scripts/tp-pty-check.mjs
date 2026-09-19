// Cek produksi: attach harus pakai node-pty (node:true), resize RPC harus ok,
// winsize harus benar-benar berubah (cek dengan st size + tput cols)
import { io } from 'socket.io-client'

const token = process.env.RP_TOKEN
const URL = process.env.RP_URL || 'https://railpanel-production-a69c.up.railway.app'
const PATH = process.env.RP_WS_PATH || '/socket.io'

const s = io(URL, { forceNew: true, path: PATH, transports: ['polling'], extraHeaders: { Cookie: `tp_token=${token}` }, timeout: 20000 })
const rpc = (ev, p) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), 15000); s.emit(ev, p, (r) => { clearTimeout(t); res(r) }) })

s.on('connect_error', (e) => { console.log('[FAIL] connect:', e.message); process.exit(1) })
s.on('connect', async () => {
  try {
    const created = await rpc('servers:create', { name: 'Tes PTY Resize', description: 'cek node-pty + winsize' })
    const id = created.server.id
    const cleanup = async (code) => { await rpc('servers:delete', { id }).catch(() => {}); process.exit(code) }
    try {
      const att = await rpc('terminal:attach', { id })
      console.log('[ATTACH] ok=' + att.ok, 'node-pty=' + att.node, 'size=' + att.cols + 'x' + att.rows)
      if (!att.ok || !att.node) { console.log('[FAIL] node-pty TIDAK aktif'); await cleanup(1) }
      let out = ''
      s.on('term:out', ({ data }) => { out += data })
      await new Promise((r) => setTimeout(r, 2200))
      out = ''
      const rs = await rpc('terminal:resize', { id, cols: 130, rows: 40 })
      console.log('[RESIZE] ok=' + rs.ok + (rs.fixed ? ' (FIXED — fallback script!)' : ''))
      await new Promise((r) => setTimeout(r, 600))
      s.emit('terminal:input', { id, data: 'tput cols; tput lines\n' })
      const t0 = Date.now()
      while (Date.now() - t0 < 10000 && !(out.match(/(\d+)\r?\n(\d+)/))) await new Promise((r) => setTimeout(r, 300))
      const clean = out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\r/g, '')
      const m = clean.match(/(\d+)\r?\n(\d+)/)
      // tput cols = kolom (130), tput lines = baris (40)
      const okSize = m && Number(m[1]) === 130 && Number(m[2]) === 40
      console.log('[TPUT] cols=' + (m ? m[1] : '?') + ' lines=' + (m ? m[2] : '?'))
      const m2 = clean.match(/(\d+)\s*\n?\s*$/) // tput cols output
      console.log(okSize ? '[OK] winsize PTY = 130x40 (resize beneran jalan)' : '[FAIL] winsize gak nge-resize')
      await cleanup(okSize ? 0 : 1)
    } catch (e) { console.log('[FAIL]', e.message); await cleanup(1) }
  } catch (e) { console.log('[FAIL] create:', e.message); process.exit(1) }
})
