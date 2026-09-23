// Test collision move (Task 19) — skenario user: home/test/ (folder) + home/test/test (file)
// Move file "test" dengan dest ".." (dari home/test → home): dulu ERROR bentrok nama
// (folder "test" udah ada di home), sekarang harus sukses + auto-rename "test (1)"
import { io } from 'socket.io-client'
import fs from 'fs'

const token = fs.existsSync('/tmp/tp_cookie_prod.txt')
  ? fs.readFileSync('/tmp/tp_cookie_prod.txt', 'utf8').split('\n').find((l) => l.includes('tp_token')).trim().split(/\s+/).pop()
  : process.env.RP_TOKEN || ''
const URL = process.env.RP_URL || 'https://railpanel-production-a69c.up.railway.app'
const PATH = process.env.RP_WS_PATH || '/socket.io'

let fail = 0
const ok = (name, cond, extra = '') => { console.log(`${cond ? '[OK]' : '[FAIL]'} ${name}${extra ? ' — ' + extra : ''}`); if (!cond) fail++ }

const s = io(URL, { forceNew: true, path: PATH, transports: ['polling'], extraHeaders: { Cookie: `tp_token=${token}` }, timeout: 15000 })
const rpc = (ev, p) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), 20000); s.emit(ev, p, (r) => { clearTimeout(t); r && r.ok === false ? rej(new Error(`${ev}: ${r.error}`)) : res(r) }) })
const names = (id, p) => rpc('files:list', { id, path: p }).then((r) => r.entries.map((e) => e.name))

s.on('connect_error', (e) => { console.log('[FAIL] connect:', e.message); process.exit(1) })
s.on('connect', async () => {
  let id = null
  try {
    // resolve token produksi via servers:list (auth ditolak kalau cookie salah)
    const { server } = await rpc('servers:create', { name: 'Tes Move Collision', description: 'task19' })
    id = server.id
    // struktur persis kayak user: folder home/test berisi file "test"
    await rpc('files:mkdir', { id, path: 'home' })
    await rpc('files:mkdir', { id, path: 'home/test' })
    await rpc('files:write', { id, path: 'home/test/test', content: 'isi file test\n' })

    // 1) move file "test" naik ke home (dest ".." dari home/test = home) → dulu error EISDIR
    const res = await rpc('files:move', { id, items: ['home/test/test'], dest: 'home' })
    ok('move file test ke home SUKSES (dulu error bentrok)', true)
    ok('respons kasih info renamed', Array.isArray(res.renamed) && res.renamed.length === 1, JSON.stringify(res.renamed))
    ok('nama baru "test (1)"', res.renamed?.[0] === 'test → test (1)', res.renamed?.[0])
    const homeList = await names(id, 'home')
    ok('home berisi folder test + file "test (1)"', homeList.includes('test') && homeList.includes('test (1)'), homeList.join(','))
    const moved = await rpc('files:read', { id, path: 'home/test (1)' })
    ok('isi file utuh setelah rename', moved.content === 'isi file test\n')

    // 2) move lagi dengan nama "test (1)" udah terpakai → "test (2)"
    await rpc('files:write', { id, path: 'home/test/test', content: 'dua\n' })
    const res2 = await rpc('files:move', { id, items: ['home/test/test'], dest: 'home' })
    ok('collision kedua → "test (2)"', res2.renamed?.[0] === 'test → test (2)', JSON.stringify(res2.renamed))
    const homeList2 = await names(id, 'home')
    ok('home: test, test (1), test (2)', ['test', 'test (1)', 'test (2)'].every((n) => homeList2.includes(n)), homeList2.join(','))

    // 3) folder bentrok juga: bikin folder home/test/inner, move ke home yang udah ada "inner"
    await rpc('files:mkdir', { id, path: 'home/inner' })
    await rpc('files:mkdir', { id, path: 'home/test/inner' })
    const res3 = await rpc('files:move', { id, items: ['home/test/inner'], dest: 'home' })
    ok('folder bentrok → "inner (1)"', res3.renamed?.[0] === 'inner → inner (1)', JSON.stringify(res3.renamed))

    // 4) move tanpa bentrok tetap tanpa rename
    await rpc('files:write', { id, path: 'home/test/apaaja.txt', content: 'x' })
    const res4 = await rpc('files:move', { id, items: ['home/test/apaaja.txt'], dest: 'home' })
    ok('move normal gak ada renamed', Array.isArray(res4.renamed) && res4.renamed.length === 0, JSON.stringify(res4.renamed))

    console.log(fail ? `\n${fail} FAIL` : '\n=== SEMUA TEST COLLISION PASS ===')
    s.close()
    process.exit(fail ? 1 : 0)
  } catch (e) {
    console.error('[FAIL]', e.message)
    if (id) await rpc('servers:delete', { id }).catch(() => {})
    s.close()
    process.exit(1)
  }
})
