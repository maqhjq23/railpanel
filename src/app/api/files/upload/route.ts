import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import fsp from 'fs/promises'
import path from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { COOKIE_NAME, verifyToken } from '@/lib/panel-auth'

export const runtime = 'nodejs'

function dataDir() {
  return process.env.DATA_DIR || path.join(process.cwd(), 'data')
}

function safePath(serverId: string, rel: string) {
  const base = path.resolve(dataDir(), 'servers', serverId)
  const target = path.resolve(base, rel || '.')
  if (target !== base && !target.startsWith(base + path.sep)) return null
  return target
}

async function authed() {
  const store = await cookies()
  return verifyToken(store.get(COOKIE_NAME)?.value || '')
}

export async function POST(req: NextRequest) {
  if (!(await authed())) {
    return NextResponse.json({ ok: false, error: 'Belum login' }, { status: 401 })
  }
  try {
    const form = await req.formData()
    const serverId = String(form.get('server') || '')
    const relDir = String(form.get('path') || '.')
    const files = form.getAll('files').filter((f): f is File => f instanceof File)
    if (!/^[a-f0-9]{12}$/.test(serverId)) {
      return NextResponse.json({ ok: false, error: 'Server tidak valid' }, { status: 400 })
    }
    const targetDir = safePath(serverId, relDir)
    if (!targetDir) {
      return NextResponse.json({ ok: false, error: 'Path tidak valid' }, { status: 400 })
    }
    await fsp.mkdir(targetDir, { recursive: true })
    let saved = 0
    for (const file of files) {
      const name = path.basename(file.name).replace(/[^\w.\- ()[\]]+/g, '_').slice(0, 120) || `file_${saved}`
      const dest = path.join(targetDir, name)
      // @ts-expect-error stream web -> node
      await pipeline(Readable.fromWeb(file.stream()), fsp.createWriteStream(dest))
      saved++
    }
    return NextResponse.json({ ok: true, saved })
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}
