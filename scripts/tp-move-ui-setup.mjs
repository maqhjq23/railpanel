// Setup server test untuk smoke test Move UI (Task 18) — produksi
// Struktur: home/contoh/a.txt + b.txt  (skenario user: di /home/contoh, move ".." → /home)
import { io } from 'socket.io-client'
import fs from 'fs'

const token = fs.readFileSync('/tmp/tp_cookie_prod.txt', 'utf8')
  .split('\n').find((l) => l.includes('tp_token')).trim().split(/\s+/).pop()
const URL = 'https://railpanel-production-a69c.up.railway.app'
const PATH = '/socket.io'

const s = io(URL, { forceNew: true, path: PATH, transports: ['polling'], extraHeaders: { Cookie: `tp_token=${token}` }, timeout: 15000 })
const rpc = (ev, p) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), 20000); s.emit(ev, p, (r) => { clearTimeout(t); r && r.ok === false ? rej(new Error(`${ev}: ${r.error}`)) : res(r) }) })

s.on('connect_error', (e) => { console.log('[FAIL] connect:', e.message); process.exit(1) })
s.on('connect', async () => {
  try {
    const { server } = await rpc('servers:create', { name: 'Tes Move UI', description: 'task18 move+location' })
    const id = server.id
    await rpc('files:mkdir', { id, path: 'home' })
    await rpc('files:mkdir', { id, path: 'home/contoh' })
    await rpc('files:write', { id, path: 'home/contoh/a.txt', content: 'halo dari task18\n' })
    await rpc('files:write', { id, path: 'home/contoh/b.txt', content: 'file kedua\n' })
    const root = await rpc('files:list', { id, path: '.' })
    const inC = await rpc('files:list', { id, path: 'home/contoh' })
    console.log('[OK] server dibuat:', id)
    console.log('[OK] root:', root.entries.map((e) => e.name).join(','))
    console.log('[OK] home/contoh:', inC.entries.map((e) => e.name).join(','))
    console.log('SERVER_ID=' + id)
    s.close()
    process.exit(0)
  } catch (e) {
    console.error('[FAIL]', e.message)
    s.close()
    process.exit(1)
  }
})
