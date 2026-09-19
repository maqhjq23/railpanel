// RailPanel terminal mini-service (sandbox) — port 3003, di-forward Caddy via XTransformPort
import { createServer } from 'http'
import { attachEngine } from './engine.mjs'

const httpServer = createServer()
attachEngine(httpServer, { path: '/' }) // path '/' WAJIB (gateway Caddy)

const PORT = 3003
httpServer.listen(PORT, () => {
  console.log(`RailPanel terminal service running on port ${PORT}`)
})

process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
