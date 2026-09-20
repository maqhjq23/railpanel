// Cleanup: hapus server test "Tes Move UI" (Task 18)
import { io } from 'socket.io-client'
import fs from 'fs'

const token = fs.readFileSync('/tmp/tp_cookie_prod.txt', 'utf8')
  .split('\n').find((l) => l.includes('tp_token')).trim().split(/\s+/).pop()
const s = io('https://railpanel-production-a69c.up.railway.app', { forceNew: true, path: '/socket.io', transports: ['polling'], extraHeaders: { Cookie: `tp_token=${token}` }, timeout: 15000 })
const rpc = (ev, p) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), 20000); s.emit(ev, p, (r) => { clearTimeout(t); r && r.ok === false ? rej(new Error(`${ev}: ${r.error}`)) : res(r) }) })

s.on('connect_error', (e) => { console.log('[FAIL] connect:', e.message); process.exit(1) })
s.on('connect', async () => {
  try {
    const servers = await rpc('servers:list', {})
    for (const sv of servers.filter((x) => x.name === 'Tes Move UI')) {
      await rpc('servers:delete', { id: sv.id })
      console.log('[OK] dihapus:', sv.id)
    }
    const after = await rpc('servers:list', {})
    console.log('[OK] panel tersisa:', after.map((x) => x.name).join(', '))
    s.close()
    process.exit(0)
  } catch (e) { console.error('[FAIL]', e.message); s.close(); process.exit(1) }
})
