'use strict';
/* ---- Model setup pages.
   One page per topic, every item with its whole configuration at a glance (read from the data, nothing changed here):
     Emissions    what emits (EmissionActivityRatio by technology and mode, sinks), penalty, limits, exogenous emissions
     Constraints  each UDC: its type (≤ / =, national / regional, off) per region, every term (activity, capacity, new
                  capacity, storage terms) with its multiplier, the right-hand side, and the equation for a chosen year
     Storage      charged / discharged by, capacity, cost, life, chronological / inter-year / inflow, rates, losses
     Vintaging    technologies with VintageMode 1 or 2, residual capacity by vintage, factors by vintage / age, retirement
   Each code opens its editor; "+" buttons create new items. */
const SETUP = {tab: 'time', reg: '', year: null, q: ''};
function showSetup(tab) {
  if (tab) SETUP.tab = tab;
  setView('ovw');
  renderSetup();
}

// values of a parameter, grouped by every index but the year: {key (index parts without the year), r, parts, ys: [[y, v]]}
function spRecs(pn, filt) {
  const P = P_(pn),
    yi = dimsOf(pn).indexOf('YEAR');
  const out = new Map();
  for (const x of P.recs) {
    const v = Number(x.v);
    if (filt && !filt(x.idx, v)) continue;
    const yr = yi >= 0 ? x.idx[yi] : null,
      parts = x.idx.filter((_, i) => i !== yi),
      k = parts.join('|');
    if (!out.has(k)) out.set(k, {parts, ys: []});
    out.get(k).ys.push([yr, v]);
  }
  for (const g of out.values()) g.ys.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return [...out.values()];
}
const spFmt = v =>
  (v === null || v === undefined || isNaN(v)
    ? '—'
    : Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0)
      ? v.toExponential(3)
      : (+v.toPrecision(6)).toLocaleString('en-US', {maximumFractionDigits: 6})
  ).replace(/^-/, '−');
// one value, or how it moves over the years: "0.25 (all years)", "1.2 (2025) → 0.8 (2050)"
function spRange(ys) {
  if (!ys.length) return '—';
  if (ys.length === 1 && ys[0][0] === null) return spFmt(ys[0][1]);
  const vals = ys.map(x => x[1]),
    same = vals.every(v => Math.abs(v - vals[0]) <= 1e-12 * Math.max(1, Math.abs(vals[0])));
  if (same)
    return `${spFmt(vals[0])} <span class="muted">(${ys.length === (M.years || []).length ? 'all years' : ys[0][0] + (ys.length > 1 ? '–' + ys[ys.length - 1][0] : '')})</span>`;
  const mn = Math.min(...vals),
    mx = Math.max(...vals);
  return `${spSpark(ys)}${spFmt(vals[0])} <span class="muted">(${ys[0][0]})</span> → ${spFmt(vals[vals.length - 1])} <span class="muted">(${ys[ys.length - 1][0]})</span>${mn < Math.min(vals[0], vals[vals.length - 1]) || mx > Math.max(vals[0], vals[vals.length - 1]) ? ` <span class="muted">· min ${spFmt(mn)}, max ${spFmt(mx)}</span>` : ''}`;
}
const spAt = (ys, y) => {
  const h = ys.find(x => String(x[0]) === String(y));
  return h ? h[1] : null;
};
const spOne = (pn, idx) => {
  const P = P_(pn);
  const h = P.recs.find(x => x.idx.every((v, i) => String(v) === String(idx[i])));
  const d = P.def !== undefined ? P.def : pinfo(pn).def;
  return h ? Number(h.v) : d !== undefined && d !== null ? Number(d) : null;
};
const spHas = pn => P_(pn).recs.length > 0;
const spRegOK = r => !SETUP.reg || r === SETUP.reg;
const spLink = (kind, code, name) =>
  `<button type="button" class="splink" data-k="${kind}" data-c="${esc(code)}" title="Open ${esc(code)}">${esc(code)}</button>${name ? ` <span class="muted">${esc(name)}</span>` : ''}`;
const spName = (set, c) =>
  set === 'TECHNOLOGY'
    ? TD[c] || ''
    : set === 'COMMODITY'
      ? FD[c] || ''
      : (typeof sdesc === 'function' ? sdesc(set, c) : '') || FD[c] || '';
const spTable = (head, rows, cls) =>
  rows.length
    ? `<table class="sptbl${cls ? ' ' + cls : ''}">${cls === 'kv' ? '' : `<thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead>`}<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    : '';
const spEmpty = t => `<p class="muted spnone">${t}</p>`;
const spCard = (kind, code, set, badges, body, open) =>
  `<details class="spcard" data-code="${esc(code)}" ${open ? 'open' : ''}><summary><span class="spic">${spIcon(SETUP.tab)}</span>${typeof sysDot === 'function' && typeof SYSTEMS !== 'undefined' ? sysDot(SYSTEMS.of(code, set)) : ''}<b>${esc(code)}</b><span class="muted spdesc">${esc(spName(set, code))}</span><span class="spbad">${badges}</span>${spActs(kind, code)}</summary><div class="spbody">${body}</div></details>`;
// every UDC, emission, storage and finance source: Edit, Rename, Duplicate, Delete (confirmed, with a message, undo on the page)
// one line icon per section, one colour
// family (teal) for the page; the diagram's icons where one fits
const SP_SVG = {
  scen: '<circle cx="6" cy="18" r="2.6"/><circle cx="6" cy="6" r="2.6"/><circle cx="18" cy="8" r="2.6"/><path d="M6 8.6v6.8"/><path d="M18 10.6c0 4-5 4.4-9.6 6.4"/>',
  time: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  lim: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-6"/><path d="M4 20.5h16"/>',
  prof: '<path d="M3 12c2-5 4-5 6 0s4 5 6 0 4-5 6 0"/>',
  uc: '<path d="M12 3v8"/><path d="M7 6.5a7 7 0 1 0 10 0"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
  vint: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 17.5l9 5 9-5"/>',
  udc: '<path d="M17 4.5H7l6 7.5-6 7.5h10"/>'
};
const SP_LIB = {dem: 'demand', casc: 'rain', emi: 'emission', stor: 'battery', trade: 'trade', fin: 'money'};
const spIcon = (k, cls) => {
  const lib = SP_LIB[k] && typeof ICON_LIB !== 'undefined' && ICON_LIB[SP_LIB[k]];
  const body = SP_SVG[k] || (lib ? lib[1] : SP_SVG.time);
  return `<svg class="spi${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
};
// a small trend line of a value over the years (only when it moves)
const spSpark = ys => {
  const v = ys.map(x => x[1]);
  if (v.length < 3) return '';
  const mn = Math.min(...v),
    mx = Math.max(...v);
  if (mx - mn <= 1e-12 * Math.max(1, Math.abs(mx))) return '';
  const W = 74,
    H = 18,
    pts = v.map((x, i) => `${((i / (v.length - 1)) * W).toFixed(1)},${(H - 2 - ((x - mn) / (mx - mn)) * (H - 4)).toFixed(1)}`).join(' ');
  return `<svg class="spk" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><polyline points="${pts}"/><circle cx="${pts.split(' ').pop().split(',')[0]}" cy="${pts.split(' ').pop().split(',')[1]}" r="2"/></svg>`;
};
const SP_FULL = new Set(['udc', 'emi', 'stor', 'x_FINANCE']);
const spActs = (kind, code) =>
  kind
    ? `<span class="spacts"><button type="button" class="btn sm spedit" data-k="${kind}" data-c="${esc(code)}" title="Open its editor: every parameter">Edit</button>${SP_FULL.has(kind) ? `<button type="button" class="btn sm spact" data-a="ren" data-k="${kind}" data-c="${esc(code)}" title="Change the code everywhere in the model">Rename</button><button type="button" class="btn sm spact" data-a="dup" data-k="${kind}" data-c="${esc(code)}" title="A copy with all its data, under a new code">Duplicate</button><button type="button" class="btn sm danger spact" data-a="del" data-k="${kind}" data-c="${esc(code)}" title="Delete it and all its data (Undo on this page)">Delete</button>` : ''}</span>`
    : '';
const spBadge = (t, cls, tip) => `<span class="spb ${cls || ''}"${tip ? ` title="${esc(tip)}"` : ''}>${t}</span>`;

/* ---------------- Emissions ---------------- */
function spEmissions() {
  const E = setOf('EMISSION').map(String);
  if (!E.length) return spEmpty('No emission in this model.');
  const ear = spRecs('EmissionActivityRatio', (ix, v) => v !== 0 && spRegOK(ix[0]));
  const ech = spRecs('EmissionToActivityChangeRatio', (ix, v) => v !== 0 && spRegOK(ix[0]));
  const byE = (L, ei) => {
    const m = new Map();
    for (const g of L) {
      const e = g.parts[ei];
      if (!m.has(e)) m.set(e, []);
      m.get(e).push(g);
    }
    return m;
  };
  const EAR = byE(ear, 2),
    ECH = byE(ech, 2);
  const lim = (pn, ei) =>
    byE(
      spRecs(pn, (ix, v) => spRegOK(ix[0])),
      ei
    );
  const PEN = lim('EmissionsPenalty', 1),
    AL = lim('AnnualEmissionLimit', 1),
    RAL = lim('RegionalAnnualEmissionLimit', 1),
    ML = lim('ModelPeriodEmissionLimit', 1),
    MX = lim('ModelPeriodExogenousEmission', 1),
    AX = lim('AnnualExogenousEmission', 1);
  const multiR = REG.length > 1 && !SETUP.reg;
  return (
    E.filter(e => !SETUP.q || (e + ' ' + spName('EMISSION', e)).toLowerCase().includes(SETUP.q))
      .map(e => {
        const src = (EAR.get(e) || []).sort((a, b) => a.parts[1].localeCompare(b.parts[1]) || a.parts[0].localeCompare(b.parts[0]));
        const techs = new Set(src.map(g => g.parts[1])),
          sinks = src.filter(g => g.ys.every(x => x[1] < 0)).map(g => g.parts[1]);
        const rows = src.map(g => [
          spLink('tech', g.parts[1], TD[g.parts[1]]),
          ...(multiR ? [esc(g.parts[0])] : []),
          esc(g.parts[3]),
          spRange(g.ys) +
            (g.ys.every(x => x[1] < 0) ? ' ' + spBadge('sink', 'ok', 'negative ratio: the technology absorbs this emission') : '')
        ]);
        const chg = (ECH.get(e) || []).map(g => [
          spLink('tech', g.parts[1], TD[g.parts[1]]),
          ...(multiR ? [esc(g.parts[0])] : []),
          esc(g.parts[3]),
          spRange(g.ys)
        ]);
        const L = [
          ['Penalty (cost per unit)', PEN],
          ['Annual limit (each region)', AL],
          ['Annual limit (all regions together)', RAL],
          ['Limit over the whole horizon', ML],
          ['Exogenous emission per year', AX],
          ['Exogenous emission, whole horizon', MX]
        ]
          .map(([t, m]) => [
            t,
            (m.get(e) || []).filter(g => g.ys.some(x => x[1] !== 0 || t.startsWith('Annual limit') || t.startsWith('Limit')))
          ])
          .filter(([, l]) => l.length)
          .map(([t, l]) => [
            t,
            l
              .map(g => `${multiR && g.parts[0] !== e ? `<span class="muted">${esc(g.parts[0])}:</span> ` : ''}${spRange(g.ys)}`)
              .join('<br>')
          ]);
        const bad2 =
          spBadge(`${techs.size} technolog${techs.size === 1 ? 'y' : 'ies'}`, techs.size ? '' : 'warn') +
          (sinks.length ? spBadge(`${sinks.length} sink${sinks.length > 1 ? 's' : ''}`, 'ok') : '') +
          ((PEN.get(e) || []).some(g => g.ys.some(x => x[1] > 0)) ? spBadge('priced', 'info', 'EmissionsPenalty > 0') : '') +
          ([AL, RAL, ML].some(m => (m.get(e) || []).length) ? spBadge('limited', 'info', 'an emission limit is set') : '');
        const body = `<h4>What emits ${esc(e)} <span class="muted">(EmissionActivityRatio, per unit of activity)</span></h4>${rows.length ? spTable(['Technology', ...(multiR ? ['Region'] : []), 'Mode', 'Ratio'], rows) : spEmpty('No technology emits it (EmissionActivityRatio is 0 everywhere).')}
      ${chg.length ? `<h4>Emission from a change of activity <span class="muted">(EmissionToActivityChangeRatio)</span></h4>${spTable(['Technology', ...(multiR ? ['Region'] : []), 'Mode', 'Ratio'], chg)}` : ''}
      <h4>Price and limits</h4>${L.length ? spTable(['Setting', 'Value'], L, 'kv') : spEmpty('No penalty, no limit, no exogenous emission (all default).')}`;
        return spCard('emi', e, 'EMISSION', bad2, body, E.length <= 3);
      })
      .join('') || spEmpty('No emission matches the filter.')
  );
}

/* ---------------- Constraints (UDC) ---------------- */
const UDC_TAG = {
  '-1': ['off', 'off', 'The constraint is not used'],
  0: ['≤ national', 'le', 'UDC1: one constraint per region and year, sum of the terms ≤ constant'],
  1: ['= national', 'eq', 'UDC2: one constraint per region and year, sum of the terms = constant'],
  2: ['≤ regional', 'le', 'RUDC1: one constraint per year, terms of all regions summed ≤ sum of the constants'],
  3: ['= regional', 'eq', 'RUDC2: one constraint per year, terms of all regions summed = sum of the constants']
};
const UDC_TERMS = [
  ['UDCMultiplierActivity', 'Activity', 'TotalTechnologyAnnualActivity', 'tech'],
  ['UDCMultiplierTotalCapacity', 'Total capacity', 'TotalCapacityAnnual', 'tech'],
  ['UDCMultiplierNewCapacity', 'New capacity', 'NewCapacity', 'tech'],
  ['UDCMultiplierStorageCapacity', 'Storage capacity', 'StorageCapacity', 'stor'],
  ['UDCMultiplierNewStorageCapacity', 'New storage capacity', 'NewStorageCapacity', 'stor'],
  ['UDCMultiplierStorageCharge', 'Storage charge', 'StorageCharge', 'stor'],
  ['UDCMultiplierStorageDischarge', 'Storage discharge', 'StorageDischarge', 'stor']
];
function spUDC() {
  const U = setOf('UDC').map(String);
  if (!U.length) return spEmpty('No user-defined constraint in this model.');
  const years = (M.years || []).map(String),
    Y = SETUP.year && years.includes(String(SETUP.year)) ? String(SETUP.year) : years[0];
  const terms = UDC_TERMS.map(([pn, lab, vn, kind]) => [pn, lab, vn, kind, spRecs(pn, (ix, v) => v !== 0)]);
  const cst = spRecs('UDCConstant', () => true);
  return (
    U.filter(
      u =>
        !SETUP.q ||
        (u + ' ' + spName('UDC', u)).toLowerCase().includes(SETUP.q) ||
        terms.some(T => T[4].some(g => g.parts[2] === u && g.parts[1].toLowerCase().includes(SETUP.q)))
    )
      .map(u => {
        const tags = REG.map(r => [r, spOne('UDCTag', [r, u])]),
          regional = tags.some(([, t]) => t === 2 || t === 3);
        const tagSet = [...new Set(tags.map(([, t]) => (t === null ? 'none' : String(t))))];
        const badges =
          tagSet
            .map(t =>
              UDC_TAG[t]
                ? spBadge(UDC_TAG[t][0], UDC_TAG[t][1], UDC_TAG[t][2])
                : spBadge('no tag', 'warn', 'UDCTag is not set: the constraint is not built')
            )
            .join('') + (tagSet.length > 1 ? spBadge('differs by region', 'warn') : '');
        const showR = r => regional || spRegOK(r);
        const rows = [],
          eq = new Map();
        for (const [pn, lab, vn, kind, L] of terms)
          for (const g of L) {
            if (g.parts[2] !== u || !showR(g.parts[0])) continue;
            const c = g.parts[1];
            rows.push([
              esc(lab),
              spLink(kind, c, kind === 'tech' ? TD[c] : spName('STORAGE', c)),
              ...(REG.length > 1 ? [esc(g.parts[0])] : []),
              spRange(g.ys),
              `<code>${esc(pn)}</code>`
            ]);
            const a = spAt(g.ys, Y);
            if (a !== null && a !== 0) {
              const k = regional ? '*' : g.parts[0];
              if (!eq.has(k)) eq.set(k, []);
              eq.get(k).push([a, `${vn}[${regional ? g.parts[0] + ',' : ''}${c}]`]);
            }
          }
        const rhs = cst.filter(g => g.parts[1] === u && showR(g.parts[0]));
        const crow = rhs.map(g => [...(REG.length > 1 ? [esc(g.parts[0])] : []), spRange(g.ys)]);
        const op = t => (t === 1 || t === 3 ? '=' : '≤');
        const eqs = (
          regional
            ? [['all regions', tags.find(([, t]) => t === 2 || t === 3)[1], '*']]
            : tags.filter(([r, t]) => spRegOK(r) && t !== -1 && t !== null).map(([r, t]) => [r, t, r])
        )
          .map(([lab, t, k]) => {
            const L = eq.get(k) || [],
              rv = regional
                ? rhs.reduce((s, g) => s + (spAt(g.ys, Y) || 0), 0)
                : rhs.find(g => g.parts[0] === k)
                  ? spAt(rhs.find(g => g.parts[0] === k).ys, Y)
                  : 0;
            const lhs = L.length
              ? L.map(
                  ([a, n], i) =>
                    `${i === 0 ? (a < 0 ? '−' : '') : a < 0 ? ' − ' : ' + '}${Math.abs(a) === 1 ? '' : spFmt(Math.abs(a)) + ' × '}${esc(n)}`
                ).join('')
              : '<span class="muted">No term</span>';
            return `<div class="speq"><span class="muted">${esc(lab)}, ${Y}:</span> ${lhs} <b>${op(t)}</b> ${spFmt(rv || 0)}</div>`;
          })
          .join('');
        const opt = (r, t) =>
          `<select class="sptag" data-u="${esc(u)}" data-r="${esc(r)}" aria-label="Type of ${esc(u)} in ${esc(r)}">${[
            ['', 'not set (no constraint)'],
            ['-1', 'off'],
            ['0', '≤ national (UDC1)'],
            ['1', '= national (UDC2)'],
            ['2', '≤ regional, all regions summed (RUDC1)'],
            ['3', '= regional, all regions summed (RUDC2)']
          ]
            .map(([v, l]) => `<option value="${v}" ${String(t ?? '') === v ? 'selected' : ''}>${l}</option>`)
            .join('')}</select>`;
        const body = `<h4>Type <span class="muted">(change it here: the message says what changed)</span></h4><div class="sptags">${tags.map(([r, t]) => `<label>${REG.length > 1 ? `<span class="muted">${esc(r)}</span>` : ''}${opt(r, t)}</label>`).join('')}</div><p class="muted spsmall">${tags.map(([r, t]) => `${REG.length > 1 ? esc(r) + ': ' : ''}${UDC_TAG[t] ? esc(UDC_TAG[t][2]) : 'UDCTag not set: the constraint is not built'}`).join(' · ')}</p>
      <h4>Equation <span class="muted">(year chosen above)</span></h4>${eqs || spEmpty('The constraint is off in the regions shown.')}
      <h4>Terms <span class="muted">(${rows.length})</span></h4>${rows.length ? spTable(['Term', 'Technology / storage', ...(REG.length > 1 ? ['Region'] : []), 'Multiplier', 'Parameter'], rows) : spEmpty('No term: every multiplier is 0.')}
      <h4>Right-hand side <span class="muted">(UDCConstant${regional ? ', summed over the regions' : ''})</span></h4>${crow.length ? spTable([...(REG.length > 1 ? ['Region'] : []), 'Constant'], crow) : spEmpty('0 (default) in every year.')}`;
        return spCard('udc', u, 'UDC', badges + spBadge(`${rows.length} term${rows.length === 1 ? '' : 's'}`), body, U.length <= 3);
      })
      .join('') || spEmpty('No constraint matches the filter.')
  );
}

/* ---------------- Storage ---------------- */
const STO_PARAMS = [
  ['OperationalLifeStorage', 'Life (years)'],
  ['CapitalCostStorage', 'Capital cost'],
  ['FixedCostStorage', 'Fixed cost'],
  ['StorageVariableCost', 'Variable cost'],
  ['ResidualStorageCapacity', 'Residual capacity'],
  ['MinStorageCharge', 'Minimum level (share)'],
  ['StorageLevelStart', 'Level at the start'],
  ['StorageMaxLevel', 'Maximum level (share)'],
  ['StorageSelfDischarge', 'Self-discharge'],
  ['StorageCapacityFade', 'Capacity fade'],
  ['StorageMaxChargeRate', 'Maximum charge rate'],
  ['StorageMaxDischargeRate', 'Maximum discharge rate'],
  ['StorageMinDuration', 'Minimum duration'],
  ['StorageMaxDuration', 'Maximum duration'],
  ['StorageMaxCycles', 'Maximum cycles'],
  ['StorageAvailability', 'Availability']
];
function spStorage() {
  const S = setOf('STORAGE').map(String);
  if (!S.length) return spEmpty('No storage in this model.');
  const to = spRecs('TechnologyToStorage', (ix, v) => v !== 0 && spRegOK(ix[0])),
    from = spRecs('TechnologyFromStorage', (ix, v) => v !== 0 && spRegOK(ix[0]));
  const inflow = new Set(
    P_('StorageInflow')
      .recs.filter(x => Number(x.v) > 0 && spRegOK(x.idx[0]))
      .map(x => x.idx[1])
  );
  const udcU = new Set(
    UDC_TERMS.filter(t => t[3] === 'stor').flatMap(t =>
      P_(t[0])
        .recs.filter(x => Number(x.v) !== 0)
        .map(x => x.idx[1])
    )
  );
  const multiR = REG.length > 1 && !SETUP.reg;
  return (
    S.filter(s => !SETUP.q || (s + ' ' + spName('STORAGE', s)).toLowerCase().includes(SETUP.q))
      .map(s => {
        const regs = REG.filter(spRegOK),
          flag = pn => regs.some(r => (spOne(pn, [r, s]) || 0) === 1);
        const chrono = flag('StorageChronological'),
          inter = flag('StorageInterYear');
        const tc = to.filter(g => g.parts[2] === s),
          tf = from.filter(g => g.parts[2] === s);
        const io = (L, what) =>
          L.map(g => [
            spLink('tech', g.parts[1], TD[g.parts[1]]),
            ...(multiR ? [esc(g.parts[0])] : []),
            esc(g.parts[3]),
            esc(what),
            spRange(g.ys)
          ]);
        const set = STO_PARAMS.map(([pn, lab]) => [lab, spRecs(pn, ix => ix[1] === s && spRegOK(ix[0]))])
          .filter(([, l]) => l.length)
          .map(([lab, l]) => [
            lab,
            l.map(g => `${multiR ? `<span class="muted">${esc(g.parts[0])}:</span> ` : ''}${spRange(g.ys)}`).join('<br>')
          ]);
        const badges =
          spBadge(
            chrono ? 'chronological' : 'by day type (OSeMOSYS)',
            chrono ? 'info' : '',
            chrono ? 'StorageChronological = 1: the level follows the order of the time slices' : 'the classic OSeMOSYS storage'
          ) +
          (inter ? spBadge('inter-year', 'info', 'StorageInterYear = 1: the level carries over from one year to the next') : '') +
          (inflow.has(s) ? spBadge('inflow', 'info', 'StorageInflow: water or energy flows in by itself') : '') +
          (udcU.has(s) ? spBadge('in a UDC', '', 'a user-defined constraint uses this storage') : '') +
          (!tc.length || !tf.length ? spBadge(!tc.length ? 'nothing charges it' : 'nothing discharges it', 'warn') : '');
        const body = `<h4>Charged and discharged by</h4>${tc.length + tf.length ? spTable(['Technology', ...(multiR ? ['Region'] : []), 'Mode', 'Role', 'Ratio'], [...io(tc, 'charges'), ...io(tf, 'discharges')]) : spEmpty('No technology is linked to it (TechnologyToStorage / TechnologyFromStorage).')}
      <h4>Settings <span class="muted">(only those set in the data; the others keep their default)</span></h4>${set.length ? spTable(['Setting', 'Value'], set, 'kv') : spEmpty('All default.')}`;
        return spCard('stor', s, 'STORAGE', badges, body, S.length <= 3);
      })
      .join('') || spEmpty('No storage matches the filter.')
  );
}

/* ---------------- Vintaging ---------------- */
const VINT_FACT = [
  'VintFacAF',
  'AgeDegAF',
  'VintFacFC',
  'AgeDegFC',
  'VintFacVC',
  'AgeDegVC',
  'VintFacIAR',
  'AgeDegIAR',
  'VintFacOAR',
  'AgeDegOAR',
  'VintFacEAR',
  'AgeDegEAR',
  'VintSeasonIAR',
  'VintSeasonOAR'
];
function spVintage() {
  if (!('VintageMode' in M.D.params)) return spEmpty('This model file has no vintaging (no VintageMode parameter).');
  const vm = new Map(
    P_('VintageMode')
      .recs.filter(x => Number(x.v) > 0)
      .map(x => [String(x.idx[0]), Number(x.v)])
  );
  const touched = new Set([...vm.keys()]);
  const facts = VINT_FACT.map(pn => [pn, P_(pn).recs.filter(x => Number(x.v) !== 1)]);
  for (const [, L] of facts) for (const x of L) touched.add(String(x.idx[0]));
  const rcv = P_('ResidualCapacityByVintage').recs.filter(x => Number(x.v) !== 0 && spRegOK(x.idx[0]));
  for (const x of rcv) touched.add(String(x.idx[1]));
  const ret = [
    ['EarlyRetirement', 'early retirement allowed'],
    ['RetirementCost', 'retirement cost'],
    ['RefurbishmentCost', 'refurbishment cost']
  ].map(([pn, lab]) => [pn, lab, P_(pn).recs.filter(x => Number(x.v) !== 0 && spRegOK(x.idx[0]))]);
  for (const [, , L] of ret) for (const x of L) touched.add(String(x.idx[1]));
  const T = [...touched].filter(t => !SETUP.q || (t + ' ' + (TD[t] || '')).toLowerCase().includes(SETUP.q)).sort();
  const head = `<p class="spintro">${vm.size ? `${vm.size} technolog${vm.size === 1 ? 'y is' : 'ies are'} tracked by vintage.` : 'No technology has VintageMode 1 or 2: vintaging is off (the model is the standard one).'} Mode 1 = capacity and annual activity by cohort; mode 2 = also the activity of each cohort in each time slice.</p>`;
  if (!T.length) return head + spEmpty(SETUP.q ? 'No technology matches the filter.' : 'No vintaging data in this model.');
  return (
    head +
    T.map(t => {
      const m = vm.get(t) || 0,
        R = rcv.filter(x => String(x.idx[1]) === t),
        F = facts.filter(([, L]) => L.some(x => String(x.idx[0]) === t));
      const rr = ret.map(([pn, lab, L]) => [lab, L.filter(x => String(x.idx[1]) === t)]).filter(([, L]) => L.length);
      const badges =
        spBadge(
          m ? `mode ${m}` : 'mode 0 (off)',
          m ? 'info' : 'warn',
          m
            ? m === 1
              ? 'capacity and annual activity by cohort'
              : 'cohorts also by time slice'
            : 'VintageMode is 0: the vintage data below is not used'
        ) +
        (R.length ? spBadge(`${new Set(R.map(x => x.idx[2])).size} residual cohorts`) : '') +
        (F.length ? spBadge(`${F.length} factor${F.length > 1 ? 's' : ''}`) : '') +
        rr.map(([lab]) => spBadge(lab)).join('');
      const rtab = R.length
        ? spTable(
            [...(REG.length > 1 && !SETUP.reg ? ['Region'] : []), 'Vintage', 'Residual capacity'],
            R.sort((a, b) => String(a.idx[2]).localeCompare(String(b.idx[2]))).map(x => [
              ...(REG.length > 1 && !SETUP.reg ? [esc(x.idx[0])] : []),
              esc(x.idx[2]),
              spFmt(Number(x.v))
            ])
          )
        : '';
      const ftab = F.length
        ? spTable(
            ['Factor', 'Values (≠ 1)'],
            F.map(([pn, L]) => {
              const l = L.filter(x => String(x.idx[0]) === t);
              return [
                `<code>${esc(pn)}</code>`,
                l
                  .slice(0, 8)
                  .map(x => `${esc(x.idx.slice(1).join(' · '))}: ${spFmt(Number(x.v))}`)
                  .join(', ') + (l.length > 8 ? ` <span class="muted">… ${l.length} values</span>` : '')
              ];
            }),
            'kv'
          )
        : '';
      const body =
        `${rtab ? `<h4>Residual capacity by vintage</h4>${rtab}` : ''}${ftab ? `<h4>Factors by vintage / age</h4>${ftab}` : ''}${
          rr.length
            ? `<h4>Retirement and refurbishment</h4>${spTable(
                ['Setting', 'Value'],
                rr.map(([lab, L]) => [
                  lab,
                  L.map(
                    x =>
                      `${REG.length > 1 && !SETUP.reg ? esc(x.idx[0]) + ': ' : ''}${x.idx.length > 2 ? esc(x.idx[2]) + ' ' : ''}${spFmt(Number(x.v))}`
                  )
                    .slice(0, 6)
                    .join(', ')
                ]),
                'kv'
              )}`
            : ''
        }` || spEmpty('VintageMode only: no factor, no residual cohort.');
      return `<details class="spcard" data-code="${esc(t)}" ${T.length <= 3 ? 'open' : ''}><summary><span class="spic">${spIcon('vint')}</span><b>${esc(t)}</b><span class="muted spdesc">${esc(TD[t] || '')}</span><span class="spbad">${badges}</span><button type="button" class="btn sm spedit" data-k="tech" data-c="${esc(t)}">Edit</button></summary><div class="spbody">${body}</div></details>`;
    }).join('')
  );
}

/* ---------------- any module: the items that have a value different from the default ---------------- */
// one card per item (technology, commodity, finance source...) with every parameter of the section set for it; the
// parameters without that index (by region or season only) go in a "General" card.
const spDef = pn => {
  const P = P_(pn);
  const d = P.def !== undefined ? P.def : pinfo(pn).def;
  return d === undefined || d === null ? 0 : Number(d);
};
function spGenericData(params, itemSet) {
  const items = new Map(),
    general = [];
  for (const [pn, lab] of params) {
    const D = dimsOf(pn),
      ii = D.indexOf(itemSet),
      ri = D.indexOf('REGION'),
      yi = D.indexOf('YEAR'),
      def = spDef(pn);
    const groups = new Map();
    for (const x of P_(pn).recs) {
      const v = Number(x.v);
      if (v === def || (ri >= 0 && !spRegOK(String(x.idx[ri])))) continue;
      const item = ii >= 0 ? String(x.idx[ii]) : '',
        rest = x.idx.map(String).filter((_, k) => k !== ii && k !== yi && !(ri >= 0 && k === ri && SETUP.reg)),
        k = item + '\u0001' + rest.join(' · ');
      if (!groups.has(k)) groups.set(k, {item, rest, ys: []});
      groups.get(k).ys.push([yi >= 0 ? x.idx[yi] : null, v]);
    }
    for (const g of groups.values()) {
      g.ys.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      const tgt = g.item ? items.get(g.item) || items.set(g.item, new Map()).get(g.item) : null;
      const line = {rest: g.rest, ys: g.ys};
      if (tgt) {
        if (!tgt.has(pn)) tgt.set(pn, {lab, lines: []});
        tgt.get(pn).lines.push(line);
      } else general.push([pn, lab, line]);
    }
  }
  return {items, general};
}
function spGeneric(sec) {
  const {items, general} = spGenericData(sec.params, sec.item);
  // each parameter: its name, then one row per index (region, commodity, mode, slice...) with the value or how it moves
  const kv = m =>
    [...m.entries()]
      .map(([pn, {lab, lines}]) => {
        const MAXR = 12,
          idx = lines.some(l => l.rest.length);
        return `<div class="spp"><div class="spph"><b>${esc(lab)}</b><code>${esc(pn)}</code>${lines.length > 1 ? `<span class="muted">${lines.length} rows</span>` : ''}</div>
      <table class="spv"><tbody>${lines
        .slice(0, MAXR)
        .map(
          l =>
            `<tr>${idx ? `<td class="spx">${l.rest.map(x => `<span class="spchip">${esc(x)}</span>`).join('')}</td>` : ''}<td class="spval">${spRange(l.ys)}</td></tr>`
        )
        .join('')}</tbody></table>
      ${lines.length > MAXR ? `<p class="muted spmore">… ${lines.length - MAXR} more rows: open the editor to see them all</p>` : ''}</div>`;
      })
      .join('');
  const G = new Map();
  for (const [pn, lab, line] of general) {
    if (!G.has(pn)) G.set(pn, {lab, lines: []});
    G.get(pn).lines.push(line);
  }
  const set = sec.item === 'COMMODITY' ? 'COMMODITY' : sec.item,
    kind = {TECHNOLOGY: 'tech', COMMODITY: 'comm', STORAGE: 'stor', EMISSION: 'emi', FINANCE: ENTSET.x_FINANCE ? 'x_FINANCE' : ''}[
      sec.item
    ];
  const list = [...items]
    .filter(([c]) => !SETUP.q || (c + ' ' + spName(set, c)).toLowerCase().includes(SETUP.q))
    .sort((a, b) => a[0].localeCompare(b[0]));
  const head = sec.intro ? `<p class="spintro">${sec.intro}</p>` : '';
  const gen = G.size
    ? `<details class="spcard" open><summary><span class="spic">${spIcon(SETUP.tab)}</span><b>${esc(sec.generalTitle || 'General')}</b><span class="spbad">${spBadge(G.size + ' setting' + (G.size > 1 ? 's' : ''))}</span></summary><div class="spbody">${kv(G)}</div></details>`
    : '';
  if (!list.length && !G.size)
    return (
      head +
      spEmpty(
        SETUP.q
          ? 'Nothing matches the filter.'
          : `Not used in this model: every parameter of this module keeps its default.${sec.how ? ' ' + sec.how : ''}`
      )
    );
  return (
    head +
    gen +
    list
      .map(([c, m]) => {
        const b =
          [...m.values()]
            .map(x => spBadge(x.lab))
            .slice(0, 5)
            .join('') + (m.size > 5 ? spBadge(`+${m.size - 5}`) : '');
        return `<details class="spcard" data-code="${esc(c)}" ${list.length <= 3 ? 'open' : ''}><summary><span class="spic">${spIcon(SETUP.tab)}</span>${typeof sysDot === 'function' && typeof SYSTEMS !== 'undefined' ? sysDot(SYSTEMS.of(c, set)) : ''}<b>${esc(c)}</b><span class="muted spdesc">${esc(sec.itemName ? sec.itemName(c) : spName(set, c))}</span><span class="spbad">${b}</span>${spActs(kind, c)}</summary><div class="spbody">${kv(m)}</div></details>`;
      })
      .join('')
  );
}
const spGenericCount = sec => {
  const {items, general} = spGenericData(sec.params, sec.item);
  return items.size + (general.length ? 1 : 0);
};

/* ---------------- time structure ---------------- */
function spTime() {
  const L = setOf('TIMESLICE').map(String),
    Y = (M.years || []).map(String),
    y0 = Y[0];
  const map = pn => {
    const m = new Map();
    for (const x of P_(pn).recs) if (Number(x.v) === 1) m.set(String(x.idx[0]), String(x.idx[1]));
    return m;
  };
  const ls = map('Conversionls'),
    ld = map('Conversionld'),
    lh = map('Conversionlh');
  const one = (pn, l) => {
    const h = P_(pn).recs.find(x => String(x.idx[0]) === l);
    return h ? Number(h.v) : null;
  };
  const ys = l => {
    const h = P_('YearSplit').recs.find(x => String(x.idx[0]) === l && String(x.idx[1]) === y0);
    return h ? Number(h.v) : null;
  };
  const sums = Y.map(y => [
      y,
      P_('YearSplit')
        .recs.filter(x => String(x.idx[1]) === y)
        .reduce((a, x) => a + Number(x.v), 0)
    ]),
    bad = sums.filter(([, v]) => Math.abs(v - 1) > 1e-6);
  const ordered = spHas('TimesliceOrder') || spHas('TimesliceGroup');
  const rows = L.map(l =>
    [
      `<b>${esc(l)}</b> <span class="muted">${esc(sdesc('TIMESLICE', l) || '')}</span>`,
      esc(ls.get(l) || '—'),
      esc(ld.get(l) || '—'),
      esc(lh.get(l) || '—'),
      ys(l) === null ? '—' : spFmt(ys(l)),
      ...(ordered ? [one('TimesliceGroup', l) ?? '—', one('TimesliceOrder', l) ?? '—', one('TimesliceHours', l) ?? '—'] : [])
    ].map(String)
  );
  const nS = setOf('SEASON').length,
    nD = setOf('DAYTYPE').length,
    nB = setOf('DAILYTIMEBRACKET').length;
  const facts = [
    ['Years', `${Y[0]}–${Y[Y.length - 1]} <span class="muted">(${Y.length})</span>`],
    ['Regions', esc(REG.join(', '))],
    [
      'Time slices',
      `${L.length} <span class="muted">= ${nS || '?'} season${nS === 1 ? '' : 's'} × ${nD || '?'} day type${nD === 1 ? '' : 's'} × ${nB || '?'} day part${nB === 1 ? '' : 's'}</span>`
    ],
    ['Modes of operation', String(setOf('MODE_OF_OPERATION').length)],
    [
      'YearSplit adds up to 1',
      bad.length
        ? `<span class="warnt">no in ${bad.length} year${bad.length > 1 ? 's' : ''} (e.g. ${bad[0][0]}: ${spFmt(bad[0][1])})</span>`
        : 'yes, every year'
    ],
    [
      'Order of the time slices',
      ordered
        ? 'set (TimesliceGroup / Order / Hours): chronological storage and unit commitment can use it'
        : 'not set (the slices have no order)'
    ]
  ];
  const disc = spGeneric({
    params: [
      ['DiscountRate', 'Discount rate'],
      ['DepreciationMethod', 'Depreciation (1 sinking fund, 2 straight line)']
    ],
    item: '_none_',
    generalTitle: 'Discounting by region'
  });
  const idv = spGeneric({params: [['DiscountRateIdv', 'Own discount rate']], item: 'TECHNOLOGY'});
  return `<details class="spcard" open><summary><span class="spic">${spIcon('time')}</span><b>Structure</b></summary><div class="spbody">${spTable(['', ''], facts, 'kv')}</div></details>
    <details class="spcard" open><summary><span class="spic">${spIcon('time')}</span><b>Time slices</b><span class="spbad">${spBadge(`YearSplit of ${y0}`)}</span></summary><div class="spbody">${spTable(['Time slice', 'Season', 'Day type', 'Day part', `YearSplit ${y0}`, ...(ordered ? ['Group', 'Order', 'Hours'] : [])], rows)}</div></details>
    ${disc.includes('spnone') ? '<details class="spcard" open><summary><span class="spic">' + spIcon('time') + '</span><b>Discounting by region</b></summary><div class="spbody"><p class="muted spnone">Defaults: discount rate 0.05, depreciation by sinking fund.</p></div></details>' : disc}${idv.includes('spnone') ? '' : '<h3 class="sph3">Technologies with their own discount rate</h3>' + idv}`;
}

/* ---------------- scenarios ---------------- */
// every scenario: its description and every value it changes (base -> scenario); edit in it, rename, duplicate, delete (undo)
function spScenarios() {
  const S = scenData();
  if (!S.list.length)
    return spEmpty(
      'No scenario yet: the base case holds every value. “+ Scenario” makes one; it then holds only the values you change in it (as in MUIO).'
    );
  const base = (p, k) => {
    const v = typeof cellGetBase === 'function' ? cellGetBase(p, k.split('|')) : undefined;
    return v === undefined || v === null ? spDef(p) : Number(v);
  };
  return (
    `<p class="spintro">The base case holds every value; a scenario holds only the values it changes. A run applies the base, then the scenarios chosen in the Solve dialog, in order. Now editing: <b>${esc(scenName(SCEN.edit))}</b>.</p>` +
    S.list
      .filter(sc => !SETUP.q || (sc.id + ' ' + sc.name + ' ' + (sc.desc || '')).toLowerCase().includes(SETUP.q))
      .map(sc => {
        const o = S.ov[sc.id] || {},
          n = scenCount(sc.id),
          np = Object.keys(o).length,
          cur = SCEN.edit === sc.id;
        const blocks = Object.entries(o)
          .map(([p, m]) => {
            const rows = Object.entries(m),
              MAXR = 12;
            return `<div class="spp"><div class="spph"><b>${esc(p)}</b>${rows.length > 1 ? `<span class="muted">${rows.length} values</span>` : ''}</div><table class="spv"><tbody>${rows
              .slice(0, MAXR)
              .map(
                ([k, v]) =>
                  `<tr><td class="spx">${k
                    .split('|')
                    .map(x => `<span class="spchip">${esc(x)}</span>`)
                    .join(
                      ''
                    )}</td><td class="spval"><span class="muted">${spFmt(base(p, k))}</span> → <b>${v === null ? 'default' : spFmt(Number(v))}</b></td></tr>`
              )
              .join(
                ''
              )}</tbody></table>${rows.length > MAXR ? `<p class="muted spmore">… ${rows.length - MAXR} more values</p>` : ''}</div>`;
          })
          .join('');
        const badges =
          (cur ? spBadge('editing', 'eq', 'new values you type go into this scenario') : '') +
          spBadge(`${n} value${n === 1 ? '' : 's'}`) +
          spBadge(`${np} parameter${np === 1 ? '' : 's'}`);
        const acts = `<span class="spacts"><button type="button" class="btn sm spsc" data-a="edit" data-id="${esc(sc.id)}" title="Values you type in the editors go into this scenario">${cur ? 'Editing' : 'Edit values'}</button><button type="button" class="btn sm spsc" data-a="ren" data-id="${esc(sc.id)}">Rename</button><button type="button" class="btn sm spsc" data-a="dup" data-id="${esc(sc.id)}">Duplicate</button><button type="button" class="btn sm danger spsc" data-a="del" data-id="${esc(sc.id)}">Delete</button></span>`;
        return `<details class="spcard" data-code="${esc(sc.id)}" ${S.list.length <= 3 ? 'open' : ''}><summary><span class="spic">${spIcon('scen')}</span><b>${esc(sc.name)}</b><span class="muted spdesc">${esc(sc.id)}${sc.desc ? ' · ' + esc(sc.desc) : ''}</span><span class="spbad">${badges}</span>${acts}</summary><div class="spbody">${blocks || spEmpty('No value changed yet: choose “Edit values”, then type in the editors.')}</div></details>`;
      })
      .join('')
  );
}
async function spScenAction(a, id) {
  const S = scenData(),
    sc = S.list.find(x => x.id === id);
  if (!sc) return;
  if (a === 'edit') {
    SCEN.edit = id;
    scenChip();
    toast(`Editing scenario ${sc.name}: values you type in the editors go into it`);
    return renderSetup();
  }
  if (a === 'ren') {
    const n = await uiPrompt('Name', sc.name);
    if (n === null) return;
    const d = await uiPrompt('Description', sc.desc || '');
    sc.name = n.trim() || sc.name;
    if (d !== null) sc.desc = d.trim();
    afterEdit(`Scenario ${sc.name} renamed`);
    return;
  }
  if (a === 'dup') {
    let k = 1;
    while (S.list.some(x => x.id === 'SC_' + k)) k++;
    S.list.push({id: 'SC_' + k, name: sc.name + ' (copy)', desc: sc.desc});
    S.ov['SC_' + k] = JSON.parse(JSON.stringify(S.ov[id] || {}));
    SETUP.reopen = ['SC_' + k];
    afterEdit(`Scenario ${sc.name} copied (${scenCount(id)} values)`);
    return;
  }
  if (a === 'del') {
    if (!await uiConfirm(`Delete the scenario ${sc.name} and its ${scenCount(id)} changed value(s)?\n\nYou can undo it on this page.`)) return;
    SETUP.undo = {text: writeData(), meta: {...M.meta}, what: `scenario ${sc.name}`};
    S.list = S.list.filter(x => x.id !== id);
    delete S.ov[id];
    if (SCEN.edit === id) {
      SCEN.edit = 'SC_0';
      scenChip();
    }
    afterEdit(`Scenario ${sc.name} deleted`);
  }
}
async function spNewScenario() {
  const S = scenData(),
    n = (await uiPrompt('Name of the new scenario (e.g. High gas price):', '') || '').trim();
  if (!n) return;
  const d = (await uiPrompt('Description (optional):', '') || '').trim();
  let k = 1;
  while (S.list.some(s => s.id === 'SC_' + k)) k++;
  S.list.push({id: 'SC_' + k, name: n, desc: d});
  SCEN.edit = 'SC_' + k;
  scenChip();
  SETUP.reopen = ['SC_' + k];
  afterEdit(`Scenario ${n} added: you are editing it`);
}
/* ---------------- the sections ---------------- */
const SECTIONS = [
  {k: 'time', g: 'Structure', label: 'Time and discounting', render: spTime, count: () => setOf('TIMESLICE').length},
  {
    k: 'dem',
    g: 'Structure',
    label: 'Demand and balances',
    item: 'COMMODITY',
    params: [
      ['SpecifiedAnnualDemand', 'Demand by time slice (annual)'],
      ['SpecifiedDemandProfile', 'Demand profile'],
      ['AccumulatedAnnualDemand', 'Annual demand (any time)'],
      ['CommodityTimeSliced', 'Balance (1 slice, 0 year, 2 season)'],
      ['BalanceEquality', 'Balance as equality'],
      ['WaterDriverFuel', 'Water driver (cascade)']
    ]
  },
  {
    k: 'lim',
    g: 'Technologies',
    label: 'Limits and targets',
    item: 'TECHNOLOGY',
    params: [
      ['TotalAnnualMaxCapacity', 'Max capacity'],
      ['TotalAnnualMinCapacity', 'Min capacity'],
      ['TotalAnnualMaxCapacityInvestment', 'Max new capacity / year'],
      ['TotalAnnualMinCapacityInvestment', 'Min new capacity / year'],
      ['TotalTechnologyAnnualActivityUpperLimit', 'Max activity / year'],
      ['TotalTechnologyAnnualActivityLowerLimit', 'Min activity / year'],
      ['TotalTechnologyModelPeriodActivityUpperLimit', 'Max activity, whole horizon'],
      ['TotalTechnologyModelPeriodActivityLowerLimit', 'Min activity, whole horizon'],
      ['TechnologyActivityByModeUpperLimit', 'Max activity by mode'],
      ['TechnologyActivityByModeLowerLimit', 'Min activity by mode'],
      ['TechnologyActivityIncreaseByModeLimit', 'Max increase by mode'],
      ['TechnologyActivityDecreaseByModeLimit', 'Max decrease by mode'],
      ['CapacityOfOneTechnologyUnit', 'Unit size (integer builds)']
    ],
    intro:
      'Bounds on capacity, investment and activity. The years a technology is on or off (Build: “Years this technology is on”) are written as these limits.'
  },
  {
    k: 'prof',
    g: 'Technologies',
    label: 'Profiles and seasonal ratios',
    item: 'TECHNOLOGY',
    params: [
      ['ProfileIAR', 'Input ratio by time slice'],
      ['ProfileOAR', 'Output ratio by time slice'],
      ['SeasonProfileIAR', 'Input ratio by season'],
      ['SeasonProfileOAR', 'Output ratio by season'],
      ['OperationalProfile', 'Operational profile (shape of the activity)'],
      ['FlatActivity', 'Flat activity: the same rate in every slice (0 / 1)'],
      ['EmissionDecoupled', 'Emission decoupled from activity']
    ],
    how: 'Profiles multiply the input / output ratios slice by slice or season by season.'
  },
  {
    k: 'uc',
    g: 'Technologies',
    label: 'Unit commitment',
    item: 'TECHNOLOGY',
    params: [
      ['UnitCommitment', 'Unit commitment on'],
      ['UnitCommitmentInteger', 'Integer units'],
      ['MinStableLoad', 'Min stable load'],
      ['StartUpCost', 'Start-up cost'],
      ['ShutDownCost', 'Shut-down cost'],
      ['NoLoadCost', 'No-load cost'],
      ['MinUpTime', 'Min up time'],
      ['MinDownTime', 'Min down time'],
      ['RampUpRate', 'Ramp up rate'],
      ['RampDownRate', 'Ramp down rate']
    ],
    how: 'Needs the order of the time slices (Time and discounting).'
  },
  {
    k: 'link',
    g: 'Technologies',
    label: 'Linked ratios',
    item: 'TECHNOLOGY',
    params: [
      ['LinkTarget', 'Linked ratio (1 input, 2 output)'],
      ['LinkSourceKind', 'Source ratio (1 input, 2 output)'],
      ['LinkFrom', 'Sources and factors'],
      ['LinkSeason', 'Linked in season (0 = not)']
    ],
    intro:
      'A ratio of the target technology follows the ratios of other technologies, slice by slice (e.g. the precipitation input of each land use = the output of PRC).'
  },
  {
    k: 'constr',
    g: 'Technologies',
    label: 'Construction time',
    item: 'TECHNOLOGY',
    params: [
      ['ConstructionYears', 'Construction years before online'],
      ['CapitalSpendProfile', 'Capital paid by construction year'],
      ['MaxUnderConstruction', 'Most capacity under construction at once']
    ],
    intro:
      'MASTER [K]: capacity of year y produces from y; its capital is paid in the construction years before (0 = none, as standard OSeMOSYS). Projects already under construction: ResidualCapacity.'
  },
  {
    k: 'constrs',
    g: 'Storage',
    label: 'Storage construction time',
    item: 'STORAGE',
    params: [
      ['ConstructionYearsStorage', 'Construction years before online'],
      ['CapitalSpendProfileStorage', 'Capital paid by construction year'],
      ['MaxUnderConstructionStorage', 'Most capacity under construction at once']
    ],
    intro: 'MASTER [K]: the energy capacity of a storage (reservoir, pumped hydro) built over several years.'
  },
  {
    k: 'vint',
    g: 'Technologies',
    label: 'Vintaging',
    render: spVintage,
    count: () => P_('VintageMode').recs.filter(x => Number(x.v) > 0).length
  },
  {
    k: 'casc',
    g: 'Water and land',
    label: 'Water cascade',
    item: 'TECHNOLOGY',
    params: [
      ['WaterDriverDepth', 'Driver depth by season'],
      ['ReferenceET', 'Reference evapotranspiration'],
      ['CascadeRule', 'Cascade rule'],
      ['CascadeShare', 'Cascade share'],
      ['CascadeSoilMax', 'Soil bucket size'],
      ['CascadeSoilDrain', 'Soil drainage'],
      ['CascadeSoilStart', 'Soil level at the start']
    ],
    generalTitle: 'Climate drivers (by region and season)',
    intro:
      'Precipitation (the driver commodity, see Demand and balances) is split by each land use into runoff, evapotranspiration and recharge with its rules.'
  },
  {
    k: 'yield',
    g: 'Water and land',
    label: 'Crop yield and calendar',
    item: 'TECHNOLOGY',
    params: [
      ['YieldResponse', 'Yield response (1 season, 2 stages)'],
      ['YieldKy', 'Ky by stage'],
      ['YieldKySeason', 'Ky of the season'],
      ['YieldFloor', 'Lowest yield factor'],
      ['CropSowingDay', 'Sowing day'],
      ['CropStageDays', 'Stage lengths (days)'],
      ['CropET0', 'ET0 of the land (zone)'],
      ['CropKcIni', 'Kc initial'],
      ['CropKcMid', 'Kc mid-season'],
      ['CropKcEnd', 'Kc end'],
      ['CropLand', 'Land of the crop'],
      ['CropSoilMax', 'Soil store of the crop'],
      ['CropWaterInput', 'Water input (1 ETm, 2 ETa)'],
      ['CropWaterOutside', 'Stubble evaporation'],
      ['CropLandInput', 'Land only in the field months']
    ],
    generalTitle: 'Climate driver of the crops (by region and season)',
    intro:
      'MASTER [Y]: the yield of a crop follows the water it gets, by stage (FAO-33). Each sowing calendar is a technology of its own; the model chooses their areas.'
  },
  {k: 'emi', g: 'Environment', label: 'Emissions', render: spEmissions, count: () => setOf('EMISSION').length},
  {k: 'udc', g: 'Constraints', label: 'User-defined constraints', render: spUDC, count: () => setOf('UDC').length},
  {k: 'stor', g: 'Storage', label: 'Storage', render: spStorage, count: () => setOf('STORAGE').length},
  {
    k: 'trade',
    g: 'Economy',
    label: 'Trade and prices',
    item: 'COMMODITY',
    params: [['TradeRoute', 'Trade route (from · to)']],
    extra: {
      item: 'TECHNOLOGY',
      params: [
        ['SalePrice', 'Sale price'],
        ['ExportUnitCost', 'Export unit cost'],
        ['ExportChainActivity', 'Export supply chain']
      ]
    },
    intro: 'Free trade between regions (TradeRoute, by commodity), sale prices and export costs (by technology).'
  },
  {
    k: 'fin',
    g: 'Economy',
    label: 'Finance',
    item: 'FINANCE',
    params: [
      ['FinanceType', 'Type (1 budget, 2 debt, 3 equity, 4 grant, 5 fund)'],
      ['FinanceAvailable', 'Money available / year'],
      ['FinanceRentShare', 'Share of export revenue'],
      ['FinanceRentShareTech', 'Revenue share by technology'],
      ['FinanceMin', 'Minimum use / year'],
      ['FinanceCumulativeMax', 'Maximum over the horizon'],
      ['FinanceRate', 'Interest / return rate'],
      ['FinanceRateTech', 'Rate for a technology'],
      ['FinanceRateStorage', 'Rate for a storage'],
      ['FinanceTenor', 'Tenor (years)'],
      ['FinanceConcessional', 'Concessional'],
      ['FinanceEligible', 'Eligible technologies (0 = not)'],
      ['FinanceEligibleStorage', 'Eligible storage (0 = not)'],
      ['FinanceMaxShare', 'Max share of a project'],
      ['FinanceMinShare', 'Min share of a project'],
      ['FinanceMaxShareStorage', 'Max share of a storage'],
      ['FinanceMinShareStorage', 'Min share of a storage'],
      ['FinanceServiceInBudget', 'Repaid from the budget'],
      ['FinanceDrawShare', 'Share drawn in the year'],
      ['FinanceBudgetImportShare', 'Budget pays imports (share)'],
      ['FinanceBudgetOpexShare', 'Budget pays operation (share)'],
      ['FinanceBudgetSavings', 'Budget savings allowed'],
      ['FinanceBudgetSavingsRate', 'Savings interest rate'],
      ['FinanceBudgetInitialSavings', 'Initial savings'],
      ['FinanceRegion', 'Capital must be financed (1)']
    ],
    generalTitle: 'Budget of each region',
    itemName: c => sdesc('FINANCE', c) || '',
    intro:
      'Each finance source (budget, debt, equity, grant or regional fund) with its money, rates, tenor and what it may finance; the budget settings of each region.',
    countFn: () => setOf('FINANCE').length
  },
  {k: 'scen', g: 'Scenarios', label: 'Scenarios', render: spScenarios, count: () => scenData().list.length}
];
/* the sections shown: in the standard edition, a section whose parameters the model file does not have is not shown
   (vintaging, unit commitment, water cascade, finance... belong to the master model) */
const SP_MASTER_ONLY = new Set(['prof', 'uc', 'link', 'constr', 'constrs', 'vint', 'casc', 'yield', 'fin']);
function spSections() {
  if (!STANDARD) return SECTIONS;
  const has = p => SCHEMA && SCHEMA.params && SCHEMA.params.has(p);
  return SECTIONS.filter(s => (s.params ? s.params.some(([p]) => has(p)) || (s.extra && s.extra.params.some(([p]) => has(p))) : !SP_MASTER_ONLY.has(s.k))).map(s =>
    // only OperationalProfile of this section is in the standard model
    s.k === 'prof' && !has('ProfileIAR') ? Object.assign(Object.create(s), {label: 'Operational profile'}) : s
  );
}
SECTIONS.forEach(sc => {
  if (sc.params && !sc.render) {
    sc.render = () => spGeneric(sc) + (sc.extra ? '<h3 class="sph3">By technology</h3>' + spGeneric({...sc.extra, intro: ''}) : '');
    sc.count = sc.countFn || (() => spGenericCount(sc) + (sc.extra ? spGenericCount(sc.extra) : 0));
  }
});

/* ---------------- the page ---------------- */
// the colour of the page: one colour, the tints and the darker shade are made from it (kept in this browser)
const SP_COLORS = THEME.COLORS;
// the colour of the page is the colour of the whole Studio (theme.js)
const spColor = () => THEME.get();
function spApplyColor(H) {
  const c = spColor();
  H.style.setProperty('--spc', c);
  const n = parseInt(c.slice(1), 16),
    L = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  H.style.setProperty('--spon', L > 0.62 ? '#1b1b1a' : '#ffffff');
}
function spSetColor(c) {
  THEME.set(c);
  THEME.menu();
  const H = document.getElementById('setup');
  spApplyColor(H);
  const i = H.querySelector('#spcolb i');
  if (i) i.style.background = c;
}
const spColorBar = () => {
  const c = spColor(),
    cur = SP_COLORS.find(x => x[0] === c);
  return `<span class="spcol"><button type="button" class="btn sm spcolb" id="spcolb" aria-haspopup="listbox" aria-expanded="false" title="Colour of this page"><i style="background:${c}"></i>Colour ▾</button>
  <div class="spcolm" id="spcolm" role="listbox" aria-label="Colour of the page" hidden>${SP_COLORS.map(([v, l]) => `<button type="button" role="option" data-c="${v}" aria-selected="${v === c}"><i style="background:${v}"></i>${l}${v === c ? ' ✓' : ''}</button>`).join('')}
  <label class="spcolany"><input type="color" id="spcolc" value="${c}">Any colour…${cur ? '' : ' ✓'}</label></div></span>`;
};
function renderSetup() {
  const H = document.getElementById('setup');
  if (!H) return;
  spApplyColor(H);
  if (typeof M === 'undefined' || !M || !M.D) {
    H.innerHTML = '<div class="empty">Open a model first.</div>';
    return;
  }
  if (!spSections().some(s => s.k === SETUP.tab)) SETUP.tab = 'time';
  const years = (M.years || []).map(String);
  if (!SETUP.year || !years.includes(String(SETUP.year))) SETUP.year = years[0];
  // keep the cards that are open, and the scroll, when the page is drawn again after a change on the same section
  const keepOpen = SETUP.drawn === SETUP.tab ? new Set([...H.querySelectorAll('.spcard[open][data-code]')].map(d => d.dataset.code)) : null,
    keepTop = SETUP.drawn === SETUP.tab ? H.scrollTop : 0;
  if (keepOpen && SETUP.reopen) {
    for (const c of SETUP.reopen) keepOpen.add(c);
  }
  SETUP.reopen = null;
  SETUP.drawn = SETUP.tab;
  const sec = spSections().find(s => s.k === SETUP.tab),
    n = new Map(
      spSections().map(s => {
        try {
          return [s.k, s.count()];
        } catch (e) {
          return [s.k, 0];
        }
      })
    );
  const body = sec.render();
  const add = {emi: ['emi', '+ Emission'], udc: ['udc', '+ Constraint (UDC)'], stor: ['stor', '+ Storage'], scen: ['scen', '+ Scenario']}[
    SETUP.tab
  ];
  let lastG = '';
  const nav = spSections().map(s => {
    const g = s.g !== lastG ? `<div class="spng">${esc(s.g)}</div>` : '';
    lastG = s.g;
    const c = n.get(s.k);
    return (
      g +
      `<button type="button" class="spn${c ? '' : ' unused'}" data-t="${s.k}" aria-current="${s.k === SETUP.tab}" title="${c ? c + ' item' + (c > 1 ? 's' : '') + ' set' : 'not used: all default'}">${spIcon(s.k)}<span class="spnl">${esc(s.label)}</span><i>${c || '–'}</i></button>`
    );
  }).join('');
  H.innerHTML = `<div class="spw" style="--spw:${SETUP.w || spwLoad()}px"><nav class="spnav" aria-label="Model setup sections"><h2>Model setup</h2>${nav}<p class="muted spleg">Grey = not used in this model</p></nav><div class="rsz sprsz" role="separator" aria-orientation="vertical" aria-label="Width of the section menu (drag, or arrow keys)" tabindex="0" title="Drag to change the width (double-click: default)"></div><div class="spmain">
    <div class="sph"><span class="spic big">${spIcon(sec.k)}</span><h3>${esc(sec.label)}</h3><span class="spacer"></span>${spColorBar()}<button type="button" class="btn" id="spcloseb" title="Back to the diagram">Close</button></div>
    ${SETUP.undo ? `<div class="spundo" role="status"><b>${esc(SETUP.undo.what)}</b> deleted. <button type="button" class="btn sm pri" id="spundo">Undo</button><button type="button" class="lnk" id="spundox">Dismiss</button></div>` : ''}
    <div class="spbar"><input type="search" id="spq" placeholder="Filter by code or name${SETUP.tab === 'udc' ? ' (also the technologies in them)' : ''}" value="${esc(SETUP.q)}">
      ${REG.length > 1 ? `<label>Region <select id="spreg"><option value="">All</option>${REG.map(r => `<option ${SETUP.reg === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>` : ''}
      ${SETUP.tab === 'udc' ? `<label>Year of the equation <select id="spyear">${years.map(y => `<option ${String(SETUP.year) === y ? 'selected' : ''}>${y}</option>`).join('')}</select></label>` : ''}
      <button type="button" class="lnk" id="spopen">Open all</button><button type="button" class="lnk" id="spclose">Close all</button><span class="spacer"></span>${add ? `<button type="button" class="btn pri" id="spadd">${add[1]}</button>` : ''}</div>
    <div class="splist">${body}</div></div></div>`;
  if (keepOpen)
    H.querySelectorAll('.spcard[data-code]').forEach(d => {
      if (keepOpen.has(d.dataset.code)) d.open = true;
    });
  H.scrollTop = keepTop;
  H.querySelectorAll('.spn[data-t]').forEach(
    b =>
      (b.onclick = () => {
        SETUP.tab = b.dataset.t;
        SETUP.q = '';
        renderSetup();
        H.scrollTop = 0;
      })
  );
  const q = H.querySelector('#spq');
  q.oninput = () => {
    clearTimeout(SETUP.t);
    SETUP.t = setTimeout(() => {
      SETUP.q = q.value.trim().toLowerCase();
      const pos = q.selectionStart;
      renderSetup();
      const q2 = document.getElementById('spq');
      q2.focus();
      q2.setSelectionRange(pos, pos);
    }, 200);
  };
  const rg = H.querySelector('#spreg');
  if (rg)
    rg.onchange = () => {
      SETUP.reg = rg.value;
      renderSetup();
    };
  const yr = H.querySelector('#spyear');
  if (yr)
    yr.onchange = () => {
      SETUP.year = yr.value;
      renderSetup();
    };
  H.querySelector('#spopen').onclick = () => H.querySelectorAll('.spcard').forEach(d => (d.open = true));
  H.querySelector('#spclose').onclick = () => H.querySelectorAll('.spcard').forEach(d => (d.open = false));
  const ad = H.querySelector('#spadd');
  if (ad) ad.onclick = () => (add[0] === 'scen' ? spNewScenario() : openEntity(add[0], null));
  H.querySelectorAll('.spsc').forEach(
    b =>
      (b.onclick = ev => {
        ev.preventDefault();
        ev.stopPropagation();
        spScenAction(b.dataset.a, b.dataset.id);
      })
  );
  H.querySelectorAll('.splink, .spedit').forEach(
    b =>
      (b.onclick = ev => {
        ev.preventDefault();
        ev.stopPropagation();
        openEntity(b.dataset.k, b.dataset.c);
      })
  );
  H.querySelector('#spcloseb').onclick = () => setView('dia');
  {
    const cb = H.querySelector('#spcolb'),
      cm = H.querySelector('#spcolm'),
      show = on => {
        cm.hidden = !on;
        cb.setAttribute('aria-expanded', on);
      };
    cb.onclick = ev => {
      ev.stopPropagation();
      show(cm.hidden);
    };
    cm.querySelectorAll('[data-c]').forEach(
      x =>
        (x.onclick = () => {
          spSetColor(x.dataset.c);
          show(false);
          renderSetup();
        })
    );
    const cc = H.querySelector('#spcolc');
    cc.oninput = () => spSetColor(cc.value);
    cc.onchange = () => {
      show(false);
      renderSetup();
    };
    if (!SETUP._colOut) {
      SETUP._colOut = true;
      document.addEventListener('click', e => {
        const m = document.getElementById('spcolm');
        if (m && !m.hidden && !e.target.closest('.spcol')) {
          m.hidden = true;
          const b2 = document.getElementById('spcolb');
          if (b2) b2.setAttribute('aria-expanded', false);
        }
      });
    }
    cm.onkeydown = e => {
      if (e.key === 'Escape') {
        show(false);
        cb.focus();
      }
    };
  }
  const un = H.querySelector('#spundo');
  if (un)
    un.onclick = () => {
      const u = SETUP.undo;
      SETUP.undo = null;
      load(u.text, u.meta);
      afterEdit(`${u.what}: delete undone`);
      renderSetup();
    };
  const ux = H.querySelector('#spundox');
  if (ux)
    ux.onclick = () => {
      SETUP.undo = null;
      renderSetup();
    };
  H.querySelectorAll('.spact').forEach(
    b =>
      (b.onclick = ev => {
        ev.preventDefault();
        ev.stopPropagation();
        spAction(b.dataset.a, b.dataset.k, b.dataset.c);
      })
  );
  H.querySelectorAll('.sptag').forEach(sel => {
    sel.onclick = ev => ev.stopPropagation();
    sel.onchange = () => spSetTag(sel.dataset.u, sel.dataset.r, sel.value);
  });
  // the width of the section menu: drag its edge, arrow keys on it, double-click = default; kept in this browser
  const rz = H.querySelector('.sprsz'),
    sw = H.querySelector('.spw');
  const setW = w => {
    SETUP.w = Math.round(Math.max(150, Math.min(Math.max(260, sw.clientWidth - 420), w)));
    sw.style.setProperty('--spw', SETUP.w + 'px');
  };
  rz.onpointerdown = e => {
    e.preventDefault();
    rz.setPointerCapture(e.pointerId);
    const x0 = e.clientX,
      w0 = H.querySelector('.spnav').getBoundingClientRect().width;
    rz.classList.add('on');
    rz.onpointermove = m => setW(w0 + m.clientX - x0);
    rz.onpointerup = () => {
      rz.onpointermove = rz.onpointerup = null;
      rz.classList.remove('on');
      spwSave();
    };
  };
  rz.onkeydown = e => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      setW((SETUP.w || spwLoad()) + (e.key === 'ArrowRight' ? 30 : -30));
      spwSave();
    }
  };
  rz.ondblclick = () => {
    setW(230);
    spwSave();
  };
}
function spwLoad() {
  try {
    return +localStorage.getItem('mst_spw') || 230;
  } catch (e) {
    return 230;
  }
}
function spwSave() {
  try {
    localStorage.setItem('mst_spw', String(SETUP.w));
  } catch (e) {}
}

// ---- actions on an item
const spSetName = kind => ENTSET[kind];
async function spAction(a, kind, code) {
  const sn = spSetName(kind),
    what = `${ENTNAME[kind] || sn.toLowerCase()} ${code}`;
  if (a === 'ren')
    return renameForm(sn, code, nb => {
      SETUP.reopen = [nb];
      toast(`${what} renamed ${nb}`);
      renderSetup();
    });
  if (a === 'del') {
    const n = Object.keys(M.D.params).reduce((k, p) => {
      const d = dimsOf(p),
        pos = d.map((x, i) => (x === sn ? i : -1)).filter(i => i >= 0);
      return k + (pos.length ? M.D.params[p].recs.filter(r => pos.some(i => String(r.idx[i]) === code)).length : 0);
    }, 0);
    if (!await uiConfirm(`Delete ${what} and its ${n} value${n === 1 ? '' : 's'}?\n\nYou can undo it on the Model setup page.`)) return;
    SETUP.undo = {text: writeData(), meta: {...M.meta}, what};
    deleteEntity(kind, code);
    if (typeof EDIT !== 'undefined' && EDIT && EDIT.code === code) EDIT = null;
    afterEdit(`${what} deleted (${n} values)`);
    return renderSetup();
  }
  if (a === 'dup') {
    const sug = (() => {
      let k = 2;
      while (setOf(sn).map(String).includes(`${code}_${k}`)) k++;
      return `${code}_${k}`;
    })();
    const nb = (await uiPrompt(`Code of the copy of ${what}:`, sug) || '').trim();
    if (!nb) return;
    if (!/^[A-Za-z0-9_.-]+$/.test(nb)) return toast('Use letters, digits, _ - . only (no spaces)');
    if (setOf(sn).map(String).includes(nb)) return toast(`${nb} already exists`);
    const n = spDuplicate(sn, kind, code, nb);
    SETUP.reopen = [nb];
    afterEdit(`${what} copied to ${nb} (${n} values)`);
    renderSetup();
  }
}
// a copy of a member with every value it has, its name, system and units
function spDuplicate(sn, kind, a, b) {
  if (sn === 'COMMODITY') cset().push(b);
  else (M.D.sets[sn] = M.D.sets[sn] || []).push(b);
  let n = 0;
  for (const p of Object.keys(M.D.params)) {
    const d = dimsOf(p),
      pos = d.map((x, i) => (x === sn ? i : -1)).filter(i => i >= 0);
    if (!pos.length) continue;
    const P = M.D.params[p],
      add = [];
    for (const r of P.recs)
      if (pos.some(i => String(r.idx[i]) === a)) add.push({...r, idx: r.idx.map((x, i) => (pos.includes(i) && String(x) === a ? b : x))});
    if (add.length) {
      P.recs.push(...add);
      P._map = null;
      n += add.length;
    }
  }
  for (const o of [TD, FD, COLORS, ICONS]) if (a in o) o[b] = o[a];
  const sd = SETDESC[sn];
  if (sd && a in sd) sd[b] = sd[a] + ' (copy)';
  if (typeof SYSTEMS !== 'undefined' && SYSTEMS.of(a, sn)) SYSTEMS.set(sn, b, SYSTEMS.of(a, sn));
  const uk = {TECHNOLOGY: 'tech', COMMODITY: 'comm', EMISSION: 'emis', STORAGE: 'stor'}[sn];
  if (uk && UNITS[uk] && UNITS[uk][a]) UNITS[uk][b] = UNITS[uk][a];
  return n;
}
// the type of a UDC in a region; a regional type is one constraint for all regions, so it is set in every region
function spSetTag(u, r, v) {
  const P = M.D.params.UDCTag || (M.D.params.UDCTag = {recs: [], def: undefined}),
    lab = x => (x === '' || x === null || x === undefined ? 'not set' : UDC_TAG[x] ? UDC_TAG[x][0] : x);
  const before = REG.map(rr => {
    const h = P.recs.find(x => String(x.idx[0]) === rr && String(x.idx[1]) === u);
    return [rr, h ? String(Number(h.v)) : ''];
  });
  const regional = v === '2' || v === '3',
    setOne = (rr, val) => {
      const i = P.recs.findIndex(x => String(x.idx[0]) === rr && String(x.idx[1]) === u);
      if (val === '') {
        if (i >= 0) P.recs.splice(i, 1);
      } else if (i >= 0) P.recs[i].v = Number(val);
      else P.recs.push({idx: [rr, u], v: Number(val)});
    };
  const was = new Map(before);
  if (regional)
    for (const rr of REG) setOne(rr, v); // one constraint for all regions
  else {
    setOne(r, v);
    for (const rr of REG) if (rr !== r && ['2', '3'].includes(was.get(rr))) setOne(rr, '-1');
  } // national and regional forms cannot be mixed
  P._map = null;
  const ch = REG.map(rr => {
    const h = P.recs.find(x => String(x.idx[0]) === rr && String(x.idx[1]) === u);
    const now = h ? String(Number(h.v)) : '';
    return now !== was.get(rr) ? `${REG.length > 1 ? rr + ': ' : ''}${lab(was.get(rr))} → ${lab(now)}` : '';
  }).filter(Boolean);
  afterEdit(`${u}: ${ch.join(' · ') || 'no change'}${regional && REG.length > 1 ? ' (regional: set in every region)' : ''}`);
  renderSetup();
}
