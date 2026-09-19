// Cek environment produksi RailPanel via console terminal:
// Ubuntu 24.04, root (uid 0), toolset lengkap, apt install jalan beneran.
import { io } from 'socket.io-client'

const token = process.env.RP_TOKEN
const URL = process.env.RP_URL || 'https://railpanel-production-a69c.up.railway.app'
const PATH = process.env.RP_WS_PATH || '/socket.io'

function fail(msg) { console.error('[FAIL]', msg); process.exit(1) }

const s = io(URL, { forceNew: true, path: PATH, transports: ['polling'], extraHeaders: { Cookie: `tp_token=${token}` }, timeout: 20000 })

s.on('connect_error', (e) => fail('connect: ' + e.message))
s.on('connect', () => {
  s.emit('servers:create', { name: 'Tes Ubuntu Env', description: 'cek env produksi' }, async (created) => {
    if (!created?.ok) fail('create gagal: ' + (created?.error || '?'))
    const id = created.server.id
    const cleanup = async () => { await new Promise((r) => s.emit('servers:delete', { id }, r)); s.close(); process.exit(0) }
    try {
      s.emit('terminal:attach', { id }, async (res) => {
        if (!res?.ok) fail('attach gagal: ' + (res?.error || '?'))
        let out = ''
        s.on('term:out', ({ data }) => { out += data })
        await new Promise((r) => setTimeout(r, 2500)) // lewati startup bash
        const cmd = process.env.CHECK_CMD || 'echo "==OS=="; cat /etc/os-release | head -2; echo "==ID=="; id -u; echo "==TOOLS=="; which apt gcc python3 node git; echo "==APT=="; apt-get update -qq 2>&1 | tail -1; apt-get install -y -qq figlet > /dev/null 2>&1 && figlet "UBUNTU OK" | head -2; echo "==SELESAI=="'
        s.emit('terminal:input', { id, data: cmd + '\n' })
        const t0 = Date.now()
        while (Date.now() - t0 < 120000 && !out.includes('==SELESAI==')) await new Promise((r) => setTimeout(r, 500))
        console.log(out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\r/g, ''))
        if (!out.includes('==SELESAI==')) { console.error('[FAIL] timeout nunggu output'); await cleanup(); process.exit(1) }
        const clean = out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\r\n/g, '\n')
        const checks = [
          ['Ubuntu 24.04', /PRETTY_NAME="Ubuntu 24\.04/, clean],
          ['root uid=0', /==ID==\n0\n/, clean],
          ['apt ada', /\/usr\/bin\/apt\b/, clean],
          ['gcc ada', /\/usr\/bin\/gcc/, clean],
          ['python3 ada', /\/usr\/bin\/python3/, clean],
          ['figlet terinstall via apt', /U.*?B.*?U.*?N.*?T.*?U/m, clean],
        ]
        let allOk = true
        for (const [name, re] of checks) {
          const ok = re.test(clean)
          console.log(`[${ok ? 'OK' : 'FAIL'}] ${name}`)
          if (!ok) allOk = false
        }
        await cleanup()
        process.exit(allOk ? 0 : 1)
      })
    } catch (e) { await cleanup(); fail(e.message) }
  })
})
