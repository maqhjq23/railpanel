// RailPanel shared auth — dipakai Next API routes (TS) & engine (mjs)
import crypto from 'crypto'

export const COOKIE_NAME = 'tp_token'

export function getSecret() {
  return process.env.AUTH_SECRET || 'tp-default-secret-change-me'
}

export function getAdminPassword() {
  return process.env.ADMIN_PASSWORD || 'admin123'
}

export function expectedToken() {
  return crypto.createHmac('sha256', getSecret()).update('tp-admin-v1').digest('hex')
}

export function verifyToken(token) {
  if (typeof token !== 'string' || token.length !== 64) return false
  const exp = expectedToken()
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(exp))
  } catch {
    return false
  }
}

export function parseCookies(header) {
  const out = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim())
  }
  return out
}
