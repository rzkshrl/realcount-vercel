// Meneruskan aksi admin ke Apps Script (kunci admin / sesi diperiksa di Apps Script).
// Sesi login disimpan di cookie HttpOnly "qcs" (tidak bisa dibaca JavaScript halaman), plus cookie "qca=1"
// yang boleh dibaca halaman supaya /admin langsung membuka panel tanpa menunggu server.
const clean = v => String(v || '').trim().replace(/^["']|["']$/g, '');
const DAY = 86400;
function cookies(req) {
  const o = {};
  String(req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return o;
}
function setAuth(res, token, remember) {
  const age = remember ? '; Max-Age=' + 14 * DAY : '';
  res.setHeader('Set-Cookie', [
    'qcs=' + token + '; Path=/api; HttpOnly; Secure; SameSite=Strict' + age,
    'qca=1; Path=/; Secure; SameSite=Strict' + age
  ]);
}
function clearAuth(res) {
  res.setHeader('Set-Cookie', [
    'qcs=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
    'qca=; Path=/; Secure; SameSite=Strict; Max-Age=0'
  ]);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const c = cookies(req), session = body.session || c.qcs || undefined;
    const r = await fetch(clean(process.env.APPS_SCRIPT_URL), {
      method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ fn: body.fn, key: body.key, session: session, data: body.data, token: clean(process.env.API_TOKEN) })
    });
    const out = await r.json();
    if (body.fn === 'logout' || out.error === 'session' || (out.error === 'unauthorized' && !body.key)) clearAuth(res);
    else if (body.fn === 'login' && out.session) setAuth(res, out.session, body.remember !== false);
    else if (body.session && !out.error) setAuth(res, body.session, true);   // pindahkan sesi lama (localStorage) ke cookie
    if (out.session) delete out.session;                                      // token tidak pernah sampai ke JavaScript halaman
    res.status(200).json(out);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal terhubung ke server.' }); }
};
