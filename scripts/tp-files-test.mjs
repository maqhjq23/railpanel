// Test fitur baru FileExplorer: files:zip, files:extract, files:move (lokal engine 3003)
import { io } from 'socket.io-client'
import crypto from 'crypto'

// token: RP_TOKEN langsung, atau HMAC dari secret (lokal default panel-auth)
const secret = process.env.RP_SECRET || 'tp-default-secret-change-me'
const token = process.env.RP_TOKEN || crypto.createHmac('sha256', secret).update('tp-admin-v1').digest('hex')
const URL = process.env.RP_URL || 'http://127.0.0.1:3003'
const PATH = process.env.RP_WS_PATH || '/'

let fail = 0
function ok(name, cond, extra = '') {
  console.log(`${cond ? '[OK]' : '[FAIL]'} ${name}${extra ? ' — ' + extra : ''}`)
  if (!cond) fail++
}

const s = io(URL, { forceNew: true, path: PATH, transports: ['polling'], extraHeaders: { Cookie: `tp_token=${token}` }, timeout: 15000 })
const rpc = (ev, p) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), 20000); s.emit(ev, p, (r) => { clearTimeout(t); r && r.ok === false ? rej(new Error(`${ev}: ${r.error}`)) : res(r) }) })
const list = (id) => rpc('files:list', { id, path: '.' }).then((r) => r.entries.map((e) => e.name))

s.on('connect_error', (e) => { console.log('[FAIL] connect:', e.message); process.exit(1) })
s.on('connect', async () => {
  let id = null
  try {
    const created = await rpc('servers:create', { name: 'Tes Files Baru', description: 'zip/extract/move' })
    id = created.server.id

    // setup: 2 file + 1 folder berisi 1 file
    await rpc('files:write', { id, path: 'a.txt', content: 'isi A' })
    await rpc('files:write', { id, path: 'b.txt', content: 'isi B' })
    await rpc('files:mkdir', { id, path: 'docs' })
    await rpc('files:write', { id, path: 'docs/d1.txt', content: 'isi D1' })

    // 1) ZIP: a.txt + b.txt + docs -> arsip.zip
    await rpc('files:zip', { id, items: ['a.txt', 'b.txt', 'docs'], out: 'arsip.zip' })
    ok('files:zip bikin arsip.zip', (await list(id)).includes('arsip.zip'))

    // 2) hapus a.txt & docs, lalu EXTRACT balik dari arsip.zip
    await rpc('files:delete', { id, path: 'a.txt' })
    await rpc('files:delete', { id, path: 'docs' })
    const mid = await list(id)
    ok('setup extract: a.txt & docs hilang', !mid.includes('a.txt') && !mid.includes('docs'), mid.join(','))
    await rpc('files:extract', { id, path: 'arsip.zip' })
    const after = await list(id)
    ok('files:extract balikin a.txt & docs', after.includes('a.txt') && after.includes('docs'), after.join(','))
    const d1 = await rpc('files:read', { id, path: 'docs/d1.txt' })
    ok('isi file hasil extract utuh', d1.content === 'isi D1')
    const a1 = await rpc('files:read', { id, path: 'a.txt' })
    ok('isi a.txt hasil extract utuh', a1.content === 'isi A')

    // 3) extract file yang bukan zip -> harus ditolak
    let rejected = false
    try { await rpc('files:extract', { id, path: 'b.txt' }) } catch { rejected = true }
    ok('extract non-zip ditolak', rejected)

    // 4) MOVE: b.txt -> docs/
    await rpc('files:move', { id, items: ['b.txt'], dest: 'docs' })
    const afterMove = await list(id)
    const docsList = await rpc('files:list', { id, path: 'docs' })
    const docsNames = docsList.entries.map((e) => e.name)
    ok('files:move pindah b.txt ke docs/', !afterMove.includes('b.txt') && docsNames.includes('b.txt'), 'docs: ' + docsNames.join(','))

    // 5) MOVE folder ke dalam dirinya sendiri -> ditolak
    let selfReject = false
    try { await rpc('files:move', { id, items: ['docs'], dest: 'docs/sub' }) } catch (e) { selfReject = /dirinya|tidak valid|gak ada/.test(e.message) }
    ok('move folder ke dalam dirinya ditolak', selfReject)

    // 6) zip tanpa item -> ditolak
    let emptyReject = false
    try { await rpc('files:zip', { id, items: [], out: 'x.zip' }) } catch { emptyReject = true }
    ok('zip tanpa item ditolak', emptyReject)

    console.log(fail === 0 ? '=== SEMUA TEST FILES PASS ===' : `=== ${fail} TEST GAGAL ===`)
    await rpc('servers:delete', { id }).catch(() => {})
    process.exit(fail === 0 ? 0 : 1)
  } catch (e) {
    console.log('[FAIL]', e.message)
    if (id) await rpc('servers:delete', { id }).catch(() => {})
    process.exit(1)
  }
})
