# E-Voting DPT v2 — setup dan pengujian

## Jalur aplikasi

- Portal pemilih utama: `/` (alias `/v2`)
- Dashboard admin utama: `/admin` (alias `/admin-v2`)
- API v2: `/api/v2/*`
- API v1 tetap tersedia sampai cutover disetujui.

## Penyimpanan

Versi v2 menggunakan Netlify Blobs untuk seluruh data. Tidak diperlukan `DATABASE_URL`, Neon, Supabase, atau server PostgreSQL.

Store dan prefix data:
- Konfigurasi: `evoting-config`, key `v2/main`
- Akun: `evoting-users`, key `user/*` dan `username/*`
- Partisipasi v2: `evoting-votes`, prefix `v2/participation/*`
- Surat suara anonim: `evoting-votes`, prefix `v2/ballot/*`
- Transaksi sementara: `evoting-votes`, prefix `v2/pending/*`
- Audit admin: `evoting-votes`, prefix `v2/audit/*`
- Sesi dan admin: store Netlify Blobs yang telah digunakan aplikasi.

Partisipasi hanya berisi status dan waktu. Ballot hanya berisi pilihan Ketua, pilihan Wakil, waktu, dan versi konfigurasi. Selama request diproses, token transaksi sementara menghubungkan klaim pending dengan ballot pending agar retry dapat dipulihkan. Setelah partisipasi selesai, token tersebut dihapus dan tidak ada ID pemilih pada ballot final.

## Pemilihan

1. Admin mengatur dua calon Ketua dan dua calon Wakil, masing-masing dengan nama dan foto.
2. Admin membuka status pemilihan setelah semua data lengkap.
3. Pemilih wajib memilih satu calon dari setiap jabatan.
4. Backend membuat klaim per akun menggunakan `onlyIfNew`.
5. Backend menyimpan satu ballot anonim yang memuat kedua pilihan.
6. Dashboard memantau partisipasi dan hanya menampilkan hasil kandidat setelah pemilihan ditutup.

## Backup legacy

Sebelum cutover:
1. Tutup pemilihan trial lama pada dashboard v1.
2. Masuk ke `/admin-v2` pada production.
3. Buka menu Keamanan & Arsip.
4. Jalankan **Buat backup data trial lama**.
5. Periksa backup ID, jumlah akun, voter-lock, ballot, dan checksum.
6. Jangan menghapus store lama sebelum arsip diverifikasi.

## Reset v2

Reset hanya dapat dilakukan pada production ketika status tidak open/closing. Backend memulihkan transaksi pending, menyalin ballot dan partisipasi ke arsip privat Netlify Blobs, memverifikasi salinan dan checksum, baru menghapus data aktif v2. Akun pemilih dan konfigurasi calon tidak dihapus.

## Load test

Jalankan pada deploy preview, bukan domain pemilihan produksi:

```bash
BASE_URL="https://URL-DEPLOY-PREVIEW" \
ADMIN_USERNAME="admin_dpt" \
ADMIN_PASSWORD="PASSWORD_ADMIN_STAGING" \
VU_COUNT=100 \
node scripts/load-test-v2.mjs
```

Script membuat akun uji, login secara paralel, mengirim pilihan Ketua dan Wakil secara serentak, mencoba suara kedua, lalu memeriksa jumlah partisipasi selesai dan transaksi tertunda.

Netlify Blobs mendukung conditional writes, tetapi bukan transaksi multi-record. Karena itu hasil load test harus diperiksa; kapasitas 100 pemilih tidak boleh dianggap lulus sebelum pengujian pada deployment yang sesungguhnya berhasil.
