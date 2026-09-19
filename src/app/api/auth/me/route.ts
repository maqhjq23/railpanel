import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { COOKIE_NAME, verifyToken } from '@/lib/panel-auth'

export const runtime = 'nodejs'

export async function GET() {
  const store = await cookies()
  const token = store.get(COOKIE_NAME)?.value
  return NextResponse.json({ authed: verifyToken(token || '') })
}
