'use client'

import { io, Socket } from 'socket.io-client'

export type ServerInfo = {
  id: string
  name: string
  startCommand: string
  env: Record<string, string>
  createdAt: string
  status: 'running' | 'stopped'
  startedAt: number | null
  terminalAlive: boolean
}

export type FileEntry = {
  name: string
  type: 'dir' | 'file'
  size: number
  mtime: number
}

export function createPanelSocket(): Socket {
  const isDev = process.env.NODE_ENV === 'development'
  return io(isDev ? '/?XTransformPort=3003' : '/', {
    path: isDev ? '/' : '/socket.io',
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    timeout: 10000,
  })
}

// RPC via socket.io acknowledgement + timeout
export function rpc<T = unknown>(
  socket: Socket,
  event: string,
  payload?: unknown,
  timeoutMs = 15000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout — server gak jawab')), timeoutMs)
    const cb = (res: (T & { ok?: boolean; error?: string }) | undefined) => {
      clearTimeout(timer)
      if (res && typeof res === 'object' && 'ok' in res && res.ok === false) {
        reject(new Error(res.error || 'Terjadi kesalahan'))
      } else {
        resolve(res as T)
      }
    }
    // payload undefined HARUS di-emit tanpa argumen (kalau tidak, ack-nya salah posisi)
    if (payload === undefined) socket.emit(event, cb)
    else socket.emit(event, payload, cb)
  })
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })
}
