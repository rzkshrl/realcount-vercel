// Meneruskan aksi admin ke Apps Script (kunci admin / sesi diperiksa di Apps Script).
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const r = await fetch(String(process.env.APPS_SCRIPT_URL || '').trim().replace(/^["']|["']$/g, ''), {
      method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ fn: body.fn, key: body.key, session: body.session, data: body.data, token: String(process.env.API_TOKEN || '').trim().replace(/^["']|["']$/g, '') })
    });
    res.status(200).json(await r.json());
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal terhubung ke server.' }); }
};
