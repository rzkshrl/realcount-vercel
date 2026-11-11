// Vercel Serverless Function: ambil JSON dari Apps Script (tanpa Google Cloud), cache di CDN.
module.exports = async (req, res) => {
  try {
    const u = new URL(process.env.APPS_SCRIPT_URL);
    u.searchParams.set('api', '1');
    u.searchParams.set('token', process.env.API_TOKEN || '');
    const r = await fetch(u, { redirect: 'follow' });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    res.status(200).json(d);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'gagal memuat data' });
  }
};
