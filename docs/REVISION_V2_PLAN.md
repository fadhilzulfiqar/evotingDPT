# E-Voting DPT — Revisi Pemilihan Independen v2

## Keputusan ruang lingkup

- Pemilihan Ketua dan Wakil Ketua dilakukan secara terpisah.
- Masing-masing jabatan memiliki dua kandidat: Ketua 01/02 dan Wakil 01/02.
- Satu akun wajib mengirim tepat satu pilihan untuk setiap jabatan dalam satu pengiriman.
- Kartu kandidat hanya menampilkan foto, nomor urut, dan nama lengkap; tidak ada visi-misi.
- Data uji coba lama dipertahankan dan diarsipkan; tidak ada reset otomatis.
- Admin dapat melihat status keikutsertaan dan waktu partisipasi, tetapi tidak dapat melihat pilihan per pemilih.

## Arsitektur

- Akun, sesi, konfigurasi, dan foto: Netlify Blobs.
- Hak pilih, surat suara, agregasi, dan audit: PostgreSQL.
- Gunakan `DATABASE_URL` dari pooled PostgreSQL connection string.
- Pemungutan suara dilakukan dalam satu transaksi PostgreSQL.
- Tabel partisipasi hanya menyimpan `election_id`, `voter_id`, dan `voted_at`.
- Tabel surat suara hanya menyimpan ID acak, election ID, idempotency key, kandidat Ketua, dan kandidat Wakil.
- Tabel surat suara tidak menyimpan voter ID, username, nama, foreign key pemilih, maupun timestamp.
- Timestamp hanya berada pada tabel partisipasi. Timestamp ballot sengaja dihilangkan agar tidak dapat dicocokkan dengan timestamp partisipasi untuk menebak pilihan pemilih.
- Tidak ada ballot ID atau candidate ID pada tabel partisipasi.
- Idempotency key acak membantu permintaan ulang setelah timeout tanpa membuat suara ganda.
- Constraint unik pada partisipasi memastikan satu akun hanya dapat menggunakan hak suara satu kali.
- Pilihan Ketua dan Wakil wajib valid dan disimpan sebagai satu surat suara; tidak ada ballot setengah jadi.

## Dashboard admin

- Ringkasan total akun, akun aktif, sudah/belum memilih, persentase partisipasi, dan status pemilihan.
- Pengelolaan empat calon: dua Ketua dan dua Wakil, masing-masing foto, nomor urut, dan nama lengkap.
- Pengelolaan akun: tambah, impor massal, edit nama/password, nonaktifkan, dan aktifkan kembali.
- Akun yang sudah memilih tidak dapat dinonaktifkan; akun yang belum memilih dapat dinonaktifkan dengan audit.
- Rekap suara Ketua dan Wakil ditampilkan terpisah dan disembunyikan saat pemilihan OPEN.
- Audit aktivitas admin, ekspor CSV, backup legacy, dan reset V2 dengan arsip otomatis.
- Tidak ada fitur untuk menghubungkan identitas pemilih dengan pilihan.

## Backup data lama

Sebelum cutover:
1. Admin menutup pemilihan trial lama melalui dashboard V1.
2. Admin menjalankan arsip legacy dari dashboard V2 pada Production Context.
3. Backend menyalin konfigurasi lama serta record `voter/*` dan `ballot/*` ke store privat `evoting-legacy-archive`.
4. Backend membandingkan sumber sebelum/sesudah penyalinan, membaca ulang setiap objek arsip, dan memverifikasi manifest.
5. Data asli di `evoting-config` dan `evoting-votes` tidak dihapus.
6. Data akun tetap berada di store asal; jumlah akun yang dipertahankan dicatat pada manifest.

Arsip legacy dapat memuat struktur V1 yang mengandung hubungan internal voter-lock dengan pilihan. Arsip hanya untuk preservasi, tidak ditampilkan melalui API dashboard atau ekspor, dan harus dibatasi aksesnya pada akun/layanan Netlify.

Production tidak dapat membuka pemilihan V2 sebelum manifest backup legacy yang lolos verifikasi tersedia.

## Status deployment

Branch ini hanya untuk pengembangan dan preview. Jangan merge ke `main` atau mengubah domain produksi sebelum:
- Pooled `DATABASE_URL` staging disetel pada Netlify Deploy Preview.
- UI pemilih dan admin lolos pemeriksaan desktop/mobile.
- Backup legacy berhasil dan manifest serta read-back terverifikasi.
- Uji login, pemilihan wajib dua jabatan, idempotency, satu akun satu surat suara, tutup/buka pemilihan, penonaktifan akun, reset terarsip, dan ekspor lulus.
- Uji beban 100 akun/perangkat pada staging lulus.
- Prosedur rollback ke V1 telah disiapkan.

## Batas klaim kapasitas

Target desain adalah 100 pemilih serentak. Kapasitas belum boleh dinyatakan lulus sampai load test pada staging dengan paket Netlify dan konfigurasi database yang sama selesai. Script menguji 100 submission paralel, dua request bersamaan untuk satu akun, retry idempotent, penolakan suara kedua, dan rekonsiliasi total ballot Ketua/Wakil dengan jumlah partisipasi. Script otomatis menutup pemilihan staging setelah tes. PostgreSQL memakai transaksi dan constraint unik; Netlify Blobs tidak digunakan untuk transaksi suara.
