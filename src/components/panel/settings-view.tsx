'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { rpc, type ServerInfo } from '@/lib/panel-client'
import { Loader2, Save, Trash2 } from 'lucide-react'

export default function SettingsView({
  socket,
  server,
  onDeleted,
  onUpdated,
}: {
  socket: any
  server: ServerInfo
  onDeleted: () => void
  onUpdated: (s: ServerInfo) => void
}) {
  const [name, setName] = useState(server.name)
  const [description, setDescription] = useState(server.description)
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    setName(server.name)
    setDescription(server.description || '')
  }, [server])

  async function save() {
    setSaving(true)
    try {
      const res = await rpc<{ server: ServerInfo }>(socket, 'servers:update', {
        id: server.id,
        name,
        description,
      })
      toast({ title: 'Tersimpan' })
      onUpdated(res.server)
    } catch (e) {
      toast({ title: 'Gagal simpan', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function deleteServer() {
    try {
      await rpc(socket, 'servers:delete', { id: server.id })
      toast({ title: 'Panel dihapus' })
      onDeleted()
    } catch (e) {
      toast({ title: 'Gagal hapus', description: (e as Error).message, variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-4">
      <Card className="border-zinc-800 bg-zinc-900">
        <CardHeader>
          <CardTitle className="text-base">Info panel</CardTitle>
          <CardDescription>Nama dan deskripsi panel ini.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="set-name">Nama panel</Label>
            <Input
              id="set-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-zinc-950 border-zinc-800 text-zinc-100"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="set-desc">Description</Label>
            <textarea
              id="set-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              spellCheck={false}
              placeholder="contoh: bot whatsapp buat auto-reply"
              className="h-20 w-full resize-none rounded-md border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-200 outline-none focus:border-emerald-700"
            />
          </div>
          <Button onClick={save} disabled={saving} className="bg-emerald-600 hover:bg-emerald-500">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Simpan
          </Button>
        </CardContent>
      </Card>

      <Card className="border-red-900/50 bg-red-950/20">
        <CardHeader>
          <CardTitle className="text-base text-red-400">Zona bahaya</CardTitle>
          <CardDescription className="text-zinc-400">
            Hapus panel ini beserta SEMUA file di dalamnya, permanen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">
                <Trash2 className="h-4 w-4" /> Hapus panel
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
              <AlertDialogHeader>
                <AlertDialogTitle>Hapus &quot;{server.name}&quot;?</AlertDialogTitle>
                <AlertDialogDescription>
                  Semua file di folder panel ini bakal kehapus permanen. Terminal yang lagi aktif juga dimatiin.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="bg-zinc-950 border-zinc-800 text-zinc-100">Batal</AlertDialogCancel>
                <AlertDialogAction onClick={deleteServer} className="bg-red-600 hover:bg-red-500">
                  Hapus permanen
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  )
}
