// RailPanel custom server (Railway/produksi) — Next.js + socket.io dalam 1 port
import { createServer } from 'http'
import next from 'next'
import { attachEngine } from './mini-services/terminal-service/engine.mjs'

const dev = false
const port = Number(process.env.PORT || 3000)
const hostname = '0.0.0.0'

const app = next({ dev, dir: process.cwd() })
const handle = app.getRequestHandler()

await app.prepare()

const httpServer = createServer((req, res) => handle(req, res))
attachEngine(httpServer, { path: '/socket.io' })

httpServer.listen(port, hostname, () => {
  console.log(`RailPanel ready on http://${hostname}:${port}`)
})
