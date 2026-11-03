# E-Voting DPT v2 — setup dan pengujian

## Jalur aplikasi

- Pemilih: `/v2`
- Admin: `/admin-v2`
- API v2: `/api/v2/*`
- API dan halaman lama tidak diganti oleh branch ini.

## Rilis dua tahap

**Tahap 1 — pre-backup:** branch ini hanya menambahkan `/v2`, `/admin-v2`, dan `/api/v2/*`. Halaman utama, `/admin`, dan API v1 tetap berjalan seperti semula. Tidak ada redirect cutover dan tidak ada data lama yang diubah.

**Tahap 2 — cutover:** hanya setelah backup legacy berhasil dan manifest diverifikasi, terapkan rilis terpisah yang mengarahkan `/` serta `/index.html` ke `/v2`, mengarahkan `/admin` serta `/admin.html` ke `/admin-v2`, dan membuat API v1 read-only. Jangan jalankan tahap 2 sebelum backup terverifikasi.

## Database wajib untuk membuka pemilihan

Netlify Functions memakai PostgreSQL untuk transaksi suara. Tambahkan environment variable:

- `DATABASE_URL`: pooled PostgreSQL connection string dari Neon, Supabase, atau penyedia PostgreSQL lain. Gunakan endpoint pooler/serverless yang disediakan provider.
- `ADMIN_BOOTSTRAP_PASSWORD`: password awal admin yang kuat (minimal 8 karakter), bila belum tersedia pada store admin.
- Untuk Deploy Preview, set `ADMIN_BOOTSTRAP_PASSWORD` pada konteks preview karena store admin preview terisolasi dari production.

Jangan commit connection string atau password ke GitHub. Untuk Netlify Deploy Preview/Branch Deploy, gunakan database staging yang terpisah dari database production.

Netlify Blobs pada preview menggunakan nama store terpisah dengan prefix `v2-preview-`. Store production yang lama tetap memakai nama semula.

## Langkah uji sebelum production

1. Hubungkan Deploy Preview ke database staging melalui `DATABASE_URL`.
2. Masuk ke `/admin-v2` pada URL preview.
3. Tambahkan akun uji dan isi dua calon Ketua serta dua calon Wakil. Setiap calon harus memiliki nama dan foto.
4. Simpan konfigurasi, kemudian ubah status menjadi Dibuka.
5. Jalankan load test dari komputer lokal dengan Node.js 20 atau lebih baru:

```bash
BASE_URL="https://URL-DEPLOY-PREVIEW" \
ADMIN_USERNAME="admin_dpt" \
ADMIN_PASSWORD="PASSWORD_ADMIN_STAGING" \
VU_COUNT=100 \
node scripts/load-test-v2.mjs
```

Script membuat akun uji baru, login bersamaan, lalu mengirim 100 surat suara secara paralel. Ia juga memastikan percobaan suara kedua pada akun yang sama ditolak. Jalankan hanya pada staging karena akun dan surat suara uji akan tertinggal sampai admin melakukan reset terarsip.

## Backup legacy sebelum cutover

Setelah rilis tahap 1 dipromosikan ke production (halaman utama lama masih tetap aktif):

1. Buka `/admin-v2` pada domain production.
2. Masuk menggunakan akun admin yang sama.
3. Buka menu Keamanan & Arsip.
4. Jalankan **Buat backup data trial lama**.
5. Pastikan notifikasi menampilkan backup ID dan jumlah record voter-lock serta ballot yang disalin.
6. Verifikasi backup ID dan jumlah record sebelum menyetujui rilis tahap 2 (cutover).

Backup legacy hanya diizinkan pada Netlify Production Context. Data asli pada `evoting-config` dan `evoting-votes` tidak dihapus. Arsip bersifat privat karena struktur voter-lock lama dapat mengandung hubungan internal antara akun dan pilihan.

## Catatan privasi dan kapasitas

Selama status pemilihan `open`, rekap perolehan setiap calon disembunyikan dari dashboard admin. Admin tetap melihat jumlah akun yang sudah/belum berpartisipasi. Rekap calon baru tersedia setelah pemilihan ditutup untuk mengurangi potensi bias.


- Tabel partisipasi menyimpan ID pemilih dan waktu, bukan pilihan.
- Tabel ballot menyimpan pilihan Ketua dan Wakil, tanpa ID pemilih atau foreign key ke pemilih.
- Dua pilihan dan status penggunaan hak suara disimpan dalam satu transaksi PostgreSQL.
- Admin hanya melihat status partisipasi per akun dan hasil agregat per jabatan.
- Target 100 pemilih serentak belum dianggap lulus sebelum script beban dijalankan pada staging dengan paket Netlify dan konfigurasi database yang sama seperti production.
