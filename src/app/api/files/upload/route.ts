import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import fsp from 'fs/promises'
import path from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { createWriteStream } from 'fs'
import { COOKIE_NAME, verifyToken } from '@/lib/panel-auth'

export const runtime = 'nodejs'

const MAX_FILE_BYTES = 200 * 1024 * 1024 // 200MB per file
const MAX_TOTAL_FILES = 20 // per request

function dataDir() {
  return process.env.DATA_DIR || path.join(process.cwd(), 'data')
}

function safePath(serverId: string, rel: string) {
  const base = path.resolve(dataDir(), 'servers', serverId)
  const target = path.resolve(base, rel || '.')
  if (target !== base && !target.startsWith(base + path.sep)) return null
  return target
}

async function serverExists(serverId: string) {
  try {
    const store = JSON.parse(await fsp.readFile(path.join(dataDir(), 'store.json'), 'utf8'))
    return Array.isArray(store?.servers) && store.servers.some((s: any) => s?.id === serverId)
  } catch {
    return false
  }
}

function isFileObj(x: unknown): x is File {
  return typeof x === 'object' && x !== null && 'arrayBuffer' in x && 'stream' in x
}

export async function POST(req: NextRequest) {
  const store = await cookies()
  if (!verifyToken(store.get(COOKIE_NAME)?.value || '')) {
    return NextResponse.json({ ok: false, error: 'Belum login' }, { status: 401 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ ok: false, error: 'Payload upload tidak valid' }, { status: 400 })
  }

  const serverId = String(form.get('server') || '')
  const rel = String(form.get('path') || '.')
  if (!/^[a-f0-9]{12}$/.test(serverId)) {
    return NextResponse.json({ ok: false, error: 'Server tidak valid' }, { status: 400 })
  }
  if (!(await serverExists(serverId))) {
    return NextResponse.json({ ok: false, error: 'Server tidak ditemukan' }, { status: 404 })
  }

  const base = safePath(serverId, rel)
  if (!base) {
    return NextResponse.json({ ok: false, error: 'Path tidak valid' }, { status: 400 })
  }
  try {
    const st = await fsp.stat(base)
    if (!st.isDirectory()) {
      return NextResponse.json({ ok: false, error: 'Tujuan bukan folder' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'Folder tujuan gak ada' }, { status: 400 })
  }

  const files = form.getAll('files').filter(isFileObj)
  if (!files.length) {
    return NextResponse.json({ ok: false, error: 'Gak ada file yang dikirim' }, { status: 400 })
  }
  if (files.length > MAX_TOTAL_FILES) {
    return NextResponse.json({ ok: false, error: `Maks ${MAX_TOTAL_FILES} file per upload` }, { status: 400 })
  }

  let saved = 0
  for (const file of files) {
    // nama file: buang path component, cegah escape folder
    const safeName = path.basename(file.name || '').replace(/[\u0000-\u001f]/g, '').trim()
    if (!safeName || safeName === '.' || safeName === '..') {
      return NextResponse.json({ ok: false, error: `Nama file tidak valid: ${file.name}` }, { status: 400 })
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { ok: false, error: `${safeName} terlalu besar (maks 200MB)` },
        { status: 413 },
      )
    }
    const target = path.join(base, safeName)
    if (target !== base && !target.startsWith(base + path.sep)) {
      return NextResponse.json({ ok: false, error: 'Path file tidak valid' }, { status: 400 })
    }
    try {
      const nodeStream = Readable.fromWeb(file.stream() as any)
      await pipeline(nodeStream, createWriteStream(target, { flags: 'w' }))
      saved++
    } catch (err) {
      await fsp.rm(target, { force: true }).catch(() => {})
      return NextResponse.json(
        { ok: false, error: `Gagal simpan ${safeName}: ${(err as Error).message}` },
        { status: 500 },
      )
    }
  }

  return NextResponse.json({ ok: true, saved })
}
