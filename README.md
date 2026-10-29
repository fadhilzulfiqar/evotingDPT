# EvotingDPT

E-Voting Ketua dan Wakil Ketua DPT Politeknik Agraria STPN Periode 2026–2027.

## Deploy online gratis

Repository ini sudah disiapkan untuk **Render Free Web Service + Render Postgres** menggunakan `render.yaml`.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/fadhilzulfiqar/evotingDPT)

Setelah deployment selesai, Render akan memberikan URL publik berbentuk `https://evotingdpt-....onrender.com`.

### Halaman
- Pemilih: `/`
- Admin: `/admin`

### Login admin awal
- Username: `admin_dpt`
- Password: `GantiPasswordAdmin2026!`

**Segera ganti password admin setelah deployment pertama.**

## Fitur
- 2 pasangan calon, foto/nama/visi/misi dapat diedit dari admin.
- Login pemilih dengan username/NIM dan password unik.
- Satu akun hanya dapat memilih satu kali.
- Identitas pemilih dipisahkan dari agregat suara.
- Dashboard admin: total pemilih, sudah/belum memilih, partisipasi, hasil suara.
- Tambah pemilih satu per satu atau massal.
- Hapus pemilih yang belum memilih.
- Reset Data Latihan untuk mengembalikan seluruh suara ke 0 dan membuka kembali hak pilih seluruh akun.
- Penyimpanan online menggunakan PostgreSQL.

## Catatan Render Free
Render Free Web Service dapat tidur setelah tidak aktif dan membutuhkan waktu untuk bangun saat kunjungan pertama. Render Postgres Free saat ini memiliki masa berlaku terbatas, sehingga gunakan untuk latihan/pemilihan jangka pendek dan simpan rekap hasil setelah kegiatan selesai.
