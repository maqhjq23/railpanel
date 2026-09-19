// E2E test RailPanel engine via socket.io client
import { io } from 'socket.io-client'
import fs from 'fs'

const cookieLine = fs.readFileSync('/tmp/tp_cookie.txt', 'utf8').split('\n').find((l) => l.includes('tp_token'))
const token = process.env.RP_TOKEN || cookieLine.trim().split(/\s+/).pop()
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
      // 2. create server
      const created = await rpc(socket, 'servers:create', {
        name: 'Tes E2E Bot',
        startCommand: 'echo halo dari proses && sleep 60',
      })
      const id = created.server.id
      step('servers:create → ' + id)
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

      // 5. managed process
      let runOut = ''
      const runDone = new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('run timeout, out=' + runOut)), 10000)
        socket.on('run:out', ({ data }) => {
          runOut += data
          if (runOut.includes('halo dari proses')) {
            clearTimeout(t)
            resolve()
          }
        })
      })
      await rpc(socket, 'process:start', { id })
      await runDone
      const logs = await rpc(socket, 'process:logs', { id })
      if (logs.status !== 'running') fail('status bukan running setelah start: ' + logs.status)
      step('process:start → log streaming OK (status running)')

      await rpc(socket, 'process:stop', { id })
      await new Promise((r) => setTimeout(r, 800))
      const logs2 = await rpc(socket, 'process:logs', { id })
      if (logs2.status === 'running') fail('masih running setelah stop')
      step('process:stop OK')

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
