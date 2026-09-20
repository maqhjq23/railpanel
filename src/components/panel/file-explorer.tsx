'use client'

// FileExplorer — file manager RailPanel.
// - Toolbar gaya "laci": bisa digeser horizontal kalau muat gak (HP).
// - Mode select (checkbox per item): tombol Pilih masuk mode yang sama;
//   bar aksi di bawahnya: Kompres, Move, Hapus, Extract + Batal.
// - Move: folder tujuan di-resolve gaya shell RELATIF terhadap folder sekarang
//   (".." naik, "docs" di sini, "/x" dari root) + preview Location di bawah input —
//   dulu dest dikirim mentah (dianggap dari root) makanya move sering gagal.
// - Tombol per item: file = edit/download/rename/hapus, folder = rename/hapus,
//   .zip = extract — extract SELALU lewat dialog konfirmasi dulu.
// - Editor: gutter nomor baris (virtualized, sinkron scroll) + textarea
//   no-wrap (teks panjang scroll horizontal, gak nembus batas) +
//   guard "perubahan belum disimpan" kalau ditutup dalam kondisi dirty.
// - GAK ada auto-focus: dialog kebuka gak dipaksa fokus ke input/textarea
//   (keyboard HP gak muncul sendiri). Fokus cuma lewat klik manual.
import { useCallback, useEffect, useRef, useState, type UIEvent as ReactUIEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { formatSize, formatTime, rpc, type FileEntry } from '@/lib/panel-client'
import {
  Archive,
  ChevronRight,
  Download,
  File as FileIcon,
  FilePlus2,
  FolderInput,
  FolderOutput,
  FolderPlus,
  Folder,
  ListChecks,
  Loader2,
  Pencil,
  SquarePen,
  Trash2,
  Upload,
} from 'lucide-react'

type DialogMode =
  | { kind: 'none' }
  | { kind: 'newFile' }
  | { kind: 'newFolder' }
  | { kind: 'rename'; from: string }
  | { kind: 'delete'; from: string }
  | { kind: 'edit'; from: string }
  | { kind: 'extract'; from?: string } // from = single (per-item); tanpa from = massal (sel)
  | { kind: 'delSel' }
  | { kind: 'zipOut' }
  | { kind: 'moveTo' }

const btnBar =
  'h-8 shrink-0 whitespace-nowrap border-zinc-800 bg-zinc-900 hover:bg-zinc-800'
const btnSel = 'h-8 shrink-0 whitespace-nowrap bg-emerald-600 hover:bg-emerald-500'

const ROW_H = 20 // px — HARUS match lineHeight editor & gutter
const LINE_STYLE = { lineHeight: '20px' }

export default function FileExplorer({ socket, serverId }: { socket: any; serverId: string }) {
  const [cwd, setCwd] = useState('.')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState<DialogMode>({ kind: 'none' })
  const [inputValue, setInputValue] = useState('')
  const [editContent, setEditContent] = useState('')
  const [origContent, setOrigContent] = useState('') // buat deteksi dirty
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [selMode, setSelMode] = useState<'none' | 'sel'>('none')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [gutStart, setGutStart] = useState(0)
  const [gutCount, setGutCount] = useState(60)
  const uploadRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const editRef = useRef<HTMLTextAreaElement>(null)
  const gutRef = useRef<HTMLDivElement>(null)
  const { toast } = useToast()

  const load = useCallback(
    async (dir: string = cwd) => {
      setLoading(true)
      try {
        const res = await rpc<{ entries: FileEntry[] }>(socket, 'files:list', { id: serverId, path: dir })
        setEntries(res.entries)
      } catch (e) {
        toast({ title: 'Gagal load file', description: (e as Error).message, variant: 'destructive' })
      } finally {
        setLoading(false)
      }
    },
    [socket, serverId, cwd, toast],
  )

  useEffect(() => {
    load(cwd)
  }, [cwd])

  // SENGAJA gak ada auto-focus: dulu dialog kebuka langsung fokus ke input/textarea
  // → keyboard HP langsung muncul nutupin setengah layar. Fokus cuma lewat klik manual
  // (mis. "Lanjut edit" di dialog discard).

  function join(dir: string, name: string) {
    return dir === '.' ? name : `${dir}/${name}`
  }

  // resolve input folder tujuan gaya shell, RELATIF terhadap folder sekarang:
  // ".." naik 1 level, "docs/a" turun, "/x" = dari root server, kosong = root.
  // Hasil = path relatif dari root server ('.' = root) — selalu di dalam server.
  function resolveDest(input: string, cwdRel: string): string {
    const raw = input.trim()
    if (raw === '') return '.'
    const cur = raw.startsWith('/') ? [] : cwdRel === '.' ? [] : cwdRel.split('/')
    for (const seg of raw.split('/')) {
      if (seg === '' || seg === '.') continue
      if (seg === '..') cur.pop()
      else cur.push(seg)
    }
    return cur.length ? cur.join('/') : '.'
  }

  // pindah folder SELALU lewat sini biar mode select ke-reset (gak boleh di effect body)
  function go(dir: string) {
    setSelMode('none')
    setSel(new Set())
    setCwd(dir)
  }

  function enterSelect(mode: 'none' | 'sel') {
    setSel(new Set())
    setSelMode(mode)
  }

  function toggleSel(p: string) {
    setSel((prev) => {
      const next = new Set(prev)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })
  }

  function isZip(e: FileEntry) {
    return e.type === 'file' && /\.zip$/i.test(e.name)
  }

  function isZipPath(p: string) {
    return /\.zip$/i.test(p.split('/').pop() || '')
  }

  function openFile(p: string) {
    rpc<{ content: string }>(socket, 'files:read', { id: serverId, path: p })
      .then((res) => {
        setInputValue('')
        setEditContent(res.content)
        setOrigContent(res.content)
        setGutStart(0)
        setGutCount(60)
        setDialog({ kind: 'edit', from: p })
      })
      .catch((e) => toast({ title: 'Gagal baca file', description: (e as Error).message, variant: 'destructive' }))
  }

  // tutup dialog utama — kalau editor dirty, minta konfirmasi dulu
  function closeMain() {
    if (dialog.kind === 'edit' && editContent !== origContent) {
      setConfirmDiscard(true)
    } else {
      setDialog({ kind: 'none' })
    }
  }

  async function submitDialog() {
    setBusy(true)
    try {
      if (dialog.kind === 'newFile') {
        await rpc(socket, 'files:write', { id: serverId, path: join(cwd, inputValue), content: '' })
      } else if (dialog.kind === 'newFolder') {
        await rpc(socket, 'files:mkdir', { id: serverId, path: join(cwd, inputValue) })
      } else if (dialog.kind === 'rename') {
        await rpc(socket, 'files:rename', { id: serverId, from: dialog.from, to: join(cwd, inputValue) })
      } else if (dialog.kind === 'delete') {
        await rpc(socket, 'files:delete', { id: serverId, path: dialog.from })
      } else if (dialog.kind === 'edit') {
        await rpc(socket, 'files:write', { id: serverId, path: dialog.from, content: editContent })
      } else if (dialog.kind === 'extract') {
        const targets = dialog.from
          ? [dialog.from]
          : Array.from(sel).filter((p) => isZipPath(p))
        let okN = 0
        let lastErr = ''
        for (const t of targets) {
          try {
            await rpc(socket, 'files:extract', { id: serverId, path: t })
            okN++
          } catch (err) {
            lastErr = (err as Error).message
          }
        }
        if (okN === 0) throw new Error(lastErr || 'Extract gagal')
        if (okN < targets.length) {
          toast({ title: `Extract sebagian (${okN}/${targets.length})`, description: lastErr, variant: 'destructive' })
        } else {
          toast({
            title: 'Extract sukses',
            description: targets.length === 1 ? targets[0].split('/').pop() : `${okN} arsip`,
          })
        }
        if (!dialog.from) enterSelect('none')
      } else if (dialog.kind === 'delSel') {
        const targets = Array.from(sel)
        let okN = 0
        let lastErr = ''
        for (const p of targets) {
          try {
            await rpc(socket, 'files:delete', { id: serverId, path: p })
            okN++
          } catch (err) {
            lastErr = (err as Error).message
          }
        }
        if (okN < targets.length) {
          toast({ title: `Hapus sebagian (${okN}/${targets.length})`, description: lastErr, variant: 'destructive' })
        }
        enterSelect('none')
      } else if (dialog.kind === 'zipOut') {
        await rpc(socket, 'files:zip', { id: serverId, items: Array.from(sel), out: join(cwd, inputValue) })
        enterSelect('none') // reset mode + seleksi
      } else if (dialog.kind === 'moveTo') {
        // dest di-resolve relatif terhadap folder sekarang (".." naik, dst).
        // Dulu dikirim mentah -> engine anggap dari root -> "Folder tujuan gak ada".
        const dest = resolveDest(inputValue, cwd)
        const n = sel.size
        const res = await rpc<{ moved?: number; renamed?: string[] }>(socket, 'files:move', { id: serverId, items: Array.from(sel), dest })
        const ren = res.renamed?.length ? ` · di-rename: ${res.renamed.join(', ')}` : ''
        toast({ title: 'Move sukses', description: `${n} item dipindah ke ${dest === '.' ? 'root' : '/' + dest}${ren}` })
        enterSelect('none')
      }
      setDialog({ kind: 'none' })
      await load()
    } catch (e) {
      toast({ title: 'Gagal', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  async function onUpload(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('server', serverId)
      fd.append('path', cwd)
      for (const f of Array.from(files)) fd.append('files', f)
      const res = await fetch('/api/files/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Upload gagal')
      toast({ title: 'Upload sukses', description: `${data.saved} file tersimpan` })
      await load()
    } catch (e) {
      toast({ title: 'Upload gagal', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setUploading(false)
      if (uploadRef.current) uploadRef.current.value = ''
    }
  }

  // sinkron gutter nomor baris ke scroll textarea + update rentang nomor yang dirender
  function onEditScroll(e: ReactUIEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget
    if (gutRef.current) gutRef.current.scrollTop = el.scrollTop
    const start = Math.max(0, Math.floor(el.scrollTop / ROW_H) - 10)
    const count = Math.ceil(el.clientHeight / ROW_H) + 30
    setGutStart((s) => (s === start ? s : start))
    setGutCount((c) => (c === count ? c : c))
  }

  const crumbs = cwd === '.' ? [] : cwd.split('/')
  const selecting = selMode !== 'none'
  const selPaths = Array.from(sel)
  const selZip = selPaths.filter((p) => isZipPath(p))
  const lineCount = dialog.kind === 'edit' ? Math.max(1, editContent.split('\n').length) : 1
  // preview lokasi tujuan move (gaya Ptero): ".." dari /home/contoh -> /home
  const moveResolved = dialog.kind === 'moveTo' ? resolveDest(inputValue, cwd) : null
  const moveLoc = moveResolved ? '/' + (moveResolved === '.' ? '' : moveResolved) : ''

  return (
    <div className="space-y-3">
      {/* breadcrumb */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 shrink-0 border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
          onClick={() => go(cwd.includes('/') ? cwd.split('/').slice(0, -1).join('/') || '.' : '.')}
          disabled={cwd === '.'}
        >
          <ChevronRight className="h-4 w-4 rotate-180" />
        </Button>
        <div className="min-w-0 flex-1 overflow-x-auto font-mono text-sm text-zinc-400 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button className="hover:text-emerald-400" onClick={() => go('.')}>/</button>
          {crumbs.map((c, i) => (
            <span key={i}>
              {' / '}
              <button
                className="hover:text-emerald-400"
                onClick={() => go(crumbs.slice(0, i + 1).join('/'))}
              >
                {c}
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* toolbar "laci": bisa digeser horizontal kalau gak muat */}
      <div className="overflow-x-auto [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-700 [&::-webkit-scrollbar]:h-1.5">
        <div className="flex w-max gap-2">
          <Button variant="outline" size="sm" className={btnBar} onClick={() => { setInputValue(''); setDialog({ kind: 'newFile' }) }}>
            <FilePlus2 className="h-4 w-4" /> File
          </Button>
          <Button variant="outline" size="sm" className={btnBar} onClick={() => { setInputValue(''); setDialog({ kind: 'newFolder' }) }}>
            <FolderPlus className="h-4 w-4" /> Folder
          </Button>
          <Button variant="outline" size="sm" className={btnBar} disabled={uploading} onClick={() => uploadRef.current?.click()}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload
          </Button>
          <Button
            variant={selecting ? 'default' : 'outline'}
            size="sm"
            className={selecting ? btnSel : btnBar}
            onClick={() => (selecting ? enterSelect('none') : enterSelect('sel'))}
          >
            <ListChecks className="h-4 w-4" /> Pilih
          </Button>
          <input
            ref={uploadRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => onUpload(e.target.files)}
          />
        </div>
      </div>

      {/* bar aksi mode select: Kompres / Move / Hapus / Extract / Batal */}
      {selecting && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-900/70 bg-emerald-950/30 px-3 py-2">
          <span className="text-xs font-medium text-emerald-300">
            {sel.size} dipilih{selZip.length > 0 ? ` · ${selZip.length} zip` : ''}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-zinc-800 bg-zinc-950"
              disabled={sel.size === 0 || busy}
              onClick={() => { setInputValue('arsip.zip'); setDialog({ kind: 'zipOut' }) }}
            >
              <Archive className="mr-1 h-4 w-4" /> Kompres
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-zinc-800 bg-zinc-950"
              disabled={sel.size === 0 || busy}
              onClick={() => { setInputValue(''); setDialog({ kind: 'moveTo' }) }}
            >
              <FolderInput className="mr-1 h-4 w-4" /> Move
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-zinc-800 bg-zinc-950 text-red-300 hover:bg-red-950/40 hover:text-red-200"
              disabled={sel.size === 0 || busy}
              onClick={() => setDialog({ kind: 'delSel' })}
            >
              <Trash2 className="mr-1 h-4 w-4" /> Hapus
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-zinc-800 bg-zinc-950 text-amber-300 hover:bg-amber-950/30 hover:text-amber-200"
              disabled={selZip.length === 0 || busy}
              onClick={() => setDialog({ kind: 'extract' })}
            >
              <FolderOutput className="mr-1 h-4 w-4" /> Extract
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-zinc-800 bg-zinc-950"
              onClick={() => enterSelect('none')}
            >
              Batal
            </Button>
          </div>
        </div>
      )}

      <ScrollArea className="h-[55vh] min-h-[320px] rounded-lg border border-zinc-800 bg-zinc-900/40">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
          </div>
        ) : entries.length === 0 ? (
          <p className="py-16 text-center text-sm text-zinc-600">Folder kosong — upload atau bikin file dulu.</p>
        ) : (
          <table className="w-full table-fixed text-sm">
            <tbody>
              {entries.map((e) => {
                const p = join(cwd, e.name)
                return (
                  <tr
                    key={e.name}
                    className={`group cursor-pointer border-b border-zinc-800/60 last:border-0 hover:bg-zinc-800/40 ${
                      sel.has(p) ? 'bg-emerald-950/30' : ''
                    }`}
                    onClick={() => {
                      if (selecting) toggleSel(p)
                      else if (e.type === 'dir') go(p)
                      else openFile(p)
                    }}
                  >
                    <td className="w-8 py-2 pl-3">
                      {selecting ? (
                        <Checkbox checked={sel.has(p)} className="pointer-events-none" />
                      ) : e.type === 'dir' ? (
                        <Folder className="h-4 w-4 text-amber-400" />
                      ) : (
                        <FileIcon className="h-4 w-4 text-zinc-500" />
                      )}
                    </td>
                    <td className="overflow-hidden py-2 pr-2">
                      <p className="truncate text-zinc-200">{e.name}</p>
                    </td>
                    <td className="hidden w-20 whitespace-nowrap py-2 pr-2 text-right text-xs text-zinc-600 sm:table-cell">
                      {formatSize(e.size)}
                    </td>
                    <td className="hidden w-28 whitespace-nowrap py-2 pr-2 text-right text-xs text-zinc-600 md:table-cell">
                      {e.mtime ? formatTime(e.mtime) : ''}
                    </td>
                    <td className="w-32 py-2 pr-2 text-right">
                      <div className="flex justify-end gap-0.5">
                        {!selecting && isZip(e) && (
                          <button
                            aria-label="Extract"
                            title="Extract zip"
                            disabled={busy}
                            className="rounded p-1 text-zinc-500 hover:bg-zinc-700/50 hover:text-amber-300"
                            onClick={(ev) => { ev.stopPropagation(); setDialog({ kind: 'extract', from: p }) }}
                          >
                            <FolderOutput className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {!selecting && e.type === 'file' && (
                          <button
                            aria-label="Edit"
                            title="Edit file"
                            className="rounded p-1 text-zinc-500 hover:bg-zinc-700/50 hover:text-sky-300"
                            onClick={(ev) => { ev.stopPropagation(); openFile(p) }}
                          >
                            <SquarePen className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {!selecting && (
                          <>
                            {e.type === 'file' && (
                              <a
                                href={`/api/files/download?server=${serverId}&path=${encodeURIComponent(p)}`}
                                onClick={(ev) => ev.stopPropagation()}
                                aria-label="Download"
                                title="Download"
                                className="rounded p-1 text-zinc-500 hover:bg-zinc-700/50 hover:text-emerald-400"
                              >
                                <Download className="h-3.5 w-3.5" />
                              </a>
                            )}
                            <button
                              aria-label="Rename"
                              title="Rename"
                              className="rounded p-1 text-zinc-500 hover:bg-zinc-700/50 hover:text-zinc-200"
                              onClick={(ev) => {
                                ev.stopPropagation()
                                setInputValue(e.name)
                                setDialog({ kind: 'rename', from: p })
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              aria-label="Hapus"
                              title="Hapus"
                              className="rounded p-1 text-zinc-500 hover:bg-zinc-700/50 hover:text-red-400"
                              onClick={(ev) => {
                                ev.stopPropagation()
                                setDialog({ kind: 'delete', from: p })
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </ScrollArea>

      {/* dialog utama: newFile/newFolder/rename/delete/delSel/edit/extract/zipOut/moveTo */}
      <Dialog open={dialog.kind !== 'none'} onOpenChange={(o) => { if (!o) closeMain() }}>
        {/* onOpenAutoFocus di-prevent: fokus bawaan Radix nyasar ke textarea/input
            (elemen fokusabel pertama) → keyboard HP langsung muncul pas dialog kebuka */}
        <DialogContent
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] overflow-hidden bg-zinc-900 text-zinc-100 sm:max-w-2xl"
        >
          {dialog.kind === 'delete' || dialog.kind === 'delSel' ? (
            <>
              <DialogHeader>
                <DialogTitle className="break-all">
                  {dialog.kind === 'delSel'
                    ? `Hapus ${sel.size} item terpilih?`
                    : dialog.kind === 'delete'
                      ? `Hapus ${dialog.from.split('/').pop()}?`
                      : ''}
                </DialogTitle>
              </DialogHeader>
              <p className="text-sm text-zinc-400">Yang dihapus gak bisa dikembalikan.</p>
              <DialogFooter>
                <Button variant="outline" className="border-zinc-800 bg-zinc-950" onClick={() => setDialog({ kind: 'none' })}>
                  Batal
                </Button>
                <Button variant="destructive" onClick={submitDialog} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Hapus'}
                </Button>
              </DialogFooter>
            </>
          ) : dialog.kind === 'extract' ? (
            <>
              <DialogHeader>
                <DialogTitle className="break-all">
                  {dialog.from
                    ? `Extract ${dialog.from.split('/').pop()}?`
                    : `Extract ${selZip.length} arsip terpilih?`}
                </DialogTitle>
              </DialogHeader>
              <p className="text-sm text-zinc-400">
                Isi arsip di-extract ke folder ini — file dengan nama yang sama bakal ke-overwrite.
              </p>
              <DialogFooter>
                <Button variant="outline" className="border-zinc-800 bg-zinc-950" onClick={() => setDialog({ kind: 'none' })}>
                  Batal
                </Button>
                <Button className="bg-emerald-600 hover:bg-emerald-500" onClick={submitDialog} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Extract'}
                </Button>
              </DialogFooter>
            </>
          ) : dialog.kind === 'edit' ? (
            <>
              <DialogHeader>
                <DialogTitle className="break-all font-mono text-base">{dialog.from}</DialogTitle>
              </DialogHeader>
              <div className="flex h-[55vh] min-h-[300px] w-full overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 focus-within:border-emerald-700">
                {/* gutter nomor baris — scrollTop disinkron dari textarea */}
                <div
                  ref={gutRef}
                  className="w-12 shrink-0 select-none overflow-hidden border-r border-zinc-800 bg-zinc-950 pt-3 text-right font-mono text-[12px] text-zinc-600"
                  style={LINE_STYLE}
                >
                  <div style={{ height: Math.max(lineCount, gutStart + gutCount) * ROW_H }}>
                    <div style={{ height: gutStart * ROW_H }} />
                    {Array.from({ length: gutCount }, (_, i) => {
                      const n = gutStart + i + 1
                      if (n > lineCount) return null
                      return (
                        <div key={n} className="pr-2" style={{ height: ROW_H }}>
                          {n}
                        </div>
                      )
                    })}
                  </div>
                </div>
                <textarea
                  ref={editRef}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  onScroll={onEditScroll}
                  wrap="off"
                  spellCheck={false}
                  className="h-full min-w-0 flex-1 resize-none overflow-auto whitespace-pre bg-transparent px-3 py-3 font-mono text-[12px] text-zinc-200 outline-none"
                  style={LINE_STYLE}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" className="border-zinc-800 bg-zinc-950" onClick={closeMain}>
                  Tutup
                </Button>
                <Button className="bg-emerald-600 hover:bg-emerald-500" onClick={submitDialog} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Simpan'}
                </Button>
              </DialogFooter>
            </>
          ) : dialog.kind === 'zipOut' || dialog.kind === 'moveTo' ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {dialog.kind === 'zipOut'
                    ? `Kompres ${sel.size} item jadi zip`
                    : `Pindah ${sel.size} item ke folder`}
                </DialogTitle>
              </DialogHeader>
              <Input
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && inputValue.trim() && submitDialog()}
                placeholder={dialog.kind === 'zipOut' ? 'arsip.zip' : 'folder tujuan — ".." naik, "docs" di sini, kosong = root'}
                className="bg-zinc-950 font-mono text-zinc-100 border-zinc-800"
              />
              {dialog.kind === 'moveTo' && (
                <p className="-mt-2 truncate font-mono text-xs text-zinc-500">
                  Location: <span className="text-emerald-400">{moveLoc}</span>
                </p>
              )}
              <DialogFooter>
                <Button variant="outline" className="border-zinc-800 bg-zinc-950" onClick={() => setDialog({ kind: 'none' })}>
                  Batal
                </Button>
                <Button
                  className="bg-emerald-600 hover:bg-emerald-500"
                  onClick={submitDialog}
                  disabled={busy || (dialog.kind === 'zipOut' && !inputValue.trim())}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : dialog.kind === 'zipOut' ? 'Kompres' : 'Move'}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="break-all">
                  {dialog.kind === 'newFile'
                    ? 'File baru'
                    : dialog.kind === 'newFolder'
                      ? 'Folder baru'
                      : dialog.kind === 'rename'
                        ? `Rename ${dialog.from.split('/').pop()}`
                        : ''}
                </DialogTitle>
              </DialogHeader>
              <Input
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && inputValue.trim() && submitDialog()}
                className="bg-zinc-950 border-zinc-800 font-mono"
              />
              <DialogFooter>
                <Button variant="outline" className="border-zinc-800 bg-zinc-950" onClick={() => setDialog({ kind: 'none' })}>
                  Batal
                </Button>
                <Button className="bg-emerald-600 hover:bg-emerald-500" onClick={submitDialog} disabled={busy || !inputValue.trim()}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'OK'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* dialog konfirmasi buang perubahan editor (di atas dialog edit) */}
      <Dialog open={confirmDiscard} onOpenChange={(o) => { if (!o) setConfirmDiscard(false) }}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md bg-zinc-900 text-zinc-100 sm:rounded-lg">
          <DialogHeader>
            <DialogTitle className="break-all">Perubahan belum disimpan</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-zinc-400">
            Teks udah diubah tapi belum disimpan. Kalau ditutup sekarang, semua perubahan hilang.
          </p>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              className="border-zinc-800 bg-zinc-950 text-red-300 hover:bg-red-950/40 hover:text-red-200"
              onClick={() => { setConfirmDiscard(false); setDialog({ kind: 'none' }) }}
              disabled={busy}
            >
              Buang perubahan
            </Button>
            <Button
              variant="outline"
              className="border-zinc-800 bg-zinc-950"
              onClick={() => { setConfirmDiscard(false); setTimeout(() => editRef.current?.focus(), 120) }}
              disabled={busy}
            >
              Lanjut edit
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-500"
              onClick={() => { setConfirmDiscard(false); submitDialog() }}
              disabled={busy}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Simpan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
