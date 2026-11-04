# Deploy E-Voting DPT ke Netlify

Aplikasi menggunakan frontend statis, Netlify Functions, dan Netlify Blobs. Tidak memerlukan database eksternal.

## 1. Hubungkan repository

1. Masuk ke Netlify.
2. Pilih **Add new project / Import an existing project**.
3. Hubungkan repository `fadhilzulfiqar/evotingDPT`.
4. Pilih branch produksi yang telah disetujui untuk site `evotedpt`.
5. Publish directory: `public`.
6. Functions directory: `netlify/functions`.

## 2. Password admin

Jika store administrator belum memiliki data admin, atur environment variable:

- Key: `ADMIN_BOOTSTRAP_PASSWORD`
- Value: password kuat minimal 8 karakter.

Username admin: `admin_dpt`. Jangan menaruh password di GitHub atau membagikannya di chat.

## 3. Halaman dan API

- Pemilih: `/v2`
- Dashboard admin: `/admin-v2`
- Health check: `/api/v2/health`

## 4. Pengelolaan pemilih

Admin dapat menambahkan akun satu per satu atau impor massal dengan format:

`Nama | Username | Password`

## 5. Model surat suara

Setiap pemilih mengirim satu pilihan Ketua dan satu pilihan Wakil dalam satu request. Backend memvalidasi kedua calon, membuat klaim partisipasi per akun menggunakan conditional create, lalu menyimpan ballot tanpa ID pemilih. Token pemrosesan sementara dihapus setelah partisipasi berstatus selesai.

## 6. Sebelum pemilihan resmi

1. Isi nama dan foto dua calon Ketua serta dua calon Wakil.
2. Impor dan verifikasi daftar akun pemilih.
3. Lakukan uji login lintas perangkat.
4. Uji pengiriman suara ganda dari akun/perangkat berbeda.
5. Jalankan load test pada deploy preview dengan akun uji khusus.
6. Pastikan tidak ada transaksi tertunda dan jumlah partisipasi selesai sama dengan jumlah ballot.
7. Arsipkan data trial sebelum reset.
8. Buka pemilihan resmi hanya setelah seluruh pemeriksaan disetujui panitia.

## 7. Batasan teknis

Netlify Blobs adalah object storage, bukan database relasional dengan transaksi multi-record. Conditional writes digunakan untuk mengklaim hak pilih per akun dan mengurangi risiko duplikasi. Pengujian beban pada deployment aktual tetap wajib, terutama untuk pengiriman serentak.
