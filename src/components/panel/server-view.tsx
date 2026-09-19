'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { rpc, type ServerInfo } from '@/lib/panel-client'
import TerminalView from './terminal-view'
import ConsoleView from './console-view'
import FileExplorer from './file-explorer'
import SettingsView from './settings-view'
import { ArrowLeft, FolderOpen, Octagon, Play, ScrollText, Settings as SettingsIcon, SquareTerminal } from 'lucide-react'

type TermMode = 'console' | 'xterm'

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
  const [termMode, setTermMode] = useState<TermMode>('console')
  const { toast } = useToast()

  useEffect(() => {
    try {
      const v = window.localStorage.getItem('rp:term-mode')
      if (v === 'console' || v === 'xterm') setTermMode(v)
    } catch { /* ignore */ }
  }, [])

  function switchTermMode(m: TermMode) {
    setTermMode(m)
    try { window.localStorage.setItem('rp:term-mode', m) } catch { /* ignore */ }
  }

  const loadList = useCallback(async () => {
    try {
      const list = await rpc<ServerInfo[]>(socket, 'servers:list')
      setServer(list.find((s) => s.id === serverId) || null)
    } catch (e) {
      toast({ title: 'Gagal load panel', description: (e as Error).message, variant: 'destructive' })
    }
  }, [socket, serverId, toast])

  useEffect(() => {
    // WAJIB: gabung room server ini biar dapet event run:status
    socket.emit('srv:join', { id: serverId }, () => {})
    loadList()
    const onStatus = (s: { id: string; status: string }) => {
      if (s.id !== serverId) return
      setServer((prev) => (prev ? { ...prev, status: s.status as ServerInfo['status'], terminalAlive: s.status === 'running' } : prev))
    }
    socket.on('run:status', onStatus)
    return () => {
      socket.off('run:status', onStatus)
    }
  }, [socket, serverId, loadList])

  // Start/Stop = nyalain/matiin TERMINAL (bukan run script)
  async function power(action: 'start' | 'stop') {
    setBusy(true)
    try {
      if (action === 'start') {
        await rpc(socket, 'terminal:attach', { id: serverId })
        toast({ title: 'Terminal aktif' })
      } else {
        await rpc(socket, 'terminal:stop', { id: serverId })
        toast({ title: 'Terminal dimatikan' })
      }
    } catch (e) {
      toast({ title: 'Gagal', description: (e as Error).message, variant: 'destructive' })
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
                {running ? 'TERMINAL AKTIF' : 'TERMINAL MATI'}
              </Badge>
            </div>
            <div className="ml-auto flex gap-2">
              {running ? (
                <Button size="sm" variant="destructive" disabled={busy} onClick={() => power('stop')}>
                  <Octagon className="h-4 w-4" /> Stop
                </Button>
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
            <TabsTrigger value="terminal" className="gap-1.5">
              <SquareTerminal className="h-4 w-4" /> Terminal
            </TabsTrigger>
            <TabsTrigger value="manager" className="gap-1.5">
              <FolderOpen className="h-4 w-4" /> Manager
            </TabsTrigger>
            <TabsTrigger value="setting" className="gap-1.5">
              <SettingsIcon className="h-4 w-4" /> Setting
            </TabsTrigger>
          </TabsList>
          <TabsContent value="terminal" className="mt-3">
            <div className="mb-2 flex items-center gap-2">
              <div className="flex overflow-hidden rounded-md border border-zinc-800" role="tablist" aria-label="Mode terminal">
                <button
                  type="button"
                  onClick={() => switchTermMode('console')}
                  aria-pressed={termMode === 'console'}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${termMode === 'console' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'}`}
                >
                  <ScrollText className="h-3.5 w-3.5" /> Console
                </button>
                <button
                  type="button"
                  onClick={() => switchTermMode('xterm')}
                  aria-pressed={termMode === 'xterm'}
                  className={`inline-flex items-center gap-1.5 border-l border-zinc-800 px-3 py-1.5 text-xs font-medium transition-colors ${termMode === 'xterm' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'}`}
                >
                  <SquareTerminal className="h-3.5 w-3.5" /> xTerm
                </button>
              </div>
            </div>
            {termMode === 'console' ? (
              <ConsoleView socket={socket} serverId={serverId} active={!!server && running} />
            ) : (
              <TerminalView socket={socket} serverId={serverId} active={!!server && running} />
            )}
          </TabsContent>
          <TabsContent value="manager" className="mt-3">
            {server && (
              <FileExplorer socket={socket} serverId={serverId} />
            )}
          </TabsContent>
          <TabsContent value="setting" className="mt-3">
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
