# DPT E-Voting STPN 2026–2027

Aplikasi e-voting Ketua dan Wakil Ketua DPT Politeknik Agraria STPN.

## Jalankan lokal

```bash
npm start
```

Buka `http://localhost:3000` dan admin di `http://localhost:3000/admin`.

## Jalankan dengan GitHub Codespaces

1. Klik **Code** > **Codespaces** > **Create codespace on main**.
2. Tunggu Codespace selesai dibuat. Aplikasi akan otomatis berjalan pada port `3000`.
3. Buka tab **PORTS**.
4. Klik kanan port `3000` > **Port Visibility** > **Public**.
5. Salin URL pada kolom **Forwarded Address**. Formatnya `https://NAMA-CODESPACE-3000.app.github.dev`.
6. Link itu dapat dibagikan ke pemilih selama Codespace tetap berjalan.

> Catatan: port publik GitHub Codespaces kembali menjadi private setelah Codespace direstart. Data pemilih dan suara disimpan di folder `runtime_data/` di Codespace dan tidak di-commit ke repository.

## Admin

Buka `/admin`. Username awal: `admin_dpt`. Ganti password admin segera setelah login.

## Keamanan

- 1 akun pemilih hanya dapat memberikan 1 suara.
- Password disimpan dalam bentuk hash scrypt.
- Pilihan suara tidak disimpan bersama identitas pemilih.
- Data runtime tidak dimasukkan ke Git (`runtime_data/` diabaikan).
