# Dashboard Quick Count Pilkades Wonogiri 2026 (Vercel, gratis, tanpa Google Cloud)

Alur: PIC -> 18 workbook -> Apps Script -> sheet `Data` -> Apps Script `?api=1` (JSON) -> `/api/data` (Vercel, cache 30 dtk) -> halaman publik.

## 1. Apps Script
1. Project Settings > Script properties > tambah `API_TOKEN` = teks acak panjang (mis. 32 karakter).
2. Deploy > New deployment > Web app: Execute as **Me**, Who has access **Anyone**. Salin URL yang berakhiran `/exec`.
3. Tes di browser: `URL/exec?api=1&token=TOKEN_KAMU` harus menampilkan JSON. Tanpa token harus `unauthorized`.
Setiap mengubah Code.gs: Deploy > Manage deployments > Edit > New version.

## 2. Vercel
Env vars: `APPS_SCRIPT_URL` (URL /exec) dan `API_TOKEN` (sama dengan di atas). Framework Preset: Other. Tanpa build command.

## Foto calon
Taruh di `public/foto/` (mis. `sumarno.jpg`, 300 px, < 40 KB), isi kolom `foto_url` di `Config_Calon` dengan nama file.
