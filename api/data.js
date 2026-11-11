// Vercel Serverless Function: baca DB Pusat (Google Sheet) via service account, hasil di-cache di edge.
const { google } = require('googleapis');

const isYa = v => String(v ?? '').trim().toLowerCase() === 'ya';
const toObjs = (v = []) => {
  const [h = [], ...rows] = v;
  return rows.filter(r => r.some(c => c !== '' && c != null))
    .map(r => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])));
};
const photo = v => {
  v = String(v || '').trim();
  if (!v) return '';
  if (/^https?:/i.test(v)) return v;
  if (/\.(jpe?g|png|webp)$/i.test(v)) return '/foto/' + encodeURIComponent(v);   // file di public/foto
  return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(v) + '&sz=w300';
};
// serial tanggal Sheets (zona WIB, UTC+7) -> epoch ms
const serialToMs = n => typeof n === 'number' ? Math.round((n - 25569) * 86400000) - 7 * 3600000 : 0;

module.exports = async (req, res) => {
  try {
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_SA_EMAIL,
      key: (process.env.GOOGLE_SA_KEY || '').replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });
    const sheets = google.sheets({ version: 'v4', auth });
    // Hanya dua sheet ini yang dibaca. Sheet PIC (berisi email) tidak pernah disentuh.
    const r = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: process.env.SHEET_ID,
      ranges: ['Config_Calon!A:H', 'Data!A:F'],
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER'
    });
    const [cfg, data] = r.data.valueRanges.map(x => toObjs(x.values));

    const idx = {};
    data.forEach(d => idx[`${d.kecamatan}|${d.desa}|${d.nama}`] = d);

    const map = {}; let last = 0;
    cfg.forEach(c => {
      const k = `${c.kecamatan}|${c.desa}`;
      const d = map[k] = map[k] || { kecamatan: c.kecamatan, desa: c.desa, status: 'Belum masuk', updated: 0, calon: [] };
      if (!isYa(c.aktif)) return;
      const x = idx[`${k}|${c.nama_calon}`];
      if (x) {
        d.status = x.status || d.status;
        const t = serialToMs(x.updated);
        d.updated = Math.max(d.updated, t); last = Math.max(last, t);
      }
      d.calon.push({
        nama: String(c.nama_calon), petahana: isYa(c.petahana),
        nomor_urut: c.nomor_urut === '' ? '' : String(c.nomor_urut), foto: photo(c.foto_url),
        suara: x && x.suara !== '' ? Number(x.suara) : null
      });
    });

    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    res.status(200).json({ desa: Object.values(map), last });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'gagal memuat data' });
  }
};
