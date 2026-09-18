---
Task ID: 1
Agent: Super Z (main)
Task: Install Pterodactyl Wings / node server untuk panel di Railway

Work Log:
- Install Railway CLI v4.5.4 (pin RAILWAY_VERSION karena GitHub rate limit)
- Login panel Pterodactyl via session API (admin creds dari user) — root_admin aktif
- Node list awal: kosong; location id=1 "TheDanzPro" tersedia
- Login Railway: pairing browserless gagal (sandbox bunuh background process antar sesi), solusi: user memberikan account token → ditulis ke ~/.railway/config.json
- Railway SSH ke service 785bdc10 (project d32512be, env 6ee6d296): Alpine 3.24.1 x86_64, panel image (nginx+php-fpm+queue-worker via supervisord)
- Audit capability: CapEff 0x800405fb (tanpa SYS_ADMIN/NET_ADMIN), userns BLOCKED, mount BLOCKED, /dev/fuse tidak ada → Docker-in-Docker dan rootless docker mustahil
- Buat node via POST /api/application/nodes: id=1 "RailwayNode", fqdn 127.0.0.1, scheme http, listen 8080, sftp 2022 (validasi panel menolak memory/disk=0, dipakai 999999999)
- Ambil config wings via /api/application/nodes/1/configuration (uuid, token_id, token)
- Download wings binary (latest) → /usr/local/bin/wings di container
- Tulis /etc/pterodactyl/config.yml (base64 untuk hindari quoting), daftarkan [program:wings] ke supervisord (perbaiki bug newline merge via sed)
- Wings start: auth ke panel BERHASIL (fetch server list OK), lalu FATAL di "failed to configure docker environment" — tidak ada docker.sock

Stage Summary:
- Node id=1 RailwayNode TERSIMPAN di panel (persisten, bagian DB panel)
- Wings binary + config + entri supervisord TERPASANG di container Railway (efemeral — hilang saat redeploy)
- Wings tidak bisa jalan penuh di Railway: platform tidak mengizinkan Docker (terverifikasi empiris)
- Solusi penuh: wings harus di VPS dengan Docker; panel tetap di Railway (fqdn node harus diupdate ke IP/domain VPS)
- Nilai konfigurasi node: uuid=a4824cf9-c4a1-4df1-a53e-a661c0f8397b, token_id=l3O0NjbbjSk7ZglV
