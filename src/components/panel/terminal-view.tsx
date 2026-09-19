'use client'

// TerminalView — xterm.js penuh (buat program layar penuh: nano, htop, vim).
// Scroll fix:
//   - scrollback 5000 + sync winsize PTY ↔ xterm (terminal:resize)
//   - fit ulang saat kontainer berubah (ResizeObserver / rotasi layar / webfont)
//   - swipe di HP bisa scroll (xterm gak punya touch scroll bawaan)
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
    let disposed = false
    let term: Terminal | null = null
    let ro: ResizeObserver | null = null
    let raf = 0
    let onWinResize: (() => void) | null = null
    let removeTouch: (() => void) | null = null

    const onOut = ({ id, data }: { id: string; data: string }) => {
      if (id === serverId && term) term.write(data)
    }
    const onClosed = ({ id }: { id: string }) => {
      if (id === serverId && term) {
        term.write('\r\n\x1b[33m[RailPanel] terminal dimatikan\x1b[0m\r\n')
        setConnected(false)
      }
    }

    async function init() {
      if (!containerRef.current) return
      const { FitAddon: Fit } = await import('@xterm/addon-fit')
      if (disposed) return
      term = new Terminal({
        fontSize: 13,
        fontFamily: 'Menlo, Monaco, "Cascadia Code", monospace',
        cursorBlink: true,
        convertEol: false,
        scrollback: 5000,
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

      const syncSize = () => {
        if (!term || disposed) return
        try { fit.fit() } catch { /* */ }
        try {
          socket.emit('terminal:resize', { id: serverId, cols: term.cols, rows: term.rows })
        } catch { /* */ }
      }
      syncSize()
      // metrik font bisa berubah setelah webfont siap → fit ulang
      document.fonts?.ready?.then(() => syncSize()).catch(() => {})
      onWinResize = syncSize
      window.addEventListener('resize', onWinResize)
      if ('ResizeObserver' in window && containerRef.current) {
        ro = new ResizeObserver(() => {
          if (raf) cancelAnimationFrame(raf)
          raf = requestAnimationFrame(syncSize)
        })
        ro.observe(containerRef.current)
      }

      term.onData((data) => {
        socket.emit('terminal:input', { id: serverId, data })
      })

      // ===== swipe scroll buat HP (wheel desktop udah ditangani xterm) =====
      const el = containerRef.current
      let lastY: number | null = null
      const cellH = () => {
        const d = (term as unknown as { dimensions?: { css?: { cell?: { height?: number } } } })
          ?.dimensions?.css?.cell?.height
        return d || 18
      }
      const touchStart = (e: TouchEvent) => {
        lastY = e.touches[0]?.clientY ?? null
      }
      const touchMove = (e: TouchEvent) => {
        if (lastY == null || !term) return
        const y = e.touches[0]?.clientY
        if (y == null) return
        const dy = lastY - y
        if (Math.abs(dy) >= cellH() / 2) {
          const lines = Math.max(-30, Math.min(30, Math.round(dy / (cellH() / 2))))
          term.scrollLines(lines)
          lastY = y
        }
        e.preventDefault()
      }
      el.addEventListener('touchstart', touchStart, { passive: true })
      el.addEventListener('touchmove', touchMove, { passive: false })
      removeTouch = () => {
        el.removeEventListener('touchstart', touchStart)
        el.removeEventListener('touchmove', touchMove)
      }

      socket.on('term:out', onOut)
      socket.on('term:closed', onClosed)

      // attach = ikut room + dapet backlog (terminal udah dijamin aktif oleh prop)
      socket.emit('terminal:attach', { id: serverId }, (res: { ok: boolean; backlog?: string; error?: string }) => {
        if (disposed || !term) return
        if (res?.ok) {
          if (res.backlog) term!.write(res.backlog)
          else term!.writeln('\x1b[32m[RailPanel] terminal aktif\x1b[0m')
          // samain winsize PTY sama xterm sekarang juga
          try {
            socket.emit('terminal:resize', { id: serverId, cols: term!.cols, rows: term!.rows })
          } catch { /* */ }
          setConnected(true)
        } else {
          term!.writeln(`\x1b[31m[gagal nyalain terminal: ${res?.error || 'unknown'}]\x1b[0m`)
        }
      })
    }

    void init()

    return () => {
      disposed = true
      socket.off('term:out', onOut)
      socket.off('term:closed', onClosed)
      ro?.disconnect()
      if (raf) cancelAnimationFrame(raf)
      if (onWinResize) window.removeEventListener('resize', onWinResize)
      removeTouch?.()
      term?.dispose()
      term = null
    }
  }, [socket, serverId, active])

  if (!active) {
    return (
      <div className="flex h-[60vh] min-h-[360px] w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-zinc-800 bg-[#0c0c0f]">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900">
          <Power className="h-5 w-5 text-zinc-500" />
        </div>
        <p className="font-medium text-zinc-200">Terminal mati</p>
      </div>
    )
  }

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="h-[60vh] min-h-[360px] w-full overflow-hidden rounded-lg border border-zinc-800 bg-[#0c0c0f] p-1"
        style={{ touchAction: 'none' }}
      />
      <Badge
        variant="outline"
        className={`absolute top-2.5 right-3 z-10 bg-zinc-950/80 backdrop-blur ${
          connected ? 'border-emerald-800 text-emerald-400' : 'border-zinc-700 text-zinc-400'
        }`}
      >
        {connected ? 'TERHUBUNG' : 'MENGHUBUNGKAN...'}
      </Badge>
    </div>
  )
}
