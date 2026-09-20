// E2E test RailPanel engine via socket.io client
import { io } from 'socket.io-client'
import fs from 'fs'

const token = process.env.RP_TOKEN || (fs.existsSync('/tmp/tp_cookie.txt')
  ? fs.readFileSync('/tmp/tp_cookie.txt', 'utf8').split('\n').find((l) => l.includes('tp_token')).trim().split(/\s+/).pop()
  : '')
const URL = process.env.RP_URL || 'http://127.0.0.1:3003'

function fail(msg) {
  console.error('[FAIL]', msg)
  process.exit(1)
}
function step(msg) {
  console.log('[OK]', msg)
}

// 1. tanpa cookie harus ditolak
const bad = io(URL, { forceNew: true, path: process.env.RP_WS_PATH || '/', transports: ['polling'], reconnection: false })
bad.on('connect_error', (err) => {
  // ditolak = lolos
  bad.close()
  step('koneksi tanpa cookie DITOLAK (unauthorized)')
  runMain()
})

function rpc(socket, event, payload, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout ' + event)), timeoutMs)
    socket.emit(event, payload, (res) => {
      clearTimeout(t)
      if (res && res.ok === false) reject(new Error(`${event}: ${res.error}`))
      else resolve(res)
    })
  })
}

async function runMain() {
  await new Promise((r) => setTimeout(r, 200))
  const socket = io(URL, { forceNew: true,
    path: process.env.RP_WS_PATH || '/',
    transports: ['polling'],
    extraHeaders: { Cookie: `tp_token=${token}` },
  })

  socket.on('connect_error', (err) => fail('connect_error: ' + err.message))

  socket.on('connect', async () => {
    try {
      // 2. create server (nama + description)
      const created = await rpc(socket, 'servers:create', {
        name: 'Tes E2E Bot',
        description: 'panel buat test otomatis',
      })
      const id = created.server.id
      if ((created.server.description || '') !== 'panel buat test otomatis') fail('description gak kesimpan')
      step('servers:create + description OK → ' + id)
      await rpc(socket, 'srv:join', { id })
      step('srv:join OK')

      // 3. file ops
      await rpc(socket, 'files:write', { id, path: 'bot.py', content: 'print("halo python")\n' })
      const list = await rpc(socket, 'files:list', { id, path: '.' })
      if (!list.entries.find((e) => e.name === 'bot.py')) fail('bot.py tidak ada di files:list')
      step('files:write + files:list OK')
      const read = await rpc(socket, 'files:read', { id, path: 'bot.py' })
      if (!read.content.includes('halo python')) fail('files:read content salah')
      step('files:read OK')

      // 4. terminal
      const termRes = await rpc(socket, 'terminal:attach', { id })
      if (!termRes.ok) fail('terminal:attach gagal')
      let termOut = ''
      const termDone = new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('terminal timeout, out=' + termOut)), 10000)
        socket.on('term:out', ({ data }) => {
          termOut += data
          if (termOut.includes('TES_TERMINAL_42')) {
            clearTimeout(t)
            resolve()
          }
        })
      })
      await new Promise((r) => setTimeout(r, 500))
      socket.emit('terminal:input', { id, data: 'echo TES_TERMINAL_$((40+2))\n' })
      await termDone
      step('terminal: input → PTY → output OK')

      // 5. status = terminal aktif, lalu Stop = terminal mati
      let listA = await rpc(socket, 'servers:list')
      const alive = listA.find((s) => s.id === id)
      if (!alive || alive.status !== 'running') fail('status harus running saat terminal aktif')
      if (alive.terminalAlive !== true) fail('terminalAlive harus true')
      step('status running saat terminal aktif OK')

      await rpc(socket, 'terminal:stop', { id })
      await new Promise((r) => setTimeout(r, 1000))
      const listB = await rpc(socket, 'servers:list')
      const dead = listB.find((s) => s.id === id)
      if (!dead || dead.status !== 'stopped') fail('status harus stopped setelah terminal:stop')
      if (dead.terminalAlive !== false) fail('terminalAlive harus false setelah stop')
      step('terminal:stop → status stopped OK')

      // 5b. servers:update description
      await rpc(socket, 'servers:update', { id, name: 'Tes E2E Bot', description: 'deskripsi baru', env: { FOO: 'bar' } })
      const listC = await rpc(socket, 'servers:list')
      const upd = listC.find((s) => s.id === id)
      if (!upd || upd.description !== 'deskripsi baru') fail('servers:update description gagal')
      if (!upd.env || upd.env.FOO !== 'bar') fail('servers:update env gagal')
      step('servers:update (nama/description/env) OK')

      // 6. cleanup + unauthorized create check
      await rpc(socket, 'servers:delete', { id })
      const after = await rpc(socket, 'servers:list')
      if (after.find((s) => s.id === id)) fail('server belum kehapus')
      step('servers:delete OK')

      console.log('\n=== E2E PASS — SEMUA FITUR ENGINE JALAN ===')
      socket.close()
      process.exit(0)
    } catch (e) {
      fail(e.message)
    }
  })
}
