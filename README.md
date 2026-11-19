# Quick Count Pilkades Wonogiri 2026

Satu admin menginput semua data di `/admin`. Google Sheet hanya database, Apps Script (Code.gs) hanya backend API.
Alur: /admin -> /api/admin -> Apps Script -> sheet (Config_Calon, Desa, Suara, Log) -> /api/data (cache 30 dtk) -> dashboard `/`.

## Apps Script
1. Tempel Code.gs di Extensions > Apps Script pada spreadsheet DB Pusat, jalankan `setupDB` (merapikan Config_Calon lama, menambah id, membuat sheet Desa/Suara/Log).
2. Script properties: `API_TOKEN` dan `ADMIN_KEY`.
3. Jalankan `cleanupOldTriggers` (sistem 18 workbook tidak dipakai lagi), lalu `diagnose`.
4. Deploy > Web app: Execute as Me, access Anyone. Setiap Code.gs berubah: New version.

## Vercel
Env: `APPS_SCRIPT_URL` (URL /exec), `API_TOKEN` (sama). Setelah ubah env: Redeploy.

## Pemakaian /admin
- Input suara: pilih kecamatan dan desa, isi suara tiap calon, pilih status, Simpan (atau Simpan dan lanjut).
- Calon dan foto: tambah/ubah calon, nomor urut, rasio dan potong foto (otomatis <= 40 KB).
- Pengaturan: kosongkan semua suara setelah uji coba.

## Tampilan publik (pembaruan desain)
- Gaya mengikuti poster Pemkab Wonogiri: ornamen gelombang merah-putih, awan mega mendung, bingkai emas dengan label tab, lambang daerah dan logo "Wonogiri Maju Sejahtera Berkelanjutan" (`public/img/`). Font Plus Jakarta Sans disimpan lokal di `public/fonts/` (27 KB).
- Nama calon tampil dengan huruf kapital di awal setiap kata; gelar sesudah koma dibiarkan seperti input. Nama yang disimpan dari /admin ikut dirapikan.
- Label "Petahana" tidak ditampilkan di dashboard (masih bisa diatur di /admin).
- Untuk warga: tombol Ikuti (desa tersimpan di HP), tombol Bagikan (WhatsApp/berbagi bawaan HP) dengan tautan langsung ke desa (`/#desa=Kecamatan|Desa`), data terakhir tersimpan agar tetap tampil saat sinyal lemah, kartu desa dimuat bertahap 24 per halaman, foto calon dimuat saat terlihat.
