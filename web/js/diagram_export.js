'use strict';
/* ============================== EXPORT THE DIAGRAM (title, author, legend, size, fonts, resolution, icons) ============================== */
const DXDEF = {
  title: '',
  subtitle: '',
  author: '',
  date: true,
  credit: APPNAME,
  legend: 'bottom',
  legbg: 'light',
  legdesc: true,
  legicons: true,
  keys: true,
  icons: 'auto',
  istyle: 'line',
  bg: 'white',
  font: '"Geist", "Segoe UI", Arial, sans-serif',
  tsize: 100,
  size: 'natural',
  w: 1600,
  h: 900,
  dpi: 300,
  fmt: 'png'
};
let DX = (() => {
  let s = {};
  try {
    s = JSON.parse(localStorage.getItem('mst_nos_dx') || '{}');
  } catch (e) {}
  return Object.assign({}, DXDEF, s);
})();
const FONTS = [
  ['"Geist", "Segoe UI", Arial, sans-serif', 'Geist (Studio)'],
  ['"Newsreader", Georgia, serif', 'Newsreader (Studio serif)'],
  ['Inter, "Segoe UI", Arial, sans-serif', 'Sans (Inter / Segoe UI)'],
  ['Arial, Helvetica, sans-serif', 'Arial / Helvetica'],
  ['Calibri, Carlito, Arial, sans-serif', 'Calibri'],
  ['"Source Sans Pro", "Source Sans 3", Arial, sans-serif', 'Source Sans'],
  ['Roboto, Arial, sans-serif', 'Roboto'],
  ['"Times New Roman", Times, serif', 'Times New Roman'],
  ['Georgia, serif', 'Georgia'],
  ['Garamond, "EB Garamond", serif', 'Garamond'],
  ['"Courier New", monospace', 'Courier (monospace)']
];
const SIZES = {
  natural: ['Natural size', null],
  a4l: ['A4 landscape', [297, 210]],
  a4p: ['A4 portrait', [210, 297]],
  a3l: ['A3 landscape', [420, 297]],
  slide: ['Slide 16:9 (1920 × 1080 px)', 'px', 1920, 1080],
  letterl: ['Letter landscape', [279.4, 215.9]],
  custom: ['Custom (px)', 'px']
};
const STYLEPROPS = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-opacity',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'letter-spacing',
  'text-anchor',
  'dominant-baseline'
];
const xesc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);

function composeDiagram(o) {
  const root = document.getElementById('root');
  if (!root || !G) return null;
  const html = document.documentElement,
    oldTheme = html.dataset.theme,
    oldShow = ICONSET.show,
    oldStyle = ICONSET.style;
  html.dataset.theme = o.bg === 'dark' ? 'dark' : 'light';
  ICONSET.show = o.icons;
  ICONSET.style = o.istyle;
  hi(null);
  draw();
  const src = document.getElementById('root'),
    svg = document.getElementById('svg');
  const bb = src.getBBox();
  const cl = src.cloneNode(true);
  cl.removeAttribute('transform');
  cl.removeAttribute('id');
  const inline = (a, b) => {
    const cs = getComputedStyle(a);
    b.setAttribute(
      'style',
      STYLEPROPS.map(p => {
        const v = cs.getPropertyValue(p);
        return v ? `${p}:${v}` : '';
      })
        .filter(Boolean)
        .join(';')
    );
    if (a.classList && a.classList.contains('f-hit')) b.setAttribute('data-rm', '1');
    b.removeAttribute('class');
    for (let i = 0; i < a.children.length; i++) if (b.children[i]) inline(a.children[i], b.children[i]);
  };
  inline(src, cl);
  cl.querySelectorAll('[data-rm], title').forEach(x => x.remove());
  cl.querySelectorAll('[style]').forEach(x => {
    if (/stroke:\s*transparent|opacity:\s*0(;|$)/.test(x.getAttribute('style')) && x.tagName === 'line') x.remove();
  });
  if (o.font !== 'keep')
    cl.querySelectorAll('text').forEach(t =>
      t.setAttribute('style', t.getAttribute('style').replace(/font-family:[^;]*/, 'font-family:' + o.font.replace(/"/g, "'")))
    );
  const defs = svg.querySelector('defs').cloneNode(true);
  const dsrc = svg.querySelector('defs');
  dsrc.querySelectorAll('marker path').forEach((p, i) => {
    const q = defs.querySelectorAll('marker path')[i];
    q.setAttribute('fill', getComputedStyle(p).fill);
  });
  const cs = getComputedStyle(html),
    ink = cs.getPropertyValue('--ink').trim() || '#222',
    muted = cs.getPropertyValue('--muted').trim() || '#777',
    paper = cs.getPropertyValue('--paper').trim() || '#fff';
  const legendItems = [...G.F]
    .sort(
      (a, b) =>
        ['land', 'ren', 'nuc', 'coal', 'oil', 'gas', 'trade', 'elc', 'h2', 'other'].indexOf(fam(a)) -
          ['land', 'ren', 'nuc', 'coal', 'oil', 'gas', 'trade', 'elc', 'h2', 'other'].indexOf(fam(b)) || a.localeCompare(b)
    )
    .map(f => {
      const tmp = document.createElementNS(svgNS, 'line');
      tmp.setAttribute('stroke', fcol(f));
      svg.appendChild(tmp);
      const c = getComputedStyle(tmp).stroke;
      tmp.remove();
      const d = (FD[f] || (fam(f) === 'other' ? '' : FAMLAB[fam(f)].toLowerCase())).split(/[.(;]/)[0].trim();
      return {f, c, d: d.length > 42 ? d.slice(0, 41) + '…' : d};
    });
  html.dataset.theme = oldTheme || '';
  if (!oldTheme) delete html.dataset.theme;
  ICONSET.show = oldShow;
  ICONSET.style = oldStyle;
  draw();
  // page layout
  const k = o.tsize / 100,
    ff = o.font.replace(/"/g, "'"),
    pad = 28,
    dW = bb.width + 20,
    dH = bb.height + 20;
  let y = pad;
  const head = [];
  if (o.title) {
    head.push(`<text x="${pad}" y="${y + 24 * k}" style="font:700 ${24 * k}px ${ff};fill:${ink}">${xesc(o.title)}</text>`);
    y += 34 * k;
  }
  if (o.subtitle) {
    head.push(`<text x="${pad}" y="${y + 15 * k}" style="font:400 ${15 * k}px ${ff};fill:${muted}">${xesc(o.subtitle)}</text>`);
    y += 24 * k;
  }
  const byline = [o.author, o.date ? new Date().toISOString().slice(0, 10) : ''].filter(Boolean).join(' · ');
  if (byline) {
    head.push(`<text x="${pad}" y="${y + 12 * k}" style="font:400 ${12 * k}px ${ff};fill:${muted}">${xesc(byline)}</text>`);
    y += 22 * k;
  }
  if (head.length) y += 8;
  // legend block
  const itW = (o.legdesc ? 300 : 120) * k,
    itH = 20 * k,
    lp = 12;
  let LW = 0,
    LH = 0,
    cols = 1,
    leg = '';
  const keyRows = o.keys ? 1 : 0;
  if (o.legend !== 'none' && legendItems.length) {
    cols =
      o.legend === 'right'
        ? Math.max(1, Math.ceil((legendItems.length * itH) / Math.max(dH, 300)))
        : Math.max(1, Math.floor((Math.max(dW, 700) - 2 * lp) / itW));
    // the systems (box edge colour) in one more row
    const SL =
      typeof SYSTEMS !== 'undefined' && SYSTEMS.list.length
        ? (() => {
            const n = new Map();
            for (const t of G.T) {
              const c = SYSTEMS.of(t, 'TECHNOLOGY');
              if (c) n.set(c, (n.get(c) || 0) + 1);
            }
            return SYSTEMS.list.filter(x => n.has(x.c));
          })()
        : [];
    const rows = Math.ceil(legendItems.length / cols);
    LW = cols * itW + 2 * lp;
    LH = (rows + keyRows + (SL.length ? 1 : 0)) * itH + 2 * lp + 18 * k;
    const it = legendItems
      .map((L, i) => {
        const cx = lp + Math.floor(i / rows) * itW,
          cy = lp + 18 * k + (i % rows) * itH;
        const ic = o.legicons ? iconFor(L.f, o.icons) : null;
        return (
          `<line x1="${cx}" y1="${cy + itH / 2}" x2="${cx + 22 * k}" y2="${cy + itH / 2}" stroke="${L.c}" stroke-width="${3 * k}" stroke-linecap="round"/>` +
          (ic ? iconSVG(ic, cx + 27 * k, cy + itH / 2 - 7 * k, 14 * k, L.c, o.istyle) : '') +
          `<text x="${cx + (ic ? 46 : 28) * k}" y="${cy + itH / 2 + 4 * k}" style="font:700 ${11 * k}px ${ff};fill:${ink}">${xesc(L.f)}<tspan style="font-weight:400;fill:${muted}">${o.legdesc && L.d ? '  ' + xesc(L.d) : ''}</tspan></text>`
        );
      })
      .join('');
    const keys = o.keys
      ? (() => {
          const cy = lp + 18 * k + rows * itH + itH / 2;
          return `<line x1="${lp}" y1="${cy}" x2="${lp + 22 * k}" y2="${cy}" stroke="${muted}" stroke-width="1.6" stroke-dasharray="5 4"/><text x="${lp + 28 * k}" y="${cy + 4 * k}" style="font:400 ${11 * k}px ${ff};fill:${muted}">reverse direction</text>
      <line x1="${lp + 150 * k}" y1="${cy}" x2="${lp + 172 * k}" y2="${cy}" stroke="${muted}" stroke-width="1.2" stroke-dasharray="1 3"/><text x="${lp + 178 * k}" y="${cy + 4 * k}" style="font:400 ${11 * k}px ${ff};fill:${muted}">own use</text>`;
        })()
      : '';
    const sysRow = SL.length
      ? (() => {
          const cy = lp + 18 * k + (rows + keyRows) * itH + itH / 2;
          let cx = lp,
            out = `<text x="${cx}" y="${cy + 4 * k}" style="font:700 ${11 * k}px ${ff};fill:${ink}">Systems (inner edge)</text>`;
          cx += 128 * k;
          for (const x of SL) {
            out += `<rect x="${cx}" y="${cy - 7 * k}" width="${22 * k}" height="${14 * k}" rx="${3.5 * k}" fill="${o.bg === 'dark' ? '#1d1f22' : '#ffffff'}" stroke="${muted}" stroke-width="${1.8 * k}"/><rect x="${cx + 3 * k}" y="${cy - 4 * k}" width="${16 * k}" height="${8 * k}" rx="${2 * k}" fill="none" stroke="${x.col}" stroke-width="${1.8 * k}"/><text x="${cx + 26 * k}" y="${cy + 4 * k}" style="font:600 ${11 * k}px ${ff};fill:${ink}">${xesc(x.n)}</text>`;
            cx += (36 + x.n.length * 6.6) * k;
          }
          LW = Math.max(LW, cx + lp);
          return out;
        })()
      : '';
    const bgc =
      o.legbg === 'none'
        ? ''
        : `<rect x="0" y="0" width="${LW}" height="${LH}" rx="8" fill="${o.legbg === 'light' ? (o.bg === 'dark' ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.035)') : 'none'}" stroke="${o.legbg === 'outline' || o.legbg === 'light' ? (o.bg === 'dark' ? 'rgba(255,255,255,.25)' : 'rgba(0,0,0,.18)') : 'none'}"/>`;
    leg = bgc + `<text x="${lp}" y="${lp + 11 * k}" style="font:700 ${12 * k}px ${ff};fill:${ink}">Commodities</text>` + it + keys + sysRow;
  }
  let W,
    H,
    dx = pad,
    dy = y,
    lx,
    ly;
  if (o.legend === 'right' && LW) {
    W = pad + dW + 20 + LW + pad;
    lx = pad + dW + 20;
    ly = y;
    H = y + Math.max(dH, LH) + pad;
  } else {
    W = Math.max(pad + dW + pad, LW + 2 * pad);
    lx = pad;
    ly = y + dH + 14;
    H = ly + (LH || 0) + pad;
  }
  const credit = o.credit
    ? `<text x="${W - pad}" y="${H - 10}" text-anchor="end" style="font:400 ${10 * k}px ${ff};fill:${muted}">${xesc(o.credit)}</text>`
    : '';
  H += o.credit ? 6 : 0;
  const bgFill = o.bg === 'transparent' ? 'none' : o.bg === 'dark' ? paper : '#ffffff';
  const body = `<rect width="${W}" height="${H}" fill="${bgFill}"/>${head.join('')}
    <g transform="translate(${dx - bb.x + 10},${dy - bb.y + 10})">${new XMLSerializer().serializeToString(cl)}</g>
    ${LW ? `<g transform="translate(${lx},${ly})">${leg}</g>` : ''}${credit}`;
  return {W: Math.ceil(W), H: Math.ceil(H), defs: new XMLSerializer().serializeToString(defs), body};
}
function finalSVG(c, o, forFile) {
  const S = SIZES[o.size] || SIZES.natural;
  let w = c.W,
    h = c.H,
    units = '';
  if (Array.isArray(S[1])) {
    w = S[1][0];
    h = S[1][1];
    units = 'mm';
  } else if (S[1] === 'px') {
    w = o.size === 'custom' ? +o.w : S[2];
    h = o.size === 'custom' ? +o.h : S[3];
  }
  // fit the content in the page, centred (the page keeps its size; preserveAspectRatio)
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}${units}" height="${h}${units}" viewBox="0 0 ${c.W} ${c.H}" preserveAspectRatio="xMidYMid meet">${o.bg !== 'transparent' && units ? `<rect x="-10000" y="-10000" width="30000" height="30000" fill="${o.bg === 'dark' ? '#1b1b1a' : '#ffffff'}"/>` : ''}${c.defs}${c.body}</svg>`;
}
function pagePx(c, o) {
  const S = SIZES[o.size] || SIZES.natural;
  if (Array.isArray(S[1])) return [Math.round((S[1][0] / 25.4) * o.dpi), Math.round((S[1][1] / 25.4) * o.dpi)];
  if (S[1] === 'px') {
    const w = o.size === 'custom' ? +o.w : S[2],
      h = o.size === 'custom' ? +o.h : S[3];
    return [Math.round((w * o.dpi) / 96), Math.round((h * o.dpi) / 96)];
  }
  return [Math.round((c.W * o.dpi) / 96), Math.round((c.H * o.dpi) / 96)];
}
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b) {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngWithDpi(buf, dpi) {
  const u = new Uint8Array(buf),
    ppm = Math.round(dpi / 0.0254);
  const ch = new Uint8Array(21);
  const dv = new DataView(ch.buffer);
  dv.setUint32(0, 9);
  ch.set([112, 72, 89, 115], 4);
  dv.setUint32(8, ppm);
  dv.setUint32(12, ppm);
  ch[16] = 1;
  dv.setUint32(17, crc32(ch.subarray(4, 17)));
  const out = new Uint8Array(u.length + 21);
  out.set(u.subarray(0, 33));
  out.set(ch, 33);
  out.set(u.subarray(33), 54);
  return out;
}
function pdfFromJpeg(jpg, pw, ph, wpt, hpt) {
  const enc = new TextEncoder(),
    parts = [],
    offs = [];
  let len = 0;
  const add = x => {
    const b = typeof x === 'string' ? enc.encode(x) : x;
    parts.push(b);
    len += b.length;
  };
  const obj = (n, s) => {
    offs[n] = len;
    add(`${n} 0 obj\n`);
    if (Array.isArray(s)) s.forEach(add);
    else add(s);
    add('\nendobj\n');
  };
  add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wpt.toFixed(2)} ${hpt.toFixed(2)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`
  );
  obj(4, [
    `<< /Type /XObject /Subtype /Image /Width ${pw} /Height ${ph} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`,
    jpg,
    '\nendstream'
  ]);
  const cs = `q ${wpt.toFixed(2)} 0 0 ${hpt.toFixed(2)} 0 0 cm /Im0 Do Q`;
  obj(5, `<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`);
  const xref = len;
  add(
    `xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map(n => String(offs[n]).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  );
  const out = new Uint8Array(len);
  let p = 0;
  for (const b of parts) {
    out.set(b, p);
    p += b.length;
  }
  return out;
}
async function rasterize(svgText, pw, ph, bg) {
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
  await img.decode();
  const c = document.createElement('canvas');
  c.width = pw;
  c.height = ph;
  const x = c.getContext('2d');
  if (bg) {
    x.fillStyle = bg;
    x.fillRect(0, 0, pw, ph);
  }
  x.drawImage(img, 0, 0, pw, ph);
  return c;
}
async function exportDiagram(o) {
  const c = composeDiagram(o);
  if (!c) return toast('Nothing to export');
  const base = (o.title || `${M.meta.name || 'model'}_${state.region}_RES`)
    .replace(/\.(txt|dat)$/i, '')
    .replace(/[^\w.-]+/g, '_')
    .slice(0, 80);
  if (o.fmt === 'drawio') {
    const html = document.documentElement,
      old = html.dataset.theme;
    html.dataset.theme = o.bg === 'dark' ? 'dark' : 'light';
    let xml;
    try {
      xml = drawioXML(o);
    } finally {
      if (old) html.dataset.theme = old;
      else delete html.dataset.theme;
    }
    return saveFile(base + '.drawio', xml, 'application/vnd.jgraph.mxfile');
  }
  const svgText = finalSVG(c, o);
  if (o.fmt === 'svg') return saveFile(base + '.svg', svgText, 'image/svg+xml');
  const [pw, ph] = pagePx(c, o);
  if (pw * ph > 2.6e8) return toast(`Too large (${pw} × ${ph} px): lower the resolution or the size`);
  const bgCol = o.fmt === 'png' && o.bg === 'transparent' ? null : o.bg === 'dark' ? '#1b1b1a' : '#ffffff';
  const cv = await rasterize(svgText, pw, ph, bgCol);
  if (o.fmt === 'png') {
    const b = await new Promise(r => cv.toBlob(r, 'image/png'));
    const u = pngWithDpi(await b.arrayBuffer(), o.dpi);
    return saveFile(base + '.png', new Blob([u], {type: 'image/png'}), 'image/png');
  }
  const jb = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.95));
  const jpg = new Uint8Array(await jb.arrayBuffer());
  if (o.fmt === 'jpg') return saveFile(base + '.jpg', jb, 'image/jpeg');
  const S = SIZES[o.size] || SIZES.natural;
  const [wpt, hpt] = Array.isArray(S[1]) ? [(S[1][0] / 25.4) * 72, (S[1][1] / 25.4) * 72] : [(pw / o.dpi) * 72, (ph / o.dpi) * 72];
  return saveFile(base + '.pdf', new Blob([pdfFromJpeg(jpg, pw, ph, wpt, hpt)], {type: 'application/pdf'}), 'application/pdf');
}
/* draw.io (diagrams.net) file: every technology, commodity bus, link, icon, title and legend is an editable shape;
   the links are connected to their shapes, so they follow when a box or a bus is moved in draw.io */
function realCol(f) {
  const svg = document.getElementById('svg'),
    tmp = document.createElementNS(svgNS, 'line');
  tmp.setAttribute('stroke', fcol(f));
  svg.appendChild(tmp);
  const c = getComputedStyle(tmp).stroke;
  tmp.remove();
  const m = c.match(/\d+(\.\d+)?/g);
  return m && m.length >= 3
    ? '#' +
        m
          .slice(0, 3)
          .map(v => (+v | 0).toString(16).padStart(2, '0'))
          .join('')
    : c;
}
function iconData(name, col, style) {
  const ic = ICON_LIB[name];
  if (!ic) return '';
  const svg =
    style === 'badge'
      ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="${col}"/><g transform="translate(4.3,4.3) scale(.64)" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ic[1]}</g></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${col}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ic[1]}</svg>`;
  return 'data:image/svg+xml,' + btoa(unescape(encodeURIComponent(svg)));
}
function drawioXML(o) {
  if (!G) return null;
  const Lo = G.layout,
    regs = state.region === 'ALL' ? REG : [state.region];
  const dark = o.bg === 'dark',
    ink = dark ? '#ecebe6' : '#1f1f1d',
    muted = dark ? '#a8a69e' : '#6b6a64',
    paper = dark ? '#1b1b1a' : '#ffffff';
  const ff = (o.font || 'Arial').split(',')[0].replace(/["']/g, '').trim(),
    k = (o.tsize || 100) / 100;
  const cells = [];
  let n = 2;
  const id = () => 'c' + n++;
  const A = s => xesc(s).replace(/\n/g, '&#xa;');
  const V = (val, style, x, y, w, h, parent = '1', cid) => {
    const i = cid || id();
    cells.push(
      `<mxCell id="${i}" value="${A(val)}" style="${style}" vertex="1" parent="${parent}"><mxGeometry x="${+x.toFixed(1)}" y="${+y.toFixed(1)}" width="${+w.toFixed(1)}" height="${+h.toFixed(1)}" as="geometry"/></mxCell>`
    );
    return i;
  };
  const E = (style, src, tgt, pts) => {
    cells.push(
      `<mxCell id="${id()}" value="" style="${style}" edge="1" parent="1" source="${src}" target="${tgt}"><mxGeometry relative="1" as="geometry">${pts && pts.length ? `<Array as="points">${pts.map(p => `<mxPoint x="${+p[0].toFixed(1)}" y="${+p[1].toFixed(1)}"/>`).join('')}</Array>` : ''}</mxGeometry></mxCell>`
    );
  };
  const txt = (sz, col, extra = '') =>
    `text;html=1;whiteSpace=wrap;align=left;verticalAlign=middle;fontFamily=${ff};fontSize=${Math.round(sz)};fontColor=${col};strokeColor=none;fillColor=none;${extra}`;
  // title block
  let y0 = 20;
  const X0 = 40;
  if (o.title) {
    V(o.title, txt(24 * k, ink, 'fontStyle=1;'), X0, y0, 900, 34 * k);
    y0 += 36 * k;
  }
  if (o.subtitle) {
    V(o.subtitle, txt(15 * k, muted), X0, y0, 900, 22 * k);
    y0 += 24 * k;
  }
  const byline = [o.author, o.date ? new Date().toISOString().slice(0, 10) : ''].filter(Boolean).join(' · ');
  if (byline) {
    V(byline, txt(12 * k, muted), X0, y0, 900, 18 * k);
    y0 += 22 * k;
  }
  const dy = Math.max(0, y0 + 10 - (TOP - 140)); // the diagram starts below the title block (labels of the buses reach ~TOP-130)
  const icons = o.icons || 'auto',
    ist = o.istyle || 'line';
  // stage headings
  for (let L = 0; L <= Lo.maxL; L += 2)
    if (Lo.tAt[L].length) {
      const lab = L === 0 ? 'Supply' : !Lo.tAt.slice(L + 1).some(a => a && a.length) ? 'End use' : 'Stage ' + L / 2;
      V(lab, txt(11, muted, 'fontStyle=1;'), Lo.colX[L], TOP + dy, 160, 20);
    }
  // commodity buses: thin coloured bars, label on top (rotated), icon below the label
  const fExt = new Map(),
    FC = new Map(),
    FID = new Map();
  for (const e of G.edges) {
    const yy = Lo.y.get('T:' + e.t) + BH / 2;
    const o2 = fExt.get(e.f) || [Infinity, -Infinity];
    fExt.set(e.f, [Math.min(o2[0], yy), Math.max(o2[1], yy)]);
  }
  for (const f of G.F) {
    const c = realCol(f);
    FC.set(f, c);
    const fx = Lo.x.get('F:' + f),
      [, y1] = fExt.get(f) || [0, TOP + 60];
    const top = TOP - 4 + dy,
      h = Math.max(20, y1 + 8 + dy - top);
    FID.set(
      f,
      V(
        '',
        `rounded=0;whiteSpace=wrap;html=1;fillColor=${c};strokeColor=none;resizable=1;movable=1;comment=${A(FD[f] || f).replace(/;/g, ',')};`,
        fx - 2,
        top,
        4,
        h,
        '1',
        'F_' + f.replace(/\W/g, '_')
      )
    );
    {
      const cx = fx - 7,
        cy = TOP - 10 + dy - 60;
      V(f, txt(10, c, `fontStyle=1;rotation=-90;align=left;spacing=0;`), cx - 60, cy - 7, 120, 14);
    } // reads upward, ends just above the bus
    const fi = iconFor(f, icons);
    if (fi) V('', `shape=image;html=1;imageAspect=1;aspect=fixed;image=${iconData(fi, c, 'badge')};`, fx - 9, TOP + dy - 1, 18, 18);
  }
  // technologies
  const TID = new Map();
  for (const t of G.T) {
    const tx = Lo.x.get('T:' + t),
      ty = Lo.y.get('T:' + t) + dy;
    const outs = G.edges.filter(e => e.t === t && e.dir === 'out').map(e => e.f),
      ins = G.edges.filter(e => e.t === t && e.dir === 'in').map(e => e.f);
    const main = outs.find(f => fam(f) !== 'other') || outs[0] || ins[0];
    const c = main ? FC.get(main) || realCol(main) : muted;
    const ic = iconFor(t, icons),
      nm = shortName(t);
    const lab = `<b>${xesc(nm)}</b><br><font style="font-size:${Math.round(9)}px" color="${muted}">${xesc(t)}${G.off.has(t) ? ' · inactive' : ''}</font>`;
    const st =
      `rounded=1;arcSize=18;whiteSpace=wrap;html=1;fillColor=${paper};strokeColor=${c};strokeWidth=1.5;fontFamily=${ff};fontSize=11;fontColor=${ink};align=left;verticalAlign=middle;spacingLeft=${ic ? 30 : 8};${G.off.has(t) ? 'dashed=1;opacity=60;' : ''}` +
      (ic
        ? `shape=label;image=${iconData(ic, c, ist)};imageWidth=20;imageHeight=20;imageAlign=left;imageVerticalAlign=middle;spacing=4;`
        : '');
    const cid = V('', st, tx, ty, BW, BH, '1', 'T_' + t.replace(/\W/g, '_'));
    cells[cells.length - 1] = cells[cells.length - 1].replace('value=""', `value="${A(lab)}" tooltip="${A(TD[t] || t)}"`);
    TID.set(t, cid);
  }
  // links: tech -> bus (output), bus -> tech (input); exit/entry points as in the Studio drawing
  const inCount = new Map(),
    outCount = new Map(),
    inSeen = new Map(),
    outSeen = new Map();
  for (const e of G.edges) {
    const m = e.dir === 'in' ? inCount : outCount;
    m.set(e.t, (m.get(e.t) || 0) + 1);
  }
  for (const e of G.edges) {
    const tx = Lo.x.get('T:' + e.t),
      ty = Lo.y.get('T:' + e.t) + dy,
      fx = Lo.x.get('F:' + e.f);
    const seen = e.dir === 'in' ? inSeen : outSeen,
      cnt = (e.dir === 'in' ? inCount : outCount).get(e.t);
    const kk = (seen.get(e.t) || 0) + 1;
    seen.set(e.t, kk);
    const fy = kk / (cnt + 1),
      c = FC.get(e.f),
      back = e.dir === 'out' ? !(fx > tx + BW) : !(fx < tx);
    const base = `edgeStyle=none;rounded=1;html=1;entryPerimeter=0;exitPerimeter=0;strokeColor=${c};strokeWidth=1.4;endArrow=block;endSize=5;endFill=1;${back ? 'dashed=1;dashPattern=5 4;' : ''}${e.aux ? 'dashed=1;dashPattern=1 3;' : ''}`;
    const bus = 'F_' + e.f.replace(/\W/g, '_');
    const [bt, bh] = (() => {
      const [, y1] = fExt.get(e.f);
      const top = TOP - 4 + dy;
      return [top, Math.max(20, y1 + 8 + dy - top)];
    })();
    const by = Math.min(1, Math.max(0, (ty + BH * fy - bt) / bh));
    if (e.dir === 'out')
      E(
        base + `exitX=1;exitY=${fy.toFixed(3)};exitDx=0;exitDy=0;entryX=0.5;entryY=${by.toFixed(3)};entryDx=0;entryDy=0;`,
        TID.get(e.t),
        bus,
        back
          ? [
              [tx + BW + 8, ty + BH + 5 + kk * 2],
              [fx, ty + BH + 5 + kk * 2]
            ]
          : null
      );
    else
      E(
        base + `exitX=0.5;exitY=${by.toFixed(3)};exitDx=0;exitDy=0;entryX=0;entryY=${fy.toFixed(3)};entryDx=0;entryDy=0;`,
        bus,
        TID.get(e.t),
        back
          ? [
              [fx, ty - 5 - kk * 2],
              [tx - 8, ty - 5 - kk * 2]
            ]
          : null
      );
  }
  // legend (a group: background + entries), below or right of the diagram
  if (o.legend !== 'none' && G.F.length) {
    const order = ['land', 'ren', 'nuc', 'coal', 'oil', 'gas', 'trade', 'elc', 'h2', 'other'];
    const F = [...G.F].sort((a, b) => order.indexOf(fam(a)) - order.indexOf(fam(b)) || a.localeCompare(b));
    const itW = (o.legdesc ? 300 : 120) * k,
      itH = 20 * k,
      lp = 12,
      dW = Lo.W;
    const cols =
      o.legend === 'right'
        ? Math.max(1, Math.ceil((F.length * itH) / Math.max(Lo.H, 300)))
        : Math.max(1, Math.floor((Math.max(dW, 700) - 2 * lp) / itW));
    const rows = Math.ceil(F.length / cols),
      LW = cols * itW + 2 * lp,
      LH = (rows + (o.keys ? 1 : 0)) * itH + 2 * lp + 18 * k;
    const lx = o.legend === 'right' ? Lo.W + 20 : X0,
      ly = o.legend === 'right' ? TOP + dy : Lo.H + dy + 10;
    const gbg =
      o.legbg === 'none'
        ? 'fillColor=none;strokeColor=none;'
        : o.legbg === 'outline'
          ? `fillColor=none;strokeColor=${dark ? '#55544f' : '#c9c8c2'};`
          : `fillColor=${dark ? '#262624' : '#f6f6f3'};strokeColor=${dark ? '#55544f' : '#d6d5cf'};`;
    const grp = V('', `rounded=1;arcSize=4;html=1;${gbg}container=1;collapsible=0;recursiveResize=0;`, lx, ly, LW, LH);
    V('Commodities', txt(12 * k, ink, 'fontStyle=1;'), lp, lp - 2, 200, 16 * k, grp);
    F.forEach((f, i) => {
      const cx = lp + Math.floor(i / rows) * itW,
        cy = lp + 18 * k + (i % rows) * itH,
        c = FC.get(f);
      V('', `rounded=1;html=1;fillColor=${c};strokeColor=none;`, cx, cy + itH / 2 - 1.5 * k, 22 * k, 3 * k, grp);
      const ic = o.legicons ? iconFor(f, icons) : null;
      if (ic)
        V(
          '',
          `shape=image;html=1;imageAspect=1;aspect=fixed;image=${iconData(ic, c, ist)};`,
          cx + 27 * k,
          cy + itH / 2 - 7 * k,
          14 * k,
          14 * k,
          grp
        );
      const d = (FD[f] || (fam(f) === 'other' ? '' : FAMLAB[fam(f)].toLowerCase())).split(/[.(;]/)[0].trim();
      V(
        `<b>${xesc(f)}</b>${o.legdesc && d ? `&nbsp; <font color="${muted}">${xesc(d.length > 42 ? d.slice(0, 41) + '…' : d)}</font>` : ''}`,
        txt(11 * k, ink),
        cx + (ic ? 46 : 28) * k,
        cy,
        itW - (ic ? 46 : 28) * k,
        itH,
        grp
      );
    });
    if (o.keys) {
      const cy = lp + 18 * k + rows * itH;
      V('', `shape=line;html=1;strokeColor=${muted};dashed=1;dashPattern=5 4;strokeWidth=1.6;`, lp, cy + itH / 2 - 2, 22 * k, 4, grp);
      V('reverse direction', txt(11 * k, muted), lp + 28 * k, cy, 120 * k, itH, grp);
      V(
        '',
        `shape=line;html=1;strokeColor=${muted};dashed=1;dashPattern=1 3;strokeWidth=1.2;`,
        lp + 150 * k,
        cy + itH / 2 - 2,
        22 * k,
        4,
        grp
      );
      V('own use', txt(11 * k, muted), lp + 178 * k, cy, 90 * k, itH, grp);
    }
  }
  if (o.credit)
    V(o.credit, txt(10 * k, muted, 'align=right;'), Math.max(Lo.W - 300, 0), Lo.H + dy + (o.legend === 'bottom' ? 0 : 10) - 4, 300, 14);
  const name = xesc(o.title || `${M.meta.name || 'model'} ${regs.length > 1 ? 'all regions' : regs[0]} RES`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<mxfile host="${APPNAME}" agent="${APPNAME}" version="24.0.0"><diagram id="res" name="${name}"><mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" background="${o.bg === 'transparent' ? 'none' : paper}" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>\n${cells.join('\n')}\n</root></mxGraphModel></diagram></mxfile>\n`;
}
function openDiagramExport() {
  const dr = document.getElementById('drawer');
  dr.hidden = false;
  const sel = (n, opts, v) =>
    `<select name="${n}">${opts.map(([a, b]) => `<option value="${xesc(a)}" ${String(a) === String(v) ? 'selected' : ''}>${xesc(b)}</option>`).join('')}</select>`;
  if (!DX.title)
    DX.title = `Reference energy system${REG.length > 1 ? ' · ' + (state.region === 'ALL' ? 'all regions' : RNAME[state.region]) : ''}`;
  dr.innerHTML = `<div class="dh"><div style="min-width:0"><div class="code">export · diagram</div><h2>Export the diagram</h2><p>The diagram of the current view (${xesc(state.region === 'ALL' ? 'all regions' : RNAME[state.region] || state.region)}) as an image for a report or a slide. The preview updates as you change the options.</p></div><button class="btn x" type="button" id="close">Close</button></div>
  <div class="db"><div class="dxprev" id="dxprev"></div><div class="ck-w" id="dxinfo2"></div><form id="dxf" class="frm">
    <fieldset><legend>Text</legend><label>Title<input name="title" value="${xesc(DX.title)}"></label><label>Subtitle<input name="subtitle" value="${xesc(DX.subtitle)}"></label>
      <div class="row2"><label>Author<input name="author" value="${xesc(DX.author)}" placeholder="e.g. your name, institution"></label><label>Credit line<input name="credit" value="${xesc(DX.credit)}"></label></div>
      <label class="chk"><input type="checkbox" name="date" ${DX.date ? 'checked' : ''}> date</label>
      <div class="row2"><label>Font${sel('font', FONTS, DX.font)}</label><label>Text size (title, legend) %<input name="tsize" type="number" min="60" max="200" step="10" value="${DX.tsize}"></label></div></fieldset>
    <fieldset><legend>Legend</legend><div class="row2"><label>Position${sel(
      'legend',
      [
        ['bottom', 'below the diagram'],
        ['right', 'right of the diagram'],
        ['none', 'no legend']
      ],
      DX.legend
    )}</label>
      <label>Background${sel(
        'legbg',
        [
          ['light', 'shaded box'],
          ['outline', 'outlined box'],
          ['none', 'no background']
        ],
        DX.legbg
      )}</label></div>
      <label class="chk"><input type="checkbox" name="legdesc" ${DX.legdesc ? 'checked' : ''}> descriptions</label> <label class="chk"><input type="checkbox" name="legicons" ${DX.legicons ? 'checked' : ''}> icons</label> <label class="chk"><input type="checkbox" name="keys" ${DX.keys ? 'checked' : ''}> line styles (reverse, own use)</label></fieldset>
    <fieldset><legend>Icons and background</legend><div class="row2"><label>Icons${sel(
      'icons',
      [
        ['auto', 'chosen + suggested'],
        ['chosen', 'only those chosen'],
        ['off', 'no icons']
      ],
      DX.icons
    )}</label>
      <label>Icon style${sel(
        'istyle',
        [
          ['line', 'line'],
          ['badge', 'coloured badge']
        ],
        DX.istyle
      )}</label></div>
      <label>Background${sel(
        'bg',
        [
          ['white', 'white'],
          ['transparent', 'transparent (PNG, SVG)'],
          ['dark', 'dark']
        ],
        DX.bg
      )}</label></fieldset>
    <fieldset><legend>Size and file</legend><div class="row2"><label>Page${sel(
      'size',
      Object.entries(SIZES).map(([k, v]) => [k, v[0]]),
      DX.size
    )}</label>
      <label>Resolution (dpi)${sel(
        'dpi',
        [
          [96, '96 (screen)'],
          [150, '150'],
          [300, '300 (print)'],
          [600, '600']
        ],
        DX.dpi
      )}</label></div>
      <div class="row2" id="dxcust" ${DX.size === 'custom' ? '' : 'hidden'}><label>Width (px)<input name="w" type="number" value="${DX.w}"></label><label>Height (px)<input name="h" type="number" value="${DX.h}"></label></div>
      <label>Format${sel(
        'fmt',
        [
          ['png', 'PNG'],
          ['svg', 'SVG (vector)'],
          ['pdf', 'PDF'],
          ['jpg', 'JPG'],
          ['drawio', 'draw.io (.drawio, editable)']
        ],
        DX.fmt
      )}</label>
      <div class="ck-w" id="dxinfo"></div></fieldset>
    <div class="acts"><button class="btn pri" type="submit">Export</button><button class="btn" type="button" id="dxreset">Reset options</button></div></form></div>`;
  const f = dr.querySelector('#dxf'),
    prev = dr.querySelector('#dxprev');
  const read = () => {
    const fd = new FormData(f);
    const o = {...DX};
    for (const k of Object.keys(DXDEF))
      if (typeof DXDEF[k] === 'boolean') o[k] = fd.get(k) === 'on';
      else if (fd.has(k)) o[k] = typeof DXDEF[k] === 'number' ? +fd.get(k) : String(fd.get(k));
    return o;
  };
  let tm = null;
  const upd = () => {
    DX = read();
    try {
      localStorage.setItem('mst_nos_dx', JSON.stringify(DX));
    } catch (e) {}
    dr.querySelector('#dxcust').hidden = DX.size !== 'custom';
    clearTimeout(tm);
    tm = setTimeout(() => {
      const c = composeDiagram(DX);
      if (!c) return;
      prev.innerHTML = finalSVG(c, DX).replace(/width="[^"]+" height="[^"]+"/, 'width="100%"');
      const [pw, ph] = pagePx(c, DX);
      dr.querySelector('#dxinfo2').textContent = dr.querySelector('#dxinfo').textContent =
        DX.fmt === 'drawio'
          ? 'draw.io file: every technology, commodity bus, link, icon, title and legend entry is a shape you can edit in draw.io (diagrams.net); the links stay connected when you move a shape. Page size and resolution do not apply.'
          : DX.fmt === 'svg'
            ? `vector · ${c.W} × ${c.H} units`
            : `${pw} × ${ph} px at ${DX.dpi} dpi (${((pw / DX.dpi) * 25.4).toFixed(0)} × ${((ph / DX.dpi) * 25.4).toFixed(0)} mm)`;
    }, 150);
  };
  f.oninput = upd;
  f.onchange = upd;
  upd();
  dr.querySelector('#dxreset').onclick = () => {
    DX = {...DXDEF};
    openDiagramExport();
  };
  f.onsubmit = async ev => {
    ev.preventDefault();
    DX = read();
    try {
      await exportDiagram(DX);
    } catch (e) {
      toast('Export failed: ' + e.message);
    }
  };
  dr.querySelector('#close').onclick = () => {
    dr.hidden = true;
  };
}
