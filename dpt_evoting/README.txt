DPT POLITEKNIK AGRARIA STPN — E-VOTING 2026–2027
=================================================

VERSI MANDIRI (tanpa Firebase/Supabase/Google Forms)

FITUR
- 2 pasangan calon.
- Foto, nama, visi, misi, slogan dapat diedit dari Dashboard Admin.
- Login pemilih dengan Username/NIM + Password unik.
- 1 akun hanya dapat memilih 1 kali (dicek di server, bukan hanya browser).
- Hasil suara anonim: admin melihat status sudah/belum memilih, tetapi tidak melihat siapa memilih paslon mana.
- Dashboard hasil, persentase partisipasi, perolehan suara, daftar pemilih.
- Tambah pemilih satu per satu atau import banyak dari teks.
- Ganti password admin.
- Tidak membutuhkan npm install / library pihak ketiga. Cukup Node.js.

CARA MENJALANKAN
1. Install Node.js 18 atau lebih baru di komputer/server Anda.
2. Ekstrak folder ini.
3. Buka Command Prompt/Terminal di folder dpt_evoting.
4. Jalankan:
   node server.js
5. Halaman pemilih:
   http://localhost:3000
6. Halaman admin:
   http://localhost:3000/admin

LOGIN ADMIN AWAL
Username : admin_dpt
Password : GantiPasswordAdmin2026!

WAJIB: Setelah login pertama, segera ganti password admin dari menu Keamanan Admin.

AKUN DEMO PEMILIH
pemilih001 / DPT001
pemilih002 / DPT002
pemilih003 / DPT003

Anda dapat menambah akun asli dari Dashboard Admin.

CARA EDIT FOTO PASLON
Dashboard Admin > Pengaturan Pemilihan & Kandidat > pilih file Foto Ketua / Foto Wakil > Simpan Perubahan.
Foto disimpan di data/config.json sebagai data image sehingga tetap tampil setelah restart server.
Disarankan foto < 2,5 MB per file.

CARA SHARE URL
- Dalam Wi-Fi/LAN yang sama: gunakan alamat IP komputer server, contoh http://192.168.1.10:3000
- Agar bisa diakses dari internet tanpa layanan pihak ketiga, Anda perlu server/VPS/domain milik sendiri atau membuka port router ke komputer server.
- Sistem ini sendiri tidak menghasilkan domain publik dari ChatGPT.

CATATAN KEAMANAN
- Password pemilih disimpan dalam bentuk hash scrypt, bukan plaintext.
- Cookie sesi menggunakan HttpOnly dan SameSite=Lax.
- Pemeriksaan satu akun satu suara dilakukan di server.
- Data suara hanya berupa agregat per paslon; pilihan tidak ditempelkan ke identitas pemilih.
- Untuk pemilu skala besar/berisiko tinggi, gunakan HTTPS, backup rutin, server terisolasi, audit log, dan database transaksional profesional.

BACKUP
Salin folder data/ secara berkala. Berkas penting:
- data/config.json
- data/users.json
- data/votes.json
- data/admin.json

