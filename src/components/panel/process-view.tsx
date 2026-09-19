'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { RefreshCw, Trash2 } from 'lucide-react'

export default function ProcessView({ socket, serverId }: { socket: any; serverId: string }) {
  const [lines, setLines] = useState<string[]>([])
  const [status, setStatus] = useState<'running' | 'stopped'>('stopped')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    socket.emit('process:logs', { id: serverId }, (res: { ok: boolean; log?: string[]; status?: string }) => {
      if (res?.ok) {
        setLines(res.log || [])
        setStatus((res.status as 'running' | 'stopped') || 'stopped')
      }
    })
    const onOut = ({ id, data }: { id: string; data: string }) => {
      if (id === serverId) setLines((prev) => [...prev.slice(-600), data])
    }
    const onStatus = ({ id, status: st }: { id: string; status: 'running' | 'stopped' }) => {
      if (id === serverId) setStatus(st)
    }
    socket.on('run:out', onOut)
    socket.on('run:status', onStatus)
    return () => {
      socket.off('run:out', onOut)
      socket.off('run:status', onStatus)
    }
  }, [socket, serverId])

  useEffect(() => {
    const el = scrollRef.current?.querySelector('[data-radix-scroll-area-viewport]')
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">Output proses yang dijalanin lewat tombol Start.</p>
        <div className="flex gap-2">
          <Badge
            variant="outline"
            className={status === 'running' ? 'border-emerald-700 text-emerald-400' : 'border-zinc-700 text-zinc-400'}
          >
            {status === 'running' ? 'RUNNING' : 'STOPPED'}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            className="h-7 border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
            onClick={() => socket.emit('process:logs', { id: serverId }, (res: { ok: boolean; log?: string[] }) => res?.ok && setLines(res.log || []))}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
            onClick={() => setLines([])}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <ScrollArea className="h-[60vh] min-h-[360px] rounded-lg border border-zinc-800 bg-[#0c0c0f]" ref={scrollRef}>
        <div className="p-3 font-mono text-xs leading-5 text-zinc-300">
          {lines.length === 0 ? (
            <p className="text-zinc-600">Belum ada output. Klik Start di atas buat menjalankan start command.</p>
          ) : (
            lines.map((l, i) => (
              <div key={i} className="whitespace-pre-wrap break-all">
                {l}
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
