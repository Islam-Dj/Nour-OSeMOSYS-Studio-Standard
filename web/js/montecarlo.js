'use strict';
/* ============================== MONTE CARLO (designer, previews, runs, results) ==============================
   The engine is mc.py on the Studio server (numpy / scipy): detection of the parameters, the 43 distributions and 11 SDEs,
   sampling (MC, Latin hypercube, Halton, Sobol), Gaussian-copula correlations, per-year smoothing, time-slice groups,
   application with bounds and re-normalised profiles, solving N samples, aggregation. This file is the interface. */
const MCV = {
  cat: null,
  det: null,
  design: null,
  sel: -1,
  tab: 'design',
  runs: [],
  res: {run: null, var: 'Objective', by: 'YEAR', filters: {}, divide: 1, unit: ''},
  pv: null,
  pvTimer: null,
  showStruct: false,
  q: ''
};
const MC0 = () => ({
  factors: [],
  corr: {ids: [], matrix: []},
  sampling: {n: 200, method: 'lhs', seed: 12345},
  solver: 'highs',
  options: {},
  workers: 2,
  scenarios: [],
  outputs: mcDefaultOuts(false),
  outputsAll: 1
});
/* results kept by default = every variable of the model without a time-slice index + every yearly derived result
   (before: 5 chosen ones); "with time slices" adds the variables and derived results by time slice (large: one copy per sample) */
const MC_OLD_OUTS = ['TotalCapacityAnnual', 'NewCapacity', 'ProductionByTechnologyAnnual', 'AnnualEmissions', 'CapitalInvestment'];
const MC_DERIVED_TS = [
  'ProductionByTechnology',
  'ProductionByTechnologyByMode',
  'ProductionByTechnologyByModeTs',
  'RateOfProductionByTechnologyByMode',
  'UseByTechnology',
  'UseByTechnologyByMode',
  'UseByTechnologyByModeTs',
  'RateOfUseByTechnologyByMode',
  'Demand'
];
function mcDefaultOuts(withTs) {
  const vs = SCHEMA && SCHEMA.vars ? [...SCHEMA.vars.values()] : [];
  const mv = vs
    .filter(v => withTs || !(v.dims || []).includes('TIMESLICE'))
    .map(v => v.name)
    .sort();
  return [
    ...mv,
    ...(typeof MC_DERIVED !== 'undefined' ? MC_DERIVED : []).filter(v => !mv.includes(v) && (withTs || !MC_DERIVED_TS.includes(v)))
  ];
}
const mcModel = () => (SCHEMA && SCHEMA.fromFile ? SCHEMA.text : MODELTXT());
const mcData = () => writeData({apply: (MCV.design && MCV.design.scenarios) || []});
const jp = (path, body) => api(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
async function mcSave() {
  const D = MCV.design;
  if (!D) return;
  if (LIB.srv && LIB.current) {
    const rec = await LIB.get(LIB.current);
    if (rec) await LIB.put({...rec, mc: D});
  }
  try {
    localStorage.setItem('mst_nos_mc_' + (M.meta.name || 'model'), JSON.stringify(D));
  } catch (e) {}
}
async function mcLoad() {
  if (LIB.srv && LIB.current) {
    const rec = await LIB.get(LIB.current);
    if (rec && rec.mc) return mcUpgrade(rec.mc);
  }
  try {
    const s = localStorage.getItem('mst_nos_mc_' + (M.meta.name || 'model'));
    if (s) return mcUpgrade(JSON.parse(s));
  } catch (e) {}
  return MC0();
}
// a design that still keeps the 5 results of the old default keeps every yearly result from now on (once)
function mcUpgrade(D) {
  if (
    D &&
    !D.outputsAll &&
    Array.isArray(D.outputs) &&
    D.outputs.length <= MC_OLD_OUTS.length &&
    D.outputs.every(v => MC_OLD_OUTS.includes(v))
  ) {
    D.outputs = mcDefaultOuts(false);
    D.outputsAll = 1;
    setTimeout(() => toast(`Monte Carlo: every yearly result is now kept (${D.outputs.length} variables)`), 300);
  }
  return D;
}

async function showMC() {
  setView('mc');
  const V = document.getElementById('mcview');
  if (!(await serverInfo())) {
    V.innerHTML = `<div class="empty" style="margin:24px">Monte Carlo runs on this computer: start the Studio app (or <code>START_SOLVER.bat</code>), then open this view again.</div>`;
    return;
  }
  V.innerHTML = '<div class="empty">Reading the model…</div>';
  try {
    if (!MCV.cat) MCV.cat = await api('/api/mc/catalog');
    if (!MCV.design) MCV.design = await mcLoad();
    MCV.det = await jp('/api/mc/detect', {model: mcModel(), data: mcData()});
    if (MCV.det.error) throw new Error(MCV.det.error);
  } catch (e) {
    V.innerHTML = `<div class="ck error" style="margin:24px"><div class="ck-d">Could not read the model: ${esc(e.message)}</div></div>`;
    return;
  }
  renderMC();
}

function renderMC() {
  const V = document.getElementById('mcview'),
    D = MCV.design;
  const tabs = [
    ['design', 'Uncertain parameters'],
    ['corr', 'Correlations and sampling'],
    ['run', 'Run'],
    ['results', 'Results']
  ];
  V.innerHTML = `<div class="mcw"><div class="mchead"><div><h2 class="mct">Monte Carlo</h2><p class="muted">${D.factors.filter(f => f.enabled !== false).length} uncertain parameter(s) · ${D.sampling.n} samples · ${esc({mc: 'plain Monte Carlo', lhs: 'Latin hypercube', halton: 'Halton', sobol: 'Sobol'}[D.sampling.method])}${D.scenarios.length ? ' · on ' + D.scenarios.map(scenName).join(' + ') : ''}</p></div>
    <div class="seg" role="tablist">${tabs.map(([k, l]) => `<button type="button" data-tab="${k}" aria-pressed="${MCV.tab === k}">${l}</button>`).join('')}</div></div><div id="mcbody"></div></div>`;
  V.querySelectorAll('[data-tab]').forEach(
    b =>
      (b.onclick = () => {
        MCV.tab = b.dataset.tab;
        renderMC();
      })
  );
  ({design: mcDesignTab, corr: mcCorrTab, run: mcRunTab, results: mcResultsTab})[MCV.tab](V.querySelector('#mcbody'));
}

/* ---------- tab 1: parameters and factors ---------- */
const DCAT = () => Object.fromEntries(MCV.cat.distributions.map(d => [d.key, d]));
const SCAT = () => Object.fromEntries(MCV.cat.sdes.map(d => [d.key, d]));
function factorSummary(f) {
  const t = f.time || {},
    dd = DCAT()[f.dist && f.dist.key],
    sd = SCAT()[t.sde];
  const pinfo = MCV.det.params.find(p => p.param === f.param) || {};
  const how = pinfo.has_year
    ? t.kind === 'growth'
      ? `growth rate ${dd ? dd.name.toLowerCase() : ''} (% per year)${t.growthPer === 'yearly' ? ', each year' : ''}, compounded`
      : t.kind === 'sde'
        ? `SDE: ${sd ? sd.name : t.sde}`
        : t.kind === 'peryear'
          ? `${dd ? dd.name : ''}, drawn each year${t.smooth && t.smooth !== 'none' ? ' (' + {ar1: 'AR(1) smoothing', kernel: 'kernel smoothing', knots: 'knot years'}[t.smooth] + ')' : ''}`
          : `${dd ? dd.name : ''}, one draw for all years`
    : dd
      ? dd.name
      : '';
  const sel = Object.entries(f.select || {})
    .filter(([, v]) => v && v.length)
    .map(([k, v]) => `${k.toLowerCase()} ${v.length > 3 ? v.length + ' selected' : v.join(', ')}`)
    .join(' · ');
  return `${how} · ${{mult: 'multiplier', add: 'added', abs: 'absolute value', pct: '% change'}[f.mode || 'mult']} · ${{all: 'one draw for all', region: 'one per region', entity: 'one per item', region_entity: 'one per region and item', record: 'one per value'}[f.scope || 'entity']}${sel ? ' · ' + sel : ''}${t.active ? ' · years ' + t.active : ''}`;
}
function mcDesignTab(B) {
  const D = MCV.design,
    det = MCV.det,
    q = MCV.q.toLowerCase();
  const used = new Set(D.factors.map(f => f.param));
  const cats = {};
  for (const p of det.params) {
    if (p.structural && !MCV.showStruct) continue;
    if (q && !(p.param.toLowerCase().includes(q) || p.category.includes(q))) continue;
    (cats[p.structural ? 'structure (not varied)' : p.category] = cats[p.structural ? 'structure (not varied)' : p.category] || []).push(p);
  }
  const plist =
    Object.entries(cats)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(
        ([c, ps]) =>
          `<div class="mccat"><h4>${esc(c)}</h4>${ps
            .map(
              p => `<div class="mcp${p.structural ? ' st' : ''}"><div><b>${esc(p.param)}</b> <span class="muted">${p.records ? p.records.toLocaleString() + ' values' : 'no data (default only)'}${p.has_year ? ' · years' : ''}${p.has_slice ? ' · time slices' : ''}${p.changes_over_years ? ' · changes over time' : ''}</span></div>
      ${p.structural ? `<div class="muted small">${esc(p.why)}</div>` : `<div class="acts"><button class="btn${used.has(p.param) ? '' : ' pri'}" data-add="${esc(p.param)}">${used.has(p.param) ? 'Add again' : 'Add'}</button></div>`}</div>`
            )
            .join('')}</div>`
      )
      .join('') || '<div class="empty">No parameter matches.</div>';
  B.innerHTML = `<div class="mcgrid"><aside class="mcleft"><h3>Parameters of this model</h3><p class="muted small">Every parameter with data, sorted by kind of uncertainty. "Add" proposes a setting for it; structural parameters (time structure, units, tags) are not varied.</p>
      <input type="search" id="mcq" placeholder="Search" value="${esc(MCV.q)}"><label class="chk"><input type="checkbox" id="mcst" ${MCV.showStruct ? 'checked' : ''}> show structural parameters</label>
      <div class="mcplist">${plist}</div></aside>
    <section class="mcmain"><h3>Uncertain parameters <span class="muted">${D.factors.length}</span></h3>
      ${
        D.factors
          .map(
            (
              f,
              i
            ) => `<div class="mcf${i === MCV.sel ? ' cur' : ''}${f.enabled === false ? ' off' : ''}" data-i="${i}"><div class="mcf-h"><label class="chk"><input type="checkbox" data-en="${i}" ${f.enabled !== false ? 'checked' : ''}></label><b>${esc(f.name || f.param)}</b><span class="muted">${esc(f.param)}</span></div>
        <div class="muted small">${esc(factorSummary(f))}</div></div>`
          )
          .join('') || '<div class="empty">Add parameters from the list on the left.</div>'
      }
      <div id="mcedit"></div>${mcLinksBox()}</section></div>`;
  const qi = B.querySelector('#mcq');
  qi.oninput = () => {
    MCV.q = qi.value;
    const pos = qi.selectionStart;
    mcDesignTab(B);
    const n = B.querySelector('#mcq');
    n.focus();
    n.setSelectionRange(pos, pos);
  };
  B.querySelector('#mcst').onchange = e => {
    MCV.showStruct = e.target.checked;
    mcDesignTab(B);
  };
  B.querySelectorAll('[data-add]').forEach(
    b =>
      (b.onclick = () => {
        const p = det.params.find(x => x.param === b.dataset.add);
        let k = 1;
        while (D.factors.some(f => f.id === 'F' + k)) k++;
        const r = JSON.parse(JSON.stringify(p.recommend));
        if (!p.records) r.includeDefaults = true;
        D.factors.push({
          id: 'F' + k,
          name: p.param
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .toLowerCase()
            .replace(/^./, c => c.toUpperCase()),
          param: p.param,
          enabled: true,
          select: {},
          post: p.post,
          ...r
        });
        MCV.sel = D.factors.length - 1;
        mcSave();
        renderMC();
      })
  );
  B.querySelectorAll('.mcf').forEach(
    d =>
      (d.onclick = e => {
        if (e.target.closest('input')) return;
        MCV.sel = +d.dataset.i;
        mcDesignTab(B);
      })
  );
  B.querySelectorAll('[data-en]').forEach(
    c =>
      (c.onchange = () => {
        D.factors[+c.dataset.en].enabled = c.checked;
        mcSave();
        renderMC();
      })
  );
  mcLinksWire(B);
  if (MCV.sel >= 0 && D.factors[MCV.sel]) mcEditor(B.querySelector('#mcedit'), D.factors[MCV.sel]);
}

/* ---------- linked values - target cells computed in every sample by a formula from a driver ---------- */
function mcLinksBox() {
  const D = MCV.design,
    L = (D.links = D.links || []),
    ff = D.formulaFile || '';
  const drivers = [
    ...D.factors.filter(f => f.enabled !== false).map(f => [f.id, (f.name || f.param) + ' · ' + f.param]),
    ...L.map(l => [l.id, 'linked value: ' + (l.name || l.id)])
  ];
  const params = MCV.det.params
    .filter(p => !p.structural)
    .map(p => p.param)
    .concat((MCV.det.declared_without_data || []).map(p => p.param));
  const row = (l, i) => {
    const tp = MCV.det.params.find(p => p.param === (l.target || {}).param) || {members: {}},
      sel = (l.target || {}).select || {};
    return `<div class="mcl${l.enabled === false ? ' off' : ''}"><div class="mcf-h"><label class="chk"><input type="checkbox" data-le="${i}" ${l.enabled !== false ? 'checked' : ''}></label><input class="mcname" data-lk="${i}:name" value="${esc(l.name || '')}" placeholder="Name"><span class="muted">${esc(l.id)}</span><span class="spacer"></span><button type="button" class="btn sm danger" data-lx="${i}">Remove</button></div>
      <div class="row2"><label>Target parameter<select data-lk="${i}:param"><option value="">Choose</option>${params.map(p => `<option ${p === (l.target || {}).param ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
        <label>Driver<select data-lk="${i}:driver"><option value="">None</option>${drivers
          .filter(([id]) => id !== l.id)
          .map(([id, nm]) => `<option value="${esc(id)}" ${id === l.driver ? 'selected' : ''}>${esc(nm)}</option>`)
          .join('')}</select></label></div>
      <div class="mcsel">${Object.keys(tp.members || {})
        .filter(d => d !== 'YEAR')
        .map(
          d =>
            `<label class="small">${esc(d.toLowerCase())} <span class="muted">(blank = all ${(tp.members[d] || []).length})</span><input data-ls="${i}:${esc(d)}" list="ll_${esc(d)}" value="${esc((sel[d] || []).join(', '))}" placeholder="e.g. ${esc((tp.members[d] || []).slice(0, 2).join(', '))}"><datalist id="ll_${esc(d)}">${(
              tp.members[d] || []
            )
              .slice(0, 400)
              .map(m => `<option value="${esc(m)}">`)
              .join('')}</datalist></label>`
        )
        .join('')}</div>
      <label>Formula <span class="muted">(base = the data value, D = the driver's multiplier, P / B = the driver's sampled / data value; functions of the formula file)</span><input class="mono" data-lk="${i}:formula" value="${esc(l.formula || 'base * D')}"></label>
      <div class="row2"><label class="chk"><input type="checkbox" data-lk="${i}:nonneg" ${l.nonneg !== false ? 'checked' : ''}> a negative value stops the sample (reported, not solved)</label>
        <label class="small">Not below / not above<span class="row2"><input data-lc="${i}:0" value="${l.clip && l.clip[0] != null ? l.clip[0] : ''}" placeholder="None"><input data-lc="${i}:1" value="${l.clip && l.clip[1] != null ? l.clip[1] : ''}" placeholder="None"></span></label></div></div>`;
  };
  return `<section class="mclinks"><h3>Linked values <span class="muted">${L.length}</span></h3>
    <p class="hint">A linked value is not drawn: in every sample it is computed from its driver by a formula, so it follows it exactly (a chain is possible: a link can drive another; loops are refused). The index sets in common with the driver are matched (a time slice counts as its season); D is the driver's multiplier for the matching cells. Physical balances that must always hold, such as the water cascade, are better inside the model (item 9).</p>
    ${L.map(row).join('') || '<div class="empty">No linked value yet.</div>'}
    <div class="acts"><button type="button" class="btn" id="lladd">+ Linked value</button><button type="button" class="btn" id="llpv">Preview the linked values</button></div><div id="llpvout"></div>
    <h4>Formula file (.py)</h4><p class="hint">Functions for the formulas, written in Python with numpy: download it (a template when empty), edit it, upload it again. It is saved with the Monte Carlo design.</p>
    <div class="acts"><span class="muted small" id="ffinfo">${ff ? 'formula file loaded' : 'no formula file'}</span><button type="button" class="btn" id="ffdl">Download${ff ? '' : ' the template'}</button><label class="btn">Upload<input type="file" id="ffup" accept=".py,.txt" hidden></label>${ff ? '<button type="button" class="btn danger" id="ffrm">Remove</button>' : ''}</div></section>`;
}
function mcLinksWire(B) {
  const D = MCV.design,
    L = (D.links = D.links || []),
    again = () => {
      mcSave();
      mcDesignTab(B);
    };
  const num = v => (String(v).trim() === '' ? null : isNaN(+v) ? null : +v);
  B.querySelectorAll('[data-le]').forEach(
    c =>
      (c.onchange = () => {
        L[+c.dataset.le].enabled = c.checked;
        mcSave();
      })
  );
  B.querySelectorAll('[data-lx]').forEach(
    b =>
      (b.onclick = () => {
        L.splice(+b.dataset.lx, 1);
        again();
      })
  );
  B.querySelectorAll('[data-lk]').forEach(
    el =>
      (el.onchange = () => {
        const [i, k] = el.dataset.lk.split(':'),
          l = L[+i];
        if (k === 'param') {
          l.target = {param: el.value, select: {}};
          return again();
        }
        if (k === 'nonneg') l.nonneg = el.checked;
        else if (k === 'driver') l.driver = el.value || null;
        else l[k] = el.value;
        mcSave();
      })
  );
  B.querySelectorAll('[data-ls]').forEach(
    el =>
      (el.onchange = () => {
        const [i, d] = el.dataset.ls.split(':'),
          l = L[+i];
        l.target = l.target || {select: {}};
        l.target.select = l.target.select || {};
        l.target.select[d] = el.value
          .split(/[,;\s]+/)
          .map(x => x.trim())
          .filter(Boolean);
        mcSave();
      })
  );
  B.querySelectorAll('[data-lc]').forEach(
    el =>
      (el.onchange = () => {
        const [i, j] = el.dataset.lc.split(':'),
          l = L[+i];
        l.clip = l.clip || [null, null];
        l.clip[+j] = num(el.value);
        mcSave();
      })
  );
  B.querySelector('#lladd').onclick = () => {
    let k = 1;
    while (L.some(l => l.id === 'L' + k)) k++;
    L.push({
      id: 'L' + k,
      name: '',
      enabled: true,
      target: {param: '', select: {}},
      driver: (D.factors[0] || {}).id || null,
      formula: 'base * D',
      nonneg: true
    });
    again();
  };
  B.querySelector('#llpv').onclick = async () => {
    const o = B.querySelector('#llpvout');
    o.innerHTML = '<p class="muted">Computing 200 samples…</p>';
    let r;
    try {
      r = await jp('/api/mc/preview_links', {design: D, model: mcModel(), data: mcData(), n: 200});
    } catch (e) {
      o.innerHTML = `<div class="ck error"><div class="ck-d">${esc(e.message)}</div></div>`;
      return;
    }
    if (r.error) {
      o.innerHTML = `<div class="ck error"><div class="ck-d">${esc(r.error)}</div></div>`;
      return;
    }
    o.innerHTML = `<div class="tw"><table class="grid"><thead><tr><th>Linked value</th><th>Parameter</th><th class="n">Cells</th><th class="n">Base (mean)</th><th class="n">5 %</th><th class="n">Median</th><th class="n">95 %</th><th>Driver · matched on</th><th class="n">Rank corr. with driver</th></tr></thead><tbody>
      ${r.links.map(x => `<tr><td>${esc(x.name)}</td><td>${esc(x.param)}</td><td class="n">${x.cells}</td><td class="n">${fmt(x.base)}</td><td class="n">${fmt(x.p5)}</td><td class="n">${fmt(x.p50)}</td><td class="n">${fmt(x.p95)}</td><td>${esc(x.driver || '–')}${x.shared && x.shared.length ? ' · ' + esc(x.shared.join(', ').toLowerCase()) : ''}</td><td class="n">${x.spearman_with_driver == null ? '–' : (+x.spearman_with_driver).toFixed(2)}</td></tr>`).join('')}</tbody></table></div>
      <p class="${r.failed ? 'ck warn' : 'muted small'}">${
        r.failed
          ? `${r.failed} of ${r.n} samples would not be solved: ${esc(
              r.failures
                .map(x => 'sample ' + (x.k + 1) + ': ' + x.why)
                .slice(0, 3)
                .join(' · ')
            )}`
          : `All ${r.n} samples pass the checks.`
      }</p>`;
  };
  B.querySelector('#ffdl').onclick = async () => {
    let t = D.formulaFile;
    if (!t) {
      const r = await jp('/api/mc/formula_file', {template: true});
      t = r.template;
    }
    saveFile('mc_formulas.py', t, 'text/x-python');
  };
  B.querySelector('#ffup').onchange = async e => {
    const fl = e.target.files[0];
    if (!fl) return;
    const t = await fl.text();
    const r = await jp('/api/mc/formula_file', {text: t});
    if (r.error) {
      toast('Formula file not loaded: ' + r.error);
      return;
    }
    D.formulaFile = t;
    mcSave();
    mcDesignTab(B);
    toast(`Formula file loaded: ${r.functions.length ? r.functions.join(', ') : 'no function'}`);
  };
  const rm = B.querySelector('#ffrm');
  if (rm)
    rm.onclick = () => {
      delete D.formulaFile;
      again();
    };
  if (D.formulaFile)
    jp('/api/mc/formula_file', {text: D.formulaFile}).then(r => {
      const i = B.querySelector('#ffinfo');
      if (i) i.textContent = r.error ? 'formula file: ' + r.error : 'formula file: ' + (r.functions.join(', ') || 'no function');
    });
}

function mcEditor(E, f) {
  const p = MCV.det.params.find(x => x.param === f.param) ||
      (MCV.det.declared_without_data || []).find(x => x.param === f.param) || {members: {}, dims: []},
    C = DCAT(),
    Sd = SCAT(),
    t = (f.time = f.time || {kind: 'static'}),
    sl = (f.slices = f.slices || {kind: 'same', rho: 0.5});
  const dd = C[f.dist.key] || C.triangular,
    sd = Sd[t.sde || 'gbm'];
  const optg = Object.entries(MCV.cat.groups.reduce((o, g) => ((o[g] = MCV.cat.distributions.filter(d => d.group === g)), o), {}))
    .map(
      ([g, ds]) =>
        `<optgroup label="${esc(g)}">${ds.map(d => `<option value="${d.key}" ${d.key === f.dist.key ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</optgroup>`
    )
    .join('');
  const pin = (prefix, params, vals) =>
    params.map(q => `<label>${esc(q.label)}<input data-${prefix}="${q.k}" value="${esc(vals[q.k] ?? q.default)}"></label>`).join('');
  const dims = Object.keys(p.members || {});
  const selBox = d => {
    const all = p.members[d] || [],
      cur = (f.select || {})[d] || [],
      wd = new Set((p.with_data || {})[d] || []);
    const lab = m =>
      d === 'TECHNOLOGY' && TD[m]
        ? shortName(m)
        : d === 'COMMODITY' && FD[m]
          ? String(FD[m]).split(/[.(;]/)[0].slice(0, 40)
          : typeof sdesc === 'function'
            ? sdesc(d, m) || ''
            : '';
    return `<details class="selb"><summary>${esc(d.toLowerCase())}: <span class="muted">${cur.length ? cur.length + ' of ' + all.length : 'all ' + all.length}${wd.size < all.length ? ` · ${wd.size} with data` : ''}</span></summary>
      <div class="fm-tools"><input type="search" class="selq" data-selq="${esc(d)}" placeholder="Search ${all.length}"><button type="button" class="btn sm" data-sall="${esc(d)}">All</button><button type="button" class="btn sm" data-snone="${esc(d)}">None</button>${wd.size && wd.size < all.length ? `<button type="button" class="btn sm" data-sdata="${esc(d)}" title="Only the members with values in the data">With data</button>` : ''}</div>
      <div class="sellist">${all.length ? all.map(m => `<label class="selr" data-q="${esc((m + ' ' + lab(m)).toLowerCase())}"><input type="checkbox" data-sel="${esc(d)}" value="${esc(m)}" ${!cur.length || cur.includes(m) ? 'checked' : ''}><b>${esc(m)}</b><span>${esc(lab(m))}</span>${wd.has(m) ? '<i title="has values in the data">Data</i>' : ''}</label>`).join('') : '<div class="muted" style="padding:8px">No members: the set is empty in the data file.</div>'}</div></details>`;
  };
  if (p.smooth_only && t.kind === 'peryear' && (!t.smooth || t.smooth === 'none') && !t.allowJumps) {
    t.smooth = 'ar1';
    if (t.rho == null || t.rho < 0.8) t.rho = 0.9;
  } // smooth-only: never independent yearly draws
  const noData = !p.records || !p.nonzero,
    bigDef = p.default != null && Math.abs(+p.default) >= 9999;
  const warnNoData = noData
    ? `<div class="ck warn"><div class="ck-h"><span class="sev warn">No values in the data</span><b>${esc(f.param)} is at its default everywhere${p.default != null ? ' (' + esc(p.default) + ')' : ''}</b></div><div class="ck-d">${bigDef ? 'That default means "no limit": a multiplier on it changes nothing useful. Give it values in the data first (Build), or set "Value is" to absolute values with your own range.' : 'Tick "also vary values left at their default" so the draws create values; choose the members below.'}</div></div>`
    : '';
  E.innerHTML = `<div class="mced"><div class="mced-h"><input class="mcname" data-k="name" value="${esc(f.name || '')}"><span class="muted">${esc(f.param)} · ${esc(p.category || '')}</span>
      <span class="spacer"></span><button class="btn" id="mcdup">Duplicate</button><button class="btn danger" id="mcdel">Remove</button></div>
    <p class="mcwhy">${esc(p.why || '')}</p>${warnNoData}
    <div class="mccols"><div class="mccol">
      <fieldset><legend>Which values</legend>${dims.map(selBox).join('') || '<span class="muted">One value</span>'}
        <label class="chk"><input type="checkbox" data-k="includeDefaults" ${f.includeDefaults ? 'checked' : ''}> also vary values left at their default (creates them)</label>
        ${(() => {
          const sib = MCV.design.factors.map((x, i) => [x, i]).filter(([x]) => x.param === f.param && x !== f);
          const ed = ['TECHNOLOGY', 'COMMODITY', 'EMISSION', 'STORAGE', 'REGION', 'MODE_OF_OPERATION'].filter(
            d => dims.includes(d) && (p.members[d] || []).length > 1
          );
          if (!ed.length)
            return sib.length
              ? `<p class="hint">Other settings of ${esc(f.param)}: ${sib.map(([x, i]) => `<button type="button" class="lnk" data-gof="${i}">${esc(x.name || x.param)}</button>`).join(', ')}</p>`
              : '';
          const sd = MCV.splitDim && ed.includes(MCV.splitDim) ? MCV.splitDim : ed[0],
            cur = (f.select || {})[sd] || [],
            mem = cur.length && cur[0] !== '__none__' ? cur : p.members[sd] || [];
          return `<details class="mcsplit" ${MCV.splitOpen ? 'open' : ''}><summary>Own settings for some items <span class="muted">e.g. triangular for one technology, uniform for the others</span></summary>
            <p class="hint">The ticked items leave this group and get their own settings (a new entry of the same parameter), which you then change freely. The items left here keep these settings. Inside one group, "Draws" decides if the items share one draw or each has its own.</p>
            <div class="row2"><label>Items of${mcSel(
              '_splitdim',
              ed.map(d => [d, d.toLowerCase()]),
              sd
            ).replace('data-k="_splitdim"', 'id="spdim"')}</label><span></span></div>
            <div class="fm-tools"><input type="search" id="spq" placeholder="Search ${mem.length}"><button type="button" class="btn sm" id="spall">All</button><button type="button" class="btn sm" id="spnone">None</button></div>
            <div class="sellist">${mem.map(m => `<label class="selr spr" data-q="${esc(String(m).toLowerCase())}"><input type="checkbox" class="spc" value="${esc(m)}"><b>${esc(m)}</b><span>${esc(sd === 'TECHNOLOGY' && TD[m] ? shortName(m) : '')}</span></label>`).join('')}</div>
            <div class="acts"><button type="button" class="btn" id="spone">Ticked: own settings, together</button><button type="button" class="btn" id="speach">Ticked: own settings, each one</button></div></details>
            ${sib.length ? `<p class="hint">Other settings of ${esc(f.param)}: ${sib.map(([x, i]) => `<button type="button" class="lnk" data-gof="${i}">${esc(x.name || x.param)}</button>`).join(', ')}</p>` : ''}`;
        })()}</fieldset>
      <fieldset><legend>How the draw is applied</legend><div class="row2"><label>Value is${mcSel(
        'mode',
        [
          ['mult', 'a multiplier of the base'],
          ['pct', 'a % change of the base'],
          ['add', 'added to the base'],
          ['abs', 'the value itself']
        ],
        f.mode || 'mult'
      )}</label>
        <label>Draws${mcSel(
          'scope',
          [
            ['all', 'one for all selected values'],
            ['region', 'one per region'],
            ['entity', 'one per item (technology, commodity…)'],
            ['region_entity', 'one per region and item'],
            ['record', 'one per value']
          ],
          f.scope || 'entity'
        )}</label></div>
        <label>Coherence inside this parameter: ${(+(f.coherence ?? (f.scope === 'all' ? 1 : 0.5))).toFixed(2)}<input type="range" min="0" max="1" step="0.05" data-k="coherence" value="${f.coherence ?? (f.scope === 'all' ? 1 : 0.5)}"></label>
        <p class="hint">How much the separate draws (regions, items) move together: 1 = all the same, 0 = independent. It also carries the correlations with other parameters.</p></fieldset>
      ${
        p.has_year
          ? `<fieldset><legend>Over time</legend>${p.smooth_only ? `<p class="mcsmooth"><b>Smooth only:</b> ${esc(p.smooth_only)}. Yearly draws must be smoothed (AR(1), kernel or knot years), or use one draw for all years, a growth rate or an SDE path.</p>` : ''}${mcSel(
              'time.kind',
              [
                ['static', 'one draw for all years (fully correlated in time)'],
                ['peryear', p.smooth_only ? 'a draw for each year, smoothed' : 'a draw for each year'],
                ['growth', 'a growth rate (% per year), compounded: smooth path'],
                ['sde', 'a path over the years (stochastic differential equation)']
              ],
              t.kind
            )}
        ${
          t.kind === 'growth'
            ? `<div class="row2"><label>Growth rate${mcSel(
                'time.growthPer',
                [
                  ['one', 'one rate for all years'],
                  ['yearly', 'a rate each year, smoothed (AR(1))']
                ],
                t.growthPer || 'one'
              )}</label>${t.growthPer === 'yearly' ? `<label>Year-to-year correlation of the rate<input data-k="time.rho" value="${t.rho ?? 0.8}"></label>` : '<span></span>'}</div>
          <p class="hint">The distribution (right) is the growth rate in % per year, added to the base path: value(y) = base(y) × (1 + rate)<sup>y − start year</sup>. E.g. triangular −1 / 0.5 / 2 %: by 2050 the demand is 0.80 to 1.6 × its base. Always smooth.</p>`
            : ''
        }
        ${
          t.kind === 'peryear'
            ? `<div class="row2"><label>Smoothing${mcSel('time.smooth', [...(p.smooth_only && !t.allowJumps ? [] : [['none', 'none (independent years)']]), ['ar1', 'AR(1): each year leans on the previous one'], ['kernel', 'kernel: moving Gaussian average'], ['knots', 'knot years, straight lines between']], p.smooth_only && !t.allowJumps && (!t.smooth || t.smooth === 'none') ? 'ar1' : t.smooth || 'none')}</label>
          ${t.smooth === 'ar1' ? `<label>Year-to-year correlation<input data-k="time.rho" value="${t.rho ?? 0.6}"></label>` : t.smooth === 'kernel' ? `<label>Width (years)<input data-k="time.width" value="${t.width ?? 3}"></label>` : t.smooth === 'knots' ? `<label>A knot every (years)<input data-k="time.knot" value="${t.knot ?? 10}"></label>` : '<span></span>'}</div>${p.smooth_only ? `<label class="chk"><input type="checkbox" data-k="time.allowJumps" ${t.allowJumps ? 'checked' : ''}> allow year-to-year jumps (not recommended here)</label>` : ''}`
            : ''
        }
        ${
          t.kind === 'sde'
            ? `<label>Process<select data-k="time.sde">${MCV.cat.sdes.map(s => `<option value="${s.key}" ${s.key === (t.sde || 'gbm') ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
          <p class="mcexp"><b>${esc(sd.name)}.</b> ${esc(sd.explain)} <span class="muted">Use: ${esc(sd.use)}</span></p><div class="row2">${pin('sp', sd.params, t.sdeParams || {})}</div>`
            : ''
        }
        ${(() => {
          const ys = (MCV.det.years || []).map(String),
            m = /^\s*(\d{4})\s*-\s*(\d{4})\s*$/.exec(t.active || ''),
            simple = !t.active || m,
            a0 = m ? m[1] : ys[0],
            a1 = m ? m[2] : ys[ys.length - 1];
          return simple
            ? `<div class="row2"><label>Uncertain from the year<select id="ty0">${ys.map(y => `<option ${y === a0 ? 'selected' : ''}>${y}</option>`).join('')}</select></label><label>To the year<select id="ty1">${ys.map(y => `<option ${y === a1 ? 'selected' : ''}>${y}</option>`).join('')}</select></label></div>`
            : '';
        })()}
        <div class="row2"><label>Years (advanced: several ranges, e.g. 2030-2050, 2060)<input data-k="time.active" value="${esc(t.active || '')}" placeholder="All years"></label><label>Outside them${mcSel(
          'time.outside',
          [
            ['base', 'back to the base'],
            ['hold', 'keep the last value']
          ],
          t.outside || 'base'
        )}</label></div>
        <label>Phase in over (years, 0 = at once)<input data-k="time.ramp" value="${t.ramp || 0}"></label></fieldset>`
          : ''
      }
      ${
        p.has_slice
          ? `<fieldset><legend>Time slices</legend><div class="row2"><label>Draws${mcSel(
              'slices.kind',
              [
                ['same', 'the same for every time slice'],
                ['season', 'one per season'],
                ['daytype', 'one per day type'],
                ['daypart', 'one per day part'],
                ['slice', 'one per time slice']
              ],
              sl.kind
            )}</label>
        <label>Correlation between them<input data-k="slices.rho" value="${sl.rho ?? 0.5}"></label></div>${f.post && f.post.renorm ? '<p class="hint">Each profile is re-normalised so it still sums to its base total (1) every year.</p>' : ''}</fieldset>`
          : ''
      }
      <fieldset><legend>Limits applied after the draw</legend><div class="row2"><label>Not below<input data-k="post.clip.0" value="${f.post && f.post.clip && f.post.clip[0] != null ? f.post.clip[0] : ''}" placeholder="None"></label><label>Not above<input data-k="post.clip.1" value="${f.post && f.post.clip && f.post.clip[1] != null ? f.post.clip[1] : ''}" placeholder="None"></label></div>
        ${p.has_slice ? `<label class="chk"><input type="checkbox" data-k="post.renorm" ${f.post && f.post.renorm ? 'checked' : ''}> re-normalise profiles over the time slices</label>` : ''}</fieldset>
    </div><div class="mccol">
      ${
        t.kind !== 'sde' || !p.has_year
          ? `<fieldset><legend>${t.kind === 'growth' && p.has_year ? 'Distribution of the growth rate (% per year)' : 'Distribution'}</legend><select data-k="dist.key">${optg}</select>
        <p class="mcexp"><b>${esc(dd.name)}.</b> ${esc(dd.explain)} <span class="muted">Use: ${esc(dd.use)}</span></p>
        <div class="row2">${pin('dp', dd.params, f.dist.params || {})}</div>
        <div class="row2"><label>Truncate below<input data-k="dist.trunc.0" value="${f.dist.trunc && f.dist.trunc[0] != null ? f.dist.trunc[0] : ''}" placeholder="No"></label><label>Truncate above<input data-k="dist.trunc.1" value="${f.dist.trunc && f.dist.trunc[1] != null ? f.dist.trunc[1] : ''}" placeholder="No"></label></div></fieldset>`
          : ''
      }
      ${mcDriverBox(f)}
      <div class="mcpv"><div class="mcpv-h"><b>Preview</b><span class="muted small" id="pvinfo">300 draws</span><span class="spacer"></span>${p.has_year ? `<label class="small">Year shown <select id="pvyear">${(MCV.det.years || []).map(y => `<option ${String(y) === String(MCV.pvYear || '') ? 'selected' : ''}>${esc(y)}</option>`).join('')}</select></label>` : ''}<button class="btn" id="pvgo">Refresh</button></div>
        <div id="pv1" class="pvc"></div><div id="pv2" class="pvc"></div><div id="pv3" class="pvc"></div><div id="pv6"></div><div id="pv5" class="pvc"></div><div id="pvitems"></div><div id="pv4" class="pvc"></div></div>
    </div></div></div>`;
  const D = MCV.design,
    setPath = (o, path, v) => {
      const k = path.split('.');
      let x = o;
      for (let i = 0; i < k.length - 1; i++) {
        if (x[k[i]] == null) x[k[i]] = /^\d+$/.test(k[i + 1]) ? [null, null] : {};
        x = x[k[i]];
      }
      x[k[k.length - 1]] = v;
    };
  const num = s => {
    const t2 = String(s).trim();
    return t2 === '' ? null : isNaN(Number(t2)) ? t2 : Number(t2);
  };
  const changed = rerender => {
    mcSave();
    if (rerender) mcEditor(E, f);
    const h = document.querySelector(`.mcf[data-i="${MCV.sel}"] .small`);
    if (h) h.textContent = factorSummary(f);
    schedulePV(f);
  };
  E.querySelectorAll('[data-k]').forEach(
    el =>
      (el.onchange = () => {
        const k = el.dataset.k;
        let v = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : num(el.value);
        if (k === 'name') v = el.value;
        setPath(f, k, v);
        if (k === 'dist.key') f.dist.params = {};
        if (k === 'time.sde') t.sdeParams = {};
        if (k === 'time.kind' && v === 'growth') f.dist = {key: 'triangular', params: {min: -1, mode: 0.5, max: 2}, trunc: null}; // a rate in % per year, not a multiplier
        if (
          k === 'time.kind' &&
          v !== 'growth' &&
          f.dist &&
          f.dist.key === 'triangular' &&
          f.dist.params &&
          f.dist.params.mode === 0.5 &&
          f.dist.params.min === -1
        )
          f.dist = {key: 'triangular', params: {min: 0.8, mode: 1, max: 1.3}, trunc: null};
        if (k === 'scope' && f.coherence == null) f.coherence = v === 'all' ? 1 : 0.5;
        changed(
          ['dist.key', 'time.kind', 'time.smooth', 'time.allowJumps', 'time.sde', 'slices.kind', 'coherence', 'scope', 'name'].includes(k)
            ? k !== 'name'
            : false
        );
        if (k === 'name') renderMC();
      })
  );
  E.querySelectorAll('[data-dp]').forEach(
    el =>
      (el.onchange = () => {
        f.dist.params = f.dist.params || {};
        f.dist.params[el.dataset.dp] = num(el.value);
        changed(false);
      })
  );
  E.querySelectorAll('[data-sp]').forEach(
    el =>
      (el.onchange = () => {
        t.sdeParams = t.sdeParams || {};
        t.sdeParams[el.dataset.sp] = num(el.value);
        changed(false);
      })
  );
  const selRead = d => {
    const all = p.members[d] || [],
      on = [...E.querySelectorAll(`[data-sel="${d}"]:checked`)].map(x => x.value);
    f.select = f.select || {};
    f.select[d] = on.length === all.length ? [] : on.length ? on : ['__none__'];
    changed(false); // [] = all, ['__none__'] = none
    const sm = E.querySelector(`[data-sel="${d}"]`)?.closest('details')?.querySelector('summary .muted');
    if (sm) sm.textContent = on.length === all.length ? 'all ' + all.length : on.length + ' of ' + all.length;
  };
  E.querySelectorAll('[data-sel]').forEach(c => (c.onchange = () => selRead(c.dataset.sel)));
  E.querySelectorAll('[data-sall],[data-snone]').forEach(
    b =>
      (b.onclick = () => {
        const d = b.dataset.sall || b.dataset.snone; // only the rows shown by the search
        E.querySelectorAll(`[data-sel="${d}"]`).forEach(c => {
          if (!c.closest('.selr').hidden) c.checked = !!b.dataset.sall;
        });
        selRead(d);
      })
  );
  {
    const y0 = E.querySelector('#ty0'),
      y1 = E.querySelector('#ty1'),
      ys = (MCV.det.years || []).map(String);
    const setA = () => {
      let a = y0.value,
        b = y1.value;
      if (+a > +b) [a, b] = [b, a];
      t.active = a === ys[0] && b === ys[ys.length - 1] ? '' : `${a}-${b}`;
      changed(true);
    };
    if (y0 && y1) {
      y0.onchange = setA;
      y1.onchange = setA;
    }
  }
  {
    const py = E.querySelector('#pvyear');
    if (py)
      py.onchange = () => {
        MCV.pvYear = py.value;
        drawPV(f);
      };
  }
  E.querySelectorAll('[data-sdata]').forEach(
    b =>
      (b.onclick = () => {
        const d = b.dataset.sdata,
          wd = (p.with_data || {})[d] || [];
        E.querySelectorAll(`[data-sel="${d}"]`).forEach(c => (c.checked = wd.includes(c.value)));
        selRead(d);
      })
  );
  E.querySelectorAll('[data-selq]').forEach(
    q =>
      (q.oninput = () => {
        const v = q.value.toLowerCase();
        q.closest('details')
          .querySelectorAll('.selr')
          .forEach(l => (l.hidden = v && !l.dataset.q.includes(v)));
      })
  );
  E.querySelector('#mcdel').onclick = () => {
    D.factors.splice(MCV.sel, 1);
    MCV.sel = -1;
    mcSave();
    renderMC();
  };
  E.querySelectorAll('[data-gof]').forEach(
    b =>
      (b.onclick = () => {
        MCV.sel = +b.dataset.gof;
        renderMC();
      })
  );
  {
    const sp = E.querySelector('.mcsplit');
    if (sp) {
      sp.ontoggle = () => {
        MCV.splitOpen = sp.open;
      };
      const sd = E.querySelector('#spdim');
      sd.onchange = () => {
        MCV.splitDim = sd.value;
        MCV.splitOpen = true;
        mcEditor(E, f);
      };
      const q = E.querySelector('#spq');
      q.oninput = () => sp.querySelectorAll('.spr').forEach(l => (l.hidden = q.value && !l.dataset.q.includes(q.value.toLowerCase())));
      E.querySelector('#spall').onclick = () =>
        sp.querySelectorAll('.spr').forEach(l => {
          if (!l.hidden) l.querySelector('input').checked = true;
        });
      E.querySelector('#spnone').onclick = () =>
        sp.querySelectorAll('.spr').forEach(l => {
          if (!l.hidden) l.querySelector('input').checked = false;
        });
      const split = each => {
        const d = sd.value,
          picked = [...sp.querySelectorAll('.spc:checked')].map(c => c.value);
        if (!picked.length) return toast('Tick the items that get their own settings');
        const all = p.members[d] || [],
          cur = (f.select || {})[d] || [],
          had = cur.length && cur[0] !== '__none__' ? cur : all,
          left = had.filter(m => !picked.includes(m));
        const groups = each ? picked.map(m => [m]) : [picked];
        if (groups.length > 40) return toast('At most 40 at once');
        const at = D.factors.indexOf(f);
        let k = 1;
        const nid = () => {
          while (D.factors.some(x => x.id === 'F' + k)) k++;
          return 'F' + k;
        };
        const made = groups.map(g => {
          const c = JSON.parse(JSON.stringify(f));
          c.id = nid();
          c.select = {...(c.select || {}), [d]: g};
          c.name = `${f.param
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .toLowerCase()
            .replace(/^./, x => x.toUpperCase())} · ${g.length > 3 ? g.slice(0, 3).join(', ') + ' +' + (g.length - 3) : g.join(', ')}`;
          return c;
        });
        D.factors.splice(at + 1, 0, ...made);
        f.select = {...(f.select || {}), [d]: left.length ? left : ['__none__']};
        if (!left.length) f.enabled = false;
        MCV.sel = at + 1;
        MCV.splitOpen = false;
        mcSave();
        renderMC();
        toast(
          `${made.length} new setting${made.length > 1 ? 's' : ''} of ${f.param}${left.length ? `; ${left.length} item(s) keep the first one` : '; the first one is now empty and switched off'}`
        );
      };
      E.querySelector('#spone').onclick = () => split(false);
      E.querySelector('#speach').onclick = () => split(true);
    }
  }
  E.querySelector('#mcdup').onclick = () => {
    let k = 1;
    while (D.factors.some(x => x.id === 'F' + k)) k++;
    D.factors.push({...JSON.parse(JSON.stringify(f)), id: 'F' + k, name: (f.name || f.param) + ' (copy)'});
    MCV.sel = D.factors.length - 1;
    mcSave();
    renderMC();
  };
  E.querySelector('#pvgo').onclick = () => drawPV(f);
  mcDriverWire(E, f, changed);
  drawPV(f);
}

/* ---------- an uncertain parameter correlated with chosen cells (seasons...) of a DRIVER parameter ---------- */
function mcDriverCells(drv) {
  // the cells a term can name: members of the driver's index sets (no years)
  const p = MCV.det.params.find(x => x.param === drv.param) || {members: {}},
    out = [];
  for (const [d, mem] of Object.entries(p.members || {}))
    if (d !== 'YEAR')
      for (const m of ((drv.select || {})[d] || []).filter(x => x !== '__none__').length ? drv.select[d] : mem)
        out.push([m, d.toLowerCase()]);
  if (p.has_slice) for (const ls of M.S.SEASON || []) out.push([String(ls), 'season']);
  return out;
}
function mcDriverBox(f) {
  const D = MCV.design,
    others = D.factors.filter(x => x !== f && x.enabled !== false && !(x.driverLink && x.driverLink.driver));
  const dl = f.driverLink || {},
    drv = others.find(x => x.id === dl.driver),
    terms = dl.terms || [];
  const cells = drv ? mcDriverCells(drv) : [];
  return `<fieldset class="mcdrv"><legend>Linked to a driver (correlation)</legend>
    <p class="hint">This parameter keeps its own distribution, and is drawn correlated with a DRIVER: for example the yield of durum wheat with the precipitation of spring (rank correlation 0.23). Pick several seasons (cells) of the driver to give one coefficient each. For one draw per season, set the driver's "Draws" to "one per value".</p>
    <label>Driver<select id="dlsel"><option value="">None (no driver)</option>${others.map(x => `<option value="${esc(x.id)}" ${x.id === dl.driver ? 'selected' : ''}>${esc(x.name || x.param)} · ${esc(x.param)}</option>`).join('')}</select></label>
    ${
      drv
        ? `<datalist id="dlcells">${cells.map(([m, d]) => `<option value="${esc(m)}">${esc(d)}</option>`).join('')}</datalist>
      <table class="grid dlt"><thead><tr><th>Cell of the driver (season, region…)</th><th>Rank correlation</th><th></th></tr></thead><tbody>
      ${terms.map((t, i) => `<tr><td><input list="dlcells" data-dlm="${i}" value="${esc(t.match ?? '')}" placeholder="e.g. 2"></td><td><input data-dlr="${i}" value="${esc(t.rho ?? '')}" placeholder="e.g. 0.23"></td><td><button type="button" class="btn sm" data-dlx="${i}" aria-label="Remove">×</button></td></tr>`).join('')}
      </tbody></table><button type="button" class="btn sm" id="dladd">+ a cell of the driver</button>
      <div id="pvdl" class="small"></div>`
        : ''
    }</fieldset>`;
}
function mcDriverWire(E, f, changed) {
  const sel = E.querySelector('#dlsel');
  if (!sel) return;
  sel.onchange = () => {
    if (!sel.value) delete f.driverLink;
    else
      f.driverLink = {
        driver: sel.value,
        terms: (f.driverLink && f.driverLink.driver === sel.value && f.driverLink.terms) || [{match: '', rho: ''}]
      };
    changed(true);
  };
  const T = () => (f.driverLink.terms = f.driverLink.terms || []);
  const num = v => (v.trim() === '' ? '' : isNaN(+v) ? v : +v);
  E.querySelectorAll('[data-dlm]').forEach(
    i =>
      (i.onchange = () => {
        T()[+i.dataset.dlm].match = i.value.trim();
        changed(false);
      })
  );
  E.querySelectorAll('[data-dlr]').forEach(
    i =>
      (i.onchange = () => {
        T()[+i.dataset.dlr].rho = num(i.value);
        changed(false);
      })
  );
  E.querySelectorAll('[data-dlx]').forEach(
    b =>
      (b.onclick = () => {
        T().splice(+b.dataset.dlx, 1);
        changed(true);
      })
  );
  const ad = E.querySelector('#dladd');
  if (ad)
    ad.onclick = () => {
      T().push({match: '', rho: ''});
      changed(true);
    };
}
function mcSel(k, opts, cur) {
  return `<select data-k="${k}">${opts.map(([a, b]) => `<option value="${a}" ${String(a) === String(cur) ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>`;
}
function schedulePV(f) {
  clearTimeout(MCV.pvTimer);
  MCV.pvTimer = setTimeout(() => drawPV(f), 500);
}
const pvLayout = (title, extra) => {
  const dark = isDark(),
    ink = dark ? '#e6e5e1' : '#2f3437',
    mut = dark ? '#9b9a97' : '#787774',
    grid = dark ? '#2c2c2c' : '#eeede9';
  return {
    title: {text: title, x: 0, xanchor: 'left', font: {family: '"Newsreader", Georgia, serif', size: 14, color: ink}},
    font: {family: '"Geist", "Segoe UI", sans-serif', size: 11, color: mut},
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    margin: {t: 34, l: 52, r: 12, b: 34},
    height: 230,
    showlegend: false,
    xaxis: {gridcolor: grid, zeroline: false},
    yaxis: {gridcolor: grid, zeroline: false},
    ...extra
  };
};
// charts saved as PNG (3x, for reports) or SVG (vector) from the chart toolbar
const PVCFG = {
  displaylogo: false,
  responsive: true,
  modeBarButtonsToRemove: ['lasso2d', 'select2d'],
  toImageButtonOptions: {format: 'png', scale: 3, filename: 'monte_carlo_chart'},
  modeBarButtonsToAdd: [
    {
      name: 'Download as SVG (vector)',
      icon: {width: 1000, height: 1000, path: 'M150 850h700v-80H150zM500 700L250 450h170V150h160v300h170z'},
      click: gd => Plotly.downloadImage(gd, {format: 'svg', filename: 'monte_carlo_chart'})
    }
  ]
};
// samples drawn as paths: all, or n spread over the run (bands and statistics always use every sample)
function mcPick(N, lim) {
  const n = lim && lim !== 'all' ? Math.min(N, +lim) : N;
  if (n >= N) return Array.from({length: N}, (_, i) => i);
  return Array.from({length: n}, (_, i) => Math.floor((i * N) / n));
}
// kernel density (Gaussian, Silverman bandwidth) of sorted values, 120 points
function mcKde(v) {
  const n = v.length;
  if (n < 3) return null;
  const m = v.reduce((a, b) => a + b, 0) / n,
    sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)),
    iqr = v[Math.floor(0.75 * (n - 1))] - v[Math.floor(0.25 * (n - 1))];
  const h = 0.9 * Math.min(sd, iqr / 1.34 || sd) * n ** -0.2;
  if (!(h > 0)) return null;
  const lo = v[0] - 3 * h,
    hi = v[n - 1] + 3 * h,
    X = Array.from({length: 120}, (_, i) => lo + ((hi - lo) * i) / 119);
  return {x: X, y: X.map(x => v.reduce((s, xi) => s + Math.exp(-0.5 * ((x - xi) / h) ** 2), 0) / (n * h * Math.sqrt(2 * Math.PI)))};
}
function fanTraces(x, b, color, name) {
  const c = color,
    a = o => c + o;
  return [
    {x, y: b.p95, mode: 'lines', line: {width: 0}, hoverinfo: 'skip'},
    {
      x,
      y: b.p5,
      mode: 'lines',
      line: {width: 0},
      fill: 'tonexty',
      fillcolor: a('22'),
      name: '5–95 %',
      hovertemplate: '5 %: %{y:.4g}<extra></extra>'
    },
    {x, y: b.p75, mode: 'lines', line: {width: 0}, hoverinfo: 'skip'},
    {x, y: b.p25, mode: 'lines', line: {width: 0}, fill: 'tonexty', fillcolor: a('44'), name: '25–75 %', hoverinfo: 'skip'},
    {x, y: b.p50, mode: 'lines', line: {color: c, width: 2}, name: name || 'median', hovertemplate: 'median %{y:.4g}<extra></extra>'}
  ];
}
async function drawPV(f) {
  const idx = MCV.design.factors.filter(x => x.enabled !== false).indexOf(f),
    info = document.getElementById('pvinfo');
  if (!info) return;
  if (idx < 0) {
    info.textContent = 'switched off: tick it to preview';
    return;
  }
  info.textContent = 'drawing…';
  const ys = MCV.det.years || [];
  if (!MCV.pvYear || !ys.map(String).includes(String(MCV.pvYear))) MCV.pvYear = ys[Math.floor(ys.length / 2)];
  let r;
  try {
    r = await jp('/api/mc/preview', {design: MCV.design, model: mcModel(), data: mcData(), factor: idx, n: 300, year: MCV.pvYear});
  } catch (e) {
    info.textContent = e.message;
    return;
  }
  if (r.error) {
    info.textContent = r.error;
    return;
  }
  await needLib('plotly');
  if (!info.isConnected) return; // the view changed while the preview was computed
  const F = r.factors[0],
    c1 = PAL[isDark() ? 'dark' : 'light'][0],
    c2 = PAL[isDark() ? 'dark' : 'light'][1];
  {
    const b = document.getElementById('pvdl');
    if (b)
      b.innerHTML = F.driverLink
        ? `<p class="muted">Rank correlation with the driver, in these 300 draws: ${F.driverLink.map(t => `<b>${esc(t.match)}</b> asked ${t.asked}, got ${(+t.achieved).toFixed(2)}`).join(' · ')}</p>`
        : '';
  }
  info.textContent = `${F.records.toLocaleString()} values · ${F.groups} draw group(s)${F.S > 1 ? ' · ' + F.S + ' time-slice groups' : ''} · 300 draws`;
  const el = id => document.getElementById(id);
  if (F.dist) {
    const d = F.dist,
      pc = d.pct,
      sh = [5, 50, 95].map(k => ({
        type: 'line',
        x0: pc[String(k)],
        x1: pc[String(k)],
        y0: 0,
        y1: 1,
        yref: 'paper',
        line: {color: k === 50 ? c2 : '#9b9a97', width: 1, dash: k === 50 ? 'solid' : 'dot'}
      }));
    const tr = d.pmf
      ? [{type: 'bar', x: d.pmf.x, y: d.pmf.p, marker: {color: c1}, hovertemplate: '%{x}: %{y:.3f}<extra></extra>'}]
      : d.pdf
        ? [
            {
              x: d.pdf.x,
              y: d.pdf.y,
              mode: 'lines',
              fill: 'tozeroy',
              line: {color: c1, width: 2},
              fillcolor: c1 + '22',
              hovertemplate: '%{x:.4g}<extra></extra>'
            }
          ]
        : [];
    Plotly.react(
      el('pv1'),
      tr,
      pvLayout(`Distribution · mean ${(+d.mean).toPrecision(4)} · 5 % ${(+pc['5']).toPrecision(3)} · 95 % ${(+pc['95']).toPrecision(3)}`, {
        shapes: sh,
        yaxis: {visible: false}
      }),
      PVCFG
    );
  } else el('pv1').innerHTML = '';
  const yrs = r.years,
    hasY = F.values.has_year;
  if (hasY) {
    const dr = F.draw,
      b = {p5: dr.p5, p25: dr.p25, p50: dr.p50, p75: dr.p75, p95: dr.p95};
    Plotly.react(
      el('pv2'),
      [
        ...fanTraces(yrs, b, c1),
        ...dr.paths
          .slice(0, 10)
          .map(pth => ({x: yrs, y: pth, mode: 'lines', line: {color: '#9b9a97', width: 0.6}, hoverinfo: 'skip', opacity: 0.6}))
      ],
      pvLayout(`Draw over the years · ${esc(dr.group)}`),
      PVCFG
    );
    const v = F.values;
    Plotly.react(
      el('pv3'),
      [
        ...fanTraces(yrs, v, c2, 'median'),
        {
          x: yrs,
          y: v.base,
          mode: 'lines',
          line: {color: isDark() ? '#e6e5e1' : '#2f3437', width: 1.5, dash: 'dash'},
          name: 'base',
          hovertemplate: 'base %{y:.4g}<extra></extra>'
        }
      ],
      pvLayout(`${esc(F.param)}: ${v.how.replace('of the selected values', '')} vs base (dashed)`, {
        shapes: [
          {
            type: 'line',
            x0: F.year ? F.year.year : null,
            x1: F.year ? F.year.year : null,
            y0: 0,
            y1: 1,
            yref: 'paper',
            line: {color: '#9b9a97', width: 1, dash: 'dot'}
          }
        ]
      }),
      PVCFG
    );
  } else {
    el('pv2').innerHTML = '';
    el('pv3').innerHTML = '';
  }
  pvItems(F, yrs, c1, c2);
  if (F.year) {
    const Y = F.year,
      inY = Y.year ? ` in ${esc(Y.year)}` : '',
      what = Y.n > 1 ? ` (${Y.how} of ${Y.n} values)` : '';
    Plotly.react(
      el('pv5'),
      [{type: 'histogram', x: Y.values, marker: {color: c2}, nbinsx: 30, hovertemplate: '%{x:.4g}: %{y}<extra></extra>'}],
      pvLayout(`Value${inY}${what} · base ${fmt(Y.base)} (dashed) · 5–95 % ${fmt(Y.p5)} – ${fmt(Y.p95)}`, {
        shapes: [
          {
            type: 'line',
            x0: Y.base,
            x1: Y.base,
            y0: 0,
            y1: 1,
            yref: 'paper',
            line: {color: isDark() ? '#e6e5e1' : '#2f3437', width: 1.5, dash: 'dash'}
          }
        ],
        yaxis: {visible: false}
      }),
      PVCFG
    );
  } else el('pv5').innerHTML = '';
  const it = el('pvitems');
  if (it)
    it.innerHTML =
      F.items && F.items.length
        ? `<div class="tw"><table class="grid pvtab"><thead><tr>${(F.dims || [])
            .filter(d => d !== 'YEAR')
            .map(d => `<th class="k">${esc(d.toLowerCase())}</th>`)
            .join(
              ''
            )}${F.year && F.year.year ? `<th>Year</th>` : ''}<th>Base</th><th>5 %</th><th>50 %</th><th>95 %</th></tr></thead><tbody>${F.items.map(r => `<tr>${r.key.map((k, i) => ((F.dims || [])[i] === 'YEAR' ? (F.year && F.year.year ? `<td>${esc(k)}</td>` : '') : `<td class="k">${esc(k)}</td>`)).join('')}<td><b>${fmt(r.base)}</b></td><td>${fmt(r.p5)}</td><td>${fmt(r.p50)}</td><td>${fmt(r.p95)}</td></tr>`).join('')}</tbody></table></div><p class="muted small">Values of the parameter for the selected items${F.year && F.year.year ? ' in ' + esc(F.year.year) : ''}: the base (from the data) and the drawn values (first ${F.items.length}).</p>`
        : '';
  if (F.slices) {
    const s = F.slices;
    Plotly.react(
      el('pv4'),
      [
        {
          type: 'bar',
          x: s.names,
          y: s.p50,
          marker: {color: c1},
          error_y: {
            type: 'data',
            symmetric: false,
            array: s.p95.map((v, i) => v - s.p50[i]),
            arrayminus: s.p50.map((v, i) => v - s.p5[i]),
            color: '#9b9a97'
          }
        }
      ],
      pvLayout(`Time-slice groups, ${s.year} · median and 5–95 %`),
      PVCFG
    );
  } else el('pv4').innerHTML = '';
}

function pvItems(F, yrs, c1, c2) {
  // each item (technology, commodity...) over the years: pick which, one small chart each
  const box = document.getElementById('pv6');
  if (!box) return;
  const S = F.series || [];
  if (S.length < 1) {
    box.innerHTML = '';
    return;
  }
  const key = F.param + '|' + MCV.sel;
  MCV.pvItems = MCV.pvItems || {};
  let pick = (MCV.pvItems[key] || S.slice(0, 4).map(x => x.label)).filter(l => S.some(x => x.label === l));
  const draw = () => {
    const sel = S.filter(x => pick.includes(x.label)).slice(0, 12);
    box.querySelector('.pvigrid').innerHTML =
      sel.map((x, i) => `<div class="pvi" id="pvi${i}"></div>`).join('') || '<div class="muted small">Tick items to see them.</div>';
    sel.forEach((x, i) =>
      Plotly.react(
        `pvi${i}`,
        [
          {x: yrs, y: x.p95, mode: 'lines', line: {width: 0}, hoverinfo: 'skip', showlegend: false},
          {
            x: yrs,
            y: x.p5,
            mode: 'lines',
            line: {width: 0},
            fill: 'tonexty',
            fillcolor: c1 + '33',
            name: '5–95 %',
            hovertemplate: '5 %% %{y:.4g}<extra></extra>'.replace('%%', '%')
          },
          ...x.paths.map(pth => ({
            x: yrs,
            y: pth,
            mode: 'lines',
            line: {color: '#9b9a97', width: 0.6},
            opacity: 0.6,
            hoverinfo: 'skip',
            showlegend: false
          })),
          {x: yrs, y: x.p50, mode: 'lines', line: {color: c1, width: 2}, name: 'median', hovertemplate: 'median %{y:.4g}<extra></extra>'},
          {
            x: yrs,
            y: x.base,
            mode: 'lines',
            line: {color: isDark() ? '#e6e5e1' : '#2f3437', width: 1.3, dash: 'dash'},
            name: 'base',
            hovertemplate: 'base %{y:.4g}<extra></extra>'
          }
        ],
        pvLayout(esc(x.label), {height: 190, margin: {l: 46, r: 8, t: 26, b: 24}, showlegend: false}),
        PVCFG
      )
    );
    const n = box.querySelector('.pvin');
    if (n)
      n.textContent = `${pick.length} of ${S.length}${F.series_total > S.length ? ` (the ${S.length} largest of ${F.series_total})` : ''}`;
  };
  box.innerHTML = `<div class="pvih"><b>Each item over the years</b> <span class="muted small pvin"></span><span class="muted small">· band 5–95 %, median, sample paths, base dashed</span></div>
    <details class="pvisel"><summary>Choose the items</summary><div class="fm-tools"><input type="search" class="pviq" placeholder="Search ${S.length}"><button type="button" class="btn sm" data-pa="1">All</button><button type="button" class="btn sm" data-pa="0">None</button></div>
      <div class="sellist">${S.map(x => `<label class="selr" data-q="${esc(x.label.toLowerCase())}"><input type="checkbox" class="pvic" value="${esc(x.label)}" ${pick.includes(x.label) ? 'checked' : ''}><b>${esc(x.label)}</b></label>`).join('')}</div></details>
    <div class="pvigrid"></div>`;
  const read = () => {
    pick = [...box.querySelectorAll('.pvic:checked')].map(c => c.value);
    MCV.pvItems[key] = pick;
    draw();
  };
  box.querySelectorAll('.pvic').forEach(c => (c.onchange = read));
  box.querySelector('.pviq').oninput = e => {
    const q = e.target.value.toLowerCase();
    box.querySelectorAll('.pvisel .selr').forEach(l => (l.hidden = q && !l.dataset.q.includes(q)));
  };
  box.querySelectorAll('[data-pa]').forEach(
    b =>
      (b.onclick = () => {
        box.querySelectorAll('.pvisel .selr').forEach(l => {
          if (!l.hidden) l.querySelector('input').checked = b.dataset.pa === '1';
        });
        read();
      })
  );
  draw();
}
const MC_DERIVED = [
  'ProductionByTechnology',
  'ProductionByTechnologyByMode',
  'ProductionByTechnologyAnnual',
  'ProductionByTechnologyByModeTs',
  'RateOfProductionByTechnologyByMode',
  'UseByTechnology',
  'UseByTechnologyByMode',
  'UseByTechnologyAnnual',
  'UseByTechnologyByModeTs',
  'RateOfUseByTechnologyByMode',
  'AnnualTechnologyEmissionByMode',
  'AnnualTechnologyEmission',
  'AnnualEmissions',
  'TotalAnnualTechnologyActivityByMode',
  'TotalTechnologyAnnualActivity',
  'CapitalInvestment',
  'AnnualizedInvestmentCost',
  'TotalStorageCapacity',
  'Demand'
];
/* ---------- tab 2: correlations, sampling, solver, outputs ---------- */
async function mcCorrTab(B) {
  const D = MCV.design,
    F = D.factors.filter(f => f.enabled !== false),
    I = await serverInfo(),
    sv = I ? I.solvers : [];
  const M0 = {};
  (D.corr.ids || []).forEach((a, i) =>
    (D.corr.ids || []).forEach((b, j) => {
      M0[a + '|' + b] = (D.corr.matrix[i] || [])[j];
    })
  );
  const cv = (a, b) => (a === b ? 1 : (M0[a + '|' + b] ?? M0[b + '|' + a] ?? 0));
  const mvars = SCHEMA && SCHEMA.vars ? [...SCHEMA.vars.keys()].sort() : [];
  const dvars = MC_DERIVED.filter(v => !mvars.includes(v));
  const cvars =
    SCHEMA && SCHEMA.cons
      ? SCHEMA.cons
          .filter(c => !/\(objective\)$/.test(c.name))
          .map(c => 'DUAL.' + c.name)
          .sort()
      : [];
  const orow = v =>
    `<label class="orow" data-v="${esc(vlabel(v).toLowerCase())}"><input type="checkbox" name="out" value="${esc(v)}" ${D.outputs.includes(v) ? 'checked' : ''}> ${esc(vlabel(v))}</label>`;
  const ogrp = (g, t, list, note) =>
    list.length
      ? `<div class="vgrp" data-g="${g}">${t}<i>${list.filter(v => D.outputs.includes(v)).length} / ${list.length}</i><span class="ogb"><button type="button" class="lnk" data-og="${g}" data-on="1">All</button> <button type="button" class="lnk" data-og="${g}" data-on="0">None</button></span></div>${note ? `<div class="vnote">${note}</div>` : ''}<div data-gl="${g}">${list.map(orow).join('')}</div>`
      : '';
  const outBox =
    `<div class="vgrp">Objective<i>Always</i></div><label class="orow" data-v="objective"><input type="checkbox" checked disabled> Objective (full, constant part, as MUIO shows it)</label>` +
    ogrp('m', 'Variables of the model', mvars) +
    ogrp('d', 'Derived (computed as MUIO does)', dvars, 'Computed after each solve from the sample data and the solution.') +
    ogrp(
      's',
      'Shadow prices (duals of the constraints)',
      cvars,
      'HiGHS, GLPK and CBC give them; one value per row of the constraint and per sample.'
    );
  B.innerHTML = `<div class="mcgrid2"><section><h3>Correlations between uncertain parameters</h3>
    <p class="muted small">Spearman-type rank correlations, applied through a Gaussian copula to the drivers of each parameter (for SDEs to their yearly shocks). An impossible combination is repaired to the nearest valid one. "Check" draws 400 samples and shows the correlation achieved between the parameters' average draws.</p>
    ${
      F.length > 1
        ? `<div class="tw"><table class="grid ctab"><thead><tr><th class="k"></th>${F.map(f => `<th>${esc(f.name || f.param)}</th>`).join('')}</tr></thead><tbody>${F.map((a, i) => `<tr><td class="k">${esc(a.name || a.param)}</td>${F.map((b, j) => `<td>${i === j ? '1' : j < i ? `<span class="muted">${cv(a.id, b.id)}</span>` : `<input data-a="${a.id}" data-b="${b.id}" value="${cv(a.id, b.id)}">`}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="acts"><button class="btn" id="ccheck">Check correlations</button></div><div id="cres"></div>`
        : '<div class="empty">Add at least two uncertain parameters.</div>'
    }
    </section><section><h3>Sampling</h3><form id="smf" class="frm">
      <div class="row2"><label>Samples<input name="n" type="number" min="2" max="100000" value="${D.sampling.n}"></label><label>Method${mcSel(
        'x',
        [
          ['lhs', 'Latin hypercube (recommended)'],
          ['mc', 'plain Monte Carlo'],
          ['halton', 'Halton (quasi-random)'],
          ['sobol', 'Sobol (quasi-random)']
        ],
        D.sampling.method
      ).replace('data-k="x"', 'name="method"')}</label></div>
      <div class="row2"><label>Seed (same seed = same samples)<input name="seed" type="number" value="${D.sampling.seed}"></label><label>Solves at the same time<input name="workers" type="number" min="1" max="64" value="${D.workers}"></label></div>
      <p class="hint">Latin hypercube and quasi-random methods cover the ranges evenly with fewer samples. Solves at the same time: up to the number of processor cores (each solve also uses memory).</p>
      <fieldset><legend>Solver</legend><div class="regs">${sv.map(s => `<label><input type="radio" name="solver" value="${s.id}" ${s.id === D.solver ? 'checked' : ''}> ${esc(s.name)}</label>`).join('')}</div>
        <div class="row2"><label>Time limit per sample (s)<input name="time_limit" value="${esc(D.options.time_limit || '')}" placeholder="None"></label><label>Threads per solve<input name="threads" value="${esc(D.options.threads || '')}" placeholder="Solver default"></label></div></fieldset>
      ${
        scenData().list.length
          ? `<fieldset><legend>Base of the samples</legend>${scenData()
              .list.map(
                s =>
                  `<label class="chk"><input type="checkbox" name="scn" value="${s.id}" ${D.scenarios.includes(s.id) ? 'checked' : ''}> scenario ${esc(s.name)}</label>`
              )
              .join('')}<p class="hint">The samples vary the base case with these scenarios applied (in order).</p></fieldset>`
          : ''
      }
      <fieldset><legend>Results kept for each sample</legend><div class="acts okeep"><button type="button" class="btn sm" id="okall">Keep every yearly result</button><button type="button" class="btn sm" id="okts">Keep everything (with time slices)</button><span class="muted small">${D.outputs.length} kept</span></div><input type="search" id="oq" placeholder="Search variables"><div class="fbox obox vbox">${outBox}</div>
        <p class="hint">Ticks are kept at once. The objective is always kept. Large variables (by time slice) take disk space: ${D.sampling.n} copies.</p></fieldset>
      <div class="acts"><button class="btn pri" type="submit">Save</button></div></form></section></div>`;
  B.querySelectorAll('[data-a]').forEach(
    i =>
      (i.onchange = () => {
        const v = Math.max(-1, Math.min(1, Number(i.value) || 0));
        i.value = v;
        const ids = F.map(f => f.id),
          m = ids.map(a =>
            ids.map(b =>
              a === b ? 1 : (a === i.dataset.a && b === i.dataset.b) || (b === i.dataset.a && a === i.dataset.b) ? v : cv(a, b)
            )
          );
        D.corr = {ids, matrix: m};
        mcSave();
        mcCorrTab(B);
      })
  );
  const cc = B.querySelector('#ccheck');
  if (cc)
    cc.onclick = async () => {
      const box = B.querySelector('#cres');
      box.innerHTML = '<div class="muted">Drawing 400 samples…</div>';
      const r = await jp('/api/mc/preview', {design: D, model: mcModel(), data: mcData(), n: 400});
      if (r.error) {
        box.innerHTML = `<div class="ck error"><div class="ck-d">${esc(r.error)}</div></div>`;
        return;
      }
      await needLib('plotly');
      box.innerHTML = `${r.repaired ? '<div class="ck warn"><div class="ck-d">The matrix you gave is not a valid correlation matrix: the nearest valid one was used.</div></div>' : ''}<div id="chm"></div>`;
      const a = r.achieved;
      if (!a) {
        box.innerHTML += '<div class="muted">Needs two parameters switched on.</div>';
        return;
      }
      Plotly.react(
        'chm',
        [
          {
            type: 'heatmap',
            z: a.spearman,
            x: a.names,
            y: a.names,
            zmin: -1,
            zmax: 1,
            colorscale: [
              [0, '#9f2f2d'],
              [0.5, '#f7f6f3'],
              [1, '#1f6c9f']
            ],
            text: a.spearman.map(r2 => r2.map(v => v.toFixed(2))),
            texttemplate: '%{text}',
            hovertemplate: '%{y} · %{x}: %{z:.2f}<extra></extra>'
          }
        ],
        pvLayout('Rank correlation achieved between the parameters (average draw per sample)', {
          height: 120 + 34 * a.names.length,
          yaxis: {autorange: 'reversed'},
          margin: {t: 34, l: 140, r: 10, b: 90}
        }),
        PVCFG
      );
    };
  B.querySelectorAll('[data-og]').forEach(
    b =>
      (b.onclick = () => {
        B.querySelectorAll(`[data-gl="${b.dataset.og}"] .orow`).forEach(l => {
          if (!l.hidden) l.querySelector('input').checked = b.dataset.on === '1';
        });
        readSm();
      })
  );
  B.querySelector('#okall').onclick = () => {
    D.outputs = mcDefaultOuts(false);
    D.outputsAll = 1;
    mcSave();
    toast(`${D.outputs.length} results kept for each sample`);
    mcCorrTab(B);
  };
  B.querySelector('#okts').onclick = () => {
    D.outputs = mcDefaultOuts(true);
    D.outputsAll = 1;
    mcSave();
    toast(`${D.outputs.length} results kept, time slices included: large runs need disk space (${D.sampling.n} copies)`);
    mcCorrTab(B);
  };
  const oq = B.querySelector('#oq');
  oq.oninput = () => B.querySelectorAll('.orow').forEach(l => (l.hidden = oq.value && !l.dataset.v.includes(oq.value.toLowerCase())));
  const smf = B.querySelector('#smf');
  const readSm = () => {
    const fd = new FormData(smf);
    D.sampling = {n: Math.max(2, +fd.get('n') || 100), method: fd.get('method'), seed: +fd.get('seed') || 0};
    D.workers = Math.max(1, +fd.get('workers') || 1);
    D.solver = fd.get('solver') || D.solver;
    D.options = {};
    for (const k of ['time_limit', 'threads']) if (String(fd.get(k) || '').trim()) D.options[k] = String(fd.get(k)).trim();
    D.scenarios = fd.getAll('scn');
    D.outputs = fd.getAll('out');
    D.outputsAll = 1;
    mcSave();
    smf.querySelectorAll('.obox [data-gl]').forEach(g => {
      const c = smf.querySelector(`.obox .vgrp[data-g="${g.dataset.gl}"] i`);
      if (c) c.textContent = `${g.querySelectorAll('input:checked').length} / ${g.querySelectorAll('input').length}`;
    });
  };
  smf.addEventListener('change', readSm); // every tick and value is kept at once (no need to press Save)
  smf.onsubmit = ev => {
    ev.preventDefault();
    readSm();
    toast('Sampling settings saved');
    renderMC();
  };
}

/* ---------- tab 3: run ---------- */
let MCPOLL = null;
async function mcRunTab(B) {
  const D = MCV.design,
    F = D.factors.filter(f => f.enabled !== false),
    runs = await api('/api/mc').catch(() => []);
  B.innerHTML = `<div class="mcgrid2"><section><h3>Start a Monte Carlo run</h3>
     <p class="muted small">${F.length} uncertain parameter(s) · ${D.sampling.n} samples · ${esc(D.solver)} · ${D.workers} at the same time · results kept: objective${D.outputs.length ? ', ' + (D.outputs.length > 8 ? D.outputs.slice(0, 8).map(vlabel).join(', ') + ` and ${D.outputs.length - 8} more` : D.outputs.map(vlabel).join(', ')) : ''}. The base is the model as it is now${D.scenarios.length ? ' with ' + D.scenarios.map(scenName).join(' + ') : ''}.</p>
     <form id="mrf" class="frm"><label>Name<input name="name" value="${esc((M.meta.name || 'model').replace(/\.(txt|dat)$/i, '') + '_mc')}"></label><div class="acts"><button class="btn pri" type="submit" ${F.length ? '' : 'disabled'}>Start</button></div></form>
     ${F.length ? '' : '<p class="muted">Add uncertain parameters first.</p>'}<div id="mlive"></div></section>
   <section><h3>Monte Carlo runs on this computer</h3>${
     runs
       .map(
         r => `<div class="ck ${r.state === 'failed' ? 'error' : ''}"><div class="ck-h"><b>${esc(r.name || r.id)}</b><span class="sev ${r.state === 'done' ? 'info' : r.state === 'failed' ? 'error' : 'warn'}">${esc(r.state || '')}</span></div>
      <div class="ck-w">${esc(r.created || '')} · ${r.ok ?? 0} optimal of ${r.done ?? 0} solved / ${r.total ?? r.n} · ${esc(r.solver || '')}${r.case ? ' · case ' + esc(r.case) : ''}${r.scenarios && r.scenarios.length ? ' · ' + esc(r.scenarios.join(' + ')) : ''}</div>
      ${r.state === 'running' ? `<div class="pbar"><i style="width:${Math.round((100 * (r.done || 0)) / (r.total || 1))}%"></i></div>` : ''}
      <div class="acts" style="margin-top:6px">${r.done ? `<button class="btn" data-res="${r.id}">Results</button>` : ''}<button class="btn" data-watch="${r.id}">Progress and log</button>${r.state === 'running' ? `<button class="btn" data-stop="${r.id}">Stop</button>` : ''}<button class="btn danger" data-del="${r.id}">Delete</button></div></div>`
       )
       .join('') || '<div class="empty">No Monte Carlo run yet.</div>'
   }</section></div>`;
  B.querySelector('#mrf').onsubmit = async ev => {
    ev.preventDefault();
    const name = new FormData(ev.target).get('name');
    const body = {
      name,
      design: D,
      model: mcModel(),
      data: mcData(),
      model_name: SCHEMA ? SCHEMA.name : 'MUIO 5.4',
      scenarios: D.scenarios.map(scenName)
    };
    if (LIB.srv && LIB.current) {
      await mcSave();
      body.case = LIB.current;
    }
    const r = await jp('/api/mc/run', body);
    if (!r.ok) return toast('Could not start: ' + (r.error || ''));
    toast('Monte Carlo started');
    mcWatch(r.id);
  };
  B.querySelectorAll('[data-res]').forEach(
    b =>
      (b.onclick = () => {
        MCV.res.run = b.dataset.res;
        MCV.tab = 'results';
        renderMC();
      })
  );
  B.querySelectorAll('[data-watch]').forEach(b => (b.onclick = () => mcWatch(b.dataset.watch)));
  B.querySelectorAll('[data-stop]').forEach(
    b =>
      (b.onclick = async () => {
        await jp(`/api/mc/${b.dataset.stop}/stop`, {});
        toast('Stopping after the samples being solved');
      })
  );
  B.querySelectorAll('[data-del]').forEach(
    b =>
      (b.onclick = async () => {
        if (!await uiConfirm('Delete this Monte Carlo run and its samples?')) return;
        await jp(`/api/mc/${b.dataset.del}/delete`, {});
        mcRunTab(B);
      })
  );
}
function mcWatch(id) {
  clearInterval(MCPOLL);
  const tick = async () => {
    const box = document.getElementById('mlive');
    if (!box) {
      clearInterval(MCPOLL);
      return;
    }
    const s = await api('/api/mc/' + id).catch(() => null);
    if (!s) return;
    const fin = ['done', 'failed', 'stopped'].includes(s.state);
    box.innerHTML = `<div class="ck ${s.state === 'failed' ? 'error' : 'cur'}"><div class="ck-h"><b>${esc(s.name || id)}</b><span class="sev ${s.state === 'done' ? 'info' : s.state === 'failed' ? 'error' : 'warn'}">${esc(s.state)}</span></div>
      <div class="ck-w">${esc(s.stage || '')} · ${s.ok ?? 0} optimal of ${s.done ?? 0} / ${s.total}${s.eta != null && !fin ? ' · about ' + Math.ceil(s.eta / 60) + ' min left' : ''}${s.elapsed != null ? ' · ' + s.elapsed + ' s' : ''}</div>
      <div class="pbar"><i style="width:${Math.round((100 * (s.done || 0)) / (s.total || 1))}%"></i></div><pre class="log">${esc((s.log || []).slice(-14).join('\n'))}</pre>
      ${s.done ? `<div class="acts"><button class="btn pri" id="mgo">Results</button></div>` : ''}</div>`;
    const g = document.getElementById('mgo');
    if (g)
      g.onclick = () => {
        MCV.res.run = id;
        MCV.tab = 'results';
        renderMC();
      };
    if (fin) clearInterval(MCPOLL);
  };
  tick();
  MCPOLL = setInterval(tick, 2000);
}

/* ---------- tab 4: results (filters as in Results, spaghetti / distributions / exceedance / breakdown / input-output sensitivity) ---------- */
async function mcResultsTab(B) {
  const runs = (await api('/api/mc').catch(() => [])).filter(r => (r.done || 0) > 0);
  if (!runs.length) {
    B.innerHTML = '<div class="empty">No Monte Carlo results yet: start a run.</div>';
    return;
  }
  const R = MCV.res;
  if (!R.run || !runs.some(r => r.id === R.run)) R.run = runs[0].id;
  R.filters = R.filters || {};
  R.view = R.view || 'both';
  R.sc = R.sc || {xas: 'value'};
  const mem = await jp(`/api/mc/${R.run}/members`, {var: R.var}).catch(() => ({dims: [], members: {}, outputs: []}));
  const outs = ['Objective', ...(mem.outputs || [])];
  if (!outs.includes(R.var)) R.var = 'Objective';
  const dims = R.var === 'Objective' ? [] : mem.dims || [];
  if (!dims.includes(R.along)) R.along = dims.includes('YEAR') ? 'YEAR' : dims[0] || '';
  if (R.breakdown === undefined) R.breakdown = dims.includes('TECHNOLOGY') && R.along !== 'TECHNOLOGY' ? 'TECHNOLOGY' : '';
  if (R.breakdown && (!dims.includes(R.breakdown) || R.breakdown === R.along)) R.breakdown = '';
  const years = mem.members.YEAR || [];
  if (!R.focus || (!['sum', 'mean'].includes(R.focus) && !years.includes(String(R.focus)))) R.focus = 'sum';
  const flt = Object.fromEntries(Object.entries(R.filters).filter(([k]) => dims.includes(k)));
  const emptyF = Object.entries(flt).find(([k, v]) => Array.isArray(v) && !v.length);
  const tok = (MCV.rtok = (MCV.rtok || 0) + 1);
  const exq = keep =>
    jp(`/api/mc/${R.run}/explore`, {
      var: R.var,
      filters: flt,
      divide: R.divide,
      along: R.along,
      focus: R.focus,
      breakdown: R.breakdown || null,
      keep,
      bmax: R.bmax || null
    });
  R.cond = (R.cond || []).filter(c => c.run === R.run);
  let a = emptyF ? {n: 0, total_samples: 0, risk: {}, totals: [], none: emptyF[0]} : await exq(null);
  const a0 = a;
  let keepSet = null;
  if (!emptyF && R.cond.length && !a.error) {
    keepSet = mcKeep(R.cond, a0);
    a = keepSet.length ? await exq(keepSet) : {n: 0, total_samples: a0.total_samples, risk: {}, totals: [], noneKept: true};
  }
  MCV.keep = keepSet;
  if (tok !== MCV.rtok || !B.isConnected) return; // a newer drawing was asked meanwhile
  if (a.error && !a.none) {
    a.none = null;
  }
  const autoU = (() => {
    if (typeof unitOfAll !== 'function') return '';
    const pick = d => R.filters[d] || mem.members[d] || [undefined];
    const recs = [];
    for (const t of pick('TECHNOLOGY').slice(0, 60))
      for (const c of pick('COMMODITY').slice(0, 40))
        for (const e of pick('EMISSION').slice(0, 10)) recs.push({TECHNOLOGY: t, COMMODITY: c, EMISSION: e});
    return R.var.startsWith('DUAL.') ? '' : unitOfAll(R.var, recs);
  })();
  const u = R.unit ? ' ' + R.unit : autoU && (+R.divide || 1) === 1 ? ' ' + autoU : '',
    f4 = v => (v == null || !isFinite(v) ? '–' : (+v).toLocaleString('en-US', {maximumFractionDigits: Math.abs(v) >= 100 ? 1 : 4}));
  const rk = a.risk || {},
    hasY = dims.includes('YEAR');
  const focusLab =
    R.var === 'Objective'
      ? 'the objective'
      : !hasY
        ? 'the total of the selection'
        : R.focus === 'sum'
          ? 'all years summed'
          : R.focus === 'mean'
            ? 'the mean per year'
            : 'the year ' + R.focus;
  const grpOpt = (t, list) =>
    list.length
      ? `<optgroup label="${t}">${list.map(v => `<option value="${esc(v)}" ${v === R.var ? 'selected' : ''}>${esc(vlabel(v))}</option>`).join('')}</optgroup>`
      : '';
  const oD = outs.filter(v => MC_DERIVED.includes(v)),
    oS = outs.filter(v => /^DUAL\./.test(v)),
    oM = outs.filter(v => v !== 'Objective' && !oD.includes(v) && !oS.includes(v));
  const varSel = `<select id="rvar"><option value="Objective" ${R.var === 'Objective' ? 'selected' : ''}>Objective</option>${grpOpt('Variables of the model', oM)}${grpOpt('Derived (as MUIO)', oD)}${grpOpt('Shadow prices', oS)}</select>`;
  const fBox = d => {
    const all = mem.members[d] || [],
      cur = R.filters[d],
      on = m => !cur || cur.includes(m);
    return `<details class="mcflt" data-fd="${esc(d)}" ${(R.open || []).includes(d) ? 'open' : ''}><summary>${esc(d)} <span class="muted fcount">${!cur ? 'all ' + all.length : cur.length + ' of ' + all.length}</span></summary>
      <div class="fbar"><input type="search" class="fq" placeholder="Search"><button type="button" class="lnk" data-fa="all">All</button><button type="button" class="lnk" data-fa="none">None</button><button type="button" class="lnk" data-fa="inv">Invert</button></div>
      <div class="fbox">${all.map(m => `<div class="frow" data-m="${esc(String(m).toLowerCase())}"><label><input type="checkbox" data-f="${esc(d)}" value="${esc(m)}" ${on(m) ? 'checked' : ''}> ${esc(m)}</label><button type="button" class="fmo" data-only="${esc(m)}" title="Only this one">Only</button></div>`).join('')}</div></details>`;
  };
  const opt = (id, list, cur) =>
    `<select id="${id}">${list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const tiles = [
    ['Samples', `${a.n || 0} optimal of ${a.total_samples || 0}`],
    ['Mean', f4(rk.mean) + u],
    ['Standard deviation · CV', `${f4(rk.sd)}${u} · ${rk.cv != null ? (100 * rk.cv).toFixed(1) + ' %' : '–'}`],
    ['5 % · median · 95 %', `${f4(rk.p5)} · ${f4(rk.p50)} · ${f4(rk.p95)}${u}`],
    ['VaR 95 % · CVaR 95 % (high side)', `${f4(rk.VaR95)} · ${f4(rk.CVaR95)}${u}`],
    ['Low side 5 % · its CVaR', `${f4(rk.VaR95_low)} · ${f4(rk.CVaR95_low)}${u}`],
    ['Range', `${f4(rk.min)} to ${f4(rk.max)}${u}`]
  ];
  const same = a.n && rk.max === rk.min;
  const P = ['1', '5', '10', '25', '50', '75', '90', '95', '99'];
  B.innerHTML = `<div class="mcres"><aside class="rcfg">
      <details open><summary>Monte Carlo run</summary>${opt(
        'rrun',
        runs.map(r => [r.id, `${r.name || r.id} · ${r.ok}/${r.total}`]),
        R.run
      )}</details>
      <details open><summary>Result</summary><label>Variable${varSel}</label>
        ${dims.length ? `<label>Along (X axis)${opt('ralong', [['', 'nothing (one number per sample)'], ...dims.map(d => [d, d])], R.along)}</label>` : ''}
        ${hasY ? `<label>Distribution, risk and sensitivity of${opt('rfocus', [['sum', 'all years summed'], ['mean', 'the mean per year'], ...years.map(y => [y, 'the year ' + y])], R.focus)}</label>` : ''}
        ${dims.length > 1 ? `<label>Split by (one distribution per member)${opt('rbreak', [['', 'no split'], ...dims.filter(d => d !== R.along).map(d => [d, d])], R.breakdown)}</label>` : ''}
        <div class="row2"><label>Samples drawn${opt(
          'rnp',
          [
            ['all', 'all'],
            ['300', '300'],
            ['100', '100'],
            ['30', '30']
          ],
          R.np || 'all'
        )}</label>${
          dims.length > 1
            ? `<label>Members in a split${opt(
                'rbmax',
                [
                  ['', 'all'],
                  ['10', '10 largest'],
                  ['20', '20 largest'],
                  ['40', '40 largest']
                ],
                R.bmax || ''
              )}</label>`
            : '<span></span>'
        }</div>
        <div class="row2"><label>Divide by<input id="rdiv" value="${R.divide}"></label><label>Unit<input id="runit" value="${esc(R.unit)}" placeholder="${autoU ? esc(autoU) + ' (model)' : 'e.g. GW'}"></label></div></details>
      <details class="rsamp" ${R.cond.length || R.sampOpen ? 'open' : ''}><summary>Samples kept <span class="muted">${keepSet ? keepSet.length + ' of ' + a0.n : 'all ' + (a0.n || 0)}</span></summary>
        ${R.cond.map((c, i) => `<div class="rcond"><span>${esc(mcCondLabel(c, a0))}</span><button type="button" class="lnk" data-cdel="${i}">Remove</button></div>`).join('') || '<p class="hint">Keep only the samples (futures) where an uncertain parameter, the objective or the result shown is in a range: every chart then shows that subset (e.g. "when gas is expensive").</p>'}
        <label>Where<select id="csrc"><option value="obj">The objective</option><option value="res">The result shown (${esc(focusLab)})</option>${(a0.factor_names || []).map((n, i) => `<option value="f:${i}">${esc(n)} (mean draw)</option>`).join('')}</select></label>
        <div class="row2"><label>from<input id="clo" placeholder="Min"></label><label>to<input id="chi" placeholder="Max"></label></div>
        <div class="acts"><button type="button" class="btn sm" id="cadd">Keep this range</button><button type="button" class="btn sm" data-cq="top">Highest 10 %</button><button type="button" class="btn sm" data-cq="bot">Lowest 10 %</button>${R.cond.length ? '<button type="button" class="btn sm" id="cclr">Keep all</button>' : ''}</div></details>
      ${dims.length ? `<div class="vgrp">Filters<i>${Object.keys(flt).length} set</i></div>${dims.map(fBox).join('')}<p class="hint">Tick, untick, all, none, invert, or "only" on a row: the charts follow a moment after the last click; the lists stay open.</p>` : ''}
      <div class="acts"><button class="btn" id="rxlsx">Excel (this view)</button><button class="btn" id="rcsv">CSV</button></div>
      <details class="rfull" ${R.fullOpen ? 'open' : ''}><summary>Full extraction</summary>
        <p class="hint">Every sample, organised to use outside (R, Python, Excel): the inputs (value of each uncertain parameter by sample, item and year), the outputs (objective and every result kept, by sample and index) and statistics over the samples. Each table starts with case, run, base scenarios and sample, so several runs can be stacked. A zip of CSV files, with a README.</p>
        <label>Layout<select id="fxl"><option value="long" ${R.fullWide ? '' : 'selected'}>Long: one value per line (YEAR a column)</option><option value="wide" ${R.fullWide ? 'selected' : ''}>Wide: years as columns</option></select></label>
        <div class="regs"><label class="chk"><input type="checkbox" id="fxi" checked> inputs</label><label class="chk"><input type="checkbox" id="fxo" checked> outputs</label><label class="chk"><input type="checkbox" id="fxs" checked> statistics</label></div>
        <div class="acts"><button class="btn pri" id="fxgo" type="button">Make the zip</button></div><div id="fxres" class="small"></div></details></aside>
    <section class="mcrmain">
      <div class="mvtabs"><span class="seg">${[
        ['overview', 'Overview'],
        ['items', 'By ' + (R.by2 || 'item').toLowerCase()],
        ['mix', 'Mix at percentiles'],
        ['runs', 'Runs compared'],
        ['map', 'Probability map']
      ]
        .map(([k, l]) => `<button type="button" data-mv="${k}" aria-pressed="${(R.mview || 'overview') === k}">${esc(l)}</button>`)
        .join('')}</span>
        ${R.hl != null && a.ks && a.ks.includes(R.hl) ? `<span class="hlchip">Sample ${R.hl + 1} highlighted <button type="button" class="lnk" id="hlx">Clear</button></span>` : ''}${keepSet ? `<span class="hlchip">${keepSet.length} of ${a0.n} samples kept</span>` : ''}</div>
      <div id="mvx" ${(R.mview || 'overview') === 'overview' ? 'hidden' : ''}></div>
      <div id="mvov" ${(R.mview || 'overview') === 'overview' ? '' : 'hidden'}>
      ${a.noneKept ? '<div class="ck warn"><div class="ck-d">No sample meets the conditions in "Samples kept".</div></div>' : ''}
      ${a.none ? `<div class="ck warn"><div class="ck-d">Nothing is selected in ${esc(a.none)}: tick at least one member (or "all").</div></div>` : ''}
      ${same ? `<div class="ck info"><div class="ck-d">${esc(focusLab)} is the same in every sample (${f4(rk.mean)}${u}): the uncertain parameters do not change it with these filters (e.g. total production is set by the demand). Split by technology, filter one item, or pick another year or variable.</div></div>` : ''}
      <div class="mcfocus muted small">Numbers below: <b>${esc(vlabel(R.var))}</b>, ${esc(focusLab)}${
        Object.keys(flt).length
          ? ', filtered (' +
            Object.entries(flt)
              .map(([k, v]) => `${k}: ${v.length > 3 ? v.length + ' members' : v.join(', ')}`)
              .join('; ') +
            ')'
          : ''
      }${u}</div>
      <div class="mcstats">${tiles.map(([k, v]) => `<div><span class="muted">${k}</span><b>${v}</b></div>`).join('')}</div>
      ${
        a.members && a.members.length > 1
          ? `<div class="rch"><div class="rch-h">${
              R.along === 'YEAR'
                ? `<span class="seg">${[
                    ['both', 'paths + bands'],
                    ['paths', 'paths'],
                    ['bands', 'bands'],
                    ['box', 'box per year'],
                    ['violin', 'violin per year']
                  ]
                    .map(([k, l]) => `<button type="button" data-view="${k}" aria-pressed="${R.view === k}">${l}</button>`)
                    .join('')}</span>`
                : ''
            }</div><div id="ra"></div></div>`
          : ''
      }
      <div class="rrow"><div class="rch"><div class="rch-h"><span class="seg">${[
        ['hist', 'histogram + density'],
        ['cdf', 'cumulative']
      ]
        .map(([k, l]) => `<button type="button" data-dist="${k}" aria-pressed="${(R.dist || 'hist') === k}">${l}</button>`)
        .join(
          ''
        )}</span></div><div id="rd"></div></div><div class="rch"><div id="re"></div><div class="rexc"><label>Probability that the value is above <input id="rthr" placeholder="${f4(rk.p50)}"></label> <b id="rthrv"></b></div></div></div>
      <div class="rch"><div class="rch-t">Value not exceeded with probability…</div><div class="tw"><table class="grid ptab"><thead><tr>${P.map(p => `<th>${p} %</th>`).join('')}<th>Mean</th></tr></thead><tbody><tr>${P.map(p => `<td>${f4((a.percentiles || {})[p])}</td>`).join('')}<td>${f4(rk.mean)}</td></tr></tbody></table></div></div>
      <div class="rch"><div class="rch-t">Convergence: is the number of samples enough?</div><div id="rcv"></div><div class="muted small" id="rcvi"></div></div>
      ${a.breakdown ? `<div class="rch"><div id="rb"></div></div>` : ''}
      <div class="rrow"><div class="rch"><div class="rch-h"><span class="seg">${[
        ['rank', 'rank correlation'],
        ['share', 'share of variance']
      ]
        .map(([k, l]) => `<button type="button" data-sens="${k}" aria-pressed="${(R.sens || 'rank') === k}">${l}</button>`)
        .join(
          ''
        )}</span></div><div id="rs"></div></div><div class="rch rscat"><div class="rch-t">Input against result, sample by sample</div>
        <div class="row2 rscfg"><label>Uncertain parameter<select id="scf"><option>…</option></select></label><label>Item<select id="sci"><option value="">All its values</option></select></label></div>
        <div class="row2 rscfg"><label>Year of the input<select id="scy"><option value="">All years</option></select></label><label>X axis${opt(
          'scx',
          [
            ['value', 'the parameter value'],
            ['multiplier', 'the draw (multiplier)']
          ],
          R.sc.xas
        )}</label></div>
        <label class="chk"><input type="checkbox" id="scd" ${R.sc.diag ? 'checked' : ''}> line y = x (when both have the same unit, e.g. new capacity vs its upper limit)</label>
        <div id="rx"></div><div class="muted small" id="rxinfo"></div></div></div>
      ${a.members && a.members.length > 1 ? `<details><summary>Percentiles along ${esc(R.along)}</summary><div class="tw"><table class="grid ptab"><thead><tr><th class="k">${esc(R.along)}</th>${['1', '5', '25', '50', '75', '95', '99'].map(p => `<th>${p} %</th>`).join('')}<th>Mean</th><th>SD</th></tr></thead><tbody>${a.members.map((m, i) => `<tr><td class="k">${esc(m)}</td>${['1', '5', '25', '50', '75', '95', '99'].map(p => `<td>${f4(a.bands[p][i])}</td>`).join('')}<td>${f4(a.mean[i])}</td><td>${f4(a.sd[i])}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
      </div></section></div>`;
  const redo = () => {
    keep();
    R.pageScroll = (B.closest('#mcview') || document.scrollingElement).scrollTop;
    mcResultsTab(B);
  };
  if (R.pageScroll != null) {
    const sc = B.closest('#mcview') || document.scrollingElement;
    sc.scrollTop = R.pageScroll;
  }
  const keep = () => {
    R.open = [...B.querySelectorAll('.mcflt[open]')].map(x => x.dataset.fd);
    R.scroll = {};
    B.querySelectorAll('.mcflt').forEach(x => {
      const f = x.querySelector('.fbox');
      if (f) R.scroll[x.dataset.fd] = f.scrollTop;
    });
  };
  const on = (id, fn) => {
    const e = B.querySelector('#' + id);
    if (e) e.onchange = fn;
  };
  // views, samples kept (F1), highlighted sample (F2)
  B.querySelectorAll('[data-mv]').forEach(
    b =>
      (b.onclick = () => {
        R.mview = b.dataset.mv;
        B.querySelectorAll('[data-mv]').forEach(x => x.setAttribute('aria-pressed', x === b));
        B.querySelector('#mvov').hidden = R.mview !== 'overview';
        B.querySelector('#mvx').hidden = R.mview === 'overview';
        if (R.mview !== 'overview') mcView(B, R, {a, a0, dims, mem, flt, u, focusLab, runs});
      })
  );
  {
    const hx = B.querySelector('#hlx');
    if (hx)
      hx.onclick = () => {
        R.hl = null;
        redo();
      };
  }
  {
    const rs = B.querySelector('.rsamp');
    rs.ontoggle = () => {
      R.sampOpen = rs.open;
    };
    rs.querySelectorAll('[data-cdel]').forEach(
      b =>
        (b.onclick = () => {
          R.cond.splice(+b.dataset.cdel, 1);
          redo();
        })
    );
    const add = (lo, hi) => {
      const src = B.querySelector('#csrc').value;
      R.cond.push({
        run: R.run,
        src,
        lo: lo === '' || lo == null ? null : +lo,
        hi: hi === '' || hi == null ? null : +hi,
        var: R.var,
        focus: R.focus
      });
      redo();
    };
    B.querySelector('#cadd').onclick = () => {
      const lo = B.querySelector('#clo').value,
        hi = B.querySelector('#chi').value;
      if (lo === '' && hi === '') return toast('Give a minimum, a maximum or both');
      add(lo, hi);
    };
    rs.querySelectorAll('[data-cq]').forEach(
      b =>
        (b.onclick = () => {
          const v = mcCondValues(B.querySelector('#csrc').value, a0)
            .filter(x => x != null)
            .sort((p, q) => p - q);
          if (!v.length) return;
          const q = v[Math.floor((b.dataset.cq === 'top' ? 0.9 : 0.1) * (v.length - 1))];
          b.dataset.cq === 'top' ? add(q, null) : add(null, q);
        })
    );
    const cc = B.querySelector('#cclr');
    if (cc)
      cc.onclick = () => {
        R.cond = [];
        redo();
      };
  }
  if ((R.mview || 'overview') !== 'overview') mcView(B, R, {a, a0, dims, mem, flt, u, focusLab, runs});
  on('rrun', e => {
    R.run = e.target.value;
    R.filters = {};
    R.sc = {xas: 'value'};
    redo();
  });
  on('rvar', e => {
    R.var = e.target.value;
    R.filters = {};
    R.breakdown = undefined;
    redo();
  });
  on('ralong', e => {
    R.along = e.target.value;
    redo();
  });
  on('rfocus', e => {
    R.focus = e.target.value;
    redo();
  });
  on('rbreak', e => {
    R.breakdown = e.target.value;
    redo();
  });
  on('rdiv', e => {
    R.divide = Number(e.target.value) || 1;
    redo();
  });
  on('rnp', e => {
    R.np = e.target.value;
    drawAlong();
  });
  on('rbmax', e => {
    R.bmax = e.target.value;
    redo();
  });
  B.querySelectorAll('[data-dist]').forEach(
    b =>
      (b.onclick = () => {
        R.dist = b.dataset.dist;
        B.querySelectorAll('[data-dist]').forEach(x => x.setAttribute('aria-pressed', x === b));
        drawDist();
      })
  );
  B.querySelectorAll('[data-sens]').forEach(
    b =>
      (b.onclick = () => {
        R.sens = b.dataset.sens;
        B.querySelectorAll('[data-sens]').forEach(x => x.setAttribute('aria-pressed', x === b));
        drawSens();
      })
  );
  on('runit', e => {
    R.unit = e.target.value;
    redo();
  });
  B.querySelectorAll('[data-view]').forEach(
    b =>
      (b.onclick = () => {
        R.view = b.dataset.view;
        B.querySelectorAll('[data-view]').forEach(x => x.setAttribute('aria-pressed', x === b));
        drawAlong();
      })
  );
  const readF = d => {
    const all = mem.members[d] || [],
      onl = [...B.querySelectorAll(`[data-f="${d}"]:checked`)].map(x => x.value);
    if (onl.length === all.length) delete R.filters[d];
    else R.filters[d] = onl;
    const c = B.querySelector(`.mcflt[data-fd="${d}"] .fcount`);
    if (c) c.textContent = onl.length === all.length ? 'all ' + all.length : onl.length + ' of ' + all.length;
    clearTimeout(MCV.ft);
    MCV.ft = setTimeout(redo, 700);
  };
  B.querySelectorAll('[data-f]').forEach(c => (c.onchange = () => readF(c.dataset.f)));
  B.querySelectorAll('.mcflt').forEach(x => {
    const d = x.dataset.fd;
    x.ontoggle = () => {
      R.open = [...B.querySelectorAll('.mcflt[open]')].map(y => y.dataset.fd);
    };
    x.querySelector('.fq').oninput = e => {
      const q = e.target.value.toLowerCase();
      x.querySelectorAll('.frow').forEach(l => (l.hidden = q && !l.dataset.m.includes(q)));
    };
    x.querySelectorAll('[data-fa]').forEach(
      bt =>
        (bt.onclick = () => {
          x.querySelectorAll('.frow').forEach(l => {
            if (l.hidden) return;
            const i = l.querySelector('input');
            i.checked = bt.dataset.fa === 'all' ? true : bt.dataset.fa === 'none' ? false : !i.checked;
          });
          readF(d);
        })
    );
    x.querySelectorAll('[data-only]').forEach(
      bt =>
        (bt.onclick = () => {
          x.querySelectorAll('[data-f]').forEach(i => (i.checked = i.value === bt.dataset.only));
          readF(d);
        })
    );
    const f = x.querySelector('.fbox');
    if (f && R.scroll && R.scroll[d]) f.scrollTop = R.scroll[d];
  });
  // exports: every sample, statistics, percentiles, split, sensitivity, input against result
  const sheets = () => {
    const names = a.factor_names || [];
    const head = [
      'sample',
      `${vlabel(R.var)} · ${focusLab}`,
      ...names.map(n => 'factor (mean draw): ' + n),
      ...(a.members || []).map(m => `${R.along} ${m}`)
    ];
    const rows = (a.totals || []).map((t2, i) => [
      (a.ks || [])[i] + 1,
      t2,
      ...((a.factor_values || [])[i] || []),
      ...((a.paths || [])[i] || [])
    ]);
    const out = [
      {name: 'Samples', rows: [head, ...rows]},
      {name: 'Statistics', rows: [['statistic of ' + focusLab, 'value'], ...Object.entries(rk).map(([k, v]) => [k, v])]},
      {name: 'Probabilities', rows: [['probability of not being exceeded (%)', 'value'], ...P.map(p => [+p, (a.percentiles || {})[p]])]}
    ];
    if ((a.members || []).length > 1)
      out.push({
        name: 'Along ' + R.along,
        rows: [
          [R.along, 'mean', 'sd', ...Object.keys(a.bands).map(p => 'p' + p)],
          ...a.members.map((m, i) => [isNaN(+m) ? m : +m, a.mean[i], a.sd[i], ...Object.keys(a.bands).map(p => a.bands[p][i])])
        ]
      });
    if (a.breakdown)
      out.push({
        name: 'Split by ' + a.breakdown.set,
        rows: [
          [a.breakdown.set, 'mean', 'p5', 'p25', 'p50', 'p75', 'p95'],
          ...a.breakdown.members.map((m, i) => [
            m,
            a.breakdown.mean[i],
            a.breakdown.p5[i],
            a.breakdown.p25[i],
            a.breakdown.p50[i],
            a.breakdown.p75[i],
            a.breakdown.p95[i]
          ])
        ]
      });
    out.push({
      name: 'Sensitivity',
      rows: [['uncertain parameter', 'rank correlation with ' + focusLab], ...(a.sensitivity || []).map(x => [x.factor, x.spearman])]
    });
    if (MCV.scat)
      out.push({
        name: 'Input vs result',
        rows: [['sample', MCV.scat.xlab, MCV.scat.ylab], ...MCV.scat.x.map((v, i) => [(a.ks || [])[i] + 1, v, MCV.scat.y[i]])]
      });
    return out;
  };
  {
    const fr = B.querySelector('.rfull');
    fr.ontoggle = () => {
      R.fullOpen = fr.open;
    };
    B.querySelector('#fxl').onchange = e => {
      R.fullWide = e.target.value === 'wide';
    };
    B.querySelector('#fxgo').onclick = async () => {
      const box = B.querySelector('#fxres'),
        bt = B.querySelector('#fxgo');
      bt.disabled = true;
      box.innerHTML = '<span class="muted">writing every sample… (large runs take a minute)</span>';
      const r = await jp(`/api/mc/${R.run}/export`, {
        wide: B.querySelector('#fxl').value === 'wide',
        inputs: B.querySelector('#fxi').checked,
        outputs: B.querySelector('#fxo').checked,
        stats: B.querySelector('#fxs').checked
      }).catch(e => ({error: e.message}));
      bt.disabled = false;
      if (!r || r.error || !r.ok) {
        box.innerHTML = `<div class="ck error"><div class="ck-d">${esc((r && r.error) || 'failed')}</div></div>`;
        return;
      }
      box.innerHTML = `<p><b>${esc(r.name)}</b> · ${(r.size / 1048576).toFixed(1)} MB · ${r.files.length} tables</p><div class="acts"><a class="btn" href="${r.url}" download="${esc(r.name)}">Download</a><button class="btn" type="button" id="fxfold">Open the folder</button></div><p class="hint muted">Also kept in the run's folder (exports).</p>`;
      B.querySelector('#fxfold').onclick = () => jp(`/api/mc/${R.run}/reveal`, {}).catch(() => toast('Could not open the folder'));
    };
  }
  B.querySelector('#rxlsx').onclick = () => saveFile(`${R.run}_${R.var}.xlsx`, makeXlsx(sheets()), XLSX_MIME);
  B.querySelector('#rcsv').onclick = () => {
    const s = sheets()[0].rows;
    saveFile(
      `${R.run}_${R.var}.csv`,
      s.map(r => r.map(v => (typeof v === 'string' && /[,"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')).join('\n'),
      'text/csv'
    );
  };
  if (!a.n) return;
  await needLib('plotly');
  if (!B.isConnected) return;
  const pal = PAL[isDark() ? 'dark' : 'light'],
    c1 = pal[0],
    c2 = pal[1],
    ink = isDark() ? '#e6e5e1' : '#2f3437',
    dark = isDark();
  const vline = (v, c, d, lab) => ({
    type: 'line',
    x0: v,
    x1: v,
    y0: 0,
    y1: 1,
    yref: 'paper',
    line: {color: c, width: 1.5, dash: d},
    label: lab ? {text: lab, textposition: 'end', font: {size: 10, color: c}} : undefined
  });
  // 1. along the X axis: spaghetti of every sample (years) or the spread per member
  function drawAlong() {
    const el = B.querySelector('#ra');
    if (!el || !a.members) return;
    const x = a.members,
      isY = R.along === 'YEAR';
    if (isY && (R.view === 'box' || R.view === 'violin')) {
      const xs = [],
        ys = [];
      a.paths.forEach(pth =>
        pth.forEach((v, j) => {
          xs.push(x[j]);
          ys.push(v);
        })
      );
      const tr = [
        {
          type: R.view,
          x: xs,
          y: ys,
          name: 'samples',
          marker: {color: c1, size: 3},
          line: {color: c1, width: 1},
          fillcolor: c1 + '33',
          boxpoints: false,
          points: false,
          box: {visible: true},
          meanline: {visible: true},
          spanmode: 'hard',
          hoverinfo: 'y'
        },
        {x, y: a.mean, mode: 'lines', line: {color: c2, width: 2}, name: 'mean'}
      ];
      Plotly.react(
        el,
        tr,
        pvLayout(`${esc(vlabel(R.var))}: the distribution in each year (${a.paths.length} samples)${u ? ' ·' + u : ''}`, {
          height: 420,
          showlegend: true,
          legend: {orientation: 'h', y: -0.12},
          xaxis: {type: 'category'}
        }),
        PVCFG
      );
      return;
    }
    if (isY) {
      const sh = mcPick(a.paths.length, R.np),
        np = sh.length,
        op = Math.max(0.05, Math.min(0.5, 12 / Math.max(1, np))),
        tr = [];
      if (R.view !== 'bands' && np) {
        const px = [],
          py = [],
          pc = [],
          pt = [];
        sh.forEach(i => {
          x.forEach((xx, j) => {
            px.push(xx);
            py.push(a.paths[i][j]);
            pc.push(a.ks[i]);
            pt.push('sample ' + (a.ks[i] + 1));
          });
          px.push(null);
          py.push(null);
          pc.push(null);
          pt.push('');
        });
        tr.push({
          x: px,
          y: py,
          mode: 'lines',
          line: {color: c1, width: 0.8},
          opacity: op,
          customdata: pc,
          text: pt,
          connectgaps: false,
          hovertemplate: '%{text}: %{y:.4g}<extra></extra>',
          name: `samples (${np}${np < a.paths.length ? ' of ' + a.paths.length : ''}) · click one to follow it`
        });
      }
      if (R.view !== 'paths')
        tr.push(
          {x, y: a.bands['95'], mode: 'lines', line: {width: 0}, hoverinfo: 'skip', showlegend: false},
          {
            x,
            y: a.bands['5'],
            mode: 'lines',
            line: {width: 0},
            fill: 'tonexty',
            fillcolor: c1 + (R.view === 'bands' ? '33' : '14'),
            name: '5–95 %',
            hovertemplate: '5 %: %{y:.4g}<extra></extra>'
          },
          {x, y: a.bands['75'], mode: 'lines', line: {width: 0}, hoverinfo: 'skip', showlegend: false},
          {
            x,
            y: a.bands['25'],
            mode: 'lines',
            line: {width: 0},
            fill: 'tonexty',
            fillcolor: c1 + (R.view === 'bands' ? '55' : '22'),
            name: '25–75 %',
            hovertemplate: '25 %: %{y:.4g}<extra></extra>'
          }
        );
      tr.push(
        {
          x,
          y: a.bands['5'],
          mode: 'lines',
          line: {color: ink, width: 1, dash: 'dot'},
          name: '5 % and 95 %',
          hovertemplate: '5 %: %{y:.4g}<extra></extra>'
        },
        {
          x,
          y: a.bands['95'],
          mode: 'lines',
          line: {color: ink, width: 1, dash: 'dot'},
          showlegend: false,
          hovertemplate: '95 %: %{y:.4g}<extra></extra>'
        },
        {
          x,
          y: a.bands['50'],
          mode: 'lines',
          line: {color: c2, width: 2.5},
          name: 'median',
          hovertemplate: 'median: %{y:.4g}<extra></extra>'
        },
        {
          x,
          y: a.mean,
          mode: 'lines',
          line: {color: ink, width: 1.5, dash: 'dash'},
          name: 'mean',
          hovertemplate: 'mean: %{y:.4g}<extra></extra>'
        }
      );
      const hi_ = R.hl != null ? a.ks.indexOf(R.hl) : -1;
      if (hi_ >= 0 && a.paths[hi_])
        tr.push({
          x,
          y: a.paths[hi_],
          mode: 'lines+markers',
          line: {color: '#d03b3b', width: 3},
          marker: {size: 4},
          name: `sample ${R.hl + 1}`,
          hovertemplate: `sample ${R.hl + 1}: %{y:.4g}<extra></extra>`
        });
      Plotly.react(
        el,
        tr,
        pvLayout(`${esc(vlabel(R.var))} over the years: every sample${u ? ' ·' + u : ''}`, {
          height: 400,
          showlegend: true,
          legend: {orientation: 'h', y: -0.12},
          hovermode: 'x unified',
          xaxis: {type: 'linear'},
          shapes: !['sum', 'mean'].includes(R.focus) ? [vline(R.focus, '#9b9a97', 'dot')] : []
        }),
        PVCFG
      );
    } else
      Plotly.react(
        el,
        [
          {
            type: 'box',
            x,
            q1: a.bands['25'],
            median: a.bands['50'],
            q3: a.bands['75'],
            lowerfence: a.bands['5'],
            upperfence: a.bands['95'],
            mean: a.mean,
            marker: {color: c1},
            line: {color: c1},
            fillcolor: c1 + '33',
            name: '',
            hovertemplate: '%{x}<extra></extra>'
          }
        ],
        pvLayout(
          `${esc(vlabel(R.var))} by ${esc(R.along)}${hasY ? ' · ' + esc(focusLab) : ''}: box 25–75 %, whiskers 5–95 %, median, mean (dashed)${u ? ' ·' + u : ''}`,
          {height: 420, margin: {t: 34, l: 60, r: 12, b: 110}, xaxis: {type: 'category', tickangle: -50, automargin: true}}
        ),
        PVCFG
      );
  }
  drawAlong();
  {
    const el = B.querySelector('#ra');
    if (el && el.on)
      el.on('plotly_click', d => {
        const k = d && d.points && d.points[0] && d.points[0].customdata;
        if (k != null && k !== R.hl) {
          R.hl = +k;
          redo();
        }
      });
  }
  // 2. distribution and exceedance of the focus number
  const T = a.totals || [],
    srt = [...T].sort((p, q) => p - q),
    n = srt.length;
  const marks = () => [
    vline(rk.p5, '#9b9a97', 'dot', '5 %'),
    vline(rk.p50, ink, 'solid', 'median'),
    vline(rk.mean, c2, 'dash', 'mean'),
    vline(rk.p95, '#9b9a97', 'dot', '95 %'),
    vline(rk.CVaR95, c2, 'dot', 'CVaR 95'),
    ...(R.hl != null && a.ks.includes(R.hl) ? [vline(T[a.ks.indexOf(R.hl)], '#d03b3b', 'solid', 'sample ' + (R.hl + 1))] : [])
  ];
  function drawDist() {
    if (same) {
      B.querySelector('#rd').innerHTML = `<div class="empty">Every sample gives ${f4(rk.mean)}${u}: no spread to draw.</div>`;
      return;
    }
    if ((R.dist || 'hist') === 'cdf') {
      Plotly.react(
        'rd',
        [
          {
            x: srt,
            y: srt.map((_, i) => (i + 1) / n),
            mode: 'lines',
            line: {color: c1, width: 2, shape: 'hv'},
            name: 'samples',
            hovertemplate: 'P(value ≤ %{x:.4g}) = %{y:.0%}<extra></extra>'
          }
        ],
        pvLayout(`Cumulative distribution of ${esc(focusLab)}${u}`, {
          height: 320,
          yaxis: {tickformat: '.0%', range: [0, 1.02]},
          shapes: marks()
        }),
        PVCFG
      );
      return;
    }
    const K = mcKde(srt),
      nb = Math.min(60, Math.max(10, Math.round(Math.sqrt(n) * 2)));
    Plotly.react(
      'rd',
      [
        {
          type: 'histogram',
          x: T,
          histnorm: 'probability density',
          marker: {color: c1 + 'aa', line: {color: dark ? '#191919' : '#fff', width: 1}},
          nbinsx: nb,
          name: 'samples',
          hovertemplate: '%{x}: density %{y:.3g}<extra></extra>'
        },
        ...(K ? [{x: K.x, y: K.y, mode: 'lines', line: {color: c2, width: 2}, name: 'density (kernel)', hoverinfo: 'skip'}] : [])
      ],
      pvLayout(`Distribution of ${esc(focusLab)}${u}`, {
        height: 320,
        bargap: 0.02,
        showlegend: false,
        yaxis: {title: {text: 'density', font: {size: 11}}},
        shapes: marks()
      }),
      PVCFG
    );
  }
  drawDist();
  // convergence: running mean with its 95 % interval, running 5 % and 95 % (samples in the order they were drawn)
  {
    const v = T.map(Number),
      K = v.length;
    if (K > 2 && !same) {
      const cp = [...new Set(Array.from({length: Math.min(80, K)}, (_, i) => Math.max(2, Math.round(((i + 1) * K) / Math.min(80, K)))))];
      const mm = [],
        lo = [],
        hi = [],
        p5 = [],
        p95 = [];
      for (const k of cp) {
        const s_ = v.slice(0, k),
          m = s_.reduce((x, y) => x + y, 0) / k,
          sd = Math.sqrt(s_.reduce((x, y) => x + (y - m) ** 2, 0) / (k - 1)),
          o = [...s_].sort((x, y) => x - y),
          q = f => o[Math.min(k - 1, Math.max(0, Math.round(f * (k - 1))))];
        mm.push(m);
        lo.push(m - (1.96 * sd) / Math.sqrt(k));
        hi.push(m + (1.96 * sd) / Math.sqrt(k));
        p5.push(q(0.05));
        p95.push(q(0.95));
      }
      Plotly.react(
        'rcv',
        [
          {x: cp, y: hi, mode: 'lines', line: {width: 0}, hoverinfo: 'skip', showlegend: false},
          {
            x: cp,
            y: lo,
            mode: 'lines',
            line: {width: 0},
            fill: 'tonexty',
            fillcolor: c1 + '33',
            name: '95 % interval of the mean',
            hoverinfo: 'skip'
          },
          {
            x: cp,
            y: mm,
            mode: 'lines',
            line: {color: c1, width: 2},
            name: 'running mean',
            hovertemplate: '%{x} samples: mean %{y:.4g}<extra></extra>'
          },
          {
            x: cp,
            y: p5,
            mode: 'lines',
            line: {color: '#9b9a97', width: 1, dash: 'dot'},
            name: 'running 5 % / 95 %',
            hovertemplate: '%{x} samples: 5 % %{y:.4g}<extra></extra>'
          },
          {
            x: cp,
            y: p95,
            mode: 'lines',
            line: {color: '#9b9a97', width: 1, dash: 'dot'},
            showlegend: false,
            hovertemplate: '%{x} samples: 95 % %{y:.4g}<extra></extra>'
          }
        ],
        pvLayout(`${esc(focusLab)} as samples are added${u}`, {
          height: 300,
          showlegend: true,
          legend: {orientation: 'h', y: -0.2},
          xaxis: {title: {text: 'samples', font: {size: 11}}}
        }),
        PVCFG
      );
      const half = (hi[hi.length - 1] - lo[lo.length - 1]) / 2,
        rel = mm[mm.length - 1] ? Math.abs(half / mm[mm.length - 1]) : 0;
      B.querySelector('#rcvi').textContent =
        `Mean ${f4(mm[mm.length - 1])}${u} ± ${f4(half)} (95 %), that is ± ${(100 * rel).toFixed(2)} %. ${rel < 0.01 ? 'Enough samples for the mean.' : rel < 0.05 ? 'Acceptable; more samples would narrow it.' : 'Too wide: run more samples.'} The 5 % and 95 % lines should be flat at the end too.`;
    } else {
      const e = B.querySelector('#rcv');
      if (e) e.innerHTML = '<div class="empty">Needs three samples or more with a spread.</div>';
    }
  }
  Plotly.react(
    're',
    [
      {
        x: srt,
        y: srt.map((_, i) => 1 - i / n),
        mode: 'lines',
        line: {color: c1, width: 2, shape: 'hv'},
        hovertemplate: 'P(value ≥ %{x:.4g}) = %{y:.0%}<extra></extra>'
      }
    ],
    pvLayout(`Exceedance: probability of being at or above a value${u}`, {
      height: 300,
      yaxis: {tickformat: '.0%', range: [0, 1.02]},
      shapes: [
        {type: 'line', x0: srt[0], x1: srt[n - 1], y0: 0.05, y1: 0.05, line: {color: '#9b9a97', width: 1, dash: 'dot'}},
        {type: 'line', x0: srt[0], x1: srt[n - 1], y0: 0.5, y1: 0.5, line: {color: '#9b9a97', width: 1, dash: 'dot'}}
      ]
    }),
    PVCFG
  );
  const thr = B.querySelector('#rthr');
  thr.oninput = () => {
    const t = Number(thr.value);
    B.querySelector('#rthrv').textContent =
      thr.value === '' || isNaN(t) ? '' : `${((100 * T.filter(v => v > t).length) / n).toFixed(1)} % of the samples`;
  };
  // 3. split by a set: one distribution per member
  if (a.breakdown) {
    const b = a.breakdown;
    Plotly.react(
      'rb',
      [
        {
          type: 'box',
          x: b.members,
          q1: b.p25,
          median: b.p50,
          q3: b.p75,
          lowerfence: b.p5,
          upperfence: b.p95,
          mean: b.mean,
          marker: {color: c1},
          line: {color: c1},
          fillcolor: c1 + '33',
          name: '',
          hovertemplate: '%{x}<extra></extra>'
        }
      ],
      pvLayout(
        `${esc(vlabel(R.var))} by ${esc(b.set)} · ${esc(focusLab)}: one distribution each (box 25–75 %, whiskers 5–95 %)${b.total_members > b.members.length ? ` · the ${b.members.length} largest of ${b.total_members}` : ''}${u ? ' ·' + u : ''}`,
        {height: 420, margin: {t: 34, l: 60, r: 12, b: 110}, xaxis: {type: 'category', tickangle: -50, automargin: true}}
      ),
      PVCFG
    );
  }
  // 4. sensitivity: rank correlations; input against result, sample by sample
  const S = (a.sensitivity || []).slice().sort((p, q) => Math.abs(p.spearman) - Math.abs(q.spearman));
  function drawSens() {
    if (!S.length) return;
    const sh = (R.sens || 'rank') === 'share',
      tot = S.reduce((x, s_) => x + s_.spearman ** 2, 0) || 1;
    const xv = S.map(s_ => (sh ? (100 * s_.spearman ** 2) / tot : s_.spearman));
    Plotly.react(
      'rs',
      [
        {
          type: 'bar',
          orientation: 'h',
          y: S.map(s_ => s_.factor),
          x: xv,
          marker: {color: S.map(s_ => (s_.spearman >= 0 ? c1 : c2))},
          text: xv.map(v => (sh ? v.toFixed(1) + ' %' : v.toFixed(2))),
          textposition: 'auto',
          hovertemplate: sh ? '%{y}: %{x:.1f} % of the explained variance<extra></extra>' : '%{y}: %{x:.2f}<extra></extra>'
        }
      ],
      pvLayout(
        sh
          ? `Share of the explained variance of ${esc(focusLab)} (squared rank correlations; blue raises, orange lowers)`
          : `Which uncertainty drives ${esc(focusLab)}: rank correlation`,
        {
          height: Math.max(220, 90 + 34 * S.length),
          xaxis: sh ? {range: [0, 100], ticksuffix: ' %'} : {range: [-1, 1], zeroline: true, zerolinecolor: '#9b9a97'},
          margin: {t: 34, l: 170, r: 16, b: 30}
        }
      ),
      PVCFG
    );
  }
  drawSens();
  MCV.inCat = MCV.inCat || {};
  if (!MCV.inCat[R.run]) MCV.inCat[R.run] = (await jp(`/api/mc/${R.run}/inputs`, {}).catch(() => ({inputs: []}))).inputs || [];
  const IC = MCV.inCat[R.run];
  if (!B.isConnected) return;
  const scf = B.querySelector('#scf'),
    sci = B.querySelector('#sci'),
    scy = B.querySelector('#scy');
  if (!IC.length) {
    B.querySelector('.rscat').innerHTML = '<div class="empty">The inputs of this run cannot be read again.</div>';
    return;
  }
  if (R.sc.factor == null || !IC[R.sc.factor]) R.sc.factor = (S.length ? S[S.length - 1].index : 0) || 0;
  const fill = () => {
    const c = IC[R.sc.factor];
    scf.innerHTML = IC.map(
      x => `<option value="${x.index}" ${x.index === +R.sc.factor ? 'selected' : ''}>${esc(x.name)} (${esc(x.param)})</option>`
    ).join('');
    if (R.sc.item && !c.items.includes(R.sc.item)) R.sc.item = '';
    sci.innerHTML =
      `<option value="">All its values (${c.n_items})</option>` +
      c.items.map(i => `<option ${i === R.sc.item ? 'selected' : ''}>${esc(i)}</option>`).join('');
    if (!c.has_year) R.sc.year = '';
    else if (R.sc.year == null) R.sc.year = !['sum', 'mean'].includes(R.focus) ? String(R.focus) : '';
    scy.innerHTML =
      `<option value="">All years</option>` +
      c.years.map(y => `<option ${String(y) === String(R.sc.year) ? 'selected' : ''}>${esc(y)}</option>`).join('');
    scy.disabled = !c.has_year;
  };
  const scat = async () => {
    const c = IC[R.sc.factor];
    const iv = await jp(`/api/mc/${R.run}/input`, {factor: R.sc.factor, item: R.sc.item || null, year: R.sc.year || null, ks: a.ks}).catch(
      e => ({error: e.message})
    );
    const info = B.querySelector('#rxinfo');
    if (!info) return;
    if (iv.error) {
      B.querySelector('#rx').innerHTML = '';
      info.textContent = iv.error;
      return;
    }
    const X = R.sc.xas === 'multiplier' ? iv.multiplier : iv.values,
      xl =
        R.sc.xas === 'multiplier'
          ? `draw of ${c.name} (multiplier)`
          : `${c.param}${R.sc.item ? ' · ' + R.sc.item : ''}${R.sc.year ? ' · ' + R.sc.year : ''} (${iv.how} of ${iv.n_values} value${iv.n_values > 1 ? 's' : ''})`;
    const yl = `${vlabel(R.var)} · ${focusLab}`;
    MCV.scat = {x: X, y: T, xlab: xl, ylab: yl};
    const rnk = v => {
      const o = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]),
        r = Array(v.length);
      o.forEach(([, i], k) => (r[i] = k));
      return r;
    };
    const rx = rnk(X),
      ry = rnk(T),
      mx = rx.reduce((s, v) => s + v, 0) / n,
      my = ry.reduce((s, v) => s + v, 0) / n;
    const cov = rx.reduce((s, v, i) => s + (v - mx) * (ry[i] - my), 0),
      sx = Math.sqrt(rx.reduce((s, v) => s + (v - mx) ** 2, 0)),
      sy = Math.sqrt(ry.reduce((s, v) => s + (v - my) ** 2, 0)),
      rho = sx && sy ? cov / sx / sy : 0;
    const lo = Math.min(...X, ...T),
      hi = Math.max(...X, ...T);
    const hj = R.hl != null ? (a.ks || []).indexOf(R.hl) : -1;
    Plotly.react(
      'rx',
      [
        {
          x: X,
          y: T,
          mode: 'markers',
          marker: {
            color: (a.ks || []).map(k => (k === R.hl ? '#d03b3b' : c1)),
            size: (a.ks || []).map(k => (k === R.hl ? 13 : 7)),
            opacity: 0.8,
            line: {color: dark ? '#191919' : '#fff', width: 1}
          },
          customdata: a.ks,
          text: (a.ks || []).map(k => 'sample ' + (k + 1)),
          hovertemplate: '%{text}<br>input %{x:.4g}<br>result %{y:.4g}<extra></extra>'
        },
        ...(R.sc.xas === 'value' && iv.base != null ? [] : [])
      ],
      pvLayout(`${esc(yl)} against the input`, {
        height: 340,
        xaxis: {title: {text: xl, font: {size: 11}}, gridcolor: dark ? '#2c2c2c' : '#eeede9'},
        yaxis: {title: {text: yl + u, font: {size: 11}}, gridcolor: dark ? '#2c2c2c' : '#eeede9'},
        shapes: [
          ...(R.sc.xas === 'value' ? [vline(iv.base, '#9b9a97', 'dash', 'base')] : [vline(1, '#9b9a97', 'dash', 'base')]),
          ...(R.sc.diag ? [{type: 'line', x0: lo, y0: lo, x1: hi, y1: hi, line: {color: c2, width: 1.5, dash: 'dot'}}] : [])
        ]
      }),
      PVCFG
    );
    {
      const rx = B.querySelector('#rx');
      if (rx && rx.on && !rx._hl) {
        rx._hl = 1;
        rx.on('plotly_click', d => {
          const k = d && d.points && d.points[0] && d.points[0].customdata;
          if (k != null && k !== R.hl) {
            R.hl = +k;
            redo();
          }
        });
      }
    }
    info.textContent = `Rank correlation ${rho.toFixed(2)} over ${n} samples. Base value of the input ${f4(iv.base)}. ${Math.abs(rho) < 0.2 ? 'Little effect: the result hardly follows this input (another constraint may be binding).' : rho > 0 ? 'The result rises with the input.' : 'The result falls when the input rises.'}`;
  };
  fill();
  scat();
  scf.onchange = () => {
    R.sc.factor = +scf.value;
    R.sc.item = '';
    R.sc.year = null;
    fill();
    scat();
  };
  sci.onchange = () => {
    R.sc.item = sci.value;
    scat();
  };
  scy.onchange = () => {
    R.sc.year = scy.value;
    scat();
  };
  B.querySelector('#scx').onchange = e => {
    R.sc.xas = e.target.value;
    scat();
  };
  B.querySelector('#scd').onchange = e => {
    R.sc.diag = e.target.checked;
    scat();
  };
}

/* ---------- results: samples kept (F1) and the other views ---------- */
function mcCondValues(src, a0) {
  if (src === 'obj') return a0.objectives || [];
  if (src === 'res') return a0.totals || [];
  const i = +String(src).split(':')[1];
  return (a0.factor_values || []).map(r => (r ? r[i] : null));
}
function mcKeep(cond, a0) {
  const ks = a0.ks || [];
  const V = cond.map(c => mcCondValues(c.src, a0));
  return ks.filter((k, j) =>
    cond.every((c, ci) => {
      const v = V[ci][j];
      return v != null && (c.lo == null || v >= c.lo) && (c.hi == null || v <= c.hi);
    })
  );
}
function mcCondLabel(c, a0) {
  const n =
    c.src === 'obj' ? 'objective' : c.src === 'res' ? 'result shown' : ((a0.factor_names || [])[+c.src.split(':')[1]] || c.src) + ' (draw)';
  const f = v => (+v).toLocaleString('en-US', {maximumFractionDigits: Math.abs(v) >= 100 ? 1 : 3});
  return `${n} ${c.lo != null && c.hi != null ? `between ${f(c.lo)} and ${f(c.hi)}` : c.lo != null ? `≥ ${f(c.lo)}` : `≤ ${f(c.hi)}`}`;
}

async function mcView(B, R, X) {
  const V = B.querySelector('#mvx');
  if (!V) return;
  const {a, dims, flt, u} = X,
    mv = R.mview;
  if (R.var === 'Objective' && mv !== 'runs') {
    V.innerHTML =
      '<div class="empty">Choose a result with years and items (e.g. NewCapacity) for this view; the objective has neither.</div>';
    return;
  }
  if (!dims.includes('YEAR') && mv !== 'runs') {
    V.innerHTML = '<div class="empty">This result has no years.</div>';
    return;
  }
  const sets = dims.filter(d => d !== 'YEAR');
  if (!sets.includes(R.by2)) R.by2 = sets.includes('TECHNOLOGY') ? 'TECHNOLOGY' : sets[0];
  await needLib('plotly');
  const pal = PAL[isDark() ? 'dark' : 'light'],
    dark = isDark(),
    ink = dark ? '#e6e5e1' : '#2f3437';
  const keep = MCV.keep || null,
    setSel =
      mv === 'runs'
        ? ''
        : `<label>Split by<select id="vby">${sets.map(d => `<option ${d === R.by2 ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select></label>`;
  if (mv === 'items') return mcViewItems(V, R, X, pal, ink, keep, setSel);
  if (mv === 'mix') return mcViewMix(V, R, X, pal, ink, keep, setSel);
  if (mv === 'map') return mcViewMap(V, R, X, pal, ink, keep, setSel);
  if (mv === 'runs') return mcViewRuns(V, R, X, pal, ink);
}
const mcSetSel = (X, R) => {
  const sets = X.dims.filter(d => d !== 'YEAR');
  return `<label>Split by<select id="vby">${sets.map(d => `<option ${d === R.by2 ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select></label>`;
};
const mcVby = (V, R, again) => {
  const s = V.querySelector('#vby');
  if (s)
    s.onchange = () => {
      R.by2 = s.value;
      again();
    };
};
const mcFlt = (X, R) => Object.fromEntries(Object.entries(X.flt).filter(([k]) => k !== 'YEAR')); // the years are the X axis here

/* V1: one small chart per item (technology...) over the years: bands, median, mean, paths; a reference run; the highlighted sample */
async function mcViewItems(V, R, X, pal, ink, keep, setSel) {
  setSel = mcSetSel(X, R);
  V.innerHTML = `<div class="mvbar">${setSel}<label>Scale<select id="vsc"><option value="own" ${R.vsc !== 'shared' ? 'selected' : ''}>Each chart its own</option><option value="shared" ${R.vsc === 'shared' ? 'selected' : ''}>The same for all</option></select></label><label>Reference run (dashed)<select id="vref"><option value="">None</option></select></label></div><div class="muted small">Reading…</div>`;
  const again = () =>
    mcViewItems(
      V,
      R,
      X,
      pal,
      ink,
      keep,
      setSel.replace(/selected/g, '').replace(`<option>${esc(R.by2)}</option>`, `<option selected>${esc(R.by2)}</option>`)
    );
  const c = await jp(`/api/mc/${R.run}/cube`, {var: R.var, filters: mcFlt(X, R), divide: R.divide, by: R.by2, mode: 'bands', keep}).catch(
    e => ({error: e.message})
  );
  if (c.error) {
    V.innerHTML = `<div class="ck error"><div class="ck-d">${esc(c.error)}</div></div>`;
    return;
  }
  const hl =
    R.hl != null && c.ks.includes(R.hl)
      ? await jp(`/api/mc/${R.run}/cube`, {
          var: R.var,
          filters: mcFlt(X, R),
          divide: R.divide,
          by: R.by2,
          mode: 'samples',
          ks: [R.hl],
          keep
        }).catch(() => null)
      : null;
  const runs = (await api('/api/runs').catch(() => [])).filter(r => r.state === 'done');
  R.vpick = R.vpick && R.vpick.by === R.by2 ? R.vpick : {by: R.by2, list: c.members.slice(0, 6)};
  const pick = R.vpick.list.filter(m => c.members.includes(m));
  V.innerHTML = `<div class="mvbar">${setSel}<label>Scale<select id="vsc"><option value="own" ${R.vsc !== 'shared' ? 'selected' : ''}>Each chart its own</option><option value="shared" ${R.vsc === 'shared' ? 'selected' : ''}>The same for all</option></select></label>
      <label>Reference run (dashed)<select id="vref"><option value="">None</option>${runs.map(r => `<option value="${esc(r.id)}" ${r.id === R.vref ? 'selected' : ''}>${esc(r.name || r.id)}</option>`).join('')}</select></label></div>
    <details class="pvisel" ${R.vpOpen ? 'open' : ''}><summary>${esc(R.by2.toLowerCase())}: ${pick.length} of ${c.members.length}${c.total_members > c.members.length ? ` (the ${c.members.length} largest of ${c.total_members})` : ''}</summary>
      <div class="fm-tools"><input type="search" class="vq" placeholder="Search"><button type="button" class="btn sm" data-va="1">All</button><button type="button" class="btn sm" data-va="0">None</button></div>
      <div class="sellist">${c.members.map(m => `<label class="selr" data-q="${esc(String(m).toLowerCase())}"><input type="checkbox" class="vpc" value="${esc(m)}" ${pick.includes(m) ? 'checked' : ''}><b>${esc(m)}</b><span>${esc(R.by2 === 'TECHNOLOGY' && TD[m] ? shortName(m) : '')}</span></label>`).join('')}</div></details>
    <p class="muted small">${esc(vlabel(R.var))} by ${esc(R.by2.toLowerCase())} over the years · ${c.n} samples · band 5–95 % and 25–75 %, median (line), mean (dotted), ${c.paths[0] ? c.paths[0].length : 0} sample paths${R.vref ? ', reference run dashed' : ''}${hl ? `, sample ${R.hl + 1} in red` : ''}${X.u ? ' ·' + X.u : ''}</p>
    <div class="vgrid">${pick.map((m, i) => `<div class="vcell" id="vc${i}"></div>`).join('') || '<div class="empty">Tick items to see them.</div>'}</div>`;
  let ref = null;
  if (R.vref) {
    try {
      const g = await getVar(R.vref, R.var),
        dd = g.dims || [],
        bi = dd.indexOf(R.by2),
        yi = dd.indexOf('YEAR');
      ref = {};
      const fx = Object.entries(mcFlt(X, R))
        .map(([k, v]) => [dd.indexOf(k), new Set(v.map(String))])
        .filter(([i]) => i >= 0);
      for (const r of g.rows || [])
        if (bi >= 0 && yi >= 0 && fx.every(([i, s]) => s.has(String(r[i])))) {
          const k = r[bi] + '|' + r[yi];
          ref[k] = (ref[k] || 0) + r[r.length - 1] / (+R.divide || 1);
        }
    } catch (e) {
      ref = null;
    }
  }
  const ymax = Math.max(0, ...c.members.flatMap((m, i) => (pick.includes(m) ? c.p95[i] : [])).flat()),
    c1 = pal[0];
  pick.forEach((m, j) => {
    const i = c.members.indexOf(m),
      x = c.years,
      tr = [];
    tr.push(
      {x, y: c.p95[i], mode: 'lines', line: {width: 0}, hoverinfo: 'skip', showlegend: false},
      {
        x,
        y: c.p5[i],
        mode: 'lines',
        line: {width: 0},
        fill: 'tonexty',
        fillcolor: c1 + '22',
        name: '5–95 %',
        hovertemplate: '5 %%: %{y:.4g}<extra></extra>'.replace('%%', '%')
      }
    );
    tr.push(
      {x, y: c.p75[i], mode: 'lines', line: {width: 0}, hoverinfo: 'skip', showlegend: false},
      {x, y: c.p25[i], mode: 'lines', line: {width: 0}, fill: 'tonexty', fillcolor: c1 + '44', name: '25–75 %', hoverinfo: 'skip'}
    );
    {
      const P_ = c.paths[i] || [],
        px = [],
        py = [];
      P_.forEach(pth => {
        px.push(...x, null);
        py.push(...pth, null);
      });
      if (P_.length)
        tr.push({
          x: px,
          y: py,
          mode: 'lines',
          line: {color: c1, width: 0.6},
          opacity: Math.max(0.05, Math.min(0.35, 10 / P_.length)),
          hoverinfo: 'skip',
          showlegend: false,
          connectgaps: false
        });
    } // every sample, one trace
    tr.push(
      {x, y: c.p50[i], mode: 'lines', line: {color: c1, width: 2.2}, name: 'median', hovertemplate: 'median %{y:.4g}<extra></extra>'},
      {
        x,
        y: c.mean[i],
        mode: 'lines',
        line: {color: ink, width: 1.2, dash: 'dot'},
        name: 'mean',
        hovertemplate: 'mean %{y:.4g}<extra></extra>'
      }
    );
    if (ref)
      tr.push({
        x,
        y: x.map(y => ref[m + '|' + y] ?? 0),
        mode: 'lines',
        line: {color: ink, width: 1.5, dash: 'dash'},
        name: 'reference run',
        hovertemplate: 'reference %{y:.4g}<extra></extra>'
      });
    if (hl && hl.values && hl.values[0]) {
      const hi = hl.members.indexOf(m);
      if (hi >= 0)
        tr.push({
          x,
          y: hl.values[0][hi],
          mode: 'lines',
          line: {color: '#d03b3b', width: 2.2},
          name: 'sample ' + (R.hl + 1),
          hovertemplate: `sample ${R.hl + 1}: %{y:.4g}<extra></extra>`
        });
    }
    Plotly.react(
      `vc${j}`,
      tr,
      pvLayout(esc(m) + (R.by2 === 'TECHNOLOGY' && TD[m] ? ` <span style="font-size:11px">${esc(shortName(m))}</span>` : ''), {
        height: 230,
        margin: {l: 50, r: 8, t: 30, b: 26},
        showlegend: false,
        hovermode: 'x unified',
        yaxis: R.vsc === 'shared' ? {range: [0, ymax * 1.05]} : {}
      }),
      PVCFG
    );
  });
  mcVby(V, R, () => mcViewItems(V, R, X, pal, ink, keep, V.querySelector('#vby') ? V.querySelector('.mvbar label').outerHTML : ''));
  V.querySelector('#vsc').onchange = e => {
    R.vsc = e.target.value;
    mcViewItems(V, R, X, pal, ink, keep, V.querySelector('.mvbar label').outerHTML);
  };
  V.querySelector('#vref').onchange = e => {
    R.vref = e.target.value;
    mcViewItems(V, R, X, pal, ink, keep, V.querySelector('.mvbar label').outerHTML);
  };
  const ps = V.querySelector('.pvisel');
  ps.ontoggle = () => {
    R.vpOpen = ps.open;
  };
  const read = () => {
    R.vpick = {by: R.by2, list: [...V.querySelectorAll('.vpc:checked')].map(x => x.value)};
    clearTimeout(MCV.vt);
    MCV.vt = setTimeout(() => mcViewItems(V, R, X, pal, ink, keep, V.querySelector('.mvbar label').outerHTML), 600);
  };
  V.querySelectorAll('.vpc').forEach(x => (x.onchange = read));
  V.querySelector('.vq').oninput = e => {
    const q = e.target.value.toLowerCase();
    V.querySelectorAll('.pvisel .selr').forEach(l => (l.hidden = q && !l.dataset.q.includes(q)));
  };
  V.querySelectorAll('[data-va]').forEach(
    b =>
      (b.onclick = () => {
        V.querySelectorAll('.pvisel .selr').forEach(l => {
          if (!l.hidden) l.querySelector('input').checked = b.dataset.va === '1';
        });
        read();
      })
  );
}

/* V2: the mix of the futures at the 5 %, 50 % and 95 % of a ranking (objective or the result shown), stacked by item over the years */
async function mcViewMix(V, R, X, pal, ink, keep, setSel) {
  setSel = mcSetSel(X, R);
  const {a} = X;
  R.mixBy = R.mixBy || 'obj';
  const val = R.mixBy === 'obj' ? a.objectives || [] : a.totals || [],
    ord = (a.ks || [])
      .map((k, j) => [k, val[j]])
      .filter(x => x[1] != null)
      .sort((p, q) => p[1] - q[1]);
  if (!ord.length) {
    V.innerHTML = '<div class="empty">No sample.</div>';
    return;
  }
  const at = q => ord[Math.round(q * (ord.length - 1))],
    picks = [
      ['5 % (low)', at(0.05)],
      ['median', at(0.5)],
      ['95 % (high)', at(0.95)]
    ];
  if (R.hl != null && a.ks.includes(R.hl)) picks.push([`sample ${R.hl + 1}`, [R.hl, val[a.ks.indexOf(R.hl)]]]);
  V.innerHTML = `<div class="mvbar">${setSel}<label>Rank the samples by<select id="vmb"><option value="obj" ${R.mixBy === 'obj' ? 'selected' : ''}>The objective (total cost)</option><option value="res" ${R.mixBy === 'res' ? 'selected' : ''}>The result shown (${esc(X.focusLab)})</option></select></label></div><div class="muted small">Reading…</div>`;
  const c = await jp(`/api/mc/${R.run}/cube`, {
    var: R.var,
    filters: mcFlt(X, R),
    divide: R.divide,
    by: R.by2,
    mode: 'samples',
    ks: picks.map(p => p[1][0]),
    keep
  }).catch(e => ({error: e.message}));
  if (c.error) {
    V.innerHTML = `<div class="ck error"><div class="ck-d">${esc(c.error)}</div></div>`;
    return;
  }
  const top = c.members.slice(0, pal.length - 1),
    other = c.members.length > top.length; // one colour each, never repeated: the rest is Other
  const ymax = Math.max(0, ...c.values.map(v => c.years.map((_, t) => v.reduce((s, row) => s + Math.max(0, row[t]), 0))).flat()) * 1.05;
  const f = v => (+v).toLocaleString('en-US', {maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 3});
  V.innerHTML = `<div class="mvbar">${setSel}<label>Rank the samples by<select id="vmb"><option value="obj" ${R.mixBy === 'obj' ? 'selected' : ''}>The objective (total cost)</option><option value="res" ${R.mixBy === 'res' ? 'selected' : ''}>The result shown (${esc(X.focusLab)})</option></select></label></div>
    <p class="muted small">${esc(vlabel(R.var))} by ${esc(R.by2.toLowerCase())}: the futures (samples) at 5 %, 50 % and 95 % of ${R.mixBy === 'obj' ? 'the objective' : esc(X.focusLab)}, same scale${X.u ? ' ·' + X.u : ''}. Ranked by ${R.mixBy === 'obj' ? 'objective' : 'result'}: ${picks.map(p => `${p[0]} = sample ${p[1][0] + 1} (${f(p[1][1])})`).join(' · ')}</p>
    <div class="vleg">${top.map((m, j) => `<span><i style="background:${pal[j % pal.length]}"></i>${esc(m)}</span>`).join('')}${other ? '<span><i style="background:#a3a19c"></i>Other</span>' : ''}</div>
    <div class="vmix">${picks.map((p, i) => `<div class="vcell" id="vm${i}"></div>`).join('')}</div>`;
  picks.forEach((p, i) => {
    const vi = c.samples.indexOf(p[1][0]);
    if (vi < 0) return;
    const v = c.values[vi];
    const tr = top.map((m, j) => ({
      type: 'bar',
      x: c.years,
      y: v[c.members.indexOf(m)],
      name: String(m),
      marker: {color: pal[j % pal.length]},
      showlegend: i === 0,
      legendgroup: String(m),
      hovertemplate: `${esc(m)} %{x}: %{y:.4g}<extra></extra>`
    }));
    if (other)
      tr.push({
        type: 'bar',
        x: c.years,
        y: c.years.map((_, t) => c.members.slice(top.length).reduce((s, m) => s + v[c.members.indexOf(m)][t], 0)),
        name: 'Other',
        marker: {color: '#a3a19c'},
        showlegend: i === 0,
        legendgroup: 'Other'
      });
    Plotly.react(
      `vm${i}`,
      tr,
      pvLayout(esc(p[0]), {
        barmode: 'relative',
        bargap: 0.15,
        height: 320,
        showlegend: false,
        yaxis: {range: [0, ymax]},
        margin: {l: 50, r: 8, t: 30, b: 30}
      }),
      PVCFG
    );
  });
  mcVby(V, R, () => mcViewMix(V, R, X, pal, ink, keep, V.querySelector('.mvbar label').outerHTML));
  V.querySelector('#vmb').onchange = e => {
    R.mixBy = e.target.value;
    mcViewMix(V, R, X, pal, ink, keep, V.querySelector('.mvbar label').outerHTML);
  };
}

/* V4: the probability that each item is above a threshold in each year (e.g. that new capacity is built) */
async function mcViewMap(V, R, X, pal, ink, keep, setSel) {
  setSel = mcSetSel(X, R);
  R.thr = R.thr ?? 0.001;
  R.mapv = R.mapv || 'prob';
  V.innerHTML = `<div class="mvbar">${setSel}<label>Show<select id="vmv"><option value="prob" ${R.mapv === 'prob' ? 'selected' : ''}>Probability of being above</option><option value="mean" ${R.mapv === 'mean' ? 'selected' : ''}>Mean value</option><option value="p50" ${R.mapv === 'p50' ? 'selected' : ''}>Median value</option></select></label><label>Threshold<input id="vthr" value="${R.thr}"></label></div><div class="muted small">Reading…</div>`;
  const c = await jp(`/api/mc/${R.run}/cube`, {
    var: R.var,
    filters: mcFlt(X, R),
    divide: R.divide,
    by: R.by2,
    mode: 'prob',
    thr: R.thr,
    keep
  }).catch(e => ({error: e.message}));
  if (c.error) {
    V.innerHTML = `<div class="ck error"><div class="ck-d">${esc(c.error)}</div></div>`;
    return;
  }
  const z = R.mapv === 'prob' ? c.prob : R.mapv === 'mean' ? c.mean : c.p50,
    rows = c.members.map(String);
  V.innerHTML = V.innerHTML.replace(
    '<div class="muted small">Reading…</div>',
    `<p class="muted small">${R.mapv === 'prob' ? `Share of the ${c.n} samples where ${esc(vlabel(R.var))} is above ${R.thr}${X.u}: 100 % = in every future (robust), 0 % = in none, between = depends on the future.` : `${R.mapv === 'mean' ? 'Mean' : 'Median'} of ${esc(vlabel(R.var))} over the ${c.n} samples${X.u ? ' ·' + X.u : ''}.`} ${c.total_members > c.members.length ? `The ${c.members.length} largest of ${c.total_members}.` : ''}</p><div id="vmap"></div>`
  );
  const c1 = pal[0],
    scale = [
      [0, isDark() ? '#1f1f1f' : '#f4f3ef'],
      [1, c1]
    ];
  Plotly.react(
    'vmap',
    [
      {
        type: 'heatmap',
        x: c.years,
        y: rows.map(m => (R.by2 === 'TECHNOLOGY' && TD[m] ? `${m} · ${shortName(m)}` : m)),
        z,
        colorscale: scale,
        zmin: R.mapv === 'prob' ? 0 : undefined,
        zmax: R.mapv === 'prob' ? 1 : undefined,
        xgap: 1,
        ygap: 1,
        customdata: c.members.map((m, i) => c.years.map((_, t) => [c.prob[i][t], c.mean[i][t], c.p50[i][t]])),
        hovertemplate:
          '%{y} · %{x}<br>above threshold in %{customdata[0]:.0%} of the samples<br>mean %{customdata[1]:.4g} · median %{customdata[2]:.4g}<extra></extra>',
        colorbar: {tickformat: R.mapv === 'prob' ? '.0%' : '', thickness: 10}
      }
    ],
    pvLayout(`${esc(vlabel(R.var))} by ${esc(R.by2.toLowerCase())} and year`, {
      height: Math.max(260, 70 + 22 * rows.length),
      margin: {l: 230, r: 20, t: 34, b: 30},
      yaxis: {autorange: 'reversed', automargin: true},
      xaxis: {type: 'category'}
    }),
    PVCFG
  );
  mcVby(V, R, () => mcViewMap(V, R, X, pal, ink, keep, V.querySelector('.mvbar label').outerHTML));
  V.querySelector('#vmv').onchange = e => {
    R.mapv = e.target.value;
    mcViewMap(V, R, X, pal, ink, keep, V.querySelector('.mvbar label').outerHTML);
  };
  V.querySelector('#vthr').onchange = e => {
    R.thr = Number(e.target.value) || 0;
    mcViewMap(V, R, X, pal, ink, keep, V.querySelector('.mvbar label').outerHTML);
  };
}

/* V3: several Monte Carlo runs (e.g. on different base scenarios) on one chart: bands over the years and the distribution */
async function mcViewRuns(V, R, X, pal, ink) {
  const runs = X.runs;
  R.vruns = (R.vruns || [R.run]).filter(id => runs.some(r => r.id === id));
  if (!R.vruns.length) R.vruns = [R.run];
  V.innerHTML = `<div class="mvbar"><div class="vruns">${runs.map(r => `<label class="chk"><input type="checkbox" class="vrc" value="${esc(r.id)}" ${R.vruns.includes(r.id) ? 'checked' : ''}> ${esc(r.name || r.id)} <span class="muted">${r.ok}/${r.total}${r.scenarios && r.scenarios.length ? ' · base + ' + esc(r.scenarios.join(' + ')) : ''}</span></label>`).join('')}</div></div><div class="muted small">Reading…</div>`;
  const flt = X.flt,
    res = await Promise.all(
      R.vruns.map(id =>
        jp(`/api/mc/${id}/explore`, {
          var: R.var,
          filters: flt,
          divide: R.divide,
          along: X.dims.includes('YEAR') ? 'YEAR' : '',
          focus: R.focus
        }).catch(e => ({error: e.message}))
      )
    );
  const name = id => (runs.find(r => r.id === id) || {}).name || id,
    f = v => (v == null ? '–' : (+v).toLocaleString('en-US', {maximumFractionDigits: Math.abs(v) >= 100 ? 1 : 3}));
  V.querySelector('.muted.small').outerHTML =
    `<p class="muted small">${esc(vlabel(R.var))} · ${esc(X.focusLab)}: each run in its colour. A run that did not keep this result is left out.</p>
    ${X.dims.includes('YEAR') ? '<div class="rch"><div id="vr1"></div></div>' : ''}<div class="rrow"><div class="rch"><div id="vr2"></div></div><div class="rch"><div id="vr3"></div></div></div>
    <div class="tw"><table class="grid ptab"><thead><tr><th class="k">Run</th><th>Samples</th><th>Mean</th><th>SD</th><th>5 %</th><th>Median</th><th>95 %</th><th>CVaR 95 %</th></tr></thead><tbody>${res.map((r, i) => (r.error || !r.n ? `<tr><td class="k">${esc(name(R.vruns[i]))}</td><td colspan="7" class="muted">${esc(r.error || 'no sample')}</td></tr>` : `<tr><td class="k"><span class="dot" style="background:${pal[i % pal.length]}"></span> ${esc(name(R.vruns[i]))}</td><td>${r.n}</td><td>${f(r.risk.mean)}</td><td>${f(r.risk.sd)}</td><td>${f(r.risk.p5)}</td><td>${f(r.risk.p50)}</td><td>${f(r.risk.p95)}</td><td>${f(r.risk.CVaR95)}</td></tr>`)).join('')}</tbody></table></div>`;
  const ok = res.map((r, i) => [r, i]).filter(([r]) => !r.error && r.n);
  if (X.dims.includes('YEAR')) {
    const tr = [];
    ok.forEach(([r, i]) => {
      const c = pal[i % pal.length],
        x = r.members;
      tr.push(
        {x, y: r.bands['95'], mode: 'lines', line: {width: 0}, hoverinfo: 'skip', showlegend: false, legendgroup: 'g' + i},
        {
          x,
          y: r.bands['5'],
          mode: 'lines',
          line: {width: 0},
          fill: 'tonexty',
          fillcolor: c + '30',
          hoverinfo: 'skip',
          showlegend: false,
          legendgroup: 'g' + i
        },
        {
          x,
          y: r.bands['50'],
          mode: 'lines',
          line: {color: c, width: 2.4},
          name: name(R.vruns[i]),
          legendgroup: 'g' + i,
          hovertemplate: `${esc(name(R.vruns[i]))} median %{y:.4g}<extra></extra>`
        }
      );
    });
    Plotly.react(
      'vr1',
      tr,
      pvLayout(`Over the years: median and 5–95 % band of each run${X.u ? ' ·' + X.u : ''}`, {
        height: 380,
        showlegend: true,
        legend: {orientation: 'h', y: -0.15},
        hovermode: 'x unified',
        xaxis: {type: 'linear'}
      }),
      PVCFG
    );
  }
  Plotly.react(
    'vr2',
    ok.map(([r, i]) => ({
      type: 'box',
      y: r.totals,
      name: name(R.vruns[i]),
      marker: {color: pal[i % pal.length]},
      boxmean: true,
      boxpoints: 'outliers'
    })),
    pvLayout(`Distribution of ${esc(X.focusLab)}${X.u}`, {height: 320}),
    PVCFG
  );
  Plotly.react(
    'vr3',
    ok.map(([r, i]) => {
      const s = [...r.totals].sort((p, q) => p - q);
      return {
        x: s,
        y: s.map((_, j) => 1 - j / s.length),
        mode: 'lines',
        line: {color: pal[i % pal.length], width: 2, shape: 'hv'},
        name: name(R.vruns[i])
      };
    }),
    pvLayout('Exceedance: probability of being at or above', {
      height: 320,
      showlegend: false,
      yaxis: {tickformat: '.0%', range: [0, 1.02]}
    }),
    PVCFG
  );
  V.querySelectorAll('.vrc').forEach(
    x =>
      (x.onchange = () => {
        R.vruns = [...V.querySelectorAll('.vrc:checked')].map(y => y.value);
        clearTimeout(MCV.vt);
        MCV.vt = setTimeout(() => mcViewRuns(V, R, X, pal, ink), 600);
      })
  );
}
