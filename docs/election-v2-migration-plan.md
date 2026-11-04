# E-Voting DPT v2 — Migration and Verification Plan

## Keputusan rilis

- Domain produksi target: `evotedpt.netlify.app`.
- Versi final menggunakan pemilihan independen: satu pilihan Ketua dan satu pilihan Wakil dalam satu surat suara.
- Data trial v1 boleh direset sesuai persetujuan pemilik, tetapi tetap diarsipkan dan diverifikasi sebelum penghapusan.
- v2 menggunakan Netlify Blobs saja; tidak membutuhkan Neon, Supabase, PostgreSQL, atau `DATABASE_URL`.

## Model ballot

Satu request berisi `chairCandidateId` dan `viceCandidateId`. Keduanya wajib valid. Tampilan berisi foto, nomor calon, dan nama lengkap untuk dua calon Ketua serta dua calon Wakil. Tidak ada visi-misi.

Ballot final berisi kedua pilihan, waktu, dan versi konfigurasi, tanpa ID pemilih, username, atau nama. Status partisipasi disimpan pada key terpisah per akun dan tidak memuat candidate ID. Token transaksi sementara hanya dipakai untuk menyelesaikan retry dan dihapus setelah transaksi selesai.

## Netlify Blobs

- Konfigurasi v2: `evoting-config/v2/main`.
- Akun pemilih: `evoting-users/user/*` dan `username/*`.
- Partisipasi: `evoting-votes/v2/participation/*`.
- Ballot anonim: `evoting-votes/v2/ballot/*`.
- Pending transaction: `evoting-votes/v2/pending/*`.
- Audit: `evoting-votes/v2/audit/*`.
- Arsip: `evoting-legacy-archive/*`.

v1 menggunakan prefix key lama (`voter/*`, `ballot/*`, `main`) dan tidak dicampur dengan prefix v2. Conditional create `onlyIfNew` digunakan untuk klaim hak pilih per akun. ETag conditional update dipakai untuk menyelesaikan transaksi pending.

## Admin

- Overview: total akun, akun aktif, selesai memilih, belum memilih, pending, partisipasi, status.
- Manajemen pemilih: tambah, impor, edit, aktivasi/nonaktifkan, dan status waktu partisipasi.
- Calon: dua Ketua dan dua Wakil, foto, nomor, nama.
- Hasil: jumlah dan persentase terpisah per jabatan, disembunyikan selama status open.
- Audit admin dan reset terarsip.
- Reset menolak status open/closing dan transaksi pending yang belum dapat dipulihkan.

## Batasan teknis

Netlify Blobs adalah object storage dengan conditional writes, bukan database relasional dan bukan transaksi multi-object. Implementasi v2 memakai klaim unik per akun dan pemulihan transaksi sementara, tetapi tidak boleh diasumsikan memiliki jaminan transaksi penuh. Uji beban dan rekonsiliasi harus dilakukan di deploy preview yang setara dengan production. Jika hasil uji tidak memenuhi kebutuhan, gunakan database transaksional sebelum pemilihan resmi.

## Load test acceptance

- 100 akun berbeda login serentak.
- 100 akun berbeda mengirim surat suara dua jabatan dalam batch paralel.
- Pengiriman kedua dari akun sama ditolak.
- Request ulang setelah timeout tidak menghasilkan ballot ganda.
- Akun dengan pilihan Ketua atau Wakil tidak valid ditolak.
- Jumlah partisipasi selesai sama dengan jumlah ballot yang sah.
- Tidak ada transaksi pending yang tertinggal setelah proses.
- Ulangi test dan catat HTTP error, latensi, dan Netlify Function errors.

## Acceptance checklist

- [ ] Backup v1 dibuat dan checksum diverifikasi.
- [ ] v2 UI diuji pada desktop dan mobile.
- [ ] Empat calon tampil dengan benar.
- [ ] Satu akun wajib memilih kedua jabatan.
- [ ] Suara ganda ditolak.
- [ ] Privasi ballot ditinjau.
- [ ] Load test staging lulus dan hasil direkam.
- [ ] Jumlah partisipasi dan ballot direkonsiliasi.
- [ ] Pemulihan transaksi pending diuji.
- [ ] Cutover dan rollback disetujui pemilik.
