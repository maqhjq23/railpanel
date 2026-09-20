// Test upload produksi: bikin server -> curl multipart ke /api/files/upload -> cek list
import { io } from 'socket.io-client'
import { execSync } from 'child_process'

const token = process.env.RP_TOKEN
const BASE = process.env.RP_URL || 'https://railpanel-production-a69c.up.railway.app'
const PATH = process.env.RP_WS_PATH || '/socket.io'

let fail = 0
function ok(name, cond, extra = '') {
  console.log(`${cond ? '[OK]' : '[FAIL]'} ${name}${extra ? ' — ' + extra : ''}`)
  if (!cond) fail++
}

const s = io(BASE, { forceNew: true, path: PATH, transports: ['polling'], extraHeaders: { Cookie: `tp_token=${token}` }, timeout: 20000 })
const rpc = (ev, p) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), 20000); s.emit(ev, p, (r) => { clearTimeout(t); r && r.ok === false ? rej(new Error(`${ev}: ${r.error}`)) : res(r) }) })

s.on('connect_error', (e) => { console.log('[FAIL] connect:', e.message); process.exit(1) })
s.on('connect', async () => {
  let id = null
  try {
    const created = await rpc('servers:create', { name: 'Tes Upload', description: 'cek route upload' })
    id = created.server.id

    // siapkan file dummy
    execSync('printf "halo dari upload test" > /tmp/up-a.txt; head -c 100000 /dev/urandom > /tmp/up-bin.bin; printf "a,b,c\\n1,2,3\\n" > /tmp/up.csv')

    // 1) upload normal (multi file)
    const r1 = execSync(
      `curl -s --max-time 60 -b "tp_token=${token}" -F "server=${id}" -F "path=." -F "files=@/tmp/up-a.txt" -F "files=@/tmp/up-bin.bin" -F "files=@/tmp/up.csv" ${BASE}/api/files/upload`,
      { encoding: 'utf8' },
    )
    console.log('  resp:', r1.slice(0, 120))
    const j1 = JSON.parse(r1)
    ok('upload 3 file sukses', j1.ok === true && j1.saved === 3)

    // 2) verifikasi via files:list + isi file benar
    const list = await rpc('files:list', { id, path: '.' })
    const names = list.entries.map((e) => e.name)
    ok('file masuk ke file manager', ['up-a.txt', 'up-bin.bin', 'up.csv'].every((n) => names.includes(n)), names.join(','))
    const ra = await rpc('files:read', { id, path: 'up-a.txt' })
    ok('isi file teks utuh', ra.content === 'halo dari upload test')
    // binary dicek via size di list + md5 lewat route download (files:read UTF-8 gak cocok buat binary)
    const binEntry = list.entries.find((e) => e.name === 'up-bin.bin')
    ok('size binary 100000 bytes tercatat', binEntry && binEntry.size === 100000, binEntry ? 'size=' + binEntry.size : 'gak ada')
    const md5Local = execSync('md5sum /tmp/up-bin.bin').toString().split(/\s+/)[0]
    const md5Down = execSync(`curl -s --max-time 60 -b "tp_token=${token}" "${BASE}/api/files/download?server=${id}&path=up-bin.bin" | md5sum`).toString().split(/\s+/)[0]
    ok('binary utuh (md5 upload=download)', md5Local === md5Down, md5Local + ' vs ' + md5Down)

    // 3) upload ke subfolder
    await rpc('files:mkdir', { id, path: 'subdir' })
    const r2 = execSync(
      `curl -s --max-time 60 -b "tp_token=${token}" -F "server=${id}" -F "path=subdir" -F "files=@/tmp/up-a.txt" ${BASE}/api/files/upload`,
      { encoding: 'utf8' },
    )
    const j2 = JSON.parse(r2)
    ok('upload ke subfolder sukses', j2.ok === true && j2.saved === 1)
    const lsub = await rpc('files:list', { id, path: 'subdir' })
    ok('file masuk subfolder', lsub.entries.some((e) => e.name === 'up-a.txt'))

    // 4) tanpa login -> ditolak
    let unauth = false
    try {
      execSync(`curl -s -o /dev/null -w "%{http_code}" --max-time 30 -F "server=${id}" -F "path=." -F "files=@/tmp/up-a.txt" ${BASE}/api/files/upload`, { encoding: 'utf8' })
    } catch (e) {
      unauth = /401|403/.test(String(e.stdout || e.message))
    }
    // cek manual status code
    const code = execSync(`curl -s -o /dev/null -w "%{http_code}" --max-time 30 -F "server=${id}" -F "path=." -F "files=@/tmp/up-a.txt" ${BASE}/api/files/upload`, { encoding: 'utf8' }).trim()
    unauth = code === '401'
    ok('upload tanpa login ditolak (401)', unauth, 'code=' + code)

    // 5) server id ngawur -> 404
    const code2 = execSync(`curl -s -o /dev/null -w "%{http_code}" --max-time 30 -b "tp_token=${token}" -F "server=000000000000" -F "path=." -F "files=@/tmp/up-a.txt" ${BASE}/api/files/upload`, { encoding: 'utf8' }).trim()
    ok('server gak dikenal ditolak (404)', code2 === '404', 'code=' + code2)

    console.log(fail === 0 ? '=== SEMUA TEST UPLOAD PASS ===' : `=== ${fail} TEST GAGAL ===`)
    await rpc('servers:delete', { id }).catch(() => {})
    process.exit(fail === 0 ? 0 : 1)
  } catch (e) {
    console.log('[FAIL]', e.message)
    if (id) await rpc('servers:delete', { id }).catch(() => {})
    process.exit(1)
  }
})
