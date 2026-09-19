// =============================================================
// RailPanel Engine — socket.io handlers: servers CRUD, file ops,
// terminal (PTY via util-linux `script`), managed run processes.
// Plain .mjs supaya bisa jalan di bun (sandbox) & node (Railway).
// =============================================================
import { Server } from 'socket.io'
import { spawn } from 'child_process'
import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { COOKIE_NAME, verifyToken, parseCookies } from '../../lib/panel-auth.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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
const terminals = new Map() // id -> { proc, pty, clients:Set, backlog:string }
const runs = new Map() // id -> { proc, startedAt, status, exitCode, log:string[] }

const MAX_BACKLOG = 12 * 1024
const MAX_LOG_LINES = 600

function pushRing(arr, item, max) {
  arr.push(item)
  if (arr.length > max) arr.splice(0, arr.length - max)
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
    const run = runs.get(s.id)
    return {
      id: s.id,
      name: s.name,
      startCommand: s.startCommand || '',
      env: s.env || {},
      createdAt: s.createdAt,
      status: run && run.status === 'running' ? 'running' : 'stopped',
      startedAt: run && run.status === 'running' ? run.startedAt : null,
      terminalAlive: terminals.has(s.id),
    }
  })
}

// ---------------- terminal ----------------
function ensureTerminal(id) {
  let t = terminals.get(id)
  if (t && t.proc.exitCode === null && t.proc.signalCode === null) return t
  const dir = serverDir(id)
  const srv = findServer(id)
  const pty = hasScriptBin()
  let proc
  if (pty) {
    proc = spawn('script', ['-qfc', 'bash', '/dev/null'], { cwd: dir, env: buildEnv(srv || { id }) })
  } else {
    proc = spawn('bash', ['-i'], { cwd: dir, env: buildEnv(srv || { id }) })
  }
  t = { proc, pty, clients: new Set(), backlog: '' }
  terminals.set(id, t)
  const onData = (chunk) => {
    t.backlog = (t.backlog + chunk.toString('utf8')).slice(-MAX_BACKLOG)
    io?.to('term:' + id).emit('term:out', { id, data: chunk.toString('utf8') })
  }
  proc.stdout.on('data', onData)
  proc.stderr.on('data', onData)
  proc.on('exit', () => {
    io?.to('term:' + id).emit('term:closed', { id })
    terminals.delete(id)
  })
  return t
}

// ---------------- managed run ----------------
function broadcastStatus(id) {
  const run = runs.get(id)
  io?.to('srv:' + id).emit('run:status', {
    id,
    status: run && run.status === 'running' ? 'running' : 'stopped',
    exitCode: run ? run.exitCode ?? null : null,
    startedAt: run && run.status === 'running' ? run.startedAt : null,
  })
}

function appendRunLog(id, line) {
  const run = runs.get(id)
  if (run) pushRing(run.log, line, MAX_LOG_LINES)
  try {
    const logPath = path.join(serverDir(id), 'run.log')
    fs.appendFileSync(logPath, line + '\n')
    const st = fs.statSync(logPath)
    if (st.size > 2 * 1024 * 1024) {
      const content = fs.readFileSync(logPath, 'utf8')
      fs.writeFileSync(logPath, content.slice(-300 * 1024))
    }
  } catch { /* ignore */ }
  io?.to('srv:' + id).emit('run:out', { id, data: line })
}

function startRun(id) {
  const srv = findServer(id)
  if (!srv) return { ok: false, error: 'Server tidak ditemukan' }
  if (!srv.startCommand || !srv.startCommand.trim()) return { ok: false, error: 'Start command masih kosong (isi dulu di tab Pengaturan)' }
  const existing = runs.get(id)
  if (existing && existing.status === 'running') return { ok: false, error: 'Proses masih jalan' }
  const dir = serverDir(id)
  const proc = spawn('bash', ['-c', srv.startCommand], {
    cwd: dir,
    env: buildEnv(srv),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const run = { proc, startedAt: Date.now(), status: 'running', exitCode: null, log: [] }
  runs.set(id, run)
  proc.stdout.on('data', (d) => String(d).split(/\r?\n/).filter(Boolean).forEach((l) => appendRunLog(id, l)))
  proc.stderr.on('data', (d) => String(d).split(/\r?\n/).filter(Boolean).forEach((l) => appendRunLog(id, '[stderr] ' + l)))
  proc.on('exit', (code, sig) => {
    if (runs.get(id) === run) {
      run.status = 'stopped'
      run.exitCode = sig ? `SIG${sig}` : code
      appendRunLog(id, `[proses berhenti — code=${run.exitCode}]`)
      broadcastStatus(id)
    }
  })
  proc.unref()
  appendRunLog(id, `[start] $ ${srv.startCommand}`)
  broadcastStatus(id)
  return { ok: true }
}

function stopRun(id) {
  const run = runs.get(id)
  if (!run || run.status !== 'running') return { ok: false, error: 'Tidak ada proses jalan' }
  const pid = run.proc.pid
  try { process.kill(-pid, 'SIGTERM') } catch { try { run.proc.kill('SIGTERM') } catch { /* */ } }
  setTimeout(() => {
    try {
      process.kill(-pid, 0) // masih hidup?
      try { process.kill(-pid, 'SIGKILL') } catch { /* */ }
    } catch { /* sudah mati */ }
  }, 5000)
  appendRunLog(id, `[stop] SIGTERM dikirim ke grup proses ${pid}`)
  return { ok: true }
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
      cb?.({ ok: true, terminalBacklog: t ? t.backlog : '', runLog: runs.get(id)?.log || [] })
      broadcastStatus(id)
    })

    // ---- servers CRUD ----
    socket.on('servers:list', (...args) => {
      const cb = args.find((a) => typeof a === 'function') || (() => {})
      cb(listServersPublic())
    })

    socket.on('servers:create', (data, cb) => {
      const name = String(data?.name || '').trim()
      if (!name || name.length > 60) return cb({ ok: false, error: 'Nama server wajib (maks 60 karakter)' })
      const id = crypto.randomBytes(6).toString('hex')
      fs.mkdirSync(serverDir(id), { recursive: true })
      store.servers.push({
        id,
        name,
        startCommand: String(data?.startCommand || '').trim(),
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
      if (typeof data.startCommand === 'string') srv.startCommand = data.startCommand.trim()
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
      const run = runs.get(id)
      if (run && run.status === 'running') {
        try { process.kill(-run.proc.pid, 'SIGKILL') } catch { /* */ }
      }
      runs.delete(id)
      try { fs.rmSync(serverDir(id), { recursive: true, force: true }) } catch { /* */ }
      store.servers = store.servers.filter((s) => s.id !== id)
      saveStore()
      cb({ ok: true })
    })

    // ---- process power ----
    socket.on('process:start', ({ id }, cb) => cb(startRun(id)))
    socket.on('process:stop', ({ id }, cb) => cb(stopRun(id)))
    socket.on('process:logs', ({ id }, cb) => {
      const run = runs.get(id)
      cb({
        ok: true,
        log: run ? run.log : [],
        status: run && run.status === 'running' ? 'running' : 'stopped',
      })
    })

    // ---- files ----
    socket.on('files:list', async ({ id, path: rel = '.' }, cb) => {
      try {
        if (!findServer(id)) return cb({ ok: false, error: 'Server tidak ditemukan' })
        const target = safePath(id, rel)
        if (!target) return cb({ ok: false, error: 'Path tidak valid' })
        const entries = await fsp.readdir(target, { withFileTypes: true })
        const out = []
        for (const e of entries) {
          if (e.name === 'run.log' && (rel === '.' || rel === '')) continue
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

    // ---- terminal ----
    socket.on('terminal:attach', ({ id }, cb) => {
      if (!findServer(id)) return cb({ ok: false, error: 'Server tidak ditemukan' })
      socket.join('term:' + id)
      const t = ensureTerminal(id)
      cb({ ok: true, pty: t.pty, backlog: t.backlog })
    })

    socket.on('terminal:input', ({ id, data }) => {
      const t = terminals.get(id)
      if (!t) return
      try { t.proc.stdin.write(data) } catch { /* */ }
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
