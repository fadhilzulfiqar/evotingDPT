# E-Voting DPT v2 — setup dan pengujian

## Jalur aplikasi

- Pemilih: `/v2`
- Admin: `/admin-v2`
- API v2: `/api/v2/*`
- API dan halaman V1 tidak diganti pada tahap persiapan.

## Target Netlify

Domain yang diminta adalah `evotedpt.netlify.app`. Project target sebelumnya dipublikasikan melalui Netlify Drop dan belum menghasilkan Deploy Preview dari branch ini. Project lain bernama `newevotingdpt` terhubung ke GitHub dan dapat menghasilkan preview PR, tetapi domain serta data pemilihnya berbeda. Preview dari project lain **bukan** preview untuk domain target `evotedpt`.

Sebelum menguji deployment target, hubungkan project Netlify `evotedpt` ke repository `fadhilzulfiqar/evotingDPT`. Jangan merge PR hanya untuk mengandalkan preview dari project Netlify yang berbeda.

## Rilis dua tahap

**Tahap 1 — pre-backup:** branch ini menambahkan halaman `/v2`, `/admin-v2`, dan API `/api/v2/*`. Halaman utama, `/admin`, dan API V1 tetap berjalan seperti semula. Tidak ada redirect cutover dan tidak ada data V1 yang diubah.

**Tahap 2 — cutover:** hanya setelah backup legacy berhasil dan manifest diverifikasi, terapkan rilis terpisah yang mengarahkan `/` serta `/index.html` ke `/v2`, mengarahkan `/admin` serta `/admin.html` ke `/admin-v2`, dan membuat API V1 read-only. Jangan jalankan tahap 2 sebelum backup terverifikasi.

## Database wajib untuk membuka pemilihan

Netlify Functions memakai PostgreSQL untuk transaksi suara. Tambahkan environment variable:

- `DATABASE_URL`: pooled PostgreSQL connection string dari Neon, Supabase, atau penyedia PostgreSQL lain. Gunakan endpoint pooler/serverless yang disediakan provider.
- `ADMIN_BOOTSTRAP_PASSWORD`: password awal admin yang kuat (minimal 8 karakter), bila belum tersedia pada store admin.
- Untuk Deploy Preview, atur `DATABASE_URL` ke database staging terpisah dan atur `ADMIN_BOOTSTRAP_PASSWORD` pada konteks preview.

Jangan commit connection string atau password ke GitHub. Jangan gunakan database production untuk load test.

Netlify Blobs pada preview menggunakan nama store terpisah dengan prefix `v2-preview-`. Store production V1 tetap memakai nama semula. V2 menggunakan konfigurasi key `v2/main` sehingga tidak menimpa konfigurasi V1.

## Langkah uji sebelum production

1. Hubungkan Deploy Preview ke database staging melalui `DATABASE_URL`.
2. Masuk ke `/admin-v2` pada URL preview.
3. Tambahkan akun uji dan isi dua calon Ketua serta dua calon Wakil. Setiap calon harus memiliki nama dan foto JPG/PNG/WebP maksimal 900 KB.
4. Simpan konfigurasi, kemudian ubah status menjadi Dibuka.
5. Jalankan load test dari komputer lokal dengan Node.js 20 atau lebih baru:

```bash
BASE_URL="https://URL-DEPLOY-PREVIEW" \
ADMIN_USERNAME="admin_dpt" \
ADMIN_PASSWORD="PASSWORD_ADMIN_STAGING" \
VU_COUNT=100 \
node scripts/load-test-v2.mjs
```

Script membuat 100 akun: 99 pemilih utama dan satu akun khusus untuk menguji dua request yang datang bersamaan. Script menguji:
- 100 login dan pengiriman surat suara secara paralel.
- Satu akun yang mengirim dua request berbeda secara bersamaan: tepat satu diterima.
- Retry dengan idempotency key dan pilihan yang sama.
- Retry dengan idempotency key sama tetapi pilihan berbeda harus ditolak.
- Percobaan suara kedua pada akun yang telah memilih harus ditolak.
- Rekonsiliasi total surat suara Ketua, Wakil, dan jumlah partisipasi.

Script otomatis menutup pemilihan staging setelah tes. Akun uji tetap tersimpan; gunakan prefix baru untuk pengujian berikutnya atau arsipkan dan reset data V2 sesuai prosedur.

Untuk keamanan, script hanya menerima host Netlify Deploy Preview secara default. Untuk host staging khusus yang telah diverifikasi bukan production, set `ALLOW_NON_PREVIEW_STAGING=true`. Jangan jalankan script terhadap `evotedpt.netlify.app` atau domain production lainnya.

## Backup legacy sebelum cutover

Setelah rilis tahap 1 dipromosikan ke Production Context (halaman utama lama masih tetap aktif):

1. Buka dashboard lama `/admin` dan tutup pemungutan suara trial V1 (status CLOSED).
2. Buka `/admin-v2` pada domain production dan masuk menggunakan akun admin yang sama.
3. Buka menu Keamanan & Arsip.
4. Jalankan **Buat backup data trial lama**. Backend menolak backup jika status V1 masih OPEN atau snapshot berubah selama penyalinan. Saat V2 akan dibuka, backend juga memeriksa ulang apakah konfigurasi dan record V1 masih sama dengan snapshot; backup kedaluwarsa tidak dapat digunakan.
5. Pastikan status menampilkan backup ID, jumlah voter-lock dan ballot yang disalin, jumlah akun lama yang dipertahankan, snapshot verified, dan archive read-back verified.
6. Jangan lanjut cutover jika manifest belum berstatus terverifikasi.

Backup legacy hanya diizinkan pada Netlify Production Context. Data asli pada `evoting-config` dan `evoting-votes` tidak dihapus. Isi arsip tidak ditampilkan pada dashboard karena struktur V1 dapat memuat relasi internal voter-lock dan pilihan.

## Catatan privasi dan kapasitas

- Selama status pemilihan `open`, rekap perolehan setiap calon disembunyikan dari dashboard admin untuk mengurangi potensi bias.
- Admin melihat siapa yang sudah/belum berpartisipasi dan waktu partisipasi, tetapi tidak melihat pilihan per akun.
- Tabel partisipasi menyimpan ID pemilih dan waktu, bukan pilihan.
- Tabel ballot menyimpan pilihan Ketua dan Wakil, tanpa ID pemilih, foreign key, atau timestamp yang dapat dicocokkan dengan waktu partisipasi.
- Kedua pilihan dan status penggunaan hak suara disimpan dalam satu transaksi PostgreSQL.
- Target 100 pemilih serentak belum dianggap lulus sebelum script beban berhasil pada staging dengan paket Netlify dan konfigurasi database yang setara production.
