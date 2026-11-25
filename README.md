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


## Versi TPS + akun desa (November 2026)
Alur baru:
- **49 akun desa** (username + sandi). Akun desa hanya melihat desanya sendiri dan hanya bisa mengisi suara sah di 3 TPS desanya.
  Tidak bisa mengubah calon, foto, akun, atau mengosongkan data. Dicek di Apps Script, bukan hanya disembunyikan di layar.
- **Suara dicatat per TPS** (147 TPS = 49 desa x 3). Total desa = jumlah 3 TPS. Status desa otomatis:
  Final bila 3 TPS Final, Sementara bila ada TPS yang sudah mengirim, Belum masuk bila belum ada.
- **Final mengunci TPS** untuk akun desa (ada konfirmasi sebelum mengunci). Kabupaten membuka kunci dengan mengubah status ke Sementara di "Input per desa".
- **Kabupaten** masuk dengan ADMIN_KEY + nama (nama dicatat di Riwayat). Tab: Monitoring (diperbarui tiap 20 detik), Input per desa (3 TPS berdampingan),
  Input per kecamatan (satu baris per TPS), Calon dan foto, Akun desa (reset sandi, nonaktifkan, keluarkan perangkat), Riwayat, Pengaturan.
- **Salah sandi dihitung per akun** (10x salah -> akun itu saja menunggu 10 menit).
- Peringatan (tidak memblokir): total satu TPS di atas 600 suara sah (`TPS_WARN` di `public/admin.html`), atau angka berubah jauh dari sebelumnya.
- Dashboard publik: progres dihitung per TPS (x/147), kartu desa menampilkan "n/3 TPS masuk" dan tabel "Rincian TPS". Nama operator tidak pernah tampil di publik.

### Sheet baru (sheet lama Desa, Suara, Log tidak dipakai dan tidak diubah)
| Sheet | Isi |
|---|---|
| TPS | tps_id, kecamatan, desa, no_tps (dibuat otomatis 3 per desa) |
| Suara_TPS | tps_id, calon_id, suara, updated, oleh |
| TPS_Status | tps_id, status, updated, oleh |
| Akun | username, role, kecamatan, desa, salt, hash, aktif, last_login (sandi tidak disimpan sebagai teks) |
| Akun_Cetak | sandi awal, SEKALI tampil. Bagikan ke operator lalu HAPUS sheet ini |
| Riwayat | semua perubahan + siapa yang mengubah |

### Cara pasang
1. **Buat salinan spreadsheet** dulu (File > Make a copy) sebagai cadangan.
2. Ganti seluruh isi Code.gs dengan `apps-script/Code.gs`, simpan.
3. Jalankan `setupDB` (menu Quick Count > Setup database). Log akan menulis "TPS: 147, akun baru: 49".
4. Buka sheet **Akun_Cetak**: username + sandi awal 49 desa. Bagikan ke operator masing-masing, lalu **hapus sheet itu**.
5. Jalankan `diagnose` dan pastikan semuanya OK.
6. Deploy > Manage deployments > Edit > Version: New version > Deploy (URL /exec tetap).
7. Push folder ini ke Vercel.
8. Uji coba, lalu Pengaturan > Kosongkan semua suara sebelum hari H. Ganti ADMIN_KEY setelah gladi.

Operator lupa sandi: kabupaten > Akun desa > Reset sandi (sandi baru tampil sekali, perangkat lama otomatis keluar).
Desa baru: tambah calon di "Calon dan foto" (3 TPS dibuat otomatis), lalu Akun desa > "Buat akun untuk desa baru".


## Halaman Petahana (/petahana)
- Halaman publik terpisah: ringkasan petahana menang/kalah, per kecamatan, daftar petahana (saring Menang/Kalah/Belum ada hasil), dan desa tanpa petahana.
- Pindah halaman lewat tombol "Quick Count | Petahana" di bagian atas kedua halaman.
- Menang/kalah diambil dari `public/data/petahana.json`, hasil konversi berkas HASIL PILKADES 2026 - PETAHANA.xlsx
  (hanya nama, desa, kecamatan, nomor urut, status petahana/mengundurkan diri, dan hasil; TTL, alamat, dan nomor suket TIDAK ikut).
- Foto dan angka suara di kartu diambil langsung dari quick count (ditandai "quick count"), dicocokkan per kecamatan + desa.
  Untuk petahana yang hasilnya belum ada, kartu menampilkan posisi sementara quick count (unggul/tertinggal).
- Memperbarui hasil: ganti isi `public/data/petahana.json` (kolom "h": "MENANG" atau "KALAH" pada baris petahana), lalu push ke Vercel.
