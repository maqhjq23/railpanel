// Unit test resolveDest (copy persis dari file-explorer.tsx) — Task 18
// Semantik baru: dest relatif terhadap folder sekarang, gaya shell.
function resolveDest(input, cwdRel) {
  const raw = input.trim()
  if (raw === '') return '.'
  const cur = raw.startsWith('/') ? [] : cwdRel === '.' ? [] : cwdRel.split('/')
  for (const seg of raw.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') cur.pop()
    else cur.push(seg)
  }
  return cur.length ? cur.join('/') : '.'
}

let pass = 0, fail = 0
function t(input, cwd, want, desc) {
  const got = resolveDest(input, cwd)
  if (got === want) { pass++; console.log(`PASS  ${desc}  (in=${JSON.stringify(input)} cwd=${cwd} -> ${got})`) }
  else { fail++; console.log(`FAIL  ${desc}  (in=${JSON.stringify(input)} cwd=${cwd}) want=${want} got=${got}`) }
}

// contoh dari user: di /home/contoh, input ".." -> location /home
t('..', 'home/contoh', 'home', 'contoh user: ".." naik 1 folder')
// turun ke folder di sekitar (bug lama: dianggap dari root)
t('docs', 'home/contoh', 'home/contoh/docs', '"docs" = folder di posisi sekarang')
t('a/b', 'home/contoh', 'home/contoh/a/b', '"a/b" nested di posisi sekarang')
// kosong & titik
t('', 'home/contoh', '.', 'kosong = root')
t('   ', 'home/contoh', '.', 'spasi doang = root')
t('.', 'home/contoh', 'home/contoh', '"." = di sini')
// absolut dari root server
t('/docs', 'home/contoh', 'docs', '"/docs" = dari root server')
t('/', 'home/contoh', '.', '"/" = root')
// naik lebih dari 1 + clamp di root
t('../..', 'home/contoh', '.', 'naik 2 dari home/contoh = root')
t('../../..', 'home/contoh', '.', 'naik 3 = clamp di root (gak bocor keluar)')
t('..', '.', '.', 'naik dari root = root')
// campuran
t('../other', 'home/contoh', 'home/other', 'naik lalu turun ke sibling')
t('a/../b', 'home/contoh', 'home/contoh/b', 'a lalu naik lalu b')
t('docs/', 'home/contoh', 'home/contoh/docs', 'trailing slash diabaikan')
t('./docs', 'home/contoh', 'home/contoh/docs', 'prefix "./" diabaikan')
t('..', 'home', '.', '".." dari home = root')
// nama aneh
t('folder baru', 'home/contoh', 'home/contoh/folder baru', 'spasi dalam nama tetap sah')
t('..x', 'home/contoh', 'home/contoh/..x', '"..x" itu nama file biasa, bukan naik')

console.log(`\n${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
