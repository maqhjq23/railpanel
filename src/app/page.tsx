'use client'

import { useEffect, useState } from 'react'
import LoginView from '@/components/panel/login-view'
import DashboardView from '@/components/panel/dashboard-view'
import ServerView from '@/components/panel/server-view'
import { createPanelSocket } from '@/lib/panel-client'
import { Loader2 } from 'lucide-react'

export default function Home() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [connected, setConnected] = useState(false)
  const [serverId, setServerId] = useState<string | null>(null)
  const [socket, setSocket] = useState<any>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (alive) setAuthed(!!d.authed)
      })
      .catch(() => {
        if (alive) setAuthed(false)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (authed !== true) return
    let s: any = null
    let disposed = false
    // dibuat via timer supaya tidak setState sinkron di body effect
    const t = setTimeout(() => {
      if (disposed) return
      s = createPanelSocket()
      setSocket(s)
      s.on('connect', () => setConnected(true))
      s.on('disconnect', () => setConnected(false))
      s.on('connect_error', (err: Error) => {
        if (err.message.includes('unauthorized')) setAuthed(false)
      })
    }, 0)
    return () => {
      disposed = true
      clearTimeout(t)
      if (s) s.disconnect()
    }
  }, [authed])

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    setServerId(null)
    setAuthed(false)
  }

  if (authed === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
          <p className="text-sm text-zinc-500">Memuat...</p>
        </div>
      </div>
    )
  }

  if (!authed) {
    return <LoginView onOk={() => setAuthed(true)} />
  }

  if (!socket || !connected) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
          <p className="text-sm text-zinc-500">Menyambungkan ke panel...</p>
        </div>
      </div>
    )
  }

  if (serverId) {
    return <ServerView socket={socket} serverId={serverId} onBack={() => setServerId(null)} />
  }

  return <DashboardView socket={socket} onOpen={setServerId} onLogout={logout} />
}
