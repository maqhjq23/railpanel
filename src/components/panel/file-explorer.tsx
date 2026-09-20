'use client'

// FileExplorer — file manager RailPanel.
// - Toolbar gaya "laci": bisa digeser horizontal kalau muat gak (HP).
// - Mode multi-select: Zip (kompres) & Move (pindah) dengan checkbox per item.
// - Tombol per item: file = edit/rename/hapus/download, folder = rename/hapus,
//   .zip = extract.
// - Editor: textarea wrap bener (teks panjang gak keluar batas dialog).
import { useCallback, useEffect, useRef, useState } from 'react'
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
  | { kind: 'zipOut' }
  | { kind: 'moveTo' }

type SelMode = 'none' | 'zip' | 'move'

const btnBar =
  'h-8 shrink-0 whitespace-nowrap border-zinc-800 bg-zinc-900 hover:bg-zinc-800'

export default function FileExplorer({ socket, serverId }: { socket: any; serverId: string }) {
  const [cwd, setCwd] = useState('.')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState<DialogMode>({ kind: 'none' })
  const [inputValue, setInputValue] = useState('')
  const [editContent, setEditContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [selMode, setSelMode] = useState<SelMode>('none')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const uploadRef = useRef<HTMLInputElement>(null)
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

  function join(dir: string, name: string) {
    return dir === '.' ? name : `${dir}/${name}`
  }

  // pindah folder SELALU lewat sini biar mode select ke-reset (gak boleh di effect body)
  function go(dir: string) {
    setSelMode('none')
    setSel(new Set())
    setCwd(dir)
  }

  function enterSelect(mode: SelMode) {
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

  function openFile(p: string) {
    rpc<{ content: string }>(socket, 'files:read', { id: serverId, path: p })
      .then((res) => {
        setInputValue('')
        setEditContent(res.content)
        setDialog({ kind: 'edit', from: p })
      })
      .catch((e) => toast({ title: 'Gagal baca file', description: (e as Error).message, variant: 'destructive' }))
  }

  async function doExtract(e: FileEntry) {
    setBusy(true)
    try {
      await rpc(socket, 'files:extract', { id: serverId, path: join(cwd, e.name) })
      toast({ title: 'Extract sukses', description: e.name })
      await load()
    } catch (err) {
      toast({ title: 'Extract gagal', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setBusy(false)
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
      } else if (dialog.kind === 'zipOut') {
        await rpc(socket, 'files:zip', { id: serverId, items: Array.from(sel), out: join(cwd, inputValue) })
        enterSelect('none') // reset mode + seleksi
      } else if (dialog.kind === 'moveTo') {
        const dest = inputValue.trim() === '' ? '.' : inputValue.trim()
        await rpc(socket, 'files:move', { id: serverId, items: Array.from(sel), dest })
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

  const crumbs = cwd === '.' ? [] : cwd.split('/')
  const selecting = selMode !== 'none'

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
            variant={selMode === 'zip' ? 'default' : 'outline'}
            size="sm"
            className={selMode === 'zip' ? 'h-8 shrink-0 whitespace-nowrap bg-emerald-600 hover:bg-emerald-500' : btnBar}
            onClick={() => (selMode === 'zip' ? enterSelect('none') : enterSelect('zip'))}
          >
            <Archive className="h-4 w-4" /> Zip
          </Button>
          <Button
            variant={selMode === 'move' ? 'default' : 'outline'}
            size="sm"
            className={selMode === 'move' ? 'h-8 shrink-0 whitespace-nowrap bg-emerald-600 hover:bg-emerald-500' : btnBar}
            onClick={() => (selMode === 'move' ? enterSelect('none') : enterSelect('move'))}
          >
            <FolderInput className="h-4 w-4" /> Move
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

      {/* bar aksi mode select */}
      {selecting && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-900/70 bg-emerald-950/30 px-3 py-2">
          <span className="text-xs font-medium text-emerald-300">
            {sel.size} dipilih — {selMode === 'zip' ? 'kompres jadi zip' : 'pindah ke folder lain'}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-zinc-800 bg-zinc-950"
              onClick={() => enterSelect('none')}
            >
              Batal
            </Button>
            <Button
              size="sm"
              className="h-8 bg-emerald-600 hover:bg-emerald-500"
              disabled={sel.size === 0 || busy}
              onClick={() => {
                if (selMode === 'zip') {
                  setInputValue('arsip.zip')
                  setDialog({ kind: 'zipOut' })
                } else {
                  setInputValue('')
                  setDialog({ kind: 'moveTo' })
                }
              }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : selMode === 'zip' ? 'Kompres' : 'Move'}
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
                    <td className="w-28 py-2 pr-2 text-right">
                      <div className="flex justify-end gap-0.5">
                        {!selecting && isZip(e) && (
                          <button
                            aria-label="Extract"
                            title="Extract zip"
                            disabled={busy}
                            className="rounded p-1 text-zinc-500 hover:bg-zinc-700/50 hover:text-amber-300"
                            onClick={(ev) => { ev.stopPropagation(); doExtract(e) }}
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

      {/* dialog umum: newFile/newFolder/rename/delete/edit/zipOut/moveTo */}
      <Dialog open={dialog.kind !== 'none'} onOpenChange={(o) => !o && setDialog({ kind: 'none' })}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] overflow-hidden bg-zinc-900 text-zinc-100 sm:max-w-2xl">
          {dialog.kind === 'delete' ? (
            <>
              <DialogHeader>
                <DialogTitle className="break-all">Hapus {dialog.from.split('/').pop()}?</DialogTitle>
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
          ) : dialog.kind === 'edit' ? (
            <>
              <DialogHeader>
                <DialogTitle className="break-all font-mono text-sm">/{dialog.from}</DialogTitle>
              </DialogHeader>
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                wrap="soft"
                spellCheck={false}
                className="h-[55vh] min-h-[300px] w-full min-w-0 max-w-full resize-none overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap text-zinc-200 outline-none focus:border-emerald-700"
              />
              <DialogFooter>
                <Button variant="outline" className="border-zinc-800 bg-zinc-950" onClick={() => setDialog({ kind: 'none' })}>
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
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && inputValue.trim() && submitDialog()}
                autoFocus
                placeholder={dialog.kind === 'zipOut' ? 'arsip.zip' : 'folder tujuan, mis. docs atau a/b (kosong = root)'}
                className="bg-zinc-950 font-mono text-zinc-100 border-zinc-800"
              />
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
                      : `Rename ${dialog.kind === 'rename' ? dialog.from.split('/').pop() : ''}`}
                </DialogTitle>
              </DialogHeader>
              <Input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && inputValue.trim() && submitDialog()}
                autoFocus
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
    </div>
  )
}
