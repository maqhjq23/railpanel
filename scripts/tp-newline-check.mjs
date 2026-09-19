// Verifikasi bug newline console: kirim `ls`, data mentah harus punya \r\n
// antara output dan prompt berikutnya, dan renderer BARU harus memisahkan barisnya
import { io } from 'socket.io-client'

const token = process.env.RP_TOKEN
const URL = process.env.RP_URL || 'https://railpanel-production-a69c.up.railway.app'
const PATH = process.env.RP_WS_PATH || '/socket.io'

// --- replika renderer console-view.tsx (versi FIXED) ---
class AnsiToHtml {
  constructor() { this.pending=''; this.openSig=''; this.lines=[]; this.cur=''; this.pendingCR=false }
  closeSpan(){ if(this.openSig){ this.cur+='</span>'; this.openSig='' } }
  pushLine(){ this.closeSpan(); this.lines.push(this.cur); this.cur='' }
  writeText(t){ if(!t)return; let out=''; const flush=()=>{ if(!out)return; if(this.pendingCR){ this.closeSpan(); this.cur=''; this.pendingCR=false } this.cur+=out; out='' }
    for(const ch of t){ if(ch==='\n'){ flush(); this.pendingCR=false; this.pushLine() } else if(ch==='\r'){ flush(); this.pendingCR=true } else if(ch==='\x07'||ch==='\x08'){} else out+=ch } flush() }
  feed(chunk){ this.pending=(this.pending+chunk).replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g,'')
    const re=/\x1b(?:\[([0-9;?]*)([@-~])|\]([^\x07\x1b]*)(?:\x07|\x1b\\)|([0-9=><@-Z\\])|([()][0-9A-Za-z]))/g
    let last=0,m; while((m=re.exec(this.pending))){ this.writeText(this.pending.slice(last,m.index)); last=re.lastIndex }
    let tail=this.pending.slice(last); const i=tail.lastIndexOf('\x1b')
    if(i!==-1){ const rest=tail.slice(i); const done=/^(?:\x1b\[[0-9;?]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[0-9=><@-Z\\]|\x1b[()][0-9A-Za-z])/.test(rest)
      if(!done&&rest.length<=4096){ this.pending=rest; tail=tail.slice(0,i) } else { this.pending=''; if(!done)tail=tail.slice(0,i) } } else { this.pending='' }
    this.writeText(tail) }
  render(){ return (this.lines.length?this.lines.join('\n')+'\n':'')+this.cur }
}
// renderer LAMA (bug) buat pembanding
class AnsiOld extends AnsiToHtml {
  render(){ return this.lines.join('\n')+this.cur }
}

const s = io(URL, { forceNew: true, path: PATH, transports: ['polling'], extraHeaders: { Cookie: `tp_token=${token}` }, timeout: 20000 })
const rpc = (ev, p) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), 15000); s.emit(ev, p, (r) => { clearTimeout(t); res(r) }) })

s.on('connect_error', (e) => { console.log('[FAIL] connect:', e.message); process.exit(1) })
s.on('connect', async () => {
  try {
    const created = await rpc('servers:create', { name: 'Tes Newline', description: 'cek CRLF output vs prompt' })
    const id = created.server.id
    const cleanup = async (code) => { await rpc('servers:delete', { id }).catch(() => {}); process.exit(code) }
    try {
      await rpc('terminal:attach', { id })
      let out = ''
      s.on('term:out', ({ data }) => { out += data })
      await new Promise((r) => setTimeout(r, 2500)) // tunggu prompt pertama
      out = ''
      s.emit('terminal:input', { id, data: 'touch run.log; touch test.py; ls\n' })
      const t0 = Date.now()
      while (Date.now() - t0 < 10000 && !(/run\.log/.test(out) && (out.match(/root@/g) || []).length >= 2)) await new Promise((r) => setTimeout(r, 300))
      await new Promise((r) => setTimeout(r, 800)) // biar prompt kedua keburu nyampe

      // 1) level DATA MENTAH: antara "test.py" dan prompt kedua harus ada \r\n
      const plain = out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
      const rawOk = /test\.py\r?\n[\s\S]*root@/.test(out) || /test\.py\r\n/.test(out)
      console.log('[DATA] pola "test.py<CR><LF>...prompt" di stream mentah:', rawOk ? 'ADA (OK)' : 'GAK ADA (BUG)')

      // 2) level RENDERER: render data mentah pakai versi baru vs lama
      const baru = new AnsiToHtml(); baru.feed(out)
      const lama = new AnsiOld(); lama.feed(out)
      const rBaru = baru.render().replace(/\n/g, '⏎\n')
      const rLama = lama.render().replace(/\n/g, '⏎\n')
      const sepOk = /test\.py\n[\s\S]*root@/.test(baru.render()) && !/test\.pyroot@/.test(baru.render())
      const bugLama = /test\.pyroot@/.test(lama.render())
      console.log('[RENDER BARU] baris test.py terpisah dari prompt:', sepOk ? 'YA (FIX JALAN)' : 'GAK')
      console.log('[RENDER LAMA] nempel "test.pyroot@" (bug lama):', bugLama ? 'YA (pembanding valid)' : 'gak kepangkas')
      console.log('--- render baru (⏎ = newline) ---')
      console.log(rBaru.trim().split('\n').slice(-6).join('\n'))

      const pass = rawOk && sepOk
      console.log(pass ? '=== VERIFIKASI PASS ===' : '=== VERIFIKASI GAGAL ===')
      await cleanup(pass ? 0 : 1)
    } catch (e) { console.log('[FAIL]', e.message); await cleanup(1) }
  } catch (e) { console.log('[FAIL] create:', e.message); process.exit(1) }
})
