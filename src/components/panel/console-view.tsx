'use client'

// ConsoleView — log pane + input line terpisah (gaya console Pterodactyl).
// Renderer ANSI baris-per-baris:
//   - \r = tulis ulang baris (progress bar apt/curl/wget jadi rapi, gak numpuk)
//   - escape yang kebelah antar chunk ditahan, gak pernah bocor jadi teks
//   - log disimpan per BARIS (gak ada potongan HTML yang korup)
import { useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowDown, Power } from 'lucide-react'

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

const MAX_LINES = 2000 // scrollback log di browser (per baris, bukan per byte)

class AnsiToHtml {
  private pending = ''
  private fg = ''
  private bg = ''
  private bold = false
  private dim = false
  private italic = false
  private underline = false
  private openSig = ''
  private lines: string[] = []
  private cur = ''
  private pendingCR = false

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

  private openSpan() {
    const s = this.sig()
    if (s && s !== this.openSig) {
      if (this.openSig) this.cur += '</span>'
      this.cur += `<span style="${s}">`
      this.openSig = s
    }
  }

  private closeSpan() {
    if (this.openSig) {
      this.cur += '</span>'
      this.openSig = ''
    }
  }

  private pushLine() {
    this.closeSpan()
    this.lines.push(this.cur)
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES)
    this.cur = ''
  }

  private resetLine() {
    // \r = kursor balik ke kolom 0 → tulis ulang baris (gaya terminal asli)
    this.closeSpan()
    this.cur = ''
  }

  private writeText(t: string) {
    if (!t) return
    let out = ''
    // CR sifatnya malas: cuma efektif kalau ADA teks setelahnya (progress bar).
    // CR yang langsung disusul LF (\r\n) = newline biasa, baris gak dibuang.
    const flush = () => {
      if (!out) return
      if (this.pendingCR) {
        this.closeSpan()
        this.cur = ''
        this.pendingCR = false
      }
      this.openSpan()
      this.cur += out
      out = ''
    }
    for (const ch of t) {
      if (ch === '\n') { flush(); this.pendingCR = false; this.pushLine() }
      else if (ch === '\r') { flush(); this.pendingCR = true }
      else if (ch === '\x07' || ch === '\x08') { /* bell & backspace: skip */ }
      else {
        if (ch === '&') out += '&amp;'
        else if (ch === '<') out += '&lt;'
        else if (ch === '>') out += '&gt;'
        else out += ch
      }
    }
    flush()
  }

  feed(chunk: string): void {
    this.pending += chunk
    // buang OSC yang sudah lengkap (judul tab terminal dll)
    this.pending = this.pending.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    // CSI (semua final byte, termasuk [?2004h bracketed-paste dari bash), OSC,
    // ESC single-char, dan ESC ( X — semuanya dikenali & dibuang dengan bersih
    const re = /\x1b(?:\[([0-9;?]*)([@-~])|\]([^\x07\x1b]*)(?:\x07|\x1b\\)|([0-9=><@-Z\\])|([()][0-9A-Za-z]))/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(this.pending))) {
      this.writeText(this.pending.slice(last, m.index))
      if (m[1] !== undefined && m[2] === 'm') this.applySgr(m[1])
      last = re.lastIndex
    }
    let tail = this.pending.slice(last)
    // escape yang kepotong di ujung chunk ditahan buat feed berikutnya
    const i = tail.lastIndexOf('\x1b')
    if (i !== -1) {
      const rest = tail.slice(i)
      const done = /^(?:\x1b\[[0-9;?]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[0-9=><@-Z\\]|\x1b[()][0-9A-Za-z])/.test(rest)
      if (!done && rest.length <= 4096) {
        this.pending = rest
        tail = tail.slice(0, i)
      } else {
        // escape ngawur yang gak pernah selesai (OSC bengkak): buang prefix-nya
        this.pending = ''
        if (!done) tail = tail.slice(0, i)
      }
    } else {
      this.pending = ''
    }
    this.writeText(tail)
  }

  render(): string {
    return this.lines.join('\n') + this.cur
  }
}

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
  const rafRef = useRef<number | null>(null)
  const historyRef = useRef<string[]>([])
  const [logHtml, setLogHtml] = useState('')
  const [connected, setConnected] = useState(false)
  const [value, setValue] = useState('')
  const [histIdx, setHistIdx] = useState<number | null>(null)
  const [showJump, setShowJump] = useState(false)

  function scheduleRender() {
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        const ansi = ansiRef.current
        if (ansi) setLogHtml(ansi.render())
      })
    }
  }

  useEffect(() => {
    if (!active) return
    let disposed = false

    const onOut = ({ id, data }: { id: string; data: string }) => {
      if (id !== serverId) return
      ansiRef.current?.feed(data)
      scheduleRender()
    }
    const onClosed = ({ id }: { id: string }) => {
      if (id === serverId) {
        ansiRef.current?.feed('\n\x1b[33m[RailPanel] terminal dimatikan\x1b[0m\n')
        scheduleRender()
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
      stickRef.current = true
      setShowJump(false)
      setLogHtml('')
      if (res?.ok) {
        if (res.backlog) ansiRef.current.feed(res.backlog)
        else ansiRef.current.feed('\x1b[32m[RailPanel] console aktif\x1b[0m\n')
        scheduleRender()
        setConnected(true)
      } else {
        ansiRef.current.feed(`\x1b[31m[gagal nyalain terminal: ${res?.error || 'unknown'}]\x1b[0m\n`)
        scheduleRender()
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
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
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
        <Badge
          variant="outline"
          className={`absolute top-2.5 right-3 z-10 bg-zinc-950/80 backdrop-blur ${
            connected ? 'border-emerald-800 text-emerald-400' : 'border-zinc-700 text-zinc-400'
          }`}
        >
          {connected ? 'TERHUBUNG' : 'MENGHUBUNGKAN...'}
        </Badge>
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
        className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2"
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
          placeholder={connected ? 'Ketik perintah...' : 'Terminal mati'}
          className="min-w-[140px] flex-1 border-0 bg-transparent font-mono text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
          aria-label="Input perintah console"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </form>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" disabled={!connected} onClick={sendCtrlC}>
          Ctrl+C
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={clearLog}>
          Bersihkan
        </Button>
      </div>
    </div>
  )
}
