# Deploy EvotingDPT ke Netlify

Versi ini memakai frontend statis di folder `public/`, Netlify Functions sebagai API, dan Netlify Blobs sebagai penyimpanan pusat.

## 1. Import repository
1. Masuk ke Netlify.
2. Pilih **Add new project / Import an existing project**.
3. Pilih GitHub dan repository `fadhilzulfiqar/evotingDPT`.
4. Branch produksi: `main`.
5. Netlify akan membaca `netlify.toml` otomatis.
6. Publish directory: `public`.
7. Functions directory: `netlify/functions`.

## 2. Password admin awal
Sebelum login admin pertama kali, disarankan menambahkan environment variable:

- Key: `ADMIN_BOOTSTRAP_PASSWORD`
- Value: password admin kuat minimal 8 karakter

Username admin tetap: `admin_dpt`.

Setelah berhasil masuk, password dapat diganti lagi dari menu **Keamanan Admin**.

## 3. URL
Setelah deploy, Netlify memberi alamat seperti:

- Pemilih: `https://nama-site.netlify.app/`
- Admin: `https://nama-site.netlify.app/admin.html`
- Health check API: `https://nama-site.netlify.app/api/health`

## 4. Cara menambah pemilih
Dari halaman Admin, pemilih dapat ditambahkan satu per satu atau melalui import massal dengan format:

`Nama | NIT | Password`

Contoh:

`Andi Saputra | 23123456 | DPT-A7K92`

## 5. Mekanisme suara
- Login diperiksa di server, bukan di browser.
- Satu NIT hanya dapat memiliki satu status penggunaan hak suara.
- Surat suara disimpan terpisah dari data pemilih setelah proses selesai.
- Dashboard admin menampilkan jumlah suara dan status sudah/belum memilih, bukan pilihan masing-masing NIT.
- Reset Data Latihan hanya menghapus data pemungutan suara; daftar pemilih tetap ada.

## 6. Sebelum pemilihan resmi
1. Isi nama paslon, visi, misi, slogan, dan foto.
2. Import daftar NIT dan password.
3. Lakukan simulasi dengan beberapa akun.
4. Pastikan akun yang sudah memilih tidak bisa memilih lagi dari browser/perangkat lain.
5. Gunakan **Reset Data Latihan** setelah simulasi.
6. Pastikan perolehan suara kembali 0 dan semua pemilih berstatus BELUM MEMILIH.
7. Baru buka status pemilihan untuk pemungutan suara resmi.

> Catatan: jangan menyimpan daftar password pemilih dalam repository GitHub publik. Masukkan daftar melalui dashboard admin setelah site Netlify aktif.
