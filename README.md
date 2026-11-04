# E-Voting DPT — Portal Pemilihan 2026–2027

## Versi aplikasi

- **Netlify:** frontend pada folder `public/`, API melalui Netlify Functions, dan penyimpanan terpusat menggunakan Netlify Blobs.
- **Prototipe statis:** file prototipe pada root repository tidak digunakan untuk pemilihan resmi karena penyimpanannya tidak tersinkron antarperangkat.

## Fitur versi final

- Pemilih login dengan akun unik.
- Setiap pemilih wajib memilih satu calon Ketua dan satu calon Wakil dalam satu pengiriman surat suara.
- Dua calon Ketua dan dua calon Wakil ditampilkan secara terpisah dengan foto, nomor calon, dan nama lengkap.
- Tidak ada kolom visi-misi.
- Satu akun hanya dapat menggunakan hak pilih satu kali.
- Dashboard admin menampilkan total akun, status sudah/belum memilih, transaksi tertunda, serta rekap terpisah untuk Ketua dan Wakil.
- Identitas/partisipasi pemilih dan isi surat suara disimpan pada key Netlify Blobs yang terpisah. Setelah transaksi selesai, token proses sementara dihapus dan ballot tidak memuat ID pemilih.
- Reset hanya tersedia setelah pemilihan ditutup, transaksi tertunda dipulihkan, dan backup terverifikasi.

## Deployment Netlify

- Publish directory: `public`
- Functions directory: `netlify/functions`
- Pemilih: `/v2`
- Admin: `/admin-v2`
- Health check: `/api/v2/health`
- Storage: Netlify Blobs

Tidak diperlukan PostgreSQL, Neon, atau environment variable `DATABASE_URL`. Pastikan `ADMIN_BOOTSTRAP_PASSWORD` tersedia bila store admin belum memiliki akun administrator. Jangan menyimpan password dalam repository.

## Catatan kapasitas dan keamanan

Netlify Blobs menyediakan object storage dengan conditional writes. Ini membantu mencegah klaim hak pilih ganda per akun, tetapi bukan pengganti transaksi database relasional. Lakukan load test pada deploy preview dan rekonsiliasi jumlah partisipasi selesai dengan jumlah ballot sebelum pemilihan resmi. Jangan menyatakan kapasitas 60–100 pemilih serentak lulus sebelum pengujian aktual berhasil.
