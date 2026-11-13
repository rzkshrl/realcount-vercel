# Quick Count Pilkades Wonogiri 2026 (Vercel + Apps Script backend)

Alur: PIC -> 18 workbook -> Code.gs (Apps Script, backend saja) -> sheet `Data` -> JSON API -> Vercel `/api/data` (cache 30 dtk) -> halaman publik.
Halaman: `/` (dashboard publik) dan `/admin` (foto dan nomor urut).

## 1. Apps Script (backend, tanpa halaman)
1. Script properties: `API_TOKEN` (acak, panjang) dan `ADMIN_KEY` (kunci admin).
2. Deploy > New deployment > Web app: Execute as **Me**, access **Anyone**. Salin URL `/exec`. (Hanya untuk API; halaman web tidak disajikan dari sini.)
3. Tes: `URL/exec?api=1&token=TOKEN` harus menampilkan JSON; tanpa token `unauthorized`.
Setiap Code.gs berubah: Deploy > Manage deployments > Edit > New version.

## 2. Vercel
Framework Preset: Other, tanpa build command. Environment variables: `APPS_SCRIPT_URL` (URL /exec) dan `API_TOKEN` (sama).

## 3. Foto calon
Buka `/admin`, masukkan `ADMIN_KEY`, pilih kecamatan dan desa. Foto otomatis dipotong persegi dan dikompres sampai 40 KB atau kurang di browser, lalu disimpan di folder Drive "QC Pilkades 2026 - Foto" dan disajikan lewat `/api/foto` (cache CDN).
