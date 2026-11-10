'use strict';
/* ---- record access ---- */
function par(p) {
  const D = M.D;
  if (!D.params[p]) D.params[p] = {name: p, def: (SCHEMA && SCHEMA.params.get(p) && SCHEMA.params.get(p).def) ?? STDDEF[p] ?? 0, recs: []};
  return D.params[p];
}
function pmap(p) {
  const P = par(p);
  if (!P._map) {
    P._map = new Map();
    P.recs.forEach((r, i) => P._map.set(r.idx.join('|'), r));
  }
  return P._map;
}
function cellGetBase(p, idx) {
  const r = pmap(p).get(idx.join('|'));
  return r ? r.v : undefined;
}
function cellGet(p, idx) {
  if (typeof SCEN !== 'undefined' && SCEN.edit !== 'SC_0') {
    const o = scenOv(SCEN.edit, p),
      k = idx.join('|');
    if (o && Object.prototype.hasOwnProperty.call(o, k)) return o[k] === null ? undefined : o[k];
  }
  return cellGetBase(p, idx);
}
function cellSet(p, idx, v) {
  if (typeof SCEN !== 'undefined' && SCEN.edit !== 'SC_0') {
    // editing a scenario: keep only the differences from the base
    const k = idx.map(String).join('|'),
      b = cellGetBase(p, idx),
      nv = v === '' || v === undefined ? null : v,
      o = scenOv(SCEN.edit, p, true);
    if ((nv === null && b === undefined) || (nv !== null && b !== undefined && Number(nv) === Number(b))) delete o[k];
    else o[k] = nv === null ? null : Number(nv);
    return;
  }
  cellSetBase(p, idx, v);
}
function cellSetBase(p, idx, v) {
  const P = par(p),
    k = idx.join('|'),
    r = pmap(p).get(k);
  if (v === null || v === undefined || v === '') {
    if (r) {
      P.recs.splice(P.recs.indexOf(r), 1);
      P._map.delete(k);
    }
    return;
  }
  if (r) r.v = v;
  else {
    const n = {idx: idx.map(String), v, p};
    P.recs.push(n);
    P._map.set(k, n);
  }
}
function getRecs(p, pre) {
  return (M.D.params[p] || {recs: []}).recs.filter(r => pre.every((x, i) => x === undefined || String(r.idx[i]) === String(x)));
}
function delRecs(p, pre) {
  const P = M.D.params[p];
  if (!P) return;
  P.recs = P.recs.filter(r => !pre.every((x, i) => x === undefined || String(r.idx[i]) === String(x)));
  P._map = null;
}
function putSeries(p, pre, ser) {
  if (SCEN.edit !== 'SC_0') {
    for (const r of getRecs(p, pre)) if (!ser || !(String(r.idx[r.idx.length - 1]) in ser)) cellSet(p, r.idx, null);
  } // scenario: the differences only
  else delRecs(p, pre);
  if (!ser) return;
  for (const [y, v] of Object.entries(ser)) cellSet(p, [...pre, String(y)], v);
}
function addSet(n, x) {
  const S = M.D.sets;
  if (!S[n]) S[n] = [];
  if (!S[n].includes(x)) S[n].push(x);
}
function cset() {
  return M.D.sets[M.D.cname || 'COMMODITY'] || (M.D.sets.COMMODITY = []);
}
const setOf = n =>
  n === 'COMMODITY'
    ? cset()
    : (n === 'AGE' || n === 'VINTAGE') && typeof VINT !== 'undefined' && VINT.on()
      ? VINT.axis(null)[n]
      : M.D.sets[n] || []; // vintage/age axis: automatic (vintage.js)
function afterEdit(msg) {
  dirty = true;
  REV++;
  if (typeof viTouch === 'function') viTouch();
  const meta = {...M.meta, note: 'edited'};
  indexModel(M.D, meta);
  if (!M.years.includes(state.year)) state.year = M.years[Math.floor(M.years.length / 3)] || M.years[0];
  if (!REG.includes(state.region)) state.region = REG[0];
  document.getElementById('src').textContent =
    `${meta.name} · edited · ${M.techs.size} technologies · ${(M.S.COMMODITY || []).length} commodities`;
  CHECK = null; // the checks run when the Studio is idle (checks.js)
  initControls();
  draw();
  if (typeof CURVIEW !== 'undefined' && CURVIEW === 'ovw' && typeof renderSetup === 'function') renderSetup();
  if (msg) toast(msg);
  LIB.autosave();
}

/* ---- series syntax:  "5" = every year;  "2024:100, 2030:150" = straight lines between points (flat outside); one value per year ---- */
function parseSeries(txt) {
  const s = String(txt || '').trim();
  if (!s) return null;
  const Y = M.years;
  if (/^-?[\d.eE+-]+$/.test(s)) {
    const v = Number(s);
    if (isNaN(v)) throw new Error(`"${s}" is not a number`);
    return Object.fromEntries(Y.map(y => [y, v]));
  }
  if (s.includes(':')) {
    const pts = s
      .split(/[,;\s]+/)
      .filter(Boolean)
      .map(x => {
        const [a, b] = x.split(':');
        const y = Number(a),
          v = Number(b);
        if (isNaN(y) || isNaN(v)) throw new Error(`"${x}" should be year:value`);
        return [y, v];
      })
      .sort((a, b) => a[0] - b[0]);
    return Object.fromEntries(
      Y.map(y => {
        if (y <= pts[0][0]) return [y, pts[0][1]];
        const L = pts[pts.length - 1];
        if (y >= L[0]) return [y, L[1]];
        const k = pts.findIndex(p => p[0] >= y),
          a = pts[k - 1],
          b = pts[k];
        return [y, +(a[1] + ((b[1] - a[1]) * (y - a[0])) / (b[0] - a[0])).toPrecision(12)];
      })
    );
  }
  const vals = s
    .split(/[,;\s]+/)
    .filter(Boolean)
    .map(Number);
  if (vals.length !== Y.length || vals.some(isNaN))
    throw new Error(`give one number, year:value points, or ${Y.length} values (one per year)`);
  return Object.fromEntries(Y.map((y, i) => [y, vals[i]]));
}

/* ---- writer: MathProg data in the MUIO layout; with a loaded model file, exactly the sets and parameters it declares ---- */
function writeData(opts) {
  opts = opts || {};
  const PRM = opts.apply && opts.apply.length ? applyScenarios(opts.apply) : M.D.params;
  const D = M.D,
    S = D.sets,
    Y = new Set((S.YEAR || []).map(String)),
    out = [],
    strict = SCHEMA && SCHEMA.fromFile;
  out.push(
    '####################',
    `# written by ${APPNAME}, ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    `# model: ${M.meta.name}${SCHEMA ? ' · model file: ' + SCHEMA.name : ''}`,
    '####################',
    '#Sets#',
    '####################'
  );
  const cn = D.cname || 'COMMODITY';
  const order = [
    'REGION',
    'TECHNOLOGY',
    'COMMODITY',
    'EMISSION',
    'STORAGE',
    'YEAR',
    'SEASON',
    'DAYTYPE',
    'DAILYTIMEBRACKET',
    'TIMESLICE',
    'MODE_OF_OPERATION',
    'STORAGEINTRADAY',
    'STORAGEINTRAYEAR',
    'UDC'
  ];
  let names = strict
    ? [...SCHEMA.sets, ...SCHEMA.optSets.filter(n => S[n])]
    : [...order, ...Object.keys(S).filter(n => !order.includes(n))];
  names = [...new Set(names.map(n => (n === 'COMMODITY' || n === 'FUEL' ? cn : n)))].filter(
    n => !(n === 'COMMODITY' && cn === 'FUEL') && !(n === 'FUEL' && cn === 'COMMODITY')
  );
  const vin = VINT.on(),
    vs = vin ? VINT.writeSets(PRM) : null,
    vdom = vin ? VINT.domain(PRM) : null;
  let vdrop = 0;
  if (vin) {
    names = names.filter(n => n !== 'AGE' || vs.AGE);
    if (!names.includes('VINTAGE') && (SCHEMA.sets.includes('VINTAGE') || (SCHEMA.optSets || []).includes('VINTAGE')))
      names.push('VINTAGE');
  }
  for (const n of names)
    if (S[n] || strict || ['STORAGE', 'EMISSION', 'UDC', 'STORAGEINTRADAY', 'STORAGEINTRAYEAR'].includes(n))
      out.push(`set ${n} := ${(vin && (n === 'VINTAGE' || n === 'AGE') ? vs[n] : S[n] || []).join(' ')} ;`);
  const dl = [
    ...(S.TECHNOLOGY || []).filter(t => TD[t]).map(t => `#@desc ${t} ${TD[t]}`),
    ...(S[cn] || []).filter(f => FD[f]).map(f => `#@desc ${f} ${FD[f]}`),
    ...Object.entries(COLORS)
      .filter(([f]) => (S[cn] || []).includes(f))
      .map(([f, c]) => `#@color ${f} ${c}`),
    ...Object.entries(ICONS)
      .filter(([c]) => (S[cn] || []).includes(c) || (S.TECHNOLOGY || []).includes(c) || (S.STORAGE || []).includes(c))
      .map(([c, i]) => `#@icon ${c} ${i}`),
    ...Object.entries(SETDESC).flatMap(([sn, o]) =>
      Object.entries(o)
        .filter(([m, t]) => t && (S[sn] || []).map(String).includes(m))
        .map(([m, t]) => `#@setdesc ${sn} ${m} ${t}`)
    )
  ];
  if (dl.length) out.push('# descriptions, colours and icons (read back by the Studio; comments for GLPK)', ...dl);
  {
    const sy = SYSTEMS.lines();
    if (sy.length)
      out.push('# systems (energy, water, land use…) and the system of each item (read back by the Studio; comments for GLPK)', ...sy);
  }
  out.push('# units (labels, as in MUIO; read back by the Studio; comments for GLPK)', ...unitLines());
  {
    const oo = onoffLines();
    if (oo.length)
      out.push('# years each technology is on, and the values the rule replaced (read back by the Studio; comments for GLPK)', ...oo);
  }
  const sl = opts.apply ? [] : scenLines();
  if (sl.length) out.push('# scenarios: values each scenario changes (read back by the Studio; comments for GLPK)', ...sl);
  if (opts.apply && opts.apply.length) out.push(`# scenarios applied: ${opts.apply.map(scenName).join(' > ')}`);
  out.push('####################', '#Parameters#', '####################');
  const pn = strict ? [...SCHEMA.params.values()].filter(x => !x.computed && x.dims.length).map(x => x.name) : allParams();
  const dropped = strict ? Object.keys(D.params).filter(p => D.params[p].recs.length && !SCHEMA.params.has(p)) : [];
  for (const p of pn) {
    const P = PRM[p] || {recs: []},
      def = defOf(p),
      sp0 = SCHEMA && SCHEMA.params.get(p),
      vk = vin && sp0 ? ['VINTAGE', 'AGE'].map(s => [s, sp0.dims.indexOf(s)]).filter(x => x[1] >= 0) : [];
    const R = vk.length ? P.recs.filter(r => vk.every(([s, k]) => vdom[s].has(String(r.idx[k])) || (vdrop++, false))) : P.recs,
      sp = SCHEMA && SCHEMA.params.get(p),
      dd = sp && sp.def !== undefined ? '' : ` default ${def}`; // GLPK refuses a default the model file already gives
    if (!R.length) {
      out.push(`param ${p}${dd} := `, ';');
      continue;
    }
    const n = R[0].idx.length,
      yl = R.every(r => Y.has(String(r.idx[n - 1])));
    const colsOf = rs => {
      let c = [...new Set(rs.map(r => String(r.idx[n - 1])))];
      if (yl) c = (S.YEAR || []).map(String).filter(y => c.includes(y));
      return c;
    };
    if (n === 1) {
      out.push(`param ${p}${dd} := `, ...R.map(r => `${r.idx[0]} ${r.v}`), ';');
      continue;
    }
    if (n === 2) {
      const cols = colsOf(R),
        rows = [...new Set(R.map(r => String(r.idx[0])))],
        m = new Map(R.map(r => [r.idx.join('|'), r.v]));
      out.push(
        `param ${p}${dd} : `,
        cols.join(' ') + ' :=',
        ...rows.map(rw => rw + ' ' + cols.map(c => (m.has(rw + '|' + c) ? m.get(rw + '|' + c) : def)).join(' ')),
        ';'
      );
      continue;
    }
    out.push(`param ${p}${dd} := `);
    const grp = new Map();
    for (const r of R) {
      const k = r.idx.slice(0, n - 2).join(',');
      if (!grp.has(k)) grp.set(k, []);
      grp.get(k).push(r);
    }
    for (const [k, rs] of grp) {
      const cols = colsOf(rs),
        rows = [...new Set(rs.map(r => String(r.idx[n - 2])))],
        m = new Map(rs.map(r => [r.idx[n - 2] + '|' + r.idx[n - 1], r.v]));
      out.push(
        `[${k},*,*]: `,
        cols.join(' ') + ' :=',
        ...rows.map(rw => rw + ' ' + cols.map(c => (m.has(rw + '|' + c) ? m.get(rw + '|' + c) : def)).join(' '))
      );
    }
    out.push(';');
  }
  if (vin) {
    out.push(
      '# vintage axis written by the Studio (VINTAGE' +
        (vs.AGE ? ', AGE' : '') +
        ', AgeIndex = year - vintage, MaxAge where the model declares them)',
      ...VINT.writeExtra(PRM)
    );
    if (vdrop)
      out.push(
        `# ${vdrop} value(s) of vintage/age parameters not written: vintage or age outside the domain the model uses (ages up to the operational life of the technologies with VintageMode 1 or 2)`
      );
  }
  writeData.vdrop = vdrop;
  out.push('#', 'end;', '');
  writeData.dropped = dropped;
  return out.join('\n');
}
async function download() {
  const txt = writeData(),
    name = (M.meta.name || 'model').replace(/\.(txt|dat)$/i, '') + '.txt';
  if (writeData.dropped.length)
    toast(
      `Not written (not declared in ${SCHEMA.name}): ${writeData.dropped.slice(0, 6).join(', ')}${writeData.dropped.length > 6 ? '…' : ''}`
    );
  if (window.pywebview && window.pywebview.api && window.pywebview.api.save_file) return saveFile(name, txt, 'text/plain');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], {type: 'text/plain'}));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
  dirty = false;
  toast(`Saved ${name} (${(txt.length / 1e6).toFixed(2)} MB)`);
}
