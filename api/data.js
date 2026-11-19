// Vercel Serverless Function: ambil JSON dari Apps Script (tanpa Google Cloud), cache di CDN.
// /api/data?v=1        -> {rev,last} kecil, cache 3 dtk. Dashboard mengecek ini tiap beberapa detik.
// /api/data?rev=<rev>  -> data lengkap untuk revisi itu, cache lama (berubah = URL baru).
// /api/data            -> data lengkap terbaru, cache 3 dtk (pemuatan pertama).
const clean = v => String(v || '').trim().replace(/^["']|["']$/g, '');   // buang spasi/tanda kutip hasil copy-paste
module.exports = async (req, res) => {
  try {
    if (!process.env.APPS_SCRIPT_URL || !process.env.API_TOKEN)
      return res.status(500).json({ error: 'env', hint: 'Environment variable APPS_SCRIPT_URL / API_TOKEN belum diisi. Isi, lalu Redeploy.' });
    let u;
    try { u = new URL(clean(process.env.APPS_SCRIPT_URL)); }
    catch (e) { return res.status(500).json({ error: 'url', hint: 'APPS_SCRIPT_URL tidak valid. Harus diawali https:// dan berakhir /exec.' }); }
    const onlyRev = !!req.query.v, want = Number(req.query.rev || 0);
    u.searchParams.set('api', '1');
    u.searchParams.set('token', clean(process.env.API_TOKEN));
    if (onlyRev) u.searchParams.set('mode', 'rev');
    const r = await fetch(u, { redirect: 'follow' });
    const text = await r.text();
    let d;
    try { d = JSON.parse(text); }
    catch (e) { return res.status(502).json({ error: 'apps-script-html', hint: 'Apps Script mengirim halaman, bukan JSON. Pastikan akses deployment = Anyone, URL berakhiran /exec, dan sudah New version.' }); }
    if (d.error === 'unauthorized') return res.status(502).json({ error: 'token', hint: 'API_TOKEN di Vercel tidak sama dengan Script property API_TOKEN.' });
    if (d.error) throw new Error(d.error);
    if (onlyRev) {
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3, stale-while-revalidate=10');
      return res.status(200).json({ rev: d.rev || 0, last: d.last || 0 });
    }
    // foto Drive lewat proxy /api/foto (di-cache CDN)
    (d.desa || []).forEach(x => x.calon.forEach(c => {
      c.foto = String(c.foto || '').replace(/^https:\/\/drive\.google\.com\/thumbnail\?id=([\w-]+).*$/, '/api/foto?id=$1');
    }));
    const exact = want && (d.rev || 0) >= want;   // data sudah memuat revisi yang diminta -> aman di-cache lama
    res.setHeader('Cache-Control', exact ? 'public, max-age=0, s-maxage=600, stale-while-revalidate=600' : 'public, max-age=0, s-maxage=3, stale-while-revalidate=10');
    res.status(200).json(d);
  } catch (e) {
    console.error(e);
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).json({ error: 'gagal memuat data', detail: String((e && e.message) || e).slice(0, 120) });
  }
};
