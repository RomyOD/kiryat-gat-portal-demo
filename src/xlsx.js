// יצירה וקריאה של קובצי Excel (xlsx) ו-CSV ללא תלות בשירות חיצוני
import JSZip from 'jszip';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

function colName(i) {
  let s = ''; i += 1;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

export async function writeXlsx(filename, sheetName, headers, rows, widths = []) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1B3076"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="4"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"><alignment horizontal="right" readingOrder="2"/></xf><xf numFmtId="164" applyNumberFormat="1"/><xf applyAlignment="1"><alignment horizontal="right" readingOrder="2" wrapText="1"/></xf></cellXfs></styleSheet>`);
  const cols = headers.map((h, i) => `<col min="${i + 1}" max="${i + 1}" width="${widths[i] || Math.max(12, String(h).length + 4)}" customWidth="1"/>`).join('');
  const line = (vals, r, head) => `<row r="${r}">${vals.map((v, c) => {
    const ref = `${colName(c)}${r}`;
    if (head) return `<c r="${ref}" t="inlineStr" s="1"><is><t>${esc(v)}</t></is></c>`;
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="2"><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr" s="3"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  }).join('')}</row>`;
  const data = [line(headers, 1, true), ...rows.map((r, i) => line(r, i + 2, false))].join('');
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${data}</sheetData><autoFilter ref="A1:${colName(headers.length - 1)}${rows.length + 1}"/></worksheet>`);
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const delim = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

function colIndex(ref) {
  const letters = ref.replace(/\d+/g, '');
  let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

async function parseXlsx(buf) {
  const zip = await JSZip.loadAsync(buf);
  const xml = async (p) => { const f = zip.file(p); return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null; };
  const wb = await xml('xl/workbook.xml');
  const rels = await xml('xl/_rels/workbook.xml.rels');
  if (!wb || !rels) throw new Error('הקובץ אינו קובץ Excel תקין');
  const first = wb.getElementsByTagName('sheet')[0];
  const rid = first.getAttribute('r:id') || first.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  let target = [...rels.getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target') || 'worksheets/sheet1.xml';
  target = target.replace(/^\/?xl\//, '').replace(/^\//, '');
  const sheet = await xml(`xl/${target}`);
  const ssDoc = await xml('xl/sharedStrings.xml');
  const shared = ssDoc ? [...ssDoc.getElementsByTagName('si')].map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent).join('')) : [];
  const out = [];
  for (const r of sheet.getElementsByTagName('row')) {
    const vals = [];
    for (const c of r.getElementsByTagName('c')) {
      const t = c.getAttribute('t'); const i = colIndex(c.getAttribute('r') || 'A1');
      let v = '';
      if (t === 's') v = shared[Number(c.getElementsByTagName('v')[0]?.textContent)] ?? '';
      else if (t === 'inlineStr') v = [...c.getElementsByTagName('t')].map((x) => x.textContent).join('');
      else v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      vals[i] = v;
    }
    for (let i = 0; i < vals.length; i++) if (vals[i] === undefined) vals[i] = '';
    if (vals.some((x) => String(x).trim() !== '')) out.push(vals);
  }
  return out;
}

export async function readTable(file) {
  if (/\.csv$/i.test(file.name)) return parseCsv(await file.text());
  if (/\.xlsx$/i.test(file.name)) return parseXlsx(await file.arrayBuffer());
  throw new Error('יש לבחור קובץ Excel (xlsx) או CSV');
}

export function toNumber(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[₪,\s]/g, '').replace(/^\((.*)\)$/, '-$1'));
  return Number.isFinite(n) ? n : NaN;
}
