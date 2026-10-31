# EvotingDPT — Portal Pemilihan DPT 2026–2027

## Versi aplikasi

- **Netlify (aplikasi aktif):** Netlify membangun situs dari folder `public/` sesuai `netlify.toml`. Versi ini memakai Netlify Functions dan Netlify Blobs untuk autentikasi, akun pemilih, konfigurasi, dan penyimpanan suara terpusat.
- **GitHub Pages (prototipe statis):** file di folder utama repository merupakan versi demo antarmuka berbasis browser. Data pada versi ini tidak tersinkron antarperangkat dan tidak boleh digunakan untuk pemilihan resmi.

## Fitur versi Netlify

- Login pemilih dan administrator dengan sesi server.
- Satu akun pemilih hanya dapat mengirim satu suara.
- Dua pasangan calon, foto ketua/wakil, visi, misi, dan slogan dapat dikelola dari dashboard admin.
- Data pemilih dapat ditambahkan satu per satu atau diimpor secara massal.
- Rekap suara dan partisipasi tersimpan terpusat.
- Reset pemilihan tetap tersedia di menu **Keamanan Admin**. Reset menghapus seluruh surat suara dan status hak pilih, tetapi **tidak menghapus daftar akun pemilih**.
- Reset hanya dapat dilakukan setelah status pemilihan ditutup atau belum dimulai, dan memerlukan dua kali konfirmasi.

## Deployment Netlify

- Build publish directory: `public`
- Functions directory: `netlify/functions`
- Endpoint pemeriksaan: `/api/health`
- Penyimpanan: Netlify Blobs

Pastikan environment variable `ADMIN_BOOTSTRAP_PASSWORD` diatur pada Netlify dengan password yang kuat (minimal 8 karakter). Jangan menyimpan password administrator atau password pemilih dalam repository.

## Catatan keamanan pemilihan

Sebelum pemilihan resmi, lakukan uji coba menyeluruh: login lintas perangkat, satu akun satu suara, percobaan pengiriman ganda, perubahan status buka/tutup, rekap suara, dan prosedur reset. Arsipkan hasil sebelum reset. Pastikan akses dashboard admin hanya diberikan kepada panitia yang berwenang.
