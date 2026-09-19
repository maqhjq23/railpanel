'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import { rpc, type ServerInfo } from '@/lib/panel-client'
import { FolderKanban, Loader2, Plus, TerminalSquare, Trash2, RefreshCw } from 'lucide-react'

export default function DashboardView({
  socket,
  onOpen,
  onLogout,
}: {
  socket: any
  onOpen: (id: string) => void
  onLogout: () => void
}) {
  const [servers, setServers] = useState<ServerInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [startCommand, setStartCommand] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ServerInfo | null>(null)
  const { toast } = useToast()

  const refresh = useCallback(async () => {
    try {
      const list = await rpc<ServerInfo[]>(socket, 'servers:list')
      setServers(list)
    } catch (e) {
      toast({ title: 'Gagal memuat server', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [socket, toast])

  useEffect(() => {
    refresh()
    const onStatus = (s: { id: string; status: string }) => {
      setServers((prev) => prev.map((v) => (v.id === s.id ? { ...v, status: s.status as ServerInfo['status'] } : v)))
    }
    socket.on('run:status', onStatus)
    return () => {
      socket.off('run:status', onStatus)
    }
  }, [socket, refresh])

  async function createServer() {
    if (!name.trim()) return
    setCreating(true)
    try {
      const res = await rpc<{ server: ServerInfo }>(socket, 'servers:create', { name, startCommand })
      toast({ title: 'Server dibuat', description: res.server.name })
      setCreateOpen(false)
      setName('')
      setStartCommand('')
      await refresh()
    } catch (e) {
      toast({ title: 'Gagal bikin server', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  async function deleteServer() {
    if (!deleteTarget) return
    try {
      await rpc(socket, 'servers:delete', { id: deleteTarget.id })
      toast({ title: 'Server dihapus', description: deleteTarget.name })
      setDeleteTarget(null)
      await refresh()
    } catch (e) {
      toast({ title: 'Gagal hapus', description: (e as Error).message, variant: 'destructive' })
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900/60 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-5xl flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15">
              <TerminalSquare className="h-4.5 w-4.5 text-emerald-400" />
            </div>
            <div>
              <h1 className="font-semibold leading-none">RailPanel</h1>
              <p className="text-xs text-zinc-500">file manager + terminal, tanpa docker</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onLogout} className="text-zinc-400 hover:text-zinc-100">
            Keluar
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Server kamu ({servers.length})</h2>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={refresh} className="border-zinc-800 bg-zinc-900 hover:bg-zinc-800">
              <RefreshCw className="h-4 w-4" />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500">
                  <Plus className="h-4 w-4" /> Server Baru
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
                <DialogHeader>
                  <DialogTitle>Bikin server baru</DialogTitle>
                  <DialogDescription>
                    Tiap server punya folder sendiri, terminal sendiri, dan start command sendiri.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="srv-name">Nama</Label>
                    <Input
                      id="srv-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="contoh: Bot WhatsApp"
                      className="bg-zinc-950 border-zinc-800"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="srv-cmd">Start command (opsional, bisa diisi belakangan)</Label>
                    <Input
                      id="srv-cmd"
                      value={startCommand}
                      onChange={(e) => setStartCommand(e.target.value)}
                      placeholder="contoh: python3 bot.py"
                      className="bg-zinc-950 border-zinc-800 font-mono text-sm"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={createServer} disabled={creating || !name.trim()} className="bg-emerald-600 hover:bg-emerald-500">
                    {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Bikin'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
          </div>
        ) : servers.length === 0 ? (
          <Card className="border-dashed border-zinc-800 bg-zinc-900/40">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <FolderKanban className="mb-3 h-10 w-10 text-zinc-600" />
              <p className="font-medium">Belum ada server</p>
              <p className="mt-1 max-w-sm text-sm text-zinc-500">
                Bikin server pertama lo, upload file-nya, terus jalanin lewat terminal atau start command.
              </p>
              <Button onClick={() => setCreateOpen(true)} className="mt-4 bg-emerald-600 hover:bg-emerald-500">
                <Plus className="h-4 w-4" /> Server Baru
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {servers.map((s) => (
              <Card
                key={s.id}
                className="group cursor-pointer border-zinc-800 bg-zinc-900 hover:border-emerald-700/60 transition-colors"
                onClick={() => onOpen(s.id)}
              >
                <CardContent className="flex items-start justify-between p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.status === 'running' ? 'bg-emerald-400 shadow-[0_0_8px] shadow-emerald-500/60' : 'bg-zinc-600'}`}
                      />
                      <p className="truncate font-medium">{s.name}</p>
                    </div>
                    <p className="mt-1 truncate font-mono text-xs text-zinc-500">
                      {s.startCommand || 'belum ada start command'}
                    </p>
                    <Badge
                      variant="outline"
                      className={`mt-2 ${s.status === 'running' ? 'border-emerald-700 text-emerald-400' : 'border-zinc-700 text-zinc-400'}`}
                    >
                      {s.status === 'running' ? 'RUNNING' : 'STOPPED'}
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-zinc-600 hover:text-red-400"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteTarget(s)
                    }}
                    aria-label={`Hapus ${s.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus server &quot;{deleteTarget?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              Semua file di folder server ini bakal kehapus permanen. Proses yang lagi jalan juga dimatiin.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-zinc-950 border-zinc-800">Batal</AlertDialogCancel>
            <AlertDialogAction onClick={deleteServer} className="bg-red-600 hover:bg-red-500">
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
