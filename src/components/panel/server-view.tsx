'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { rpc, type ServerInfo } from '@/lib/panel-client'
import TerminalView from './terminal-view'
import ProcessView from './process-view'
import FileExplorer from './file-explorer'
import SettingsView from './settings-view'
import { ArrowLeft, Octagon, Play, RotateCcw } from 'lucide-react'

export default function ServerView({
  socket,
  serverId,
  onBack,
}: {
  socket: any
  serverId: string
  onBack: () => void
}) {
  const [server, setServer] = useState<ServerInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()

  const loadList = useCallback(async () => {
    try {
      const list = await rpc<ServerInfo[]>(socket, 'servers:list')
      setServer(list.find((s) => s.id === serverId) || null)
    } catch (e) {
      toast({ title: 'Gagal load server', description: (e as Error).message, variant: 'destructive' })
    }
  }, [socket, serverId, toast])

  useEffect(() => {
    // WAJIB: gabung room server ini biar dapet event run:status / run:out
    socket.emit('srv:join', { id: serverId }, () => {})
    loadList()
    const onStatus = (s: { id: string; status: string }) => {
      if (s.id !== serverId) return
      setServer((prev) => (prev ? { ...prev, status: s.status as ServerInfo['status'] } : prev))
    }
    socket.on('run:status', onStatus)
    return () => {
      socket.off('run:status', onStatus)
    }
  }, [socket, serverId, loadList])

  async function power(action: 'start' | 'stop') {
    setBusy(true)
    try {
      await rpc(socket, `process:${action}`, { id: serverId })
      toast({ title: action === 'start' ? 'Start dikirim' : 'Stop dikirim' })
    } catch (e) {
      toast({ title: 'Gagal', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  async function restart() {
    setBusy(true)
    try {
      await rpc(socket, 'process:stop', { id: serverId })
      await new Promise((r) => setTimeout(r, 1200))
      await rpc(socket, 'process:start', { id: serverId })
      toast({ title: 'Restart dikirim' })
    } catch (e) {
      toast({ title: 'Gagal restart', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const running = server?.status === 'running'

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900/60 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-5xl px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="icon" onClick={onBack} aria-label="Kembali" className="text-zinc-400 hover:text-zinc-100">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${running ? 'bg-emerald-400 shadow-[0_0_8px] shadow-emerald-500/60' : 'bg-zinc-600'}`}
              />
              <h1 className="font-semibold">{server?.name || '...'}</h1>
              <Badge
                variant="outline"
                className={running ? 'border-emerald-700 text-emerald-400' : 'border-zinc-700 text-zinc-400'}
              >
                {running ? 'RUNNING' : 'STOPPED'}
              </Badge>
            </div>
            <div className="ml-auto flex gap-2">
              {running ? (
                <>
                  <Button size="sm" variant="outline" className="border-zinc-800 bg-zinc-900 hover:bg-zinc-800" disabled={busy} onClick={restart}>
                    <RotateCcw className="h-4 w-4" /> Restart
                  </Button>
                  <Button size="sm" variant="destructive" disabled={busy} onClick={() => power('stop')}>
                    <Octagon className="h-4 w-4" /> Stop
                  </Button>
                </>
              ) : (
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500" disabled={busy} onClick={() => power('start')}>
                  <Play className="h-4 w-4" /> Start
                </Button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-5">
        <Tabs defaultValue="terminal">
          <TabsList className="bg-zinc-900 border border-zinc-800">
            <TabsTrigger value="terminal">Terminal</TabsTrigger>
            <TabsTrigger value="proses">Log Proses</TabsTrigger>
            <TabsTrigger value="files">File Manager</TabsTrigger>
            <TabsTrigger value="settings">Pengaturan</TabsTrigger>
          </TabsList>
          <TabsContent value="terminal" className="mt-3">
            <TerminalView socket={socket} serverId={serverId} />
          </TabsContent>
          <TabsContent value="proses" className="mt-3">
            <ProcessView socket={socket} serverId={serverId} />
          </TabsContent>
          <TabsContent value="files" className="mt-3">
            {server && (
              <FileExplorer socket={socket} serverId={serverId} />
            )}
          </TabsContent>
          <TabsContent value="settings" className="mt-3">
            {server && (
              <SettingsView
                socket={socket}
                server={server}
                onDeleted={onBack}
                onUpdated={(s) => setServer(s)}
              />
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
