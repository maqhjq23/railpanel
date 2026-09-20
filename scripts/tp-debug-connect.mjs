// Debug: konek ke engine lokal, dump error handshake lengkap
import { io } from 'socket.io-client'
const URL = process.env.RP_URL || 'http://127.0.0.1:3003'
const token = process.env.RP_TOKEN
const s = io(URL, {
  forceNew: true,
  path: '/socket.io',
  transports: ['polling'],
  reconnection: false,
  extraHeaders: { Cookie: `tp_token=${token}` },
})
s.on('connect', () => { console.log('CONNECTED', s.id); process.exit(0) })
s.on('connect_error', (e) => {
  console.log('ERR message:', JSON.stringify(e.message))
  console.log('ERR stack:', e.stack?.split('\n').slice(0, 6).join('\n'))
  console.log('ERR data:', JSON.stringify(e.data))
  process.exit(1)
})
setTimeout(() => { console.log('timeout'); process.exit(2) }, 8000)
