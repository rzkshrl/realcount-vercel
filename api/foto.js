// Proxy foto Drive + cache CDN lama, supaya Drive tidak dibebani pengunjung publik.
module.exports = async (req, res) => {
  const id = String(req.query.id || '');
  if (!/^[\w-]{10,80}$/.test(id)) return res.status(400).end();
  try {
    const r = await fetch('https://drive.google.com/thumbnail?id=' + id + '&sz=w300', { redirect: 'follow' });
    if (!r.ok) return res.status(404).end();
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, s-maxage=86400, max-age=3600, stale-while-revalidate=604800');
    res.status(200).send(Buffer.from(await r.arrayBuffer()));
  } catch (e) { res.status(502).end(); }
};
