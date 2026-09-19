'use client'

import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { Badge } from '@/components/ui/badge'
import { Power } from 'lucide-react'

export default function TerminalView({
  socket,
  serverId,
  active,
}: {
  socket: any
  serverId: string
  active: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!active) {
      setConnected(false)
      return
    }
    let term: Terminal | null = null
    let disposed = false

    async function init() {
      if (!containerRef.current) return
      const { FitAddon: Fit } = await import('@xterm/addon-fit')
      term = new Terminal({
        fontSize: 13,
        fontFamily: 'Menlo, Monaco, "Cascadia Code", monospace',
        cursorBlink: true,
        convertEol: false,
        theme: {
          background: '#0c0c0f',
          foreground: '#e4e4e7',
          cursor: '#34d399',
          selectionBackground: '#3f3f46',
          black: '#18181b',
          red: '#f87171',
          green: '#34d399',
          yellow: '#fbbf24',
          blue: '#60a5fa',
          magenta: '#c084fc',
          cyan: '#22d3ee',
          white: '#e4e4e7',
        },
      })
      const fit = new Fit()
      term.loadAddon(fit)
      term.open(containerRef.current)
      try { fit.fit() } catch { /* */ }

      term.onData((data) => {
        socket.emit('terminal:input', { id: serverId, data })
      })

      const onOut = ({ id, data }: { id: string; data: string }) => {
        if (id === serverId && term) term.write(data)
      }
      const onClosed = ({ id }: { id: string }) => {
        if (id === serverId && term) {
          term.write('\r\n\x1b[33m[terminal dimatikan]\x1b[0m\r\n')
        }
      }
      socket.on('term:out', onOut)
      socket.on('term:closed', onClosed)

      // attach = ikut room + dapet backlog (terminal udah dijamin aktif oleh prop)
      socket.emit('terminal:attach', { id: serverId }, (res: { ok: boolean; backlog?: string; pty?: boolean; error?: string }) => {
        if (disposed) return
        if (res?.ok) {
          if (res.backlog) term!.write(res.backlog)
          else term!.writeln('\x1b[32m[RailPanel] terminal aktif. selamat menggunakan.\x1b[0m')
          setConnected(true)
        } else {
          term!.writeln(`\x1b[31m[gagal nyalain terminal: ${res?.error || 'unknown'}]\x1b[0m`)
        }
      })

      const onResize = () => { try { fit.fit() } catch { /* */ } }
      window.addEventListener('resize', onResize)
      return () => {
        window.removeEventListener('resize', onResize)
      }
    }

    const cleanup = init()

    return () => {
      disposed = true
      socket.off('term:out')
      socket.off('term:closed')
      term?.dispose()
      void cleanup
    }
  }, [socket, serverId, active])

  if (!active) {
    return (
      <div className="flex h-[60vh] min-h-[360px] w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-zinc-800 bg-[#0c0c0f]">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900">
          <Power className="h-5 w-5 text-zinc-500" />
        </div>
        <p className="font-medium text-zinc-200">Terminal mati</p>
        <p className="max-w-xs text-center text-sm text-zinc-500">
          Tekan tombol <span className="font-semibold text-emerald-400">Start</span> di kanan atas buat nyalain terminal.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">
          Shell biasa (bukan docker) — cwd: folder panel. <span className="hidden sm:inline">Ctrl+C jalan, program interaktif (nano, vim) jalan.</span>
        </p>
        <Badge variant="outline" className={connected ? 'border-emerald-700 text-emerald-400' : 'border-zinc-700 text-zinc-400'}>
          {connected ? 'TERHUBUNG' : 'MENGHUBUNGKAN...'}
        </Badge>
      </div>
      <div
        ref={containerRef}
        className="h-[60vh] min-h-[360px] w-full overflow-hidden rounded-lg border border-zinc-800 bg-[#0c0c0f] p-1"
      />
    </div>
  )
}
