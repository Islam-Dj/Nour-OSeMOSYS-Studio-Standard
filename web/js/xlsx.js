'use strict';
/* ============================== Excel files (.xlsx), written in the page ==============================
   makeXlsx([{name, rows: [[cell, ...], ...], widths?: [chars, ...], bold?: [row indexes]}]) -> Blob.
   Numbers stay numbers, the first row is bold and frozen, columns get a width from their content. No library: an
   .xlsx is a zip of a few XML files; this writes the zip without compression (Excel and LibreOffice read it). */
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
function makeXlsx(sheets) {
  const xe = s =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const col = i => {
    let s = '';
    i++;
    while (i) {
      const m = (i - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      i = Math.floor((i - 1) / 26);
    }
    return s;
  };
  const used = new Set();
  const sheetName = n => {
    let b =
        String(n || 'Sheet')
          .replace(/[\\\/?*\[\]:]/g, ' ')
          .slice(0, 31) || 'Sheet',
      k = 2,
      s = b;
    while (used.has(s.toLowerCase())) s = b.slice(0, 28) + ' ' + k++;
    used.add(s.toLowerCase());
    return s;
  };
  const names = sheets.map(s => sheetName(s.name));
  const sheetXml = sh => {
    const rows = sh.rows || [],
      bold = new Set(sh.bold || [0]),
      ncol = Math.max(1, ...rows.map(r => r.length));
    const w = Array.from(
      {length: ncol},
      (_, c) =>
        (sh.widths && sh.widths[c]) ||
        Math.min(
          60,
          Math.max(
            8,
            ...rows.slice(0, 500).map(r => (r[c] == null ? 0 : String(typeof r[c] === 'number' ? +r[c].toPrecision(10) : r[c]).length + 2))
          )
        )
    );
    const body = rows
      .map(
        (r, i) =>
          `<row r="${i + 1}">${r
            .map((v, c) => {
              if (v === null || v === undefined || v === '') return '';
              const ref = col(c) + (i + 1),
                st = bold.has(i) ? ' s="1"' : '';
              return typeof v === 'number' && isFinite(v)
                ? `<c r="${ref}"${st}><v>${v}</v></c>`
                : `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${xe(v)}</t></is></c>`;
            })
            .join('')}</row>`
      )
      .join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0">${sh.freeze === false ? '' : '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'}</sheetView></sheetViews><cols>${w.map((x, c) => `<col min="${c + 1}" max="${c + 1}" width="${x}" customWidth="1"/>`).join('')}</cols><sheetData>${body}</sheetData></worksheet>`;
  };
  const files = [
    [
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`
    ],
    [
      '_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
    ],
    [
      'xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xe(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
    ],
    [
      'xl/styles.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`
    ],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)])
  ];
  return new Blob([zipStored(files.map(([n, t]) => [n, new TextEncoder().encode(t)]))], {type: XLSX_MIME});
}
function zipStored(entries) {
  // a zip archive, entries stored (no compression)
  const T =
    zipStored.T ||
    (zipStored.T = Array.from({length: 256}, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    }));
  const crc = d => {
    let c = 0xffffffff;
    for (let i = 0; i < d.length; i++) c = T[(c ^ d[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const parts = [],
    cen = [];
  let off = 0;
  for (const [name, data] of entries) {
    const nb = new TextEncoder().encode(name),
      c = crc(data),
      h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true);
    h.setUint16(8, 0, true);
    h.setUint32(14, c, true);
    h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, nb.length, true);
    parts.push(new Uint8Array(h.buffer), nb, data);
    const e = new DataView(new ArrayBuffer(46));
    e.setUint32(0, 0x02014b50, true);
    e.setUint16(4, 20, true);
    e.setUint16(6, 20, true);
    e.setUint16(8, 0x0800, true);
    e.setUint32(16, c, true);
    e.setUint32(20, data.length, true);
    e.setUint32(24, data.length, true);
    e.setUint16(28, nb.length, true);
    e.setUint32(42, off, true);
    cen.push(new Uint8Array(e.buffer), nb);
    off += 30 + nb.length + data.length;
  }
  const cs = cen.reduce((s, a) => s + a.length, 0),
    end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cs, true);
  end.setUint32(16, off, true);
  const all = [...parts, ...cen, new Uint8Array(end.buffer)],
    out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
  let p = 0;
  for (const a of all) {
    out.set(a, p);
    p += a.length;
  }
  return out;
}
