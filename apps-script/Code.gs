/**
 * QUICK COUNT PILKADES WONOGIRI 2026 - backend saja (container-bound ke spreadsheet "DB Pusat")
 * Satu admin menginput semuanya lewat /admin (Vercel). Spreadsheet hanya database.
 * Sheet: Config_Calon, Desa, Suara, Log  (dibuat/dirapikan oleh setupDB)
 * Urutan: tempel kode -> setupDB -> Script properties (API_TOKEN, ADMIN_KEY) -> Deploy Web app (Anyone)
 *
 * Versi cepat:
 * - doGet ?mode=rev  -> {rev,last} dari Script properties, tanpa membaca sheet (dipakai dashboard untuk cek perubahan)
 * - Cache dashboard dipecah beberapa bagian (tidak lagi gagal di atas 95 KB) dan langsung DITAMBAL saat suara disimpan
 * - saveVotes membalas ringkas (tanpa membaca ulang semua sheet) supaya admin tidak menunggu
 * - Sesi login admin (token 14 hari) supaya kunci admin tidak perlu disimpan di browser
 */
const STATUS = ['Belum masuk', 'Sementara', 'Final'];
const SH = { CFG: 'Config_Calon', DESA: 'Desa', VOTE: 'Suara', LOG: 'Log' };
const HEAD = {
  CFG: ['id', 'kecamatan', 'desa', 'urut_daftar', 'nama_calon', 'petahana', 'aktif', 'nomor_urut', 'foto_url', 'foto_rasio'],
  DESA: ['kecamatan', 'desa', 'status', 'updated'],
  VOTE: ['calon_id', 'suara', 'updated'],
  LOG: ['waktu', 'jenis', 'kecamatan', 'desa', 'calon', 'lama', 'baru']
};
const SESSION_DAYS = 14;
const CHUNK = 45000;          // karakter per bagian cache (batas CacheService 100 KB per nilai)
const CACHE_SEC = 21600;      // 6 jam (maksimum CacheService)

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Quick Count')
    .addItem('Setup database', 'setupDB')
    .addItem('Cek kesehatan', 'diagnose')
    .addItem('Hapus trigger lama', 'cleanupOldTriggers')
    .addItem('Keluarkan semua sesi admin', 'logoutAll')
    .addToUi();
}

// ID DB Pusat disimpan sekali supaya selalu bisa dibuka lewat ID (aman untuk semua konteks)
const db_ = () => {
  const id = PropertiesService.getScriptProperties().getProperty('DB_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
};
const isYa_ = v => String(v).trim().toLowerCase() === 'ya';

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

/** ---------- Cache & revisi ---------- */
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

/** Tandai ada perubahan. Dashboard mengecek angka ini tiap beberapa detik. */
function bumpRev_(last, rev) {
  const o = { REV: String(rev || Date.now()) };
  if (last != null) o.LAST = String(last);
  PropertiesService.getScriptProperties().setProperties(o);
  return Number(o.REV);
}

/** 1) Siapkan / rapikan database. Aman dijalankan berulang (juga untuk Config_Calon versi lama). */
function setupDB() {
  PropertiesService.getScriptProperties().setProperty('DB_ID', SpreadsheetApp.getActiveSpreadsheet().getId());
  const ss = db_();
  ss.setSpreadsheetTimeZone('Asia/Jakarta');
  Object.keys(SH).forEach(k => {
    const sh = ss.getSheetByName(SH[k]) || ss.insertSheet(SH[k]);
    if (sh.getLastRow() === 0) sh.appendRow(HEAD[k]);
  });
  const cfg = ss.getSheetByName(SH.CFG);
  let head = cfg.getRange(1, 1, 1, cfg.getLastColumn()).getValues()[0];
  if (head.indexOf('id') < 0) { cfg.insertColumnBefore(1); cfg.getRange(1, 1).setValue('id'); head = ['id'].concat(head); }
  HEAD.CFG.forEach(n => { if (head.indexOf(n) < 0) { head.push(n); cfg.getRange(1, head.length).setValue(n); } });
  const v = cfg.getDataRange().getValues(), ci = head.indexOf('id');
  let max = 0;
  v.slice(1).forEach(r => { const m = /^C(\d+)$/.exec(String(r[ci])); if (m) max = Math.max(max, +m[1]); });
  const ids = v.slice(1).map(r => [r[ci] || (r[head.indexOf('nama_calon')] ? 'C' + String(++max).padStart(3, '0') : '')]);
  if (ids.length) cfg.getRange(2, ci + 1, ids.length, 1).setValues(ids);
  // baris Desa untuk setiap desa di Config_Calon
  const ds = ss.getSheetByName(SH.DESA), have = new Set(rows_(ds).map(r => r.kecamatan + '|' + r.desa)), add = [];
  rows_(cfg).forEach(r => { const k = r.kecamatan + '|' + r.desa; if (!have.has(k)) { have.add(k); add.push([r.kecamatan, r.desa, STATUS[0], '']); } });
  if (add.length) ds.getRange(ds.getLastRow() + 1, 1, add.length, 4).setValues(add);
  ss.getSheetByName(SH.LOG).getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  ds.getRange('D:D').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  ss.getSheetByName(SH.VOTE).getRange('C:C').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  bumpRev_(); dropDash_();
  PropertiesService.getScriptProperties().setProperty('LAST', String(getDashboardData().last));
}

/** Hapus semua trigger lama (sistem 18 workbook sudah tidak dipakai) */
function cleanupOldTriggers() { ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t)); }

/** Keluarkan semua perangkat admin (mis. HP admin hilang) */
function logoutAll() {
  const sp = PropertiesService.getScriptProperties();
  Object.keys(sp.getProperties()).filter(k => k.indexOf('S_') === 0).forEach(k => sp.deleteProperty(k));
}

// Edit manual langsung di spreadsheet membatalkan cache dashboard dan menandai perubahan
function onEdit() { bumpRev_(); dropDash_(); }

/** ---------- API publik (dashboard) ---------- */
function doGet(e) {
  const sp = PropertiesService.getScriptProperties(), tok = sp.getProperty('API_TOKEN');
  const p = (e && e.parameter) || {};
  if (!(p.api && tok && p.token === tok)) return json_({ error: 'unauthorized' });
  if (p.mode === 'rev') {
    let rev = Number(sp.getProperty('REV') || 0), last = sp.getProperty('LAST');
    if (!rev || last == null) { rev = bumpRev_(); dropDash_(); last = getDashboardData().last; sp.setProperty('LAST', String(last)); }
    return json_({ rev: rev, last: Number(last) });
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
  const ss = db_(), votes = {}, dst = {}, map = {};
  let last = 0;
  rows_(ss.getSheetByName(SH.VOTE)).forEach(r => votes[r.calon_id] = r);
  rows_(ss.getSheetByName(SH.DESA)).forEach(r => dst[r.kecamatan + '|' + r.desa] = r);
  rows_(ss.getSheetByName(SH.CFG)).forEach(r => {
    const k = r.kecamatan + '|' + r.desa;
    if (!map[k]) {
      const s = dst[k], t = s && s.updated ? new Date(s.updated).getTime() : 0;
      last = Math.max(last, t);
      map[k] = { kecamatan: r.kecamatan, desa: r.desa, status: (s && s.status) || STATUS[0], updated: t, calon: [] };
    }
    if (!isYa_(r.aktif)) return;
    const v = votes[r.id];
    map[k].calon.push({
      id: r.id, nama: r.nama_calon, petahana: isYa_(r.petahana), nomor_urut: r.nomor_urut || '',
      foto: photoUrl_(r.foto_url), rasio: r.foto_rasio || '4x6',
      suara: v && v.suara !== '' ? Number(v.suara) : null
    });
  });
  const desa = Object.values(map);
  desa.forEach(d => d.calon.sort((a, b) => (+a.nomor_urut || 99) - (+b.nomor_urut || 99)));
  const res = { desa: desa, last: last, rev: Number(PropertiesService.getScriptProperties().getProperty('REV') || 0) };
  cachePut_(res);
  return res;
}

/** Tambal cache dashboard setelah suara disimpan (tanpa membaca sheet lagi) */
function patchDash_(d, status, t, vals, rev) {
  const x = cacheGet_();
  if (!x) return;
  const row = x.desa.find(r => r.kecamatan === d.kecamatan && r.desa === d.desa);
  if (!row) { dropDash_(); return; }
  row.status = status; row.updated = t;
  row.calon.forEach(c => { if (Object.prototype.hasOwnProperty.call(vals, c.id)) c.suara = vals[c.id] === '' ? null : vals[c.id]; });
  x.last = Math.max(Number(x.last) || 0, t); x.rev = rev;
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

function checkKey_(key) {
  const sp = PropertiesService.getScriptProperties(), cache = CacheService.getScriptCache();
  const fails = Number(cache.get('adm_fail') || 0);
  if (fails >= 10) return false;                        // 10x salah -> terkunci 10 menit
  const real = sp.getProperty('ADMIN_KEY');
  const ok = !!real && key === real;
  if (!ok) cache.put('adm_fail', String(fails + 1), 600);
  return ok;
}

function sessionOk_(t) {
  if (!t || !/^[a-f0-9]{48,64}$/.test(t)) return false;
  const sp = PropertiesService.getScriptProperties(), v = sp.getProperty('S_' + t);
  if (!v) return false;
  if (Number(v) < Date.now()) { sp.deleteProperty('S_' + t); return false; }
  return true;
}

function newSession_() {
  const sp = PropertiesService.getScriptProperties(), now = Date.now(), all = sp.getProperties();
  Object.keys(all).forEach(k => { if (k.indexOf('S_') === 0 && Number(all[k]) < now) sp.deleteProperty(k); });
  const t = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  const exp = now + SESSION_DAYS * 864e5;
  sp.setProperty('S_' + t, String(exp));
  return { session: t, exp: exp };
}

function admin_(b) {
  const fn = b.fn, d = b.data || {};
  if (fn === 'logout') { if (b.session) PropertiesService.getScriptProperties().deleteProperty('S_' + b.session); return { ok: true }; }
  const viaSession = !!b.session && sessionOk_(b.session);
  if (!viaSession && !(b.key && checkKey_(b.key))) return { error: b.session && !b.key ? 'session' : 'unauthorized' };
  if (fn === 'login') return Object.assign(adminList_(), newSession_());
  if (fn === 'list') return adminList_();
  const f = { saveVotes: saveVotes_, saveCalon: saveCalon_, addCalon: addCalon_, reset: reset_ }[fn];
  if (!f) return { error: 'bad request' };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { error: 'Sistem sibuk, coba lagi.' };
  try {
    const r = f(d);
    if (!r || !r.ok) return r;
    if (fn === 'saveVotes') return r;                    // balasan ringkas: admin tidak perlu menunggu daftar lengkap
    SpreadsheetApp.flush(); bumpRev_(); dropDash_();      // REV dulu, baru cache dibuang: data baru selalu membawa REV baru
    const list = adminList_();
    PropertiesService.getScriptProperties().setProperty('LAST', String(list.desa.reduce((m, x) => Math.max(m, x.updated || 0), 0)));
    return Object.assign(list, { ok: true, info: r.info || '' });
  } finally { lock.releaseLock(); }
}

function adminList_() {
  const ss = db_(), votes = {};
  rows_(ss.getSheetByName(SH.VOTE)).forEach(r => votes[r.calon_id] = r);
  const calon = rows_(ss.getSheetByName(SH.CFG)).map(r => ({
    id: r.id, kecamatan: r.kecamatan, desa: r.desa, nama: r.nama_calon, petahana: isYa_(r.petahana), aktif: isYa_(r.aktif),
    nomor_urut: r.nomor_urut === '' ? '' : String(r.nomor_urut), foto: photoUrl_(r.foto_url), rasio: r.foto_rasio || '4x6',
    suara: votes[r.id] && votes[r.id].suara !== '' ? Number(votes[r.id].suara) : null
  }));
  const dst = {};
  rows_(ss.getSheetByName(SH.DESA)).forEach(r => dst[r.kecamatan + '|' + r.desa] = r);
  const seen = {}, desa = [];
  calon.forEach(c => {
    const k = c.kecamatan + '|' + c.desa;
    if (seen[k]) return; seen[k] = 1;
    const s = dst[k];
    desa.push({ kecamatan: c.kecamatan, desa: c.desa, status: (s && s.status) || STATUS[0], updated: s && s.updated ? new Date(s.updated).getTime() : 0 });
  });
  return { calon: calon, desa: desa };
}

function log_(rows) {
  if (!rows.length) return;
  const l = db_().getSheetByName(SH.LOG);
  l.getRange(l.getLastRow() + 1, 1, rows.length, 7).setValues(rows);
}

/** Simpan suara satu desa + statusnya */
function saveVotes_(d) {
  const ss = db_();
  const cs = rows_(ss.getSheetByName(SH.CFG)).filter(r => r.kecamatan === d.kecamatan && r.desa === d.desa && isYa_(r.aktif));
  if (!cs.length) return { error: 'Desa ini belum punya calon aktif.' };
  const vals = {}; let any = false, full = true;
  for (const r of cs) {
    const raw = (d.suara || {})[r.id];
    if (raw === '' || raw == null) { vals[r.id] = ''; full = false; continue; }
    if (!/^\d{1,6}$/.test(String(raw))) return { error: 'Suara ' + r.nama_calon + ' harus angka bulat, 0 atau lebih.' };
    vals[r.id] = Number(raw); any = true;
  }
  let status = STATUS.indexOf(d.status) >= 0 ? d.status : STATUS[0];
  if (!any) status = STATUS[0];
  else if (status === STATUS[0]) status = STATUS[1];
  if (status === STATUS[2] && !full) return { error: 'Status Final butuh suara semua calon terisi.' };

  const now = new Date(), log = [];
  const vs = ss.getSheetByName(SH.VOTE), cur = vs.getDataRange().getValues(), pos = {}, add = [];
  cur.forEach((r, i) => { if (i) pos[r[0]] = i; });
  cs.forEach(r => {
    const nv = vals[r.id], has = pos[r.id] != null, old = has ? cur[pos[r.id]][1] : '';
    if (old !== nv) log.push([now, 'suara', r.kecamatan, r.desa, r.nama_calon, old, nv]);
    if (has) vs.getRange(pos[r.id] + 1, 2, 1, 2).setValues([[nv, now]]); else add.push([r.id, nv, now]);
  });
  if (add.length) vs.getRange(vs.getLastRow() + 1, 1, add.length, 3).setValues(add);
  const ds = ss.getSheetByName(SH.DESA), dv = ds.getDataRange().getValues();
  const i = dv.findIndex((r, n) => n > 0 && r[0] === d.kecamatan && r[1] === d.desa);
  if (i > 0) {
    if (dv[i][2] !== status) log.push([now, 'status', d.kecamatan, d.desa, '', dv[i][2], status]);
    ds.getRange(i + 1, 3, 1, 2).setValues([[status, now]]);
  } else {
    log.push([now, 'status', d.kecamatan, d.desa, '', '', status]);
    ds.appendRow([d.kecamatan, d.desa, status, now]);
  }
  log_(log);
  const t = now.getTime(), rev = Date.now();
  patchDash_(d, status, t, vals, rev);                    // cache ditambal dulu, baru REV diumumkan
  bumpRev_(t, rev);
  const suara = {}; Object.keys(vals).forEach(k => suara[k] = vals[k] === '' ? null : vals[k]);
  return { ok: true, info: 'Tersimpan.', kecamatan: d.kecamatan, desa: d.desa, status: status, updated: t, suara: suara };
}

function fotoFolder_() {
  const sp = PropertiesService.getScriptProperties(), id = sp.getProperty('FOTO_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const f = DriveApp.createFolder('QC Pilkades 2026 - Foto');
  sp.setProperty('FOTO_FOLDER_ID', f.getId());
  return f;
}

/** Ubah data calon: nama, petahana, aktif, nomor urut, rasio, foto (JPEG <= 40 KB) */
function saveCalon_(d) {
  const sh = db_().getSheetByName(SH.CFG), v = sh.getDataRange().getValues(), head = v[0];
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

/** Tambah calon baru (kecamatan/desa baru otomatis terbentuk) */
function addCalon_(d) {
  const kec = String(d.kecamatan || '').trim().toUpperCase(), desa = String(d.desa || '').trim().toUpperCase(), nama = String(d.nama || '').trim();
  if (!kec || !desa || !nama || nama.length > 80) return { error: 'Kecamatan, desa, dan nama calon wajib diisi.' };
  const ss = db_(), sh = ss.getSheetByName(SH.CFG), v = sh.getDataRange().getValues(), head = v[0];
  const c = n => head.indexOf(n);
  const same = v.filter((r, k) => k > 0 && r[c('kecamatan')] === kec && r[c('desa')] === desa);
  if (same.filter(r => isYa_(r[c('aktif')])).length >= 5) return { error: 'Maksimal 5 calon aktif per desa.' };
  let max = 0;
  v.slice(1).forEach(r => { const m = /^C(\d+)$/.exec(String(r[c('id')])); if (m) max = Math.max(max, +m[1]); });
  const o = { id: 'C' + String(max + 1).padStart(3, '0'), kecamatan: kec, desa: desa, urut_daftar: same.length + 1, nama_calon: nama,
    petahana: d.petahana ? 'ya' : '', aktif: 'ya', nomor_urut: '', foto_url: '', foto_rasio: '4x6' };
  sh.appendRow(head.map(h => o[h] !== undefined ? o[h] : ''));
  const ds = ss.getSheetByName(SH.DESA);
  if (!rows_(ds).some(r => r.kecamatan === kec && r.desa === desa)) ds.appendRow([kec, desa, STATUS[0], '']);
  return { ok: true, info: 'Calon ditambahkan.' };
}

/** Kosongkan semua suara dan status (untuk setelah uji coba). Wajib confirm = "RESET" */
function reset_(d) {
  if (d.confirm !== 'RESET') return { error: 'Ketik RESET untuk konfirmasi.' };
  const ss = db_(), vs = ss.getSheetByName(SH.VOTE), ds = ss.getSheetByName(SH.DESA);
  if (vs.getLastRow() > 1) vs.getRange(2, 1, vs.getLastRow() - 1, 3).clearContent();
  if (ds.getLastRow() > 1) {
    const n = ds.getLastRow() - 1;
    ds.getRange(2, 3, n, 2).setValues(Array.from({ length: n }, () => [STATUS[0], '']));
  }
  log_([[new Date(), 'reset', '', '', '', '', 'semua suara dikosongkan']]);
  return { ok: true, info: 'Semua suara dikosongkan.' };
}

/** Cek kesehatan: jalankan dari editor, lihat hasilnya di Execution log */
function diagnose() {
  const sp = PropertiesService.getScriptProperties(), out = [];
  const add = (ok, msg) => out.push((ok ? 'OK       ' : 'MASALAH  ') + msg);
  add(!!sp.getProperty('API_TOKEN'), 'Script property API_TOKEN terisi');
  add(!!sp.getProperty('ADMIN_KEY'), 'Script property ADMIN_KEY terisi');
  add(!!sp.getProperty('DB_ID'), 'DB_ID tersimpan (jalankan setupDB)');
  add(!!sp.getProperty('REV'), 'Penanda revisi REV ada (jalankan setupDB sekali setelah update kode)');
  let ss = null;
  try { ss = db_(); } catch (e) { add(false, 'DB Pusat tidak bisa dibuka: ' + e); }
  if (ss) {
    Object.keys(SH).forEach(k => add(!!ss.getSheetByName(SH[k]), 'Sheet ' + SH[k] + ' ada'));
    const cfg = ss.getSheetByName(SH.CFG);
    if (cfg) {
      const r = rows_(cfg);
      add(r.length > 0, 'Config_Calon: ' + r.length + ' calon');
      add(r.every(x => x.id), 'Semua calon punya id');
    }
  }
  add(ScriptApp.getProjectTriggers().length === 0, 'Tidak ada trigger lama (' + ScriptApp.getProjectTriggers().length + ')');
  try {
    dropDash_();
    const t0 = Date.now(), d = getDashboardData(), t1 = Date.now(); getDashboardData(); const t2 = Date.now();
    add(d.desa.length > 0, 'getDashboardData mengembalikan ' + d.desa.length + ' desa (' + JSON.stringify(d).length + ' karakter)');
    add(t2 - t1 < 500, 'Baca dari sheet ' + (t1 - t0) + ' ms, dari cache ' + (t2 - t1) + ' ms');
  } catch (e) { add(false, 'getDashboardData error: ' + e); }
  const ses = Object.keys(sp.getProperties()).filter(k => k.indexOf('S_') === 0).length;
  add(true, 'Sesi admin aktif: ' + ses);
  Logger.log(out.join('\n'));
}
