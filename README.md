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

## Pembaruan cepat (versi near real-time)
Wajib dilakukan berurutan setelah update:
1. Ganti seluruh isi Code.gs di Apps Script dengan `apps-script/Code.gs`, simpan.
2. Jalankan `setupDB` sekali (membuat penanda revisi REV), lalu `diagnose` dan cek log.
3. Deploy > Manage deployments > Edit > Version: **New version** > Deploy (URL /exec tetap sama).
4. Push ke Vercel (redeploy otomatis).

Cara kerja:
- Dashboard mengecek `/api/rev` (respons ~40 byte, cache CDN 2 dtk) tiap 8 dtk saat halaman terlihat; 30 dtk bila pengunjung diam lebih dari 10 menit; berhenti saat tab disembunyikan.
- Data lengkap (`/api/data`, cache CDN 2 dtk) hanya diunduh kalau revisi berubah, plus pengaman tiap 5 menit.
- Saat admin menyimpan suara, Apps Script langsung menambal cache dashboard, jadi publik melihat angka baru dalam kira-kira 5-15 detik.
- Untuk menghemat kuota Vercel Hobby (1 juta edge request per bulan), naikkan `POLL_ACTIVE` di `public/index.html` (mis. 15000) bila pengunjung sangat banyak.
- Admin: login sekali, sesi 14 hari disimpan di cookie HttpOnly `qcs` (tidak bisa dibaca JavaScript). Cookie `qca=1` memberi tahu halaman bahwa admin sudah masuk, jadi /admin langsung menampilkan panel dari data terakhir di perangkat lalu memperbarui di belakang. Hapus centang "Tetap masuk" agar sesi berakhir saat browser ditutup. Tombol Keluar menghapus cookie dan data tersimpan. Menu Quick Count > "Keluarkan semua sesi admin" untuk mencabut semua perangkat.
- Simpan suara berjalan di latar belakang: admin bisa langsung lanjut ke desa berikutnya; status penyimpanan tampil di kanan atas, desa yang gagal bisa dicoba lagi.

## Input per kecamatan (admin)
- Tab "Input per kecamatan": semua desa satu kecamatan tampil sekaligus. Enter turun ke desa berikutnya, Shift+Enter naik, Ctrl+S menyimpan.
- Desa yang diubah ditandai kuning, yang salah ditandai merah (bukan angka, atau Final tapi ada suara kosong).
- Sebelum menyimpan, angka yang berubah jauh (3x lipat atau sepertiga, selisih >= 50) ditampilkan untuk diperiksa.
- Semua perubahan dikirim sekaligus (maks 25 desa per permintaan) lewat `saveVotesBatch` di Code.gs; desa yang gagal tetap ditandai dan bisa disimpan ulang.
- Perubahan yang belum disimpan bertahan selama tab terbuka (juga kalau halaman dimuat ulang).
- Foto calon: seret file ke kartu calon, atau tempel (Ctrl+V). Editor punya grid sepertiga, putar 90°, miring ±45°, perbesar (slider/roda/cubit), geser (mouse/jari/panah).

## Sinkron lebih cepat (catatan perubahan)
- Setiap simpan suara, Apps Script mencatat desa yang berubah (60 detik terakhir) di cache `chg`. `/api/rev` ikut membawa catatan ini.
- Dashboard menerapkan catatan itu langsung (tanpa mengunduh data lengkap) bila rantai revisinya utuh. Kalau tidak utuh (misalnya calon/foto diubah, reset, edit manual di sheet), dashboard otomatis mengunduh data lengkap.
- Polling adaptif: 5 dtk selama 2 menit setelah ada perubahan, 8 dtk normal, 30 dtk bila pengunjung diam > 10 menit, berhenti saat tab disembunyikan.
