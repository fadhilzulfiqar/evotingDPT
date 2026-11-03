# E-Voting DPT — Revisi Pemilihan Independen v2

## Keputusan ruang lingkup

- Pemilihan Ketua dan Wakil Ketua dilakukan secara terpisah.
- Masing-masing jabatan memiliki dua kandidat: Ketua 01/02 dan Wakil 01/02.
- Satu akun wajib mengirim tepat satu pilihan untuk setiap jabatan dalam satu pengiriman.
- Kartu kandidat hanya menampilkan foto, nomor urut, dan nama lengkap.
- Data uji coba lama dipertahankan dan diarsipkan; tidak ada reset otomatis.
- Identitas pemilih tidak disimpan pada baris surat suara dan pilihan tidak ditampilkan pada dashboard admin.

## Arsitektur

- Akun, sesi, konfigurasi, dan foto: Netlify Blobs.
- Hak pilih, surat suara, agregasi, dan audit: PostgreSQL.
- Gunakan `DATABASE_URL` dari pooled PostgreSQL connection string.
- Pemungutan suara dilakukan dalam satu transaksi PostgreSQL.
- Tabel partisipasi hanya menyimpan `election_id`, `voter_id`, dan `voted_at`.
- Tabel surat suara hanya menyimpan ID acak, election ID, idempotency key, kandidat Ketua, kandidat Wakil, dan waktu.
- Tidak ada voter ID, username, nama, atau foreign key pemilih pada tabel surat suara.
- Tidak ada ballot ID atau candidate ID pada tabel partisipasi.
- Idempotency key acak membantu permintaan ulang setelah timeout tanpa membuat suara ganda.

## Backup data lama

Sebelum cutover:
1. Admin menjalankan arsip legacy dari dashboard v2.
2. Backend menyalin konfigurasi lama dan record `voter/*` serta `ballot/*` ke store privat `evoting-legacy-archive`.
3. Manifest menyimpan waktu, jumlah record, dan status backup.
4. Data asli di `evoting-config` dan `evoting-votes` tidak dihapus.
5. Data akun tetap berada di store asli dan tidak disalin ke arsip agar hash password tidak diduplikasi.

Arsip legacy dapat memuat struktur lama yang mengandung hubungan internal voter-lock dengan pilihan. Arsip hanya untuk preservasi, tidak ditampilkan melalui API dashboard, dan harus dibatasi aksesnya pada akun/layanan Netlify.

## Status deployment

Branch ini hanya untuk pengembangan dan preview. Jangan merge ke `main` atau mengubah domain produksi sebelum:
- DATABASE_URL pooled Postgres disetel pada Netlify.
- Backup legacy berhasil dan manifest terverifikasi.
- Uji login, pemilihan wajib dua jabatan, idempotency, satu akun satu surat suara, tutup/buka pemilihan, penghapusan/penonaktifan akun, reset terarsip, dan ekspor lulus.
- Uji beban 100 akun/perangkat pada staging lulus.

## Batas klaim kapasitas

Target desain adalah 100 pemilih serentak. Kapasitas belum boleh dinyatakan lulus sampai load test pada staging dengan database dan paket Netlify yang sama selesai. PostgreSQL memakai transaksi dan constraint unik; Netlify Blobs tidak digunakan untuk counter atau transaksi suara.
