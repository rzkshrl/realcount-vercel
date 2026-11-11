# Dashboard Quick Count Pilkades Wonogiri 2026 (Vercel)

Alur: PIC -> 18 workbook -> Apps Script `pullAll` -> sheet `Data` di DB Pusat -> `/api/data` (Vercel, cache 30 dtk) -> halaman publik.

## Setup
1. Google Cloud Console: buat project, aktifkan **Google Sheets API**.
2. IAM & Admin > Service Accounts: buat service account, lalu Keys > Add key > JSON. Simpan file JSON-nya.
3. Buka spreadsheet **DB Pusat**, Share ke email service account (`...iam.gserviceaccount.com`) sebagai **Viewer**.
4. Vercel: import repo/folder ini. Di Settings > Environment Variables isi:
   - `SHEET_ID`        : ID spreadsheet DB Pusat (bagian antara /d/ dan /edit pada URL)
   - `GOOGLE_SA_EMAIL` : `client_email` dari JSON
   - `GOOGLE_SA_KEY`   : `private_key` dari JSON (tempel apa adanya, termasuk BEGIN/END)
5. Deploy. Tes: buka `/api/data` (harus keluar JSON) lalu halaman utama.

## Foto calon
Taruh file di `public/foto/` (mis. `sumarno.jpg`), lalu isi kolom `foto_url` di `Config_Calon` dengan nama file tersebut.
Kolom `nomor_urut` diisi setelah pengundian. Perubahan sheet muncul di dashboard dalam kurang dari 1 menit.

## Catatan
- Jangan commit file JSON service account ke repo.
- Sheet `PIC` (berisi email) tidak dibaca oleh API.

## Tetap gratis
- `/api/data` di-cache 30 detik di CDN Vercel (`s-maxage=30`): berapa pun pengunjungnya, fungsi hanya jalan beberapa kali per menit.
- Halaman hanya memuat ulang data saat tab terlihat (tiap 45 detik).
- Kompres foto calon (300 px, WebP/JPG, di bawah 40 KB) supaya bandwidth aman.
- Paket Hobby Vercel ditujukan untuk penggunaan non-komersial; untuk proyek instansi cek syarat penggunaannya.
