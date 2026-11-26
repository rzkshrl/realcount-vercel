/**
 * QUICK COUNT PILKADES WONOGIRI 2026 - backend (container-bound ke spreadsheet "DB Pusat")
 *
 * Versi TPS + akun desa
 * - Suara dicatat per TPS (3 TPS per desa). Total desa dihitung dari TPS.
 * - 49 akun desa (username + sandi): hanya bisa mengisi suara TPS desanya sendiri.
 *   TPS yang sudah Final terkunci untuk akun desa; hanya kabupaten yang bisa membuka.
 * - Kabupaten masuk dengan ADMIN_KEY + nama (nama dicatat di Riwayat). Akses penuh.
 *
 * Sheet baru (sheet lama Desa/Suara/Log tidak dipakai lagi dan tidak diubah):
 *   Config_Calon  calon per desa (tetap)
 *   TPS           tps_id, kecamatan, desa, no_tps
 *   Suara_TPS     tps_id, calon_id, suara, updated, oleh
 *   TPS_Status    tps_id, status, updated, oleh
 *   Akun          username, role, kecamatan, desa, salt, hash, aktif, last_login
 *   Akun_Cetak    daftar sandi awal (sekali tampil) - HAPUS setelah dibagikan
 *   Riwayat       waktu, jenis, kecamatan, desa, tps, calon, lama, baru, oleh
 *   DPT           kecamatan, desa, laki, perempuan, total (diisi dari /admin > Data DPT, atau diedit langsung)
 *
 * Urutan pasang: (buat salinan spreadsheet dulu) -> tempel kode -> jalankan setupDB
 *   -> Script properties API_TOKEN & ADMIN_KEY sudah ada -> Deploy > Manage deployments > Edit > New version
 */
const STATUS = ['Belum masuk', 'Sementara', 'Final'];
const TPS_PER_DESA = 3;
const SH = { CFG: 'Config_Calon', TPS: 'TPS', VOTE: 'Suara_TPS', TST: 'TPS_Status', AKUN: 'Akun', CETAK: 'Akun_Cetak', LOG: 'Riwayat', DPT: 'DPT' };
const HEAD = {
  CFG: ['id', 'kecamatan', 'desa', 'urut_daftar', 'nama_calon', 'petahana', 'aktif', 'nomor_urut', 'foto_url', 'foto_rasio'],
  TPS: ['tps_id', 'kecamatan', 'desa', 'no_tps'],
  VOTE: ['tps_id', 'calon_id', 'suara', 'updated', 'oleh'],
  TST: ['tps_id', 'status', 'updated', 'oleh'],
  AKUN: ['username', 'role', 'kecamatan', 'desa', 'salt', 'hash', 'aktif', 'last_login'],
  LOG: ['waktu', 'jenis', 'kecamatan', 'desa', 'tps', 'calon', 'lama', 'baru', 'oleh'],
  DPT: ['kecamatan', 'desa', 'laki', 'perempuan', 'total']
};
const SESSION_DAYS = 14;
const CHUNK = 30000;          // karakter per bagian cache (batas CacheService 100 KB per nilai)
const CACHE_SEC = 21600;      // 6 jam (maksimum CacheService)
const MAX_FAIL = 10;          // salah sandi per akun sebelum dikunci 10 menit

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Quick Count')
    .addItem('Setup database (TPS + akun desa)', 'setupDB')
    .addItem('Cek kesehatan', 'diagnose')
    .addItem('Keluarkan semua sesi login', 'logoutAll')
    .addToUi();
}

const db_ = () => {
  const id = PropertiesService.getScriptProperties().getProperty('DB_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
};
const sheet_ = n => db_().getSheetByName(SH[n]);
const isYa_ = v => String(v).trim().toLowerCase() === 'ya';
const dk_ = (k, d) => k + '|' + d;

function rows_(sh) {
  const v = sh.getDataRange().getValues();
  const h = v.shift();
  return v.filter(r => r.some(c => c !== '')).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}
function setCell_(sh, head, row, name, val) {
  let c = head.indexOf(name);
  if (c < 0) { c = head.length; head.push(name); sh.getRange(1, c + 1).setValue(name); }
  sh.getRange(row, c + 1).setValue(val);
}
const toMs_ = v => v ? new Date(v).getTime() || 0 : 0;

/** ---------- Cache, revisi, catatan perubahan ---------- */
function cachePut_(obj) {
  const s = JSON.stringify(obj), n = Math.ceil(s.length / CHUNK), o = { dash_n: String(n) };
  for (let i = 0; i < n; i++) o['dash_' + i] = s.slice(i * CHUNK, (i + 1) * CHUNK);
  try { CacheService.getScriptCache().putAll(o, CACHE_SEC); } catch (e) { dropDash_(); }
}
function cacheGet_() {
  const c = CacheService.getScriptCache(), n = Number(c.get('dash_n') || 0);
  if (!n) return null;
  const keys = Array.from({ length: n }, (_, i) => 'dash_' + i), g = c.getAll(keys);
  if (keys.some(k => g[k] == null)) return null;
  try { return JSON.parse(keys.map(k => g[k]).join('')); } catch (e) { return null; }
}
function dropDash_() { CacheService.getScriptCache().removeAll(['dash', 'dash_n']); }

function bumpRev_(last, rev, rows) {
  const sp = PropertiesService.getScriptProperties(), prev = Number(sp.getProperty('REV') || 0);
  const o = { REV: String(rev || Date.now()) };
  if (last != null) o.LAST = String(last);
  pushChg_(prev, Number(o.REV), rows || null);          // catatan dulu, baru REV diumumkan
  sp.setProperties(o);
  return Number(o.REV);
}
const CHG_MS = 60000, CHG_MAX = 30000;
function pushChg_(prev, rev, rows) {
  const c = CacheService.getScriptCache();
  let list = [];
  try { list = JSON.parse(c.get('chg') || '[]'); } catch (e) {}
  list.push({ p: prev, r: rev, d: rows });
  list = list.filter(x => x.r > rev - CHG_MS).slice(-15);
  let s = JSON.stringify(list);
  while (s.length > CHG_MAX && list.length > 1) { list.shift(); s = JSON.stringify(list); }
  if (s.length > CHG_MAX) s = JSON.stringify([{ p: prev, r: rev, d: null }]);
  try { c.put('chg', s, 600); } catch (e) {}
}
function readChg_() { try { return JSON.parse(CacheService.getScriptCache().get('chg') || '[]'); } catch (e) { return []; } }

/** ---------- Setup ---------- */
function setupDB() {
  const sp = PropertiesService.getScriptProperties();
  sp.setProperty('DB_ID', SpreadsheetApp.getActiveSpreadsheet().getId());
  const ss = db_();
  ss.setSpreadsheetTimeZone('Asia/Jakarta');
  ['CFG', 'TPS', 'VOTE', 'TST', 'AKUN', 'LOG'].forEach(k => {
    const sh = ss.getSheetByName(SH[k]) || ss.insertSheet(SH[k]);
    if (sh.getLastRow() === 0) sh.appendRow(HEAD[k]);
  });
  // id calon
  const cfg = ss.getSheetByName(SH.CFG);
  let head = cfg.getRange(1, 1, 1, cfg.getLastColumn()).getValues()[0];
  if (head.indexOf('id') < 0) { cfg.insertColumnBefore(1); cfg.getRange(1, 1).setValue('id'); head = ['id'].concat(head); }
  HEAD.CFG.forEach(n => { if (head.indexOf(n) < 0) { head.push(n); cfg.getRange(1, head.length).setValue(n); } });
  const v = cfg.getDataRange().getValues(), ci = head.indexOf('id');
  let max = 0;
  v.slice(1).forEach(r => { const m = /^C(\d+)$/.exec(String(r[ci])); if (m) max = Math.max(max, +m[1]); });
  const ids = v.slice(1).map(r => [r[ci] || (r[head.indexOf('nama_calon')] ? 'C' + String(++max).padStart(3, '0') : '')]);
  if (ids.length) cfg.getRange(2, ci + 1, ids.length, 1).setValues(ids);
  // TPS untuk setiap desa
  const desaList = [];
  const seen = {};
  rows_(cfg).forEach(r => { const k = dk_(r.kecamatan, r.desa); if (r.kecamatan && r.desa && !seen[k]) { seen[k] = 1; desaList.push([r.kecamatan, r.desa]); } });
  ensureTps_(desaList);
  // akun desa
  const made = ensureAccounts_(desaList);
  if (made.length) {
    const ct = ss.getSheetByName(SH.CETAK) || ss.insertSheet(SH.CETAK);
    if (ct.getLastRow() === 0) ct.appendRow(['username', 'sandi_awal', 'kecamatan', 'desa', 'dibuat']);
    ct.getRange(ct.getLastRow() + 1, 1, made.length, 5).setValues(made.map(a => [a.username, a.password, a.kecamatan, a.desa, new Date()]));
  }
  ss.getSheetByName(SH.LOG).getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  ss.getSheetByName(SH.VOTE).getRange('D:D').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  ss.getSheetByName(SH.TST).getRange('C:C').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  bumpRev_(); dropDash_();
  sp.setProperty('LAST', String(getDashboardData().last));
  Logger.log('TPS: ' + rows_(ss.getSheetByName(SH.TPS)).length + ', akun baru: ' + made.length + (made.length ? ' (lihat sheet Akun_Cetak, hapus setelah dibagikan)' : ''));
}

/** Buat baris TPS (3 per desa) untuk desa yang belum punya */
function ensureTps_(desaList) {
  const sh = sheet_('TPS'), have = {}, cur = rows_(sh);
  let max = 0;
  cur.forEach(r => { have[dk_(r.kecamatan, r.desa) + '|' + r.no_tps] = 1; const m = /^T(\d+)$/.exec(String(r.tps_id)); if (m) max = Math.max(max, +m[1]); });
  const add = [];
  desaList.forEach(([k, d]) => { for (let n = 1; n <= TPS_PER_DESA; n++) if (!have[dk_(k, d) + '|' + n]) add.push(['T' + String(++max).padStart(3, '0'), k, d, n]); });
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, 4).setValues(add);
  return add.length;
}

/** ---------- Akun & sandi ---------- */
const hex_ = bytes => bytes.map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('');
const hash_ = (salt, pass) => hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + pass, Utilities.Charset.UTF_8));
const slug_ = s => String(s).toLowerCase().normalize('NFD').replace(/[^\w]+/g, '').replace(/_/g, '');
function newPassword_() {
  const al = 'abcdefghjkmnpqrstuvwxyz23456789', h = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  let p = '';
  for (let i = 0; i < 8; i++) p += al[parseInt(h.substr(i * 3, 3), 16) % al.length];
  return p;
}
function ensureAccounts_(desaList) {
  const sh = sheet_('AKUN'), cur = rows_(sh), byDesa = {}, names = {};
  cur.forEach(a => { names[a.username] = 1; if (a.role === 'desa') byDesa[dk_(a.kecamatan, a.desa)] = 1; });
  const made = [];
  desaList.forEach(([k, d]) => {
    if (byDesa[dk_(k, d)]) return;
    let u = slug_(k) + '.' + slug_(d), i = 2;
    while (names[u]) u = slug_(k) + '.' + slug_(d) + (i++);
    names[u] = 1;
    const p = newPassword_(), salt = Utilities.getUuid();
    made.push({ username: u, password: p, kecamatan: k, desa: d, row: [u, 'desa', k, d, salt, hash_(salt, p), 'ya', ''] });
  });
  if (made.length) sh.getRange(sh.getLastRow() + 1, 1, made.length, HEAD.AKUN.length).setValues(made.map(m => m.row));
  return made;
}

function logoutAll() {
  const sp = PropertiesService.getScriptProperties();
  Object.keys(sp.getProperties()).filter(k => k.indexOf('S_') === 0).forEach(k => sp.deleteProperty(k));
}

// Edit manual langsung di spreadsheet membatalkan cache dashboard dan menandai perubahan
function onEdit() { bumpRev_(); dropDash_(); CacheService.getScriptCache().remove('dpt'); }

/** ---------- Data inti ---------- */
function loadAll_() {
  const ss = db_();
  const cfg = rows_(ss.getSheetByName(SH.CFG));
  const tps = rows_(ss.getSheetByName(SH.TPS)).map(r => ({ id: String(r.tps_id), kecamatan: r.kecamatan, desa: r.desa, no: Number(r.no_tps) }));
  const vs = ss.getSheetByName(SH.VOTE), vv = vs.getDataRange().getValues();
  const ts = ss.getSheetByName(SH.TST), tv = ts.getDataRange().getValues();
  const votes = {}, vpos = {}, st = {}, tpos = {};
  vv.forEach((r, i) => { if (i && r[0]) { const k = r[0] + '|' + r[1]; votes[k] = r[2]; vpos[k] = i; } });
  tv.forEach((r, i) => { if (i && r[0]) { st[r[0]] = { status: r[1] || STATUS[0], updated: toMs_(r[2]), oleh: r[3] || '' }; tpos[r[0]] = i; } });
  return { ss, cfg, tps, vs, vv, ts, tv, votes, vpos, st, tpos };
}

/** Baris desa untuk dashboard publik (tanpa nama operator). keys = Set desa yang dibangun, atau null = semua */
function buildDesa_(A, keys) {
  const map = {}, out = [];
  A.cfg.forEach(r => {
    const k = dk_(r.kecamatan, r.desa);
    if (!r.kecamatan || (keys && !keys.has(k))) return;
    if (!map[k]) { map[k] = { kecamatan: r.kecamatan, desa: r.desa, status: STATUS[0], updated: 0, tps: [], calon: [] }; out.push(map[k]); }
    if (isYa_(r.aktif)) map[k].calon.push({ id: r.id, nama: r.nama_calon, petahana: isYa_(r.petahana), nomor_urut: r.nomor_urut || '', foto: photoUrl_(r.foto_url), rasio: r.foto_rasio || '4x6', suara: null });
  });
  A.tps.forEach(t => {
    const d = map[dk_(t.kecamatan, t.desa)];
    if (!d) return;
    const s = A.st[t.id] || { status: STATUS[0], updated: 0 }, sv = {};
    d.calon.forEach(c => { const v = A.votes[t.id + '|' + c.id]; sv[c.id] = v === '' || v == null ? null : Number(v); });
    d.tps.push({ id: t.id, no: t.no, status: s.status, updated: s.updated, s: sv });
  });
  out.forEach(d => {
    d.tps.sort((a, b) => a.no - b.no);
    d.calon.sort((a, b) => (+a.nomor_urut || 99) - (+b.nomor_urut || 99));
    d.calon.forEach(c => { let any = false, sum = 0; d.tps.forEach(t => { const v = t.s[c.id]; if (v != null) { any = true; sum += v; } }); c.suara = any ? sum : null; });
    d.updated = d.tps.reduce((m, t) => Math.max(m, t.updated || 0), 0);
    const fin = d.tps.length && d.tps.every(t => t.status === STATUS[2]), some = d.tps.some(t => t.status !== STATUS[0]);
    d.status = fin ? STATUS[2] : some ? STATUS[1] : STATUS[0];
  });
  return out;
}

/** ---------- API publik (dashboard) ---------- */
function doGet(e) {
  const sp = PropertiesService.getScriptProperties(), tok = sp.getProperty('API_TOKEN');
  const p = (e && e.parameter) || {};
  if (!(p.api && tok && p.token === tok)) return json_({ error: 'unauthorized' });
  if (p.mode === 'dpt') return json_(dptGet_());
  if (p.mode === 'rev') {
    let rev = Number(sp.getProperty('REV') || 0), last = sp.getProperty('LAST');
    if (!rev || last == null) { rev = bumpRev_(); dropDash_(); last = getDashboardData().last; sp.setProperty('LAST', String(last)); }
    return json_({ rev: rev, last: Number(last), chg: readChg_() });
  }
  return json_(getDashboardData());
}
const json_ = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);

function photoUrl_(v) {
  v = String(v || '').trim();
  if (!v) return '';
  return /^https?:/i.test(v) ? v : 'https://drive.google.com/thumbnail?id=' + v + '&sz=w300';
}

function getDashboardData() {
  const hit = cacheGet_();
  if (hit) return hit;
  const sp = PropertiesService.getScriptProperties();
  const rev0 = Number(sp.getProperty('REV') || 0);       // dibaca SEBELUM sheet
  const A = loadAll_(), desa = buildDesa_(A, null);
  const res = { desa: desa, last: desa.reduce((m, d) => Math.max(m, d.updated || 0), 0), rev: rev0, tps_per_desa: TPS_PER_DESA };
  if (Number(sp.getProperty('REV') || 0) === rev0) cachePut_(res);
  return res;
}

/** Ganti baris desa di cache dashboard (tanpa membaca sheet lagi) */
function patchRows_(rows, rev) {
  const x = cacheGet_();
  if (!x) return;
  for (const r of rows) {
    const i = x.desa.findIndex(d => d.kecamatan === r.kecamatan && d.desa === r.desa);
    if (i < 0) { dropDash_(); return; }
    x.desa[i] = r;
  }
  x.last = Math.max(Number(x.last) || 0, ...rows.map(r => r.updated || 0)); x.rev = rev;
  cachePut_(x);
}

/** ---------- API admin (POST dari Vercel /api/admin) ---------- */
function doPost(e) {
  let out;
  try {
    const b = JSON.parse(e.postData.contents);
    const tok = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
    out = (!tok || b.token !== tok) ? { error: 'unauthorized' } : admin_(b);
  } catch (err) { out = { error: 'bad request' }; }
  return json_(out);
}

/** Batas salah sandi per akun (bukan untuk semua orang) */
function tooMany_(who) { return Number(CacheService.getScriptCache().get('fail_' + who) || 0) >= MAX_FAIL; }
function failed_(who) { const c = CacheService.getScriptCache(), n = Number(c.get('fail_' + who) || 0) + 1; c.put('fail_' + who, String(n), 600); }

function checkKey_(key) {
  if (tooMany_('_admin')) return false;
  const real = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  const ok = !!real && key === real;
  if (!ok) failed_('_admin');
  return ok;
}

function login_(d, b) {
  // kabupaten: kunci admin + nama
  if (b.key) {
    if (tooMany_('_admin')) return { error: 'Terlalu banyak percobaan salah. Coba lagi 10 menit lagi.' };
    if (!checkKey_(b.key)) return { error: 'unauthorized' };
    const nama = String(d.nama || '').trim().slice(0, 40) || 'kabupaten';
    return { me: { role: 'kabupaten', user: 'kabupaten', nama: nama } };
  }
  // desa: username + sandi
  const u = String(d.user || '').trim().toLowerCase(), p = String(d.pass || '');
  if (!u || !p) return { error: 'Isi username dan sandi.' };
  if (tooMany_(u)) return { error: 'Terlalu banyak sandi salah untuk akun ini. Coba lagi 10 menit lagi.' };
  const sh = sheet_('AKUN'), v = sh.getDataRange().getValues(), head = v[0], c = n => head.indexOf(n);
  const i = v.findIndex((r, n) => n > 0 && String(r[c('username')]).toLowerCase() === u);
  if (i < 1 || hash_(v[i][c('salt')], p) !== v[i][c('hash')]) { failed_(u); return { error: 'unauthorized' }; }
  if (!isYa_(v[i][c('aktif')])) return { error: 'Akun ini dinonaktifkan. Hubungi kabupaten.' };
  sh.getRange(i + 1, c('last_login') + 1).setValue(new Date());
  return { me: { role: v[i][c('role')] || 'desa', user: u, nama: u, kecamatan: v[i][c('kecamatan')], desa: v[i][c('desa')] } };
}

function session_(t) {
  if (!t || !/^[a-f0-9]{48,64}$/.test(t)) return null;
  const sp = PropertiesService.getScriptProperties(), v = sp.getProperty('S_' + t);
  if (!v) return null;
  let s;
  try { s = JSON.parse(v); } catch (e) { return null; }
  if (typeof s === 'number') s = { exp: s, me: { role: 'kabupaten', user: 'kabupaten', nama: 'kabupaten' } };   // sesi versi lama
  if (!s || s.exp < Date.now()) { sp.deleteProperty('S_' + t); return null; }
  return s.me;
}

function newSession_(me) {
  const sp = PropertiesService.getScriptProperties(), now = Date.now(), all = sp.getProperties();
  Object.keys(all).forEach(k => {
    if (k.indexOf('S_') !== 0) return;
    let s; try { s = JSON.parse(all[k]); } catch (e) { s = 0; }
    const exp = typeof s === 'number' ? s : (s && s.exp) || 0;
    if (exp < now) sp.deleteProperty(k);
  });
  const t = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  const exp = now + SESSION_DAYS * 864e5;
  sp.setProperty('S_' + t, JSON.stringify({ exp: exp, me: me }));
  return { session: t, exp: exp };
}

function dropSessionsOf_(user) {
  const sp = PropertiesService.getScriptProperties(), all = sp.getProperties();
  Object.keys(all).forEach(k => {
    if (k.indexOf('S_') !== 0) return;
    try { const s = JSON.parse(all[k]); if (s && s.me && s.me.user === user) sp.deleteProperty(k); } catch (e) {}
  });
}

const DESA_FN = { list: 1, saveTps: 1 };

function admin_(b) {
  const fn = b.fn, d = b.data || {};
  if (fn === 'logout') { if (b.session) PropertiesService.getScriptProperties().deleteProperty('S_' + b.session); return { ok: true }; }
  if (fn === 'login') {
    const r = login_(d, b);
    if (r.error) return r;
    return Object.assign(adminList_(r.me), newSession_(r.me), { me: r.me });
  }
  let me = b.session ? session_(b.session) : null;
  if (!me && b.key) me = checkKey_(b.key) ? { role: 'kabupaten', user: 'kabupaten', nama: 'kabupaten' } : null;
  if (!me) return { error: b.session && !b.key ? 'session' : 'unauthorized' };
  if (me.role !== 'kabupaten' && !DESA_FN[fn]) return { error: 'Akun desa tidak boleh melakukan ini.' };
  if (fn === 'list') return Object.assign(adminList_(me), { me: me });
  if (fn === 'listAkun') return listAkun_();
  if (fn === 'getLog') return getLog_(d);
  if (fn === 'getDpt') return { ok: true, dpt: dptGet_() };
  const f = { saveTps: saveTps_, saveCalon: saveCalon_, addCalon: addCalon_, reset: reset_, resetPass: resetPass_, setAktif: setAktif_, logoutUser: logoutUser_, createAkun: createAkun_, saveDpt: saveDpt_ }[fn];
  if (!f) return { error: 'bad request' };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return { error: 'busy', info: 'Sistem sibuk, mencoba lagi...' };
  try {
    const r = f(d, me);
    if (!r || !r.ok) return r;
    if (fn === 'saveTps' || fn === 'resetPass' || fn === 'setAktif' || fn === 'logoutUser' || fn === 'createAkun' || fn === 'saveDpt') return r;
    SpreadsheetApp.flush(); bumpRev_(); dropDash_();
    const list = adminList_(me);
    PropertiesService.getScriptProperties().setProperty('LAST', String(list.tps.reduce((m, x) => Math.max(m, x.updated || 0), 0)));
    return Object.assign(list, { ok: true, info: r.info || '', me: me });
  } finally { lock.releaseLock(); }
}

/** Data untuk panel admin. Akun desa hanya menerima desanya sendiri. */
function adminList_(me) {
  const A = loadAll_(), own = me.role === 'kabupaten' ? null : dk_(me.kecamatan, me.desa);
  const calon = A.cfg.filter(r => r.kecamatan && (!own || dk_(r.kecamatan, r.desa) === own)).map(r => ({
    id: r.id, kecamatan: r.kecamatan, desa: r.desa, nama: r.nama_calon, petahana: isYa_(r.petahana), aktif: isYa_(r.aktif),
    nomor_urut: r.nomor_urut === '' ? '' : String(r.nomor_urut), foto: photoUrl_(r.foto_url), rasio: r.foto_rasio || '4x6'
  }));
  const tps = A.tps.filter(t => !own || dk_(t.kecamatan, t.desa) === own).map(t => {
    const s = A.st[t.id] || { status: STATUS[0], updated: 0, oleh: '' }, sv = {};
    calon.forEach(c => { if (c.kecamatan === t.kecamatan && c.desa === t.desa) { const v = A.votes[t.id + '|' + c.id]; sv[c.id] = v === '' || v == null ? null : Number(v); } });
    return { id: t.id, kecamatan: t.kecamatan, desa: t.desa, no: t.no, status: s.status, updated: s.updated, oleh: s.oleh, suara: sv };
  }).sort((a, b) => a.kecamatan.localeCompare(b.kecamatan) || a.desa.localeCompare(b.desa) || a.no - b.no);
  return { calon: calon, tps: tps };
}

function log_(rows) {
  if (!rows.length) return;
  const l = sheet_('LOG');
  l.getRange(l.getLastRow() + 1, 1, rows.length, HEAD.LOG.length).setValues(rows);
}
const who_ = me => me.role === 'kabupaten' ? 'kabupaten: ' + me.nama : me.user;

/** Simpan suara satu atau beberapa TPS. d.items = [{tps_id, status, suara:{calon_id: angka|''}}] */
function saveTps_(d, me) {
  const items = Array.isArray(d.items) ? d.items.slice(0, 40) : [];
  if (!items.length) return { error: 'Tidak ada perubahan untuk disimpan.' };
  const A = loadAll_(), now = new Date(), t = now.getTime(), oleh = who_(me), log = [], results = [], touched = new Set();
  const tpsById = {}; A.tps.forEach(x => tpsById[x.id] = x);
  const add = [], tadd = [];
  let vDirty = false, tDirty = false;
  items.forEach(it => {
    const out = { tps_id: it.tps_id }, tp = tpsById[it.tps_id];
    if (!tp) { out.error = 'TPS tidak ditemukan.'; results.push(out); return; }
    if (me.role !== 'kabupaten' && dk_(tp.kecamatan, tp.desa) !== dk_(me.kecamatan, me.desa)) { out.error = 'Bukan TPS desa Anda.'; results.push(out); return; }
    const cur = A.st[tp.id] || { status: STATUS[0] };
    if (me.role !== 'kabupaten' && cur.status === STATUS[2]) { out.error = 'TPS ' + tp.no + ' sudah Final dan terkunci. Hubungi kabupaten bila ada kesalahan.'; results.push(out); return; }
    const cs = A.cfg.filter(r => r.kecamatan === tp.kecamatan && r.desa === tp.desa && isYa_(r.aktif));
    if (!cs.length) { out.error = 'Desa ini belum punya calon aktif.'; results.push(out); return; }
    const vals = {}; let any = false, full = true, bad = '';
    for (const r of cs) {
      const raw = (it.suara || {})[r.id];
      if (raw === '' || raw == null) { vals[r.id] = ''; full = false; continue; }
      if (!/^\d{1,6}$/.test(String(raw))) { bad = 'Suara ' + r.nama_calon + ' harus angka bulat, 0 atau lebih.'; break; }
      vals[r.id] = Number(raw); any = true;
    }
    if (bad) { out.error = bad; results.push(out); return; }
    let status = STATUS.indexOf(it.status) >= 0 ? it.status : STATUS[1];
    if (!any) status = STATUS[0]; else if (status === STATUS[0]) status = STATUS[1];
    if (status === STATUS[2] && !full) { out.error = 'Final butuh suara semua calon terisi.'; results.push(out); return; }
    cs.forEach(r => {
      const k = tp.id + '|' + r.id, nv = vals[r.id], old = A.votes[k] == null ? '' : A.votes[k];
      if (old !== nv) log.push([now, 'suara', tp.kecamatan, tp.desa, tp.no, r.nama_calon, old, nv, oleh]);
      A.votes[k] = nv;
      if (A.vpos[k] > 0) { const row = A.vv[A.vpos[k]]; row[2] = nv; row[3] = now; row[4] = oleh; vDirty = true; }
      else if (A.vpos[k] !== -1) { add.push([tp.id, r.id, nv, now, oleh]); A.vpos[k] = -1; }
    });
    if (cur.status !== status) log.push([now, 'status', tp.kecamatan, tp.desa, tp.no, '', cur.status, status, oleh]);
    A.st[tp.id] = { status: status, updated: t, oleh: oleh };
    if (A.tpos[tp.id] > 0) { const row = A.tv[A.tpos[tp.id]]; row[1] = status; row[2] = now; row[3] = oleh; tDirty = true; }
    else if (A.tpos[tp.id] !== -1) { tadd.push([tp.id, status, now, oleh]); A.tpos[tp.id] = -1; }
    const sv = {}; Object.keys(vals).forEach(id => sv[id] = vals[id] === '' ? null : vals[id]);
    Object.assign(out, { ok: true, status: status, updated: t, oleh: oleh, suara: sv });
    results.push(out); touched.add(dk_(tp.kecamatan, tp.desa));
  });
  if (vDirty && A.vv.length > 1) A.vs.getRange(2, 1, A.vv.length - 1, 5).setValues(A.vv.slice(1).map(r => [r[0], r[1], r[2], r[3], r[4]]));
  if (add.length) A.vs.getRange(A.vs.getLastRow() + 1, 1, add.length, 5).setValues(add);
  if (tDirty && A.tv.length > 1) A.ts.getRange(2, 1, A.tv.length - 1, 4).setValues(A.tv.slice(1).map(r => [r[0], r[1], r[2], r[3]]));
  if (tadd.length) A.ts.getRange(A.ts.getLastRow() + 1, 1, tadd.length, 4).setValues(tadd);
  log_(log);
  const saved = results.filter(r => r.ok).length;
  if (saved) {
    const rows = buildDesa_(A, touched), rev = Date.now();
    patchRows_(rows, rev);                                 // cache ditambal dulu, baru REV diumumkan
    bumpRev_(t, rev, rows);
  }
  return { ok: true, info: saved + ' TPS tersimpan.', results: results };
}

/** ---------- Kabupaten: akun ---------- */
function listAkun_() {
  const A = rows_(sheet_('AKUN')).map(a => ({ username: a.username, role: a.role, kecamatan: a.kecamatan, desa: a.desa, aktif: isYa_(a.aktif), last_login: toMs_(a.last_login) }));
  return { ok: true, akun: A };
}
function akunRow_(u) {
  const sh = sheet_('AKUN'), v = sh.getDataRange().getValues(), head = v[0];
  const i = v.findIndex((r, n) => n > 0 && String(r[head.indexOf('username')]) === String(u));
  return { sh, v, head, i };
}
function resetPass_(d, me) {
  const x = akunRow_(d.username);
  if (x.i < 1) return { error: 'Akun tidak ditemukan.' };
  const p = newPassword_(), salt = Utilities.getUuid();
  x.sh.getRange(x.i + 1, x.head.indexOf('salt') + 1, 1, 2).setValues([[salt, hash_(salt, p)]]);
  dropSessionsOf_(d.username);
  CacheService.getScriptCache().remove('fail_' + d.username);
  log_([[new Date(), 'akun', x.v[x.i][x.head.indexOf('kecamatan')], x.v[x.i][x.head.indexOf('desa')], '', '', '', 'sandi direset: ' + d.username, who_(me)]]);
  return { ok: true, username: d.username, password: p, info: 'Sandi baru dibuat. Perangkat lama akun ini sudah dikeluarkan.' };
}
function setAktif_(d, me) {
  const x = akunRow_(d.username);
  if (x.i < 1) return { error: 'Akun tidak ditemukan.' };
  x.sh.getRange(x.i + 1, x.head.indexOf('aktif') + 1).setValue(d.aktif ? 'ya' : 'tidak');
  if (!d.aktif) dropSessionsOf_(d.username);
  log_([[new Date(), 'akun', '', '', '', '', '', (d.aktif ? 'diaktifkan: ' : 'dinonaktifkan: ') + d.username, who_(me)]]);
  return { ok: true, info: d.aktif ? 'Akun diaktifkan.' : 'Akun dinonaktifkan dan dikeluarkan.' };
}
function logoutUser_(d) { dropSessionsOf_(d.username); return { ok: true, info: 'Semua perangkat akun ini dikeluarkan.' }; }
function createAkun_(d, me) {
  const seen = {}, list = [];
  rows_(sheet_('CFG')).forEach(r => { const k = dk_(r.kecamatan, r.desa); if (r.kecamatan && r.desa && !seen[k]) { seen[k] = 1; list.push([r.kecamatan, r.desa]); } });
  ensureTps_(list);
  const made = ensureAccounts_(list);
  if (made.length) log_([[new Date(), 'akun', '', '', '', '', '', made.length + ' akun desa dibuat', who_(me)]]);
  return { ok: true, created: made.map(m => ({ username: m.username, password: m.password, kecamatan: m.kecamatan, desa: m.desa })), info: made.length ? made.length + ' akun baru dibuat.' : 'Semua desa sudah punya akun.' };
}

/** ---------- Kabupaten: riwayat ---------- */
function getLog_(d) {
  const sh = sheet_('LOG'), n = sh.getLastRow() - 1, lim = Math.min(Number(d.limit) || 300, 1000);
  if (n < 1) return { ok: true, log: [] };
  const from = Math.max(2, sh.getLastRow() - lim + 1);
  const v = sh.getRange(from, 1, sh.getLastRow() - from + 1, HEAD.LOG.length).getValues().reverse();
  return { ok: true, log: v.map(r => ({ waktu: toMs_(r[0]), jenis: r[1], kecamatan: r[2], desa: r[3], tps: r[4], calon: r[5], lama: r[6], baru: r[7], oleh: r[8] })) };
}

/** ---------- Kabupaten: calon, foto, reset ---------- */
function fotoFolder_() {
  const sp = PropertiesService.getScriptProperties(), id = sp.getProperty('FOTO_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const f = DriveApp.createFolder('QC Pilkades 2026 - Foto');
  sp.setProperty('FOTO_FOLDER_ID', f.getId());
  return f;
}

function saveCalon_(d) {
  const sh = sheet_('CFG'), v = sh.getDataRange().getValues(), head = v[0];
  const c = n => head.indexOf(n);
  const i = v.findIndex((r, n) => n > 0 && String(r[c('id')]) === String(d.id));
  if (i < 1) return { error: 'Calon tidak ditemukan.' };
  const row = i + 1, me = v[i];
  if (d.nama !== undefined) {
    const nm = String(d.nama).trim();
    if (!nm || nm.length > 80) return { error: 'Nama calon wajib diisi (maksimal 80 huruf).' };
    setCell_(sh, head, row, 'nama_calon', nm);
  }
  if (d.petahana !== undefined) setCell_(sh, head, row, 'petahana', d.petahana ? 'ya' : '');
  if (d.aktif !== undefined) {
    if (d.aktif) {
      const n = v.filter((r, k) => k > 0 && k !== i && r[c('kecamatan')] === me[c('kecamatan')] && r[c('desa')] === me[c('desa')] && isYa_(r[c('aktif')])).length;
      if (n >= 5) return { error: 'Maksimal 5 calon aktif per desa.' };
    }
    setCell_(sh, head, row, 'aktif', d.aktif ? 'ya' : 'tidak');
  }
  if (d.nomor_urut !== undefined) {
    if (!/^\d{0,2}$/.test(String(d.nomor_urut))) return { error: 'Nomor urut harus angka 1-2 digit.' };
    if (d.nomor_urut !== '' && v.some((r, k) => k > 0 && k !== i && r[c('kecamatan')] === me[c('kecamatan')] && r[c('desa')] === me[c('desa')] && isYa_(r[c('aktif')]) && String(r[c('nomor_urut')]) === String(d.nomor_urut)))
      return { error: 'Nomor urut ' + d.nomor_urut + ' sudah dipakai calon lain di desa ini.' };
    setCell_(sh, head, row, 'nomor_urut', d.nomor_urut === '' ? '' : Number(d.nomor_urut));
  }
  if (d.rasio !== undefined) {
    if (!/^(4x6|3x4|1x1)$/.test(d.rasio)) return { error: 'Rasio foto tidak valid.' };
    setCell_(sh, head, row, 'foto_rasio', d.rasio);
  }
  if (d.foto_b64) {
    if (d.foto_b64.length > 60000) return { error: 'Foto melebihi 40 KB.' };
    const bytes = Utilities.base64Decode(d.foto_b64);
    if (bytes.length > 40 * 1024) return { error: 'Foto melebihi 40 KB.' };
    if (!(bytes[0] === -1 && bytes[1] === -40)) return { error: 'File bukan JPEG.' };
    const name = (me[c('kecamatan')] + '-' + me[c('desa')] + '-' + d.id).replace(/[^\w-]+/g, '_') + '.jpg';
    const file = fotoFolder_().createFile(Utilities.newBlob(bytes, 'image/jpeg', name));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const old = String(me[c('foto_url')] || '');
    if (/^[\w-]{20,}$/.test(old)) { try { DriveApp.getFileById(old).setTrashed(true); } catch (e) {} }
    setCell_(sh, head, row, 'foto_url', file.getId());
  }
  return { ok: true, info: 'Tersimpan.' };
}

/** Tambah calon baru (desa baru otomatis dapat 3 TPS; akun desa dibuat dari tab Akun) */
function addCalon_(d) {
  const kec = String(d.kecamatan || '').trim().toUpperCase(), desa = String(d.desa || '').trim().toUpperCase(), nama = String(d.nama || '').trim();
  if (!kec || !desa || !nama || nama.length > 80) return { error: 'Kecamatan, desa, dan nama calon wajib diisi.' };
  const sh = sheet_('CFG'), v = sh.getDataRange().getValues(), head = v[0];
  const c = n => head.indexOf(n);
  const same = v.filter((r, k) => k > 0 && r[c('kecamatan')] === kec && r[c('desa')] === desa);
  if (same.filter(r => isYa_(r[c('aktif')])).length >= 5) return { error: 'Maksimal 5 calon aktif per desa.' };
  let max = 0;
  v.slice(1).forEach(r => { const m = /^C(\d+)$/.exec(String(r[c('id')])); if (m) max = Math.max(max, +m[1]); });
  const o = { id: 'C' + String(max + 1).padStart(3, '0'), kecamatan: kec, desa: desa, urut_daftar: same.length + 1, nama_calon: nama,
    petahana: d.petahana ? 'ya' : '', aktif: 'ya', nomor_urut: '', foto_url: '', foto_rasio: '4x6' };
  sh.appendRow(head.map(h => o[h] !== undefined ? o[h] : ''));
  ensureTps_([[kec, desa]]);
  return { ok: true, info: 'Calon ditambahkan.' };
}

/** Kosongkan semua suara TPS dan status (untuk setelah uji coba). Wajib confirm = "RESET" */
function reset_(d, me) {
  if (d.confirm !== 'RESET') return { error: 'Ketik RESET untuk konfirmasi.' };
  const vs = sheet_('VOTE'), ts = sheet_('TST');
  if (vs.getLastRow() > 1) vs.getRange(2, 1, vs.getLastRow() - 1, HEAD.VOTE.length).clearContent();
  if (ts.getLastRow() > 1) ts.getRange(2, 1, ts.getLastRow() - 1, HEAD.TST.length).clearContent();
  log_([[new Date(), 'reset', '', '', '', '', '', 'semua suara TPS dikosongkan', who_(me)]]);
  return { ok: true, info: 'Semua suara TPS dikosongkan.' };
}

/** Cek kesehatan: jalankan dari editor, lihat hasilnya di Execution log */
function diagnose() {
  const sp = PropertiesService.getScriptProperties(), out = [];
  const add = (ok, msg) => out.push((ok ? 'OK       ' : 'MASALAH  ') + msg);
  add(!!sp.getProperty('API_TOKEN'), 'Script property API_TOKEN terisi');
  add(!!sp.getProperty('ADMIN_KEY'), 'Script property ADMIN_KEY terisi');
  add(!!sp.getProperty('DB_ID'), 'DB_ID tersimpan (jalankan setupDB)');
  let ss = null;
  try { ss = db_(); } catch (e) { add(false, 'DB Pusat tidak bisa dibuka: ' + e); }
  if (ss) {
    ['CFG', 'TPS', 'VOTE', 'TST', 'AKUN', 'LOG'].forEach(k => add(!!ss.getSheetByName(SH[k]), 'Sheet ' + SH[k] + ' ada'));
    try {
      const cfg = rows_(ss.getSheetByName(SH.CFG)), tps = rows_(ss.getSheetByName(SH.TPS)), ak = rows_(ss.getSheetByName(SH.AKUN));
      const desa = new Set(cfg.filter(r => r.kecamatan).map(r => dk_(r.kecamatan, r.desa)));
      add(cfg.every(x => x.id || !x.nama_calon), 'Semua calon punya id (' + cfg.length + ' calon)');
      add(tps.length === desa.size * TPS_PER_DESA, 'TPS: ' + tps.length + ' (harus ' + desa.size * TPS_PER_DESA + ' = ' + desa.size + ' desa x ' + TPS_PER_DESA + ')');
      add(ak.filter(a => a.role === 'desa').length >= desa.size, 'Akun desa: ' + ak.filter(a => a.role === 'desa').length + ' dari ' + desa.size + ' desa');
      add(!ss.getSheetByName(SH.CETAK), ss.getSheetByName(SH.CETAK) ? 'Sheet Akun_Cetak masih ada: hapus setelah sandi dibagikan' : 'Sheet Akun_Cetak sudah dihapus');
    } catch (e) { add(false, 'Gagal membaca sheet: ' + e); }
  }
  try {
    dropDash_();
    const t0 = Date.now(), d = getDashboardData(), t1 = Date.now(); getDashboardData(); const t2 = Date.now();
    add(d.desa.length > 0, 'getDashboardData: ' + d.desa.length + ' desa, ' + JSON.stringify(d).length + ' karakter');
    add(t2 - t1 < 500, 'Baca dari sheet ' + (t1 - t0) + ' ms, dari cache ' + (t2 - t1) + ' ms');
  } catch (e) { add(false, 'getDashboardData error: ' + e); }
  add(true, 'Sesi login aktif: ' + Object.keys(sp.getProperties()).filter(k => k.indexOf('S_') === 0).length);
  Logger.log(out.join('\n'));
}

/** ---------- Data DPT (halaman /partisipasi) ---------- */
/** Publik: {sumber, diperbarui, desa:[{k,d,l,p,t}]}. Nama operator tidak ikut dikirim. */
function dptGet_() {
  const c = CacheService.getScriptCache(), hit = c.get('dpt');
  if (hit) return JSON.parse(hit);
  const sh = sheet_('DPT'), sp = PropertiesService.getScriptProperties();
  const desa = !sh ? [] : rows_(sh).filter(r => r.kecamatan && r.desa).map(r => {
    const l = Number(r.laki) || 0, p = Number(r.perempuan) || 0;
    return { k: String(r.kecamatan).trim(), d: String(r.desa).trim(), l: l, p: p, t: Number(r.total) || (l + p) };
  });
  const out = { sumber: sp.getProperty('DPT_SRC') || 'Data DPT Pilkades Serentak 2026', diperbarui: Number(sp.getProperty('DPT_AT') || 0), desa: desa };
  try { c.put('dpt', JSON.stringify(out), CACHE_SEC); } catch (e) {}
  return out;
}

/** Ganti seluruh data DPT. d = {sumber, rows:[{k,d,l,p,t}]} - hanya kabupaten */
function saveDpt_(d, me) {
  const rows = Array.isArray(d.rows) ? d.rows : [];
  if (!rows.length) return { error: 'Tidak ada baris DPT.' };
  if (rows.length > 3000) return { error: 'Terlalu banyak baris (maks. 3000).' };
  const seen = {}, vals = [];
  const int = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 1e6 && Math.floor(n) === n ? n : NaN; };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {}, k = String(r.k || '').trim().toUpperCase().slice(0, 60), ds = String(r.d || '').trim().toUpperCase().slice(0, 60);
    const l = int(r.l), p = int(r.p), t = r.t === '' || r.t == null ? l + p : int(r.t);
    if (!k || !ds) return { error: 'Baris ' + (i + 1) + ': kecamatan atau desa kosong.' };
    if ([l, p, t].some(isNaN)) return { error: 'Baris ' + (i + 1) + ' (' + ds + '): angka DPT tidak valid.' };
    const key = dk_(k, ds);
    if (seen[key]) return { error: 'Desa ' + ds + ' (Kec. ' + k + ') muncul dua kali.' };
    seen[key] = 1;
    vals.push([k, ds, l, p, t]);
  }
  const ss = db_(), sh = ss.getSheetByName(SH.DPT) || ss.insertSheet(SH.DPT);
  const old = sh.getLastRow() > 1 ? rows_(sh).length : 0;
  sh.clearContents();
  sh.getRange(1, 1, 1, HEAD.DPT.length).setValues([HEAD.DPT]);
  sh.getRange(2, 1, vals.length, HEAD.DPT.length).setValues(vals);
  const sp = PropertiesService.getScriptProperties(), now = Date.now();
  sp.setProperty('DPT_AT', String(now));
  sp.setProperty('DPT_SRC', String(d.sumber || 'Data DPT Pilkades Serentak 2026').replace(/[<>]/g, '').slice(0, 120));
  CacheService.getScriptCache().remove('dpt');
  const tot = vals.reduce((a, r) => a + r[4], 0);
  log_([[new Date(), 'DPT', '', '', '', '', old ? old + ' desa' : '', vals.length + ' desa, total ' + tot, who_(me)]]);
  return { ok: true, dpt: dptGet_(), info: 'Data DPT tersimpan: ' + vals.length + ' desa, total ' + tot.toLocaleString('id-ID') + ' pemilih.' };
}
