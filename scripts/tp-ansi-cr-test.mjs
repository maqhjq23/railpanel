// Repro test renderer console: cari skenario split chunk yang bikin newline hilang
class AnsiToHtml {
  constructor() { this.pending=''; this.fg=''; this.bg=''; this.bold=false; this.dim=false; this.italic=false; this.underline=false; this.openSig=''; this.lines=[]; this.cur=''; this.pendingCR=false }
  reset(){ this.fg='';this.bg='';this.bold=false;this.dim=false;this.italic=false;this.underline=false }
  sig(){ const p=[]; if(this.fg)p.push(`color:${this.fg}`); if(this.bg)p.push(`background-color:${this.bg}`); if(this.bold)p.push('font-weight:700'); if(this.dim)p.push('opacity:.65'); if(this.italic)p.push('font-style:italic'); if(this.underline)p.push('text-decoration:underline'); return p.join(';') }
  applySgr(seq){ if(seq===''||seq==='0'){this.reset();return} const parts=seq.split(';').map(x=>x===''?0:parseInt(x,10)); let i=0; while(i<parts.length){ const p=parts[i]; if(p===0)this.reset(); else if(p===1)this.bold=true; else if(p===2)this.dim=true; else if(p===3)this.italic=true; else if(p===4)this.underline=true; else if(p===22){this.bold=false;this.dim=false} else if(p===23)this.italic=false; else if(p===24)this.underline=false; else if(p===38||p===48){let c=''; if(parts[i+1]===5){i+=2} else if(parts[i+1]===2){i+=4}} i++ } }
  openSpan(){ const s=this.sig(); if(s&&s!==this.openSig){ if(this.openSig)this.cur+='</span>'; this.cur+=`<span style="${s}">`; this.openSig=s } }
  closeSpan(){ if(this.openSig){ this.cur+='</span>'; this.openSig='' } }
  pushLine(){ this.closeSpan(); this.lines.push(this.cur); this.cur='' }
  writeText(t){ if(!t)return; let out=''; const flush=()=>{ if(!out)return; if(this.pendingCR){ this.closeSpan(); this.cur=''; this.pendingCR=false } this.openSpan(); this.cur+=out; out='' }
    for(const ch of t){ if(ch==='\n'){ flush(); this.pendingCR=false; this.pushLine() } else if(ch==='\r'){ flush(); this.pendingCR=true } else if(ch==='\x07'||ch==='\x08'){ } else { if(ch==='&')out+='&amp;'; else if(ch==='<')out+='&lt;'; else if(ch==='>')out+='&gt;'; else out+=ch } } flush() }
  feed(chunk){ this.pending+=chunk; this.pending=this.pending.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g,'')
    const re=/\x1b(?:\[([0-9;?]*)([@-~])|\]([^\x07\x1b]*)(?:\x07|\x1b\\)|([0-9=><@-Z\\])|([()][0-9A-Za-z]))/g
    let last=0,m; while((m=re.exec(this.pending))){ this.writeText(this.pending.slice(last,m.index)); if(m[1]!==undefined&&m[2]==='m')this.applySgr(m[1]); last=re.lastIndex }
    let tail=this.pending.slice(last); const i=tail.lastIndexOf('\x1b')
    if(i!==-1){ const rest=tail.slice(i); const done=/^(?:\x1b\[[0-9;?]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[0-9=><@-Z\\]|\x1b[()][0-9A-Za-z])/.test(rest)
      if(!done&&rest.length<=4096){ this.pending=rest; tail=tail.slice(0,i) } else { this.pending=''; if(!done)tail=tail.slice(0,i) } } else { this.pending='' }
    this.writeText(tail) }
  render(){ return (this.lines.length?this.lines.join('\n')+'\n':'')+'|CUR>'+this.cur }
}

const OSC='\x1b]0;root@5d4f8d4e75bd: ~\x07'
const GRN='\x1b[01;32m', RST='\x1b[00m', BLU='\x1b[01;34m'
const prompt=()=>`${OSC}${GRN}root@5d4f8d4e75bd${RST}:${BLU}~${RST}$# `

// Alur nyata: echo "ls\r\n" -> output "run.log  test.py\r\n" -> prompt (OSC+SGR, tanpa trailing newline)
const E1='ls\r\n'
const E2='run.log  test.py\r\n'
const E3=prompt()

const scenarios = {
  'A. 1 chunk utuh': [E1+E2+E3],
  'B. per event (E1)(E2)(E3)': [E1,E2,E3],
  'C. split tepat setelah \\r': ['ls\r\nrun.log  test.py\r','\n'+E3],
  'D. split tepat sebelum \\r': ['ls\r\nrun.log  test.py','\r\n'+E3],
  'E. split di tengah CRLF': ['ls\r\nrun.log  test.py\r','\nroot@x:~# '],
  'F. CRLF kepecah 3 chunk': ['ls\r\nrun.log  test.py\r','\n',''],
  'G. \\r sendirian lalu \\n sendirian': ['ls','\r','\nrun.log  test.py','\r','\n'+E3],
  'H. OSC prompt kepecah antar chunk': ['ls\r\nrun.log  test.py\r\n'+prompt().slice(0,10),prompt().slice(10)],
}

let fail=0
for(const [name,chunks] of Object.entries(scenarios)){
  const a=new AnsiToHtml()
  for(const c of chunks)a.feed(c)
  const out=a.render().replace(/\x1b/g,'ESC')
  // ekspektasi: baris "run.log  test.py" SENDIRI, prompt mulai di baris/cur baru
  const ok = out.includes('\nrun.log  test.py\n|CUR>') || out.endsWith('\nrun.log  test.py\n|CUR>')
  if(!ok)fail++
  console.log(`${ok?'PASS':'FAIL'} ${name}`)
  if(!ok)console.log('   render:',JSON.stringify(out))
}

// extra: CRLF setelah SGR span terbuka (warna) — span harus ditutup & dibuka lagi
{
  const a=new AnsiToHtml()
  a.feed(GRN+'run.log  test.py\r\n'+RST)
  const out=a.render()
  const ok=out.split('\n')[0].includes('run.log  test.py') && out.includes('</span>')
  console.log(`${ok?'PASS':'FAIL'} I. CRLF dengan span warna terbuka`)
  if(!ok)console.log('   render:',JSON.stringify(out))
  if(!ok)fail++
}
console.log(fail===0?'SEMUA PASS':'ADA '+fail+' FAIL')
