'use strict';
/* ============================== ADD A MODEL ONTO THE OPEN MODEL ==============================
   The open case (A) keeps its structure: years, time slices, seasons, day types, YearSplit and the other time parameters. The data
   file added (B) brings its sets and parameters: sets are joined; a region of B goes to a region of A or stays a new one; a
   record of B that A already has keeps A's value (or B's, when chosen); values of B on other time slices are put on A's slices by
   their overlap along the year (both lists taken in time order): demand profiles (shares) are split, rates (capacity factors,
   profiles of the ratios) are averaged over the time. Seasons the same way. Years of B outside A are left out; years of A that B
   does not have take B's nearest year. */
const MG_TIME = new Set([
  'YearSplit',
  'Conversionls',
  'Conversionld',
  'Conversionlh',
  'DaySplit',
  'DaysInDayType',
  'DaySplit',
  'StorageChronological',
  'TimeSliceOrder',
  'DiscountRate'
]);
const MG_SHARE = new Set(['SpecifiedDemandProfile']); // shares of the year: split by the overlap
const MG_TIMESETS = new Set(['YEAR', 'TIMESLICE', 'SEASON', 'DAYTYPE', 'DAILYTIMEBRACKET']);
/* the time of each member, in order along the year: slices from YearSplit (first year), seasons from the slices they hold */
function mgLengths(D, set) {
  const S = D.sets[set] || [],
    y0 = String((D.sets.YEAR || [])[0]),
    ys = {};
  for (const r of (D.params.YearSplit || {recs: []}).recs) if (String(r.idx[1]) === y0) ys[String(r.idx[0])] = +r.v;
  if (set === 'TIMESLICE') return S.map(s => [String(s), ys[String(s)] ?? 1 / Math.max(1, S.length)]);
  if (set === 'SEASON') {
    const len = {};
    for (const r of (D.params.Conversionls || {recs: []}).recs)
      if (+r.v === 1) len[String(r.idx[1])] = (len[String(r.idx[1])] || 0) + (ys[String(r.idx[0])] || 0);
    return S.map(s => [String(s), len[String(s)] ?? 1 / Math.max(1, S.length)]);
  }
  return S.map(s => [String(s), 1 / Math.max(1, S.length)]);
}
/* overlap[b][a] of two lists of [member, length] laid end to end over one year (each list scaled to 1) */
function mgOverlap(LB, LA) {
  const tb = LB.reduce((s, x) => s + x[1], 0) || 1,
    ta = LA.reduce((s, x) => s + x[1], 0) || 1,
    O = {};
  let cb = 0;
  for (const [b, lb] of LB) {
    const b0 = cb / tb,
      b1 = (cb + lb) / tb;
    cb += lb;
    O[b] = {};
    let ca = 0;
    for (const [a, la] of LA) {
      const a0 = ca / ta,
        a1 = (ca + la) / ta;
      ca += la;
      const o = Math.max(0, Math.min(b1, a1) - Math.max(b0, a0));
      if (o > 1e-12) O[b][a] = o;
    }
  }
  return {O, durB: Object.fromEntries(LB.map(([b, l]) => [b, l / tb])), durA: Object.fromEntries(LA.map(([a, l]) => [a, l / ta]))};
}
/* B's values on B's members -> values on A's members (kind 'share' or 'rate') */
function mgMap(vB, ov, kind, members) {
  const out = {};
  for (const a of members) out[a] = 0;
  for (const [b, v] of Object.entries(vB)) {
    const row = ov.O[b] || {};
    for (const [a, o] of Object.entries(row)) out[a] += kind === 'share' ? (v * o) / ov.durB[b] : (v * o) / ov.durA[a];
  }
  return out;
}
/* the plan: what the merge does, before doing it */
function mergePlan(A, B, opt) {
  opt = opt || {};
  const rep = {
    prefer: opt.prefer || 'open',
    sets: {},
    conflicts: [],
    conflictCount: 0,
    dropped: [],
    filled: 0,
    time: [],
    defaults: [],
    regions: {}
  };
  const regA = (A.sets.REGION || []).map(String),
    regB = (B.sets.REGION || []).map(String),
    rmap = {};
  for (const r of regB)
    rmap[r] =
      opt.regions && opt.regions[r] != null ? opt.regions[r] : regA.includes(r) ? r : regA.length === 1 && regB.length === 1 ? regA[0] : r;
  rep.regions = rmap;
  const yA = (A.sets.YEAR || []).map(String),
    yB = (B.sets.YEAR || []).map(String),
    outY = yB.filter(y => !yA.includes(y)),
    missY = yA.filter(y => !yB.includes(y));
  if (outY.length)
    rep.dropped.push(`years of the added data outside the open case left out: ${outY[0]}–${outY[outY.length - 1]} (${outY.length})`);
  if (missY.length)
    rep.dropped.push(
      `years of the open case the added data does not have (${missY.length}: ${missY.slice(0, 3).join(', ')}${missY.length > 3 ? '…' : ''}) take its nearest year`
    );
  const same = set =>
    JSON.stringify((A.sets[set] || []).map(String)) === JSON.stringify((B.sets[set] || []).map(String)) &&
    JSON.stringify(mgLengths(A, set)) === JSON.stringify(mgLengths(B, set));
  const tsMap = !same('TIMESLICE') ? mgOverlap(mgLengths(B, 'TIMESLICE'), mgLengths(A, 'TIMESLICE')) : null;
  const seMap = (B.sets.SEASON || []).length && !same('SEASON') ? mgOverlap(mgLengths(B, 'SEASON'), mgLengths(A, 'SEASON')) : null;
  if (tsMap)
    rep.time.push(
      `time slices differ (${(B.sets.TIMESLICE || []).length} → ${(A.sets.TIMESLICE || []).length}): the values of the added data are put on the slices of the open case by their overlap along the year (` +
        Object.entries(tsMap.O)
          .map(
            ([b, row]) =>
              `${b} → ${Object.entries(row)
                .map(
                  ([a, o]) =>
                    `${a}${Math.abs(o - tsMap.durA[a]) > 1e-9 || Math.abs(o - tsMap.durB[b]) > 1e-9 ? ' ' + Math.round((100 * o) / tsMap.durB[b]) + '%' : ''}`
                )
                .join(' + ')}`
          )
          .slice(0, 8)
          .join('; ') +
        (Object.keys(tsMap.O).length > 8 ? '; …' : '') +
        ')'
    );
  if (seMap)
    rep.time.push(`seasons differ (${(B.sets.SEASON || []).length} → ${(A.sets.SEASON || []).length}): season values mapped the same way`);
  // sets
  const S = {};
  for (const [n, v] of Object.entries(A.sets)) S[n] = v.map(String);
  for (const [n, v] of Object.entries(B.sets)) {
    if (MG_TIMESETS.has(n)) continue;
    const cur = new Set(S[n] || []);
    let add = (n === 'REGION' ? v.map(r => rmap[String(r)]) : v.map(String)).filter(x => !cur.has(x));
    add = [...new Set(add)];
    if (add.length) {
      S[n] = [...(S[n] || []), ...add];
      rep.sets[n] = add;
    }
  }
  // parameters
  const P = {};
  for (const [n, p] of Object.entries(A.params)) P[n] = {name: n, def: p.def, recs: p.recs.map(r => ({idx: r.idx.map(String), v: r.v}))};
  const keyOf = idx => idx.join('\u0001');
  for (const [n, pb] of Object.entries(B.params)) {
    if (MG_TIME.has(n)) continue;
    const dims = typeof dimsOf === 'function' ? dimsOf(n) : [];
    if (!dims.length && pb.recs.length && pb.recs[0].idx.length) continue;
    const pa = (P[n] = P[n] || {name: n, def: pb.def, recs: []});
    if (pb.def !== undefined && pa.def !== undefined && +pb.def !== +pa.def && pb.recs.length)
      rep.defaults.push(
        `${n}: default ${pa.def} (open case) / ${pb.def} (added data): the added items use ${pa.def} where they had no value`
      );
    const ri = dims.map((d, i) => (d.startsWith('REGION') ? i : -1)).filter(i => i >= 0),
      yi = dims.indexOf('YEAR'),
      ti = dims.indexOf('TIMESLICE'),
      si = dims.indexOf('SEASON');
    // 1. regions mapped; 2. time slices / seasons mapped (grouped by the other indices); 3. years kept or filled
    let recs = pb.recs.map(r => {
      const idx = r.idx.map(String);
      for (const i of ri) idx[i] = rmap[idx[i]] ?? idx[i];
      return {idx, v: +r.v};
    });
    for (const [ix, mp, set] of [
      [ti, tsMap, 'TIMESLICE'],
      [si, seMap, 'SEASON']
    ]) {
      if (ix < 0 || !mp) continue;
      const G = new Map();
      for (const r of recs) {
        const k = keyOf(r.idx.filter((_, i) => i !== ix));
        if (!G.has(k)) G.set(k, {base: r.idx, v: {}});
        G.get(k).v[r.idx[ix]] = r.v;
      }
      const kind = MG_SHARE.has(n) ? 'share' : 'rate',
        mem = (A.sets[set] || []).map(String),
        dfl = pb.def !== undefined ? +pb.def : 0,
        out = [];
      for (const g of G.values()) {
        const vB = {};
        for (const [b] of Object.entries(mp.O)) vB[b] = g.v[b] ?? (kind === 'share' ? 0 : dfl);
        const vA = mgMap(vB, mp, kind, mem);
        for (const a of mem) {
          const idx = g.base.slice();
          idx[ix] = a;
          out.push({idx, v: vA[a]});
        }
      }
      recs = out;
    }
    if (yi >= 0) {
      const by = new Map();
      for (const r of recs) {
        const k = keyOf(r.idx.filter((_, i) => i !== yi));
        if (!by.has(k)) by.set(k, {base: r.idx, v: {}});
        by.get(k).v[r.idx[yi]] = r.v;
      }
      const out = [];
      for (const g of by.values()) {
        const have = Object.keys(g.v)
          .map(Number)
          .sort((a, b) => a - b);
        for (const y of yA) {
          let v = g.v[y];
          if (v === undefined) {
            if (!have.length) continue;
            const ny = have.reduce((p, c) => (Math.abs(c - +y) < Math.abs(p - +y) ? c : p), have[0]);
            v = g.v[String(ny)];
            rep.filled++;
          }
          const idx = g.base.slice();
          idx[yi] = y;
          out.push({idx, v});
        }
      }
      recs = out;
    }
    const have = new Map(pa.recs.map((r, i) => [keyOf(r.idx), i]));
    for (const r of recs) {
      const k = keyOf(r.idx);
      if (have.has(k)) {
        const cur = pa.recs[have.get(k)];
        if (Math.abs(+cur.v - r.v) > 1e-9 * Math.max(1, Math.abs(r.v))) {
          rep.conflictCount++;
          if (rep.conflicts.length < 40) rep.conflicts.push(`${n}[${r.idx.join(',')}]: ${cur.v} (open) / ${r.v} (added)`);
          if (opt.prefer === 'added') cur.v = r.v;
        }
      } else {
        have.set(k, pa.recs.length);
        pa.recs.push({idx: r.idx, v: r.v});
      }
    }
  }
  return {rep, sets: S, params: P};
}
/* the metadata lines of the added file for its new items (descriptions, colours, icons, units, systems) */
function mergeMeta(textB, newCodes) {
  return textB
    .split(/\r?\n/)
    .filter(l => /^#@(desc|color|icon|setdesc|unit|unitdef|system|subsystem|sysof)\b/.test(l))
    .filter(l => {
      const w = l.split(/\s+/);
      if (/^#@(system|subsystem)\b/.test(w[0])) return !(typeof SYSTEMS !== 'undefined' && SYSTEMS.list.some(s => s.c === w[1]));
      if (w[0] === '#@unitdef')
        return !(typeof UNITS !== 'undefined' && (UNITS.custom || []).some(c => c.id === (w[1] || '').split('|')[0]));
      return w.slice(1, 3).some(x => newCodes.has(x));
    });
}
function mergeReportHTML(rep) {
  const sets =
    Object.entries(rep.sets)
      .map(([n, v]) => `<li><b>${esc(n.toLowerCase())}</b>: +${v.length} (${esc(v.slice(0, 8).join(', '))}${v.length > 8 ? '…' : ''})</li>`)
      .join('') || '<li>No new item</li>';
  return `<ul class="mgl">${sets}</ul>
    ${
      Object.keys(rep.regions).length
        ? `<p class="small">Regions: ${Object.entries(rep.regions)
            .map(([b, a]) => `${esc(b)} → ${esc(a)}`)
            .join(', ')}</p>`
        : ''
    }
    ${rep.time.map(t => `<p class="small">${esc(t)}</p>`).join('')}${rep.dropped.map(t => `<p class="small">${esc(t)}</p>`).join('')}
    ${rep.filled ? `<p class="small">${rep.filled.toLocaleString()} values filled from the nearest year.</p>` : ''}
    ${rep.defaults.length ? `<details><summary>${rep.defaults.length} default value${rep.defaults.length === 1 ? '' : 's'} differ</summary><ul class="small">${rep.defaults.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
    ${rep.conflictCount ? `<details ${rep.conflictCount < 6 ? 'open' : ''}><summary class="warnt">${rep.conflictCount.toLocaleString()} value${rep.conflictCount === 1 ? '' : 's'} given in both with different numbers</summary><ul class="small">${rep.conflicts.map(x => `<li>${esc(x)}</li>`).join('')}${rep.conflictCount > rep.conflicts.length ? '<li>…</li>' : ''}</ul></details>` : '<p class="small">No value given in both with a different number.</p>'}`;
}
/* the dialog: regions of the added data, which value wins, the plan; then the open case becomes the joined model */
async function openMergeDialog(textB, fileName) {
  const A = parseData(writeData()),
    B = parseData(textB),
    regA = (A.sets.REGION || []).map(String),
    regB = (B.sets.REGION || []).map(String);
  const opt = {regions: {}, prefer: 'open'};
  let plan = mergePlan(A, B, opt);
  opt.regions = {...plan.rep.regions};
  return new Promise(res => {
    const d = document.createElement('div');
    d.className = 'pop modal';
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-label', 'Add a model to the open case');
    const body = () => `<h3>Add ${esc(fileName)} to ${esc(M.meta.name || 'the open case')}</h3>
      <p class="muted">The open case keeps its structure (years, time slices, seasons, YearSplit and the other time parameters); the added data brings its technologies, commodities, storages, emissions, constraints and their values. Check the joined model afterwards (Check).</p>
      <form class="frm" id="mgf"><div class="row2">${regB
        .map(
          r =>
            `<label>Region ${esc(r)} of the added data<select data-rg="${esc(r)}">${[
              ...regA.map(a => [a, 'join ' + a]),
              [r, regA.includes(r) ? r : 'new region ' + r]
            ]
              .filter((x, i, arr) => arr.findIndex(y => y[0] === x[0]) === i)
              .map(([v, l]) => `<option value="${esc(v)}" ${opt.regions[r] === v ? 'selected' : ''}>${esc(l)}</option>`)
              .join('')}</select></label>`
        )
        .join('')}
        <label>A value given in both<select id="mgp"><option value="open" ${opt.prefer === 'open' ? 'selected' : ''}>keep the open case's</option><option value="added" ${opt.prefer === 'added' ? 'selected' : ''}>take the added data's</option></select></label></div>
        <fieldset><legend>What the merge does</legend><div id="mgr">${mergeReportHTML(plan.rep)}</div></fieldset>
        <div class="acts"><button class="btn" type="button" id="mgc">Cancel</button><button class="btn pri" type="submit">Add to the open case</button></div></form>`;
    d.innerHTML = body();
    document.body.appendChild(d);
    const wire = () => {
      d.querySelector('#mgc').onclick = () => {
        d.remove();
        res(null);
      };
      d.querySelectorAll('[data-rg]').forEach(
        s =>
          (s.onchange = () => {
            opt.regions[s.dataset.rg] = s.value;
            plan = mergePlan(A, B, opt);
            d.querySelector('#mgr').innerHTML = mergeReportHTML(plan.rep);
          })
      );
      d.querySelector('#mgp').onchange = e => {
        opt.prefer = e.target.value;
        plan = mergePlan(A, B, opt);
        d.querySelector('#mgr').innerHTML = mergeReportHTML(plan.rep);
      };
      d.querySelector('#mgf').onsubmit = ev => {
        ev.preventDefault();
        d.remove();
        res(applyMerge(textB, plan, fileName));
      };
    };
    wire();
  });
}
/* the joined model: the sets and parameters of the plan written by the Studio, the new items' descriptions, then loaded */
function applyMerge(textB, plan, fileName) {
  const oldCodes = new Set(Object.values(M.D.sets).flat().map(String)),
    newCodes = new Set(
      Object.values(plan.sets)
        .flat()
        .filter(x => !oldCodes.has(String(x)))
        .map(String)
    );
  const B = parseData(textB);
  for (const [k, v] of Object.entries(B.desc || {}))
    if (newCodes.has(k) && !TD[k] && !FD[k]) (B.sets.TECHNOLOGY || []).includes(k) ? (TD[k] = v) : (FD[k] = v);
  for (const [k, v] of Object.entries(B.colors || {})) if (newCodes.has(k)) COLORS[k] = v;
  for (const [k, v] of Object.entries(B.icons || {})) if (newCodes.has(k)) ICONS[k] = v;
  const meta = {...M.meta};
  M.D.sets = plan.sets;
  M.D.params = plan.params;
  let text = writeData();
  const extra = mergeMeta(textB, newCodes).filter(l => !/^#@(desc|color|icon)\b/.test(l));
  if (extra.length) text = text.replace(/\nend;\s*$/, '\n' + extra.join('\n') + '\nend;\n');
  load(text, {...meta, note: `${meta.note ? meta.note + '; ' : ''}${fileName} added`});
  dirty = true;
  if (typeof scenChip === 'function') scenChip();
  toast(
    `${fileName} added: ${
      Object.entries(plan.rep.sets)
        .map(([n, v]) => `+${v.length} ${n.toLowerCase()}`)
        .join(', ') || 'no new item'
    }${plan.rep.conflictCount ? ` · ${plan.rep.conflictCount} values given in both kept as ${plan.rep.prefer === 'added' ? 'added' : 'in the open case'}` : ''}. Save the case to keep it.`
  );
  return plan.rep;
}
