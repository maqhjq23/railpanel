'use client'

// ConsoleView — console gaya Pterodactyl: pane LOG terpisah dari baris INPUT.
// Terminal di server tetap PTY asli; cuma cara tampil & input yang diubah.
import { useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowDown, CornerDownLeft, Power } from 'lucide-react'

// ---------- palet warna ANSI (16 + 256 color) ----------
const BASIC16 = ['#3f3f46', '#f87171', '#34d399', '#fbbf24', '#60a5fa', '#c084fc', '#22d3ee', '#e4e4e7']
const BRIGHT16 = ['#71717a', '#fca5a5', '#6ee7b7', '#fde68a', '#93c5fd', '#d8b4fe', '#67e8f9', '#fafafa']
const BG16 = ['#18181b', '#450a0a', '#14532d', '#713f12', '#172554', '#3b0764', '#164e63', '#27272a']
const BGBRIGHT16 = ['#27272a', '#7f1d1d', '#166534', '#854d0e', '#1e40af', '#6b21a8', '#155e75', '#3f3f46']

function sgr256(n: number): string {
  if (n < 16) return n < 8 ? BASIC16[n] : BRIGHT16[n - 8]
  if (n < 232) {
    const i = n - 16
    const v = (x: number) => (x === 0 ? 0 : 55 + x * 40)
    return `rgb(${v(Math.floor(i / 36))},${v(Math.floor((i % 36) / 6))},${v(i % 6)})`
  }
  const g = 8 + (n - 232) * 10
  return `rgb(${g},${g},${g})`
}

// ---------- ANSI -> HTML (toleran chunk terpotong di tengah escape) ----------
class AnsiToHtml {
  private pending = ''
  private fg = ''
  private bg = ''
  private bold = false
  private dim = false
  private italic = false
  private underline = false
  private openSig = ''

  private reset() {
    this.fg = ''
    this.bg = ''
    this.bold = false
    this.dim = false
    this.italic = false
    this.underline = false
  }

  private sig(): string {
    const parts: string[] = []
    if (this.fg) parts.push(`color:${this.fg}`)
    if (this.bg) parts.push(`background-color:${this.bg}`)
    if (this.bold) parts.push('font-weight:700')
    if (this.dim) parts.push('opacity:.65')
    if (this.italic) parts.push('font-style:italic')
    if (this.underline) parts.push('text-decoration:underline')
    return parts.join(';')
  }

  private applySgr(seq: string) {
    if (seq === '' || seq === '0') {
      this.reset()
      return
    }
    const parts = seq.split(';').map((x) => (x === '' ? 0 : parseInt(x, 10)))
    let i = 0
    while (i < parts.length) {
      const p = parts[i]
      if (p === 0) this.reset()
      else if (p === 1) this.bold = true
      else if (p === 2) this.dim = true
      else if (p === 3) this.italic = true
      else if (p === 4) this.underline = true
      else if (p === 22) { this.bold = false; this.dim = false }
      else if (p === 23) this.italic = false
      else if (p === 24) this.underline = false
      else if (p >= 30 && p <= 37) this.fg = BASIC16[p - 30]
      else if (p === 39) this.fg = ''
      else if (p >= 40 && p <= 47) this.bg = BG16[p - 40]
      else if (p === 49) this.bg = ''
      else if (p >= 90 && p <= 97) this.fg = BRIGHT16[p - 90]
      else if (p >= 100 && p <= 107) this.bg = BGBRIGHT16[p - 100]
      else if (p === 38 || p === 48) {
        let color = ''
        if (parts[i + 1] === 5) {
          color = sgr256(parts[i + 2] ?? 0)
          i += 2
        } else if (parts[i + 1] === 2) {
          color = `rgb(${parts[i + 2] ?? 0},${parts[i + 3] ?? 0},${parts[i + 4] ?? 0})`
          i += 4
        }
        if (p === 38) this.fg = color
        else this.bg = color
      }
      i++
    }
  }

  private wrap(s: string): string {
    const sig = this.sig()
    if (sig === '') {
      if (this.openSig !== '') {
        this.openSig = ''
        return '</span>' + s
      }
      return s
    }
    if (sig !== this.openSig) {
      let out = ''
      if (this.openSig !== '') out += '</span>'
      out += `<span style="${sig}">`
      this.openSig = sig
      return out + s
    }
    return s
  }

  private text(t: string): string {
    if (!t) return ''
    const esc = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const norm = esc.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    return this.wrap(norm)
  }

  feed(chunk: string): string {
    this.pending += chunk
    // buang OSC (judul tab terminal dll)
    this.pending = this.pending.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    let out = ''
    const re = /\x1b\[([0-9;]*)([a-zA-Z])/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(this.pending))) {
      out += this.text(this.pending.slice(last, m.index))
      if (m[2] === 'm') this.applySgr(m[1])
      last = m.index + m[0].length
    }
    let tail = this.pending.slice(last)
    // escape yang kepotong di ujung chunk ditahan buat feed berikutnya
    const incomplete = /(?:\x1b\[[0-9;?]*|\x1b\]|\x1b)$/.exec(tail)
    if (incomplete) {
      this.pending = incomplete[0]
      tail = tail.slice(0, tail.length - incomplete[0].length)
    } else {
      this.pending = ''
    }
    out += this.text(tail)
    return out
  }
}

const MAX_LOG_HTML = 200 * 1024 // batas log di browser (biar gak bengkak)

export default function ConsoleView({
  socket,
  serverId,
  active,
}: {
  socket: any
  serverId: string
  active: boolean
}) {
  const logRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const ansiRef = useRef<AnsiToHtml | null>(null)
  const htmlRef = useRef('')
  const rafRef = useRef<number | null>(null)
  const historyRef = useRef<string[]>([])
  const [logHtml, setLogHtml] = useState('')
  const [connected, setConnected] = useState(false)
  const [value, setValue] = useState('')
  const [histIdx, setHistIdx] = useState<number | null>(null)
  const [showJump, setShowJump] = useState(false)

  function pushHtml(chunk: string) {
    const ansi = ansiRef.current
    if (!ansi) return
    htmlRef.current = (htmlRef.current + ansi.feed(chunk)).slice(-MAX_LOG_HTML)
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        setLogHtml(htmlRef.current)
      })
    }
  }

  useEffect(() => {
    if (!active) return
    let disposed = false

    const onOut = ({ id, data }: { id: string; data: string }) => {
      if (id === serverId) pushHtml(data)
    }
    const onClosed = ({ id }: { id: string }) => {
      if (id === serverId) {
        pushHtml('\n\x1b[33m[RailPanel] terminal dimatikan — tekan Start buat nyalain lagi.\x1b[0m\n')
        setConnected(false)
      }
    }
    socket.on('term:out', onOut)
    socket.on('term:closed', onClosed)

    // attach = ikut room + dapet replay backlog (terminal dijamin aktif oleh prop).
    // Reset log dilakuin DI CALLBACK (bukan body effect) biar gak cascading render.
    socket.emit('terminal:attach', { id: serverId }, (res: { ok: boolean; backlog?: string; error?: string }) => {
      if (disposed) return
      ansiRef.current = new AnsiToHtml()
      htmlRef.current = ''
      stickRef.current = true
      setShowJump(false)
      setLogHtml('')
      if (res?.ok) {
        if (res.backlog) pushHtml(res.backlog)
        else pushHtml('\x1b[32m[RailPanel] console aktif — ketik perintah di bawah.\x1b[0m\n')
        setConnected(true)
      } else {
        pushHtml(`\x1b[31m[gagal nyalain terminal: ${res?.error || 'unknown'}]\x1b[0m\n`)
      }
    })

    return () => {
      disposed = true
      socket.off('term:out', onOut)
      socket.off('term:closed', onClosed)
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [socket, serverId, active])

  // auto-scroll ke bawah selama user gak lagi scroll ke atas
  useEffect(() => {
    const el = logRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [logHtml])

  function sendLine() {
    if (!connected) return
    const line = value
    historyRef.current = [line, ...historyRef.current].slice(0, 100)
    setHistIdx(null)
    socket.emit('terminal:input', { id: serverId, data: line + '\n' })
    setValue('')
  }

  function sendCtrlC() {
    if (!connected) return
    socket.emit('terminal:input', { id: serverId, data: '\x03' })
  }

  function clearLog() {
    ansiRef.current = new AnsiToHtml()
    htmlRef.current = ''
    setLogHtml('')
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const h = historyRef.current
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!h.length) return
      const next = histIdx === null ? 0 : Math.min(histIdx + 1, h.length - 1)
      setHistIdx(next)
      setValue(h[next])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (histIdx === null) return
      const prev = histIdx - 1
      if (prev < 0) {
        setHistIdx(null)
        setValue('')
      } else {
        setHistIdx(prev)
        setValue(h[prev])
      }
    }
  }

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
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-zinc-500">
          Console gaya Pterodactyl — log &amp; input terpisah. Untuk program layar penuh (nano, htop) pindah mode{' '}
          <span className="font-semibold text-zinc-300">xTerm</span>.
        </p>
        <Badge variant="outline" className={connected ? 'border-emerald-700 text-emerald-400' : 'border-zinc-700 text-zinc-400'}>
          {connected ? 'TERHUBUNG' : 'MENGHUBUNGKAN...'}
        </Badge>
      </div>

      <div className="relative">
        <div
          ref={logRef}
          onScroll={() => {
            const el = logRef.current
            if (!el) return
            const stick = el.scrollHeight - el.scrollTop - el.clientHeight < 60
            stickRef.current = stick
            setShowJump(!stick)
          }}
          aria-label="Log console"
          className="h-[55vh] min-h-[320px] w-full overflow-y-auto rounded-lg border border-zinc-800 bg-[#0c0c0f] p-3 font-mono text-[12.5px] leading-relaxed break-words whitespace-pre-wrap text-zinc-200"
        >
          <div dangerouslySetInnerHTML={{ __html: logHtml }} />
        </div>
        {showJump && (
          <button
            onClick={() => {
              const el = logRef.current
              if (el) el.scrollTop = el.scrollHeight
            }}
            className="absolute right-5 bottom-3 flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900/90 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
            aria-label="Ke log terbaru"
          >
            <ArrowDown className="h-3.5 w-3.5" /> Log baru
          </button>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          sendLine()
        }}
        className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2"
      >
        <span className="font-mono text-sm font-bold text-emerald-400" aria-hidden="true">
          $
        </span>
        <Input
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setHistIdx(null)
          }}
          onKeyDown={onInputKeyDown}
          disabled={!connected}
          placeholder={connected ? 'Ketik perintah, Enter buat kirim...' : 'Terminal mati — tekan Start dulu'}
          className="min-w-[140px] flex-1 border-0 bg-transparent font-mono text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
          aria-label="Input perintah console"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <Button type="submit" size="sm" className="bg-emerald-600 hover:bg-emerald-500" disabled={!connected}>
          <CornerDownLeft className="h-4 w-4" /> Kirim
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={!connected} onClick={sendCtrlC} title="Kirim sinyal Ctrl+C">
          Ctrl+C
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={clearLog} title="Bersihin log di layar">
          Bersihkan
        </Button>
      </form>
      <p className="text-xs text-zinc-600">
        Riwayat perintah: panah ↑ / ↓ di kotak input. Log gak hilang pas pindah tab selama terminal masih aktif.
      </p>
    </div>
  )
}
