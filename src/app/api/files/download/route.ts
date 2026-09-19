import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import fsp from 'fs/promises'
import path from 'path'
import { createReadStream } from 'fs'
import { Readable } from 'stream'
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

export async function GET(req: NextRequest) {
  const store = await cookies()
  if (!verifyToken(store.get(COOKIE_NAME)?.value || '')) {
    return NextResponse.json({ ok: false, error: 'Belum login' }, { status: 401 })
  }
  const serverId = req.nextUrl.searchParams.get('server') || ''
  const rel = req.nextUrl.searchParams.get('path') || ''
  if (!/^[a-f0-9]{12}$/.test(serverId)) {
    return NextResponse.json({ ok: false, error: 'Server tidak valid' }, { status: 400 })
  }
  const target = safePath(serverId, rel)
  if (!target) {
    return NextResponse.json({ ok: false, error: 'Path tidak valid' }, { status: 400 })
  }
  try {
    const st = await fsp.stat(target)
    if (st.isDirectory()) {
      return NextResponse.json({ ok: false, error: 'Yang ini folder, bukan file' }, { status: 400 })
    }
    const stream = Readable.toWeb(createReadStream(target)) as ReadableStream
    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(st.size),
        'Content-Disposition': `attachment; filename="${path.basename(target)}"`,
      },
    })
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 404 })
  }
}
