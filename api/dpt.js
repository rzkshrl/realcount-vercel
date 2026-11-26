// Data DPT untuk /partisipasi, dari sheet "DPT" di Apps Script (diisi lewat /admin > Data DPT).
// Jarang berubah, jadi di-cache CDN 60 detik. Bila sheet DPT belum ada, halaman memakai /data/dpt.json.
const clean = v => String(v || '').trim().replace(/^["']|["']$/g, '');
module.exports = async (req, res) => {
  try {
    const u = new URL(clean(process.env.APPS_SCRIPT_URL));
    u.searchParams.set('api', '1');
    u.searchParams.set('token', clean(process.env.API_TOKEN));
    u.searchParams.set('mode', 'dpt');
    const r = await fetch(u, { redirect: 'follow' });
    const d = JSON.parse(await r.text());
    if (d.error || !Array.isArray(d.desa)) throw new Error(d.error || 'format');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=86400');
    res.status(200).json(d);
  } catch (e) {
    console.error(e);
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: 'dpt' });
  }
};
