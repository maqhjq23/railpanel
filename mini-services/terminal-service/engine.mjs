// =============================================================
// RailPanel Engine — socket.io handlers: servers CRUD, file ops,
// terminal (PTY asli via node-pty, fallback util-linux `script`).
// Plain .mjs supaya bisa jalan di bun (sandbox) & node (Railway).
// =============================================================
import { Server } from 'socket.io'
import { spawn } from 'child_process'
import { createRequire } from 'module'
import { StringDecoder } from 'string_decoder'
import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { COOKIE_NAME, verifyToken, parseCookies } from '../../lib/panel-auth.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// node-pty = PTY asli (bisa resize winsize, UTF-8 aman, echo bener).
// Kalau gagal ke-load (native build gagal), fallback ke util-linux `script`.
const require = createRequire(import.meta.url)
let nodePty = null
try { nodePty = require('node-pty') } catch { nodePty = null }

// ---- env fallback (sandbox: root .env mungkin gak kebaca otomatis) ----
function loadEnvFallback() {
  try {
    const envPath = path.resolve(__dirname, '../../.env')
    if (fs.existsSync(envPath)) {
      for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
        if (m && process.env[m[1]] === undefined) {
          process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
        }
      }
    }
  } catch { /* ignore */ }
}
loadEnvFallback()

export const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data')
const STORE_PATH = path.join(DATA_DIR, 'store.json')
const SERVERS_ROOT = path.join(DATA_DIR, 'servers')

function ensureDirs() {
  fs.mkdirSync(SERVERS_ROOT, { recursive: true })
}
ensureDirs()

// ---------------- store (JSON) ----------------
let store = { servers: [] }
try {
  if (fs.existsSync(STORE_PATH)) store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'))
} catch { store = { servers: [] } }
if (!Array.isArray(store.servers)) store.servers = []

function saveStore() {
  const tmp = STORE_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2))
  fs.renameSync(tmp, STORE_PATH)
}

function findServer(id) {
  return store.servers.find((s) => s.id === id)
}

function serverDir(id) {
  return path.join(SERVERS_ROOT, id)
}

function safePath(id, rel) {
  const base = path.resolve(serverDir(id))
  const target = path.resolve(base, rel || '.')
  if (target !== base && !target.startsWith(base + path.sep)) return null
  return target
}

// ---------------- runtime state ----------------
// Model RailPanel: 1 server = 1 folder + 1 terminal (PTY).
// Terminal AKTIF = PTY jalan, MATI = gak ada proses. Gak ada auto-run script.
const terminals = new Map() // id -> { proc, pty, clients:Set, backlog:string, ready:boolean, inputBuf:string[] }

// Backlog console: diputar ulang (replay) tiap kali user attach/buka tab,
// gaya scrollback console Pterodactyl.
const MAX_BACKLOG = 64 * 1024
// potong backlog mulai dari awal baris biar replay gak mulai di tengah escape sequence
function sliceBacklog(raw) {
  if (raw.length < MAX_BACKLOG) return raw
  let s = raw.slice(-MAX_BACKLOG)
  const nl = s.indexOf('\n')
  if (nl !== -1 && nl < MAX_BACKLOG / 2) s = s.slice(nl + 1)
  return s
}

function hasScriptBin() {
  return fs.existsSync('/usr/bin/script') || fs.existsSync('/bin/script') || fs.existsSync('/usr/local/bin/script')
}

function buildEnv(srv) {
  const env = { ...process.env }
  delete env.PORT // biar gak nimpa port app utama dari proses user
  if (srv.env && typeof srv.env === 'object') {
    for (const [k, v] of Object.entries(srv.env)) {
      if (k && typeof v === 'string') env[k] = v
    }
  }
  env.HOME = serverDir(srv.id)
  return env
}

function listServersPublic() {
  return store.servers.map((s) => {
    const active = terminals.has(s.id)
    return {
      id: s.id,
      name: s.name,
      description: s.description || '',
      env: s.env || {},
      createdAt: s.createdAt,
      status: active ? 'running' : 'stopped', // running = terminal aktif
      terminalAlive: active,
    }
  })
}

// ---------------- terminal ----------------
function ensureTerminal(id) {
  let t = terminals.get(id)
  if (t && !t.dead) return t
  const dir = serverDir(id)
  const srv = findServer(id)
  const env = buildEnv(srv || { id })
  const COLS = 80
  const ROWS = 24
  let proc
  if (nodePty) {
    // PTY asli: bisa resize, UTF-8 aman, line-discipline bener (echo gak dobel)
    proc = nodePty.spawn('bash', ['-i'], { name: 'xterm-256color', cols: COLS, rows: ROWS, cwd: dir, env })
    t = { proc, node: true, cols: COLS, rows: ROWS, backlog: '', ready: false, inputBuf: [], dead: false, clients: new Set() }
  } else {
    const pty = hasScriptBin()
    if (pty) proc = spawn('script', ['-qfc', 'bash', '/dev/null'], { cwd: dir, env })
    else proc = spawn('bash', ['-i'], { cwd: dir, env })
    t = { proc, node: false, cols: COLS, rows: ROWS, backlog: '', ready: false, inputBuf: [], dead: false, clients: new Set() }
  }
  terminals.set(id, t)
  const flushInput = () => {
    if (t.dead) return
    const buf = t.inputBuf.splice(0)
    for (const d of buf) writeTerm(t, d)
  }
  const onData = (chunk) => {
    if (!t.node) chunk = t.decoder.write(chunk) // gabungin UTF-8 yang kebelah antar chunk
    if (!t.ready) {
      // shell baru nembe output (prompt) = readline siap; kasih jeda kecil biar
      // echo line-discipline & readline gak tabrakan (mencegah echo dobel/kepotong)
      t.ready = true
      setTimeout(flushInput, 400)
    }
    t.backlog = sliceBacklog(t.backlog + chunk)
    io?.to('term:' + id).emit('term:out', { id, data: chunk })
  }
  // jaga-jaga: kalau shell gak pernah output, flush paksa setelah 3 detik
  setTimeout(() => { if (!t.ready) { t.ready = true; flushInput() } }, 3000)
  if (t.node) {
    proc.onData(onData)
    proc.onExit(() => onTermExit(id, t))
  } else {
    t.decoder = new StringDecoder('utf8')
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)
    proc.on('exit', () => onTermExit(id, t))
  }
  broadcastStatus(id)
  return t
}

function writeTerm(t, data) {
  try {
    if (t.node) t.proc.write(data)
    else t.proc.stdin.write(data)
  } catch { /* */ }
}

function onTermExit(id, t) {
  t.dead = true
  io?.to('term:' + id).emit('term:closed', { id })
  if (terminals.get(id) === t) terminals.delete(id)
  broadcastStatus(id)
}

function stopTerminal(id) {
  const t = terminals.get(id)
  if (!t) return { ok: false, error: 'Terminal emang lagi mati' }
  try { t.proc.kill('SIGHUP') } catch { /* */ }
  try { t.proc.kill('SIGTERM') } catch { /* */ }
  // jaga-jaga kalau gak mau mati juga
  setTimeout(() => {
    const cur = terminals.get(id)
    if (cur === t) { try { t.proc.kill('SIGKILL') } catch { /* */ } }
  }, 2500)
  return { ok: true }
}

// ---------------- status broadcast ----------------
// Status server = status terminalnya (running = terminal aktif)
function broadcastStatus(id) {
  io?.to('srv:' + id).emit('run:status', {
    id,
    status: terminals.has(id) ? 'running' : 'stopped',
  })
}

// ---------------- io instance ----------------
let io = null

export function attachEngine(httpServer, opts = {}) {
  io = new Server(httpServer, {
    path: opts.path || '/socket.io',
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 5 * 1024 * 1024,
  })
  // opsional: path tambahan (dev — client next dev pakai path '/' via proxy XTransformPort)
  if (opts.rootPath) io.attach(httpServer, { path: opts.rootPath, addTrailingSlash: false })

  io.use((socket, next) => {
    const cookies = parseCookies(socket.handshake.headers.cookie || '')
    if (verifyToken(cookies[COOKIE_NAME])) return next()
    next(new Error('unauthorized'))
  })

  io.on('connection', (socket) => {
    socket.on('srv:join', ({ id }, cb) => {
      if (!findServer(id)) return cb?.({ ok: false, error: 'Server tidak ditemukan' })
      socket.join('srv:' + id)
      const t = terminals.get(id)
      cb?.({ ok: true, terminalBacklog: t ? t.backlog : '' })
      broadcastStatus(id)
    })

    // ---- servers CRUD ----
    socket.on('servers:list', (...args) => {
      const cb = args.find((a) => typeof a === 'function') || (() => {})
      cb(listServersPublic())
    })

    socket.on('servers:create', (data, cb) => {
      const name = String(data?.name || '').trim()
      if (!name || name.length > 60) return cb({ ok: false, error: 'Nama panel wajib (maks 60 karakter)' })
      const id = crypto.randomBytes(6).toString('hex')
      fs.mkdirSync(serverDir(id), { recursive: true })
      store.servers.push({
        id,
        name,
        description: String(data?.description || '').trim().slice(0, 300),
        env: data?.env && typeof data.env === 'object' ? data.env : {},
        createdAt: new Date().toISOString(),
      })
      saveStore()
      cb({ ok: true, server: listServersPublic().find((s) => s.id === id) })
    })

    socket.on('servers:update', (data, cb) => {
      const srv = findServer(data?.id)
      if (!srv) return cb({ ok: false, error: 'Server tidak ditemukan' })
      if (typeof data.name === 'string' && data.name.trim()) srv.name = data.name.trim().slice(0, 60)
      if (typeof data.description === 'string') srv.description = data.description.trim().slice(0, 300)
      if (data.env && typeof data.env === 'object') {
        const clean = {}
        for (const [k, v] of Object.entries(data.env)) {
          if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && typeof v === 'string') clean[k] = v
        }
        srv.env = clean
      }
      saveStore()
      cb({ ok: true, server: listServersPublic().find((s) => s.id === data.id) })
    })

    socket.on('servers:delete', ({ id }, cb) => {
      const srv = findServer(id)
      if (!srv) return cb({ ok: false, error: 'Server tidak ditemukan' })
      const t = terminals.get(id)
      if (t) { try { t.proc.kill('SIGKILL') } catch { /* */ } terminals.delete(id) }
      try { fs.rmSync(serverDir(id), { recursive: true, force: true }) } catch { /* */ }
      store.servers = store.servers.filter((s) => s.id !== id)
      saveStore()
      cb({ ok: true })
    })

    // ---- terminal power (Start/Stop di header) ----
    socket.on('terminal:stop', ({ id }, cb) => cb(stopTerminal(id)))

    // ---- files ----
    socket.on('files:list', async ({ id, path: rel = '.' }, cb) => {
      try {
        if (!findServer(id)) return cb({ ok: false, error: 'Server tidak ditemukan' })
        const target = safePath(id, rel)
        if (!target) return cb({ ok: false, error: 'Path tidak valid' })
        const entries = await fsp.readdir(target, { withFileTypes: true })
        const out = []
        for (const e of entries) {
          if (e.name === 'run.log' && (rel === '.' || rel === '')) continue // sisa data lama
          try {
            const st = await fsp.stat(path.join(target, e.name))
            out.push({ name: e.name, type: e.isDirectory() ? 'dir' : 'file', size: st.size, mtime: st.mtimeMs })
          } catch {
            out.push({ name: e.name, type: e.isDirectory() ? 'dir' : 'file', size: 0, mtime: 0 })
          }
        }
        out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
        cb({ ok: true, entries: out, cwd: rel })
      } catch (err) {
        cb({ ok: false, error: err.message })
      }
    })

    socket.on('files:read', async ({ id, path: rel }, cb) => {
      try {
        const target = safePath(id, rel)
        if (!target) return cb({ ok: false, error: 'Path tidak valid' })
        const st = await fsp.stat(target)
        if (st.size > 2 * 1024 * 1024) return cb({ ok: false, error: 'File terlalu besar untuk diedit (maks 2MB)' })
        cb({ ok: true, content: await fsp.readFile(target, 'utf8') })
      } catch (err) {
        cb({ ok: false, error: err.message })
      }
    })

    socket.on('files:write', async ({ id, path: rel, content }, cb) => {
      try {
        const target = safePath(id, rel)
        if (!target) return cb({ ok: false, error: 'Path tidak valid' })
        await fsp.mkdir(path.dirname(target), { recursive: true })
        await fsp.writeFile(target, String(content ?? ''), 'utf8')
        cb({ ok: true })
      } catch (err) {
        cb({ ok: false, error: err.message })
      }
    })

    socket.on('files:mkdir', async ({ id, path: rel }, cb) => {
      try {
        const target = safePath(id, rel)
        if (!target) return cb({ ok: false, error: 'Path tidak valid' })
        await fsp.mkdir(target, { recursive: true })
        cb({ ok: true })
      } catch (err) {
        cb({ ok: false, error: err.message })
      }
    })

    socket.on('files:delete', async ({ id, path: rel }, cb) => {
      try {
        const target = safePath(id, rel)
        const base = path.resolve(serverDir(id))
        if (!target || target === base) return cb({ ok: false, error: 'Path tidak valid' })
        await fsp.rm(target, { recursive: true, force: true })
        cb({ ok: true })
      } catch (err) {
        cb({ ok: false, error: err.message })
      }
    })

    socket.on('files:rename', async ({ id, from, to }, cb) => {
      try {
        const fromP = safePath(id, from)
        const toP = safePath(id, to)
        if (!fromP || !toP) return cb({ ok: false, error: 'Path tidak valid' })
        await fsp.rename(fromP, toP)
        cb({ ok: true })
      } catch (err) {
        cb({ ok: false, error: err.message })
      }
    })

    // ---- files: arsip (extract/zip) & pindah (multi-select) ----
    function runCmd(cmd, args, cwd, timeoutMs = 90000) {
      return new Promise((resolve) => {
        const p = spawn(cmd, args, { cwd, env: { ...process.env, HOME: cwd } })
        let out = ''
        let err = ''
        let done = false
        const finish = (res) => { if (!done) { done = true; clearTimeout(t); resolve(res) } }
        const t = setTimeout(() => { try { p.kill('SIGKILL') } catch {}; finish({ ok: false, error: 'Proses timeout' }) }, timeoutMs)
        p.stdout.on('data', (d) => { out += d; if (out.length > 8000) out = out.slice(-8000) })
        p.stderr.on('data', (d) => { err += d; if (err.length > 8000) err = err.slice(-8000) })
        p.on('error', (e) => finish({ ok: false, error: e.message, missing: e.code === 'ENOENT' }))
        p.on('close', (code) => finish({ ok: code === 0, code, out: out.trim(), err: err.trim() }))
      })
    }

    socket.on('files:extract', async ({ id, path: rel }, cb) => {
      try {
        const base = path.resolve(serverDir(id))
        const target = safePath(id, rel)
        if (!target || target === base) return cb({ ok: false, error: 'Path tidak valid' })
        const st = await fsp.stat(target).catch(() => null)
        if (!st || st.isDirectory()) return cb({ ok: false, error: 'Bukan file zip' })
        if (!/\.zip$/i.test(target)) return cb({ ok: false, error: 'Ekstensi harus .zip' })
        const dir = path.dirname(target)
        let r = await runCmd('unzip', ['-o', target, '-d', dir], dir)
        if (r.missing) r = await runCmd('python3', ['-m', 'zipfile', '-e', target, dir], dir)
        if (!r.ok) return cb({ ok: false, error: (r.err || r.error || 'Extract gagal').slice(0, 300) })
        cb({ ok: true })
      } catch (err) {
        cb({ ok: false, error: err.message })
      }
    })

    socket.on('files:zip', async ({ id, items, out }, cb) => {
      try {
        const base = path.resolve(serverDir(id))
        const outP = safePath(id, String(out || ''))
        if (!outP || outP === base) return cb({ ok: false, error: 'Nama arsip tidak valid' })
        if (!/\.zip$/i.test(outP)) return cb({ ok: false, error: 'Nama arsip harus berakhiran .zip' })
        if (!Array.isArray(items) || !items.length) return cb({ ok: false, error: 'Pilih file/folder dulu' })
        const rels = []
        for (const it of items) {
          const t = safePath(id, String(it))
          if (!t || t === base) return cb({ ok: false, error: 'Item tidak valid: ' + it })
          rels.push(path.relative(base, t))
        }
        await fsp.rm(outP, { force: true })
        let r = await runCmd('zip', ['-r', '-q', path.relative(base, outP), ...rels], base)
        if (r.missing) r = await runCmd('python3', ['-m', 'zipfile', '-c', path.relative(base, outP), ...rels], base)
        if (!r.ok) {
          await fsp.rm(outP, { force: true }).catch(() => {})
          return cb({ ok: false, error: (r.err || r.error || 'Kompres gagal').slice(0, 300) })
        }
        cb({ ok: true })
      } catch (err) {
        cb({ ok: false, error: err.message })
      }
    })

    // cari nama file/folder bebas di dir: "name (1)", "name (2)" ... (dipakai move
    // kalau di tujuan udah ada nama yang sama — mis. file "test" dinaikin ke /home
    // yang kebetulan udah punya FOLDER "test" → jangan error, rename "test (1)")
    async function freeName(dir, name) {
      const ext = path.extname(name)
      const stem = ext ? name.slice(0, -ext.length) : name
      for (let i = 1; i < 1000; i++) {
        const cand = path.join(dir, `${stem} (${i})${ext}`)
        if (!(await fsp.stat(cand).catch(() => null))) return cand
      }
      return null
    }

    socket.on('files:move', async ({ id, items, dest }, cb) => {
      try {
        const base = path.resolve(serverDir(id))
        const destP = safePath(id, String(dest || ''))
        if (!destP) return cb({ ok: false, error: 'Folder tujuan tidak valid' })
        const dst = await fsp.stat(destP).catch(() => null)
        if (!dst || !dst.isDirectory()) return cb({ ok: false, error: 'Folder tujuan gak ada' })
        if (!Array.isArray(items) || !items.length) return cb({ ok: false, error: 'Pilih item dulu' })
        let moved = 0
        const renamed = []
        for (const it of items) {
          const t = safePath(id, String(it))
          if (!t || t === base) return cb({ ok: false, error: 'Item tidak valid: ' + it })
          if (destP === t || destP.startsWith(t + path.sep)) return cb({ ok: false, error: 'Gak bisa mindahin folder ke dalam dirinya sendiri' })
          let target = path.join(destP, path.basename(t))
          if (target !== t && (await fsp.stat(target).catch(() => null))) {
            // bentrok nama di tujuan → auto-rename "nama (1)" (keep both), bukan error
            const free = await freeName(destP, path.basename(t))
            if (!free) return cb({ ok: false, error: `Gak ada nama bebas buat ${path.basename(t)}` })
            renamed.push(`${path.basename(t)} → ${path.basename(free)}`)
            target = free
          }
          if (target === t) { moved++; continue }
          try {
            await fsp.rename(t, target)
          } catch (e) {
            if (e.code === 'EXDEV') {
              await fsp.cp(t, target, { recursive: true })
              await fsp.rm(t, { recursive: true, force: true })
            } else {
              return cb({ ok: false, error: `Gagal pindah ${path.basename(t)}: ${e.message}` })
            }
          }
          moved++
        }
        cb({ ok: true, moved, renamed })
      } catch (err) {
        cb({ ok: false, error: err.message })
      }
    })

    // ---- terminal ----
    socket.on('terminal:attach', ({ id }, cb) => {
      if (!findServer(id)) return cb({ ok: false, error: 'Server tidak ditemukan' })
      socket.join('term:' + id)
      const t = ensureTerminal(id)
      cb({ ok: true, pty: true, node: !!t.node, cols: t.cols, rows: t.rows, backlog: t.backlog })
    })

    socket.on('terminal:input', ({ id, data }) => {
      const t = terminals.get(id)
      if (!t) return
      // shell belum siap (baru di-spawn): antri dulu, jangan langsung ditulis
      if (!t.ready) {
        if (t.inputBuf.length < 64) t.inputBuf.push(String(data))
        return
      }
      writeTerm(t, String(data))
    })

    // sinkronin winsize PTY sama ukuran layar xterm di browser
    socket.on('terminal:resize', ({ id, cols, rows }, cb) => {
      const t = terminals.get(id)
      if (!t) return cb?.({ ok: false, error: 'Terminal mati' })
      const c = Math.max(2, Math.min(500, Math.floor(Number(cols)) || t.cols))
      const r = Math.max(2, Math.min(300, Math.floor(Number(rows)) || t.rows))
      try {
        if (t.node) {
          if (c !== t.cols || r !== t.rows) { t.cols = c; t.rows = r; t.proc.resize(c, r) }
          cb?.({ ok: true })
        } else {
          // fallback `script`: winsize gak bisa diubah (keterbatasan wrapper)
          cb?.({ ok: true, fixed: true })
        }
      } catch (e) {
        cb?.({ ok: false, error: e?.message || 'resize gagal' })
      }
    })

    socket.on('disconnecting', () => {
      for (const room of socket.rooms) {
        if (room.startsWith('term:')) {
          const t = terminals.get(room.slice(5))
          if (t) t.clients.delete(socket.id)
        }
      }
    })
  })

  return io
}

export function getDataDir() {
  return DATA_DIR
}
