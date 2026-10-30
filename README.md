# EvotingDPT — Redesign Futuristik

URL GitHub Pages:
- Pemilih: https://fadhilzulfiqar.github.io/evotingDPT/
- Admin: https://fadhilzulfiqar.github.io/evotingDPT/admin.html

## File utama
- index.html: portal pemilih
- admin.html: portal admin
- style.css: tema futuristik emas/gelap
- app.js: logika demo lokal
- assets/: logo DPT dan empat foto kandidat

## Upload aset visual
Ekstrak file `EvotingDPT_assets_upload.zip`, lalu unggah semua file di dalam folder `assets` ke folder `assets` pada repository GitHub.

Nama file harus persis:
- logo-dpt.webp
- paslon-01-ketua.webp
- paslon-01-wakil.webp
- paslon-02-ketua.webp
- paslon-02-wakil.webp

Urutan foto mengikuti urutan unggahan: Ketua Paslon 01, Wakil Paslon 01, Ketua Paslon 02, Wakil Paslon 02.

## Batasan penting GitHub Pages
GitHub Pages hanya menyediakan hosting statis. Versi ini adalah prototipe/latihan:
- akun dan password diperiksa di browser;
- data suara dan status pemilih disimpan di localStorage browser;
- data dari HP pemilih tidak otomatis masuk ke dashboard admin;
- satu akun bisa mencoba lagi dari perangkat/browser lain;
- perubahan kandidat/foto/visi/misi dari admin hanya tersimpan pada browser admin.

Karena itu jangan gunakan versi ini untuk pemilihan resmi lintas perangkat. Pemilihan resmi memerlukan backend dan database terpusat dengan validasi server-side.

## Keamanan
Password awal dibagikan terpisah kepada pemilik akun. Jangan menyimpan password dalam repository publik. Segera ganti password admin pada perangkat admin jika memakai simulasi.
