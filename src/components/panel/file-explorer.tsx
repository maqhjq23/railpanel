'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  ChevronRight,
  Download,
  File as FileIcon,
  FilePlus2,
  FolderPlus,
  Folder,
  Loader2,
  Pencil,
  Trash2,
  Upload,
} from 'lucide-react'

type DialogMode =
  | { kind: 'none' }
  | { kind: 'newFile' }
  | { kind: 'newFolder' }
  | { kind: 'rename'; from: string }
  | { kind: 'delete'; from: string }
  | { kind: 'edit'; from: string; content: string }

export default function FileExplorer({ socket, serverId }: { socket: any; serverId: string }) {
  const [cwd, setCwd] = useState('.')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState<DialogMode>({ kind: 'none' })
  const [inputValue, setInputValue] = useState('')
  const [editContent, setEditContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
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

  function open(entry: FileEntry) {
    const p = join(cwd, entry.name)
    if (entry.type === 'dir') setCwd(p)
    else
      rpc<{ content: string }>(socket, 'files:read', { id: serverId, path: p })
        .then((res) => {
          setInputValue('')
          setEditContent(res.content)
          setDialog({ kind: 'edit', from: p, content: res.content })
        })
        .catch((e) => toast({ title: 'Gagal baca file', description: (e as Error).message, variant: 'destructive' }))
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
          onClick={() => setCwd(cwd.includes('/') ? cwd.split('/').slice(0, -1).join('/') || '.' : '.')}
          disabled={cwd === '.'}
        >
          <ChevronRight className="h-4 w-4 rotate-180" />
        </Button>
        <div className="min-w-0 flex-1 overflow-x-auto font-mono text-sm text-zinc-400">
          <button className="hover:text-emerald-400" onClick={() => setCwd('.')}>/</button>
          {crumbs.map((c, i) => (
            <span key={i}>
              {' / '}
              <button
                className="hover:text-emerald-400"
                onClick={() => setCwd(crumbs.slice(0, i + 1).join('/'))}
              >
                {c}
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
          onClick={() => { setInputValue(''); setDialog({ kind: 'newFile' }) }}
        >
          <FilePlus2 className="h-4 w-4" /> File
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
          onClick={() => { setInputValue(''); setDialog({ kind: 'newFolder' }) }}
        >
          <FolderPlus className="h-4 w-4" /> Folder
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
          disabled={uploading}
          onClick={() => uploadRef.current?.click()}
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload
        </Button>
        <input
          ref={uploadRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => onUpload(e.target.files)}
        />
      </div>

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
              {entries.map((e) => (
                <tr
                  key={e.name}
                  className="group cursor-pointer border-b border-zinc-800/60 last:border-0 hover:bg-zinc-800/40"
                  onClick={() => open(e)}
                >
                  <td className="w-8 py-2 pl-3">
                    {e.type === 'dir' ? (
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
                  <td className="w-20 py-2 pr-2 text-right">
                    <div className="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      {e.type === 'file' && (
                        <a
                          href={`/api/files/download?server=${serverId}&path=${encodeURIComponent(join(cwd, e.name))}`}
                          onClick={(ev) => ev.stopPropagation()}
                          aria-label="Download"
                          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-700/50 hover:text-emerald-400"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </a>
                      )}
                      <button
                        aria-label="Rename"
                        className="rounded p-1.5 text-zinc-500 hover:bg-zinc-700/50 hover:text-zinc-200"
                        onClick={(ev) => {
                          ev.stopPropagation()
                          setInputValue(e.name)
                          setDialog({ kind: 'rename', from: join(cwd, e.name) })
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        aria-label="Hapus"
                        className="rounded p-1.5 text-zinc-500 hover:bg-zinc-700/50 hover:text-red-400"
                        onClick={(ev) => {
                          ev.stopPropagation()
                          setDialog({ kind: 'delete', from: join(cwd, e.name) })
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ScrollArea>

      {/* dialog umum: newFile/newFolder/rename/delete/edit */}
      <Dialog open={dialog.kind !== 'none'} onOpenChange={(o) => !o && setDialog({ kind: 'none' })}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100 sm:max-w-2xl">
          {dialog.kind === 'delete' ? (
            <>
              <DialogHeader>
                <DialogTitle>Hapus {dialog.from.split('/').pop()}?</DialogTitle>
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
                <DialogTitle className="font-mono text-sm">/{dialog.from}</DialogTitle>
              </DialogHeader>
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                spellCheck={false}
                className="h-[55vh] min-h-[300px] w-full resize-none rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-zinc-200 outline-none focus:border-emerald-700"
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
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>
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
