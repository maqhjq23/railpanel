import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { COOKIE_NAME, getAdminPassword, expectedToken } from '@/lib/panel-auth'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const password = String(body?.password || '')
    const expected = getAdminPassword()
    const okPass =
      password.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(password), Buffer.from(expected))
    if (!okPass) {
      return NextResponse.json({ ok: false, error: 'Password salah' }, { status: 401 })
    }
    const res = NextResponse.json({ ok: true })
    res.cookies.set(COOKIE_NAME, expectedToken(), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    })
    return res
  } catch {
    return NextResponse.json({ ok: false, error: 'Request tidak valid' }, { status: 400 })
  }
}
