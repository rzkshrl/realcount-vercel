/* xlsx-lite: membaca dan menulis file .xlsx sederhana di peramban, tanpa pustaka luar.
 * Baca: XLSX.read(ArrayBuffer) -> {sheets:[{name, rows:[[...]]}]}   (juga .csv lewat XLSX.csv(text))
 * Tulis: XLSX.write([{name, rows}]) -> Blob .xlsx
 * Hanya nilai sel (teks, angka, hasil rumus). Format, gabungan sel, dan gambar diabaikan. */
(function () {
  'use strict';
  const td = new TextDecoder('utf-8'), te = new TextEncoder();

  /* ---------- ZIP ---------- */
  function unzip(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf), files = {};
    let e = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('Bukan file .xlsx (atau file rusak).');
    let p = dv.getUint32(e + 16, true);
    const n = dv.getUint16(e + 10, true);
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nlen));
      const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      files[name] = { method, data: u8.subarray(start, start + csize) };
      p += 46 + nlen + elen + clen;
    }
    return files;
  }
  async function inflate(f) {
    if (f.method === 0) return f.data;
    if (f.method !== 8) throw new Error('Kompresi file tidak didukung.');
    if (typeof DecompressionStream === 'undefined') throw new Error('Peramban ini terlalu lama. Pakai Chrome, Edge, Firefox atau Safari versi terbaru.');
    const s = new Blob([f.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }

  /* ---------- Baca ---------- */
  const xml = s => new DOMParser().parseFromString(s, 'application/xml');
  const tags = (n, t) => Array.from(n.getElementsByTagNameNS('*', t));
  const colIdx = ref => { let c = 0; for (const ch of ref.replace(/\d+$/, '')) c = c * 26 + ch.charCodeAt(0) - 64; return c - 1; };
  const path = (base, t) => t.startsWith('/') ? t.slice(1) : (base + t).replace(/[^/]+\/\.\.\//g, '');

  async function read(buf) {
    const z = unzip(buf), get = async n => z[n] ? td.decode(await inflate(z[n])) : null;
    const wb = await get('xl/workbook.xml');
    if (!wb) throw new Error('Bukan file Excel .xlsx. Bila file .xls, buka di Excel lalu Simpan Sebagai .xlsx.');
    const rels = {}, rx = await get('xl/_rels/workbook.xml.rels');
    if (rx) tags(xml(rx), 'Relationship').forEach(r => rels[r.getAttribute('Id')] = path('xl/', r.getAttribute('Target')));
    const ss = [], sx = await get('xl/sharedStrings.xml');
    if (sx) tags(xml(sx), 'si').forEach(si => ss.push(tags(si, 't').filter(t => t.parentNode.localName !== 'rPh').map(t => t.textContent).join('')));
    const sheets = [];
    for (const s of tags(xml(wb), 'sheet')) {
      const id = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      const sx2 = await get(rels[id] || '');
      if (!sx2) continue;
      const rows = [];
      tags(xml(sx2), 'row').forEach(row => {
        const ri = Number(row.getAttribute('r')) - 1;
        const r = rows[ri >= 0 ? ri : rows.length] = [];
        tags(row, 'c').forEach((c, j) => {
          const ref = c.getAttribute('r'), ci = ref ? colIdx(ref) : j, t = c.getAttribute('t');
          const v = tags(c, 'v')[0], vt = v ? v.textContent : '';
          let val = null;
          if (t === 's') val = ss[Number(vt)] ?? '';
          else if (t === 'inlineStr') val = tags(c, 't').map(x => x.textContent).join('');
          else if (t === 'str' || t === 'e') val = vt;
          else if (t === 'b') val = vt === '1';
          else if (vt !== '') val = Number(vt);
          r[ci] = val;
        });
      });
      for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
      sheets.push({ name: s.getAttribute('name'), rows });
    }
    return { sheets };
  }

  function csv(text) {
    text = text.replace(/^﻿/, '').replace(/^sep=.\r?\n/i, '');
    const first = text.split(/\r?\n/)[0], d = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
    const rows = [[]];
    let cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === d) { rows[rows.length - 1].push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; rows[rows.length - 1].push(cur); cur = ''; rows.push([]); }
      else cur += ch;
    }
    rows[rows.length - 1].push(cur);
    return { sheets: [{ name: 'CSV', rows: rows.map(r => r.map(v => v === '' ? null : v)) }] };
  }

  /* ---------- Tulis (ZIP tanpa kompresi) ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = u => { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(entries) {
    const parts = [], cd = [];
    let off = 0;
    entries.forEach(([name, str]) => {
      const nm = te.encode(name), data = te.encode(str), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 0, true); h.setUint16(12, 0x21, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nm.length, true);
      parts.push(h, nm, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(14, 0x21, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
      cd.push(c, nm);
      off += 30 + nm.length + data.length;
    });
    const size = cd.reduce((a, x) => a + x.byteLength, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...cd, e], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const colName = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  function write(sheets) {
    const sh = sheets.map((s, i) => {
      const rows = s.rows.map((r, ri) => '<row r="' + (ri + 1) + '">' + r.map((v, ci) => {
        if (v == null || v === '') return '';
        const ref = colName(ci) + (ri + 1), st = ri === 0 && s.header ? ' s="1"' : '';
        return typeof v === 'number' ? '<c r="' + ref + '"' + st + '><v>' + v + '</v></c>' : '<c r="' + ref + '" t="inlineStr"' + st + '><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
      }).join('') + '</row>').join('');
      const cols = s.widths ? '<cols>' + s.widths.map((w, c) => '<col min="' + (c + 1) + '" max="' + (c + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols>' : '';
      return ['xl/worksheets/sheet' + (i + 1) + '.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + cols + '<sheetData>' + rows + '</sheetData></worksheet>'];
    });
    return zip([
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sh.map(s => '<Override PartName="/' + s[0] + '" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets.map((s, i) => '<sheet name="' + esc(s.name).slice(0, 31) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sh.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '<Relationship Id="rId' + (sh.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>']
    ].concat(sh));
  }

  window.XLSX = { read, csv, write };
})();
