'use strict';
/* ============================== ROBUST DECISION MAKING (RDM) ==============================
   XLRM: X = the uncertainties of the Monte Carlo page (distributions, SDEs, correlations), L = strategies (each one a set of
   Studio scenarios), R = the model, M = metrics computed from the kept results AFTER the run (they can change without solving
   again). Every strategy is solved on the SAME futures (engine/rdm.py). The analyses (scorecard, regret, targets, scenario
   discovery with PRIM and a decision tree, trade-offs, the futures table) run here, in the page. */
const RDV = {
  design: null,
  tab: 'setup',
  run: null,
  info: null,
  ev: null,
  evKey: '',
  an: {view: 'score', metric: null, rel: false, strat: null, cond: 'targets', thr: 10, mval: null, box: -1, tx: null, ty: null, color: ''}
};
let RDPOLL = null;
const RDCOL = ['#3a6fb5', '#c47a1a', '#00968a', '#b8503c', '#7b58b8', '#7d7a1c']; // validated (light and dark): CVD, normal vision, contrast
const rdCol = i => RDCOL[i % RDCOL.length];
// the ways to
// turn the years of a metric into one number (the same in engine/rdm.py _reduce)
const RD_AGG = [
  ['sum', 'Sum over the years'],
  ['npv', 'Sum discounted to the first year'],
  ['mean', 'Average per year'],
  ['median', 'Median year'],
  ['last', 'Value in the last year'],
  ['first', 'Value in the first year'],
  ['year', 'Value in a chosen year'],
  ['max', 'Highest year'],
  ['min', 'Lowest year'],
  ['range', 'Range (highest - lowest year)'],
  ['sd', 'Standard deviation over the years'],
  ['cv', 'Coefficient of variation over the years (%)'],
  ['growth', 'Growth first to last year (%)'],
  ['cagr', 'Average yearly growth (%)']
];
/* the extra field of some of them: the year, or the discount rate */
const rdAggExtra = m =>
  m.agg === 'year'
    ? `<div class="row3"><label>Year<input data-m="year" type="number" value="${m.year ?? ''}" placeholder="Last year"></label></div>`
    : m.agg === 'npv'
      ? `<div class="row3"><label>Discount rate (%)<input data-m="rate" type="number" step="any" value="${m.rate ?? 5}"></label></div>`
      : '';
/* the years of a metric -> one number (as engine/rdm.py _reduce) */
function rdReduce(by, m) {
  const ys = Object.keys(by)
      .map(Number)
      .filter(y => !isNaN(y))
      .sort((a, b) => a - b),
    vals = ys.map(y => by[y]),
    n = vals.length,
    agg = m.agg || 'sum';
  if (!n) return NaN;
  const mean = vals.reduce((a, b) => a + b, 0) / n,
    sd = n > 1 ? Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  let v;
  if (agg === 'mean') v = mean;
  else if (agg === 'median') {
    const q = [...vals].sort((a, b) => a - b);
    v = n % 2 ? q[(n - 1) / 2] : (q[n / 2 - 1] + q[n / 2]) / 2;
  } else if (agg === 'last') v = by[ys[n - 1]];
  else if (agg === 'first') v = by[ys[0]];
  else if (agg === 'year') {
    const yy = +m.year || ys[n - 1];
    v = by[ys.reduce((a, b) => (Math.abs(b - yy) < Math.abs(a - yy) ? b : a))];
  } else if (agg === 'max') v = Math.max(...vals);
  else if (agg === 'min') v = Math.min(...vals);
  else if (agg === 'range') v = Math.max(...vals) - Math.min(...vals);
  else if (agg === 'sd') v = sd;
  else if (agg === 'cv') v = mean ? (sd / Math.abs(mean)) * 100 : 0;
  else if (agg === 'growth') v = by[ys[0]] ? (by[ys[n - 1]] / by[ys[0]] - 1) * 100 : 0;
  else if (agg === 'cagr') {
    const a = by[ys[0]],
      b = by[ys[n - 1]],
      k = ys[n - 1] - ys[0];
    v = a && k && b / a > 0 ? (Math.pow(b / a, 1 / k) - 1) * 100 : 0;
  } else if (agg === 'npv') {
    const r = (m.rate == null || m.rate === '' ? 5 : +m.rate) / 100;
    v = ys.reduce((acc, y) => acc + by[y] / Math.pow(1 + r, y - ys[0]), 0);
  } else v = vals.reduce((a, b) => a + b, 0);
  return v / (+m.divide || 1);
}
const RD_DER = {
  ProductionByTechnologyAnnual: ['REGION', 'TECHNOLOGY', 'COMMODITY', 'YEAR'],
  UseByTechnologyAnnual: ['REGION', 'TECHNOLOGY', 'COMMODITY', 'YEAR'],
  AnnualEmissions: ['REGION', 'EMISSION', 'YEAR'],
  AnnualTechnologyEmission: ['REGION', 'TECHNOLOGY', 'EMISSION', 'YEAR'],
  CapitalInvestment: ['REGION', 'TECHNOLOGY', 'YEAR'],
  TotalTechnologyAnnualActivity: ['REGION', 'TECHNOLOGY', 'YEAR'],
  AnnualizedInvestmentCost: ['REGION', 'TECHNOLOGY', 'YEAR'],
  Demand: ['REGION', 'TIMESLICE', 'COMMODITY', 'YEAR'],
  TotalStorageCapacity: ['REGION', 'STORAGE', 'YEAR']
};
const rdVars = () => {
  const mv = SCHEMA && SCHEMA.vars ? [...SCHEMA.vars.keys()] : [];
  return ['Objective', ...[...new Set([...mv, ...Object.keys(RD_DER)])].sort()];
};
const rdDims = v =>
  v === 'Objective'
    ? []
    : (SCHEMA && SCHEMA.vars && SCHEMA.vars.get(v) ? SCHEMA.vars.get(v).dims : RD_DER[v] || []).map(d => (d === 'FUEL' ? 'COMMODITY' : d));
const RD0 = () => ({
  name: '',
  strategies: [{id: 'BASE', name: 'Base', desc: 'the model as it is, no scenario', scenarios: []}],
  sampling: {n: 100, method: 'lhs', seed: 12345},
  workers: 2,
  solver: 'highs',
  metrics: [
    {
      id: 'M1',
      name: 'Total system cost',
      var: 'Objective',
      agg: 'sum',
      divide: 1,
      unit: '',
      dir: 'min',
      limit: null,
      filters: {},
      years: [null, null]
    }
  ],
  extra: []
});
async function rdSave() {
  const D = RDV.design;
  if (!D) return;
  if (LIB.srv && LIB.current) {
    const rec = await LIB.get(LIB.current);
    if (rec) await LIB.put({...rec, rdm: D});
  }
  try {
    localStorage.setItem('mst_nos_rdm_' + (M.meta.name || 'model'), JSON.stringify(D));
  } catch (e) {}
}
async function rdLoad() {
  if (LIB.srv && LIB.current) {
    const rec = await LIB.get(LIB.current);
    if (rec && rec.rdm) return rec.rdm;
  }
  try {
    const s = localStorage.getItem('mst_nos_rdm_' + (M.meta.name || 'model'));
    if (s) return JSON.parse(s);
  } catch (e) {}
  return RD0();
}
// solver settings of the RDM runs, with the load on this computer
function rdSolverBox(D, I) {
  const o = D.options || {},
    hi = D.solver === 'highs',
    cpus = I.cpus || 0,
    th = +o.threads || 1,
    load = D.workers * th;
  const opt = (k, list) =>
    `<select name="${k}">${list.map(([a, b]) => `<option value="${a}" ${String(o[k] || '') === a ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>`;
  return `<fieldset class="rdsolv"><legend>${hi ? 'HiGHS settings' : 'Solver settings'}</legend>
    ${
      hi
        ? `<div class="row3"><label>Method${opt('algorithm', [
            ['', 'automatic (HiGHS chooses)'],
            ['simplex', 'dual simplex'],
            ['ipm', 'interior point'],
            ['pdlp', 'PDLP (first order, very large models)']
          ])}</label>
      <label>Crossover${opt('crossover', [
        ['', 'default'],
        ['off', 'off (faster, interior solution)'],
        ['on', 'on (exact vertex, exact duals)']
      ])}</label>
      <label>Presolve${opt('presolve', [
        ['', 'on (default)'],
        ['off', 'off']
      ])}</label></div>`
        : ''
    }
    <div class="row3"><label>Threads per solve<input name="threads" type="number" min="1" max="256" value="${esc(o.threads || '')}" placeholder="1"></label>
      <label>Time limit per solve (s)<input name="time_limit" type="number" min="1" value="${esc(o.time_limit || '')}" placeholder="None"></label>
      ${hi ? `<label>Tolerance<input name="tolerance" type="number" step="any" min="0" value="${esc(o.tolerance || '')}" placeholder="1e-7 (default)"></label>` : '<span></span>'}</div>
    <p class="muted small ${cpus && load > cpus ? 'rdwarn' : ''}">${D.workers} solve${D.workers === 1 ? '' : 's'} at the same time × ${th} thread${th === 1 ? '' : 's'} = ${load} thread${load === 1 ? '' : 's'}${cpus ? ` of the ${cpus} of this computer${load > cpus ? ': too many, the solves will slow each other down' : load > cpus - 2 && cpus > 4 ? ': keep about 2 free for the system' : ''}` : ''}. Many small solves: 1 thread each and as many at once as threads (minus 2). One large model: fewer solves at once with more threads each, interior point with crossover off.</p></fieldset>`;
}
const rdFactors = () => ((MCV.design && MCV.design.factors) || []).filter(f => f.enabled !== false);

async function showRDM() {
  setView('rdm');
  const V = document.getElementById('rdmview');
  if (!(await serverInfo())) {
    V.innerHTML = `<div class="empty" style="margin:24px">Robust decisions run on this computer: start the Studio app (or <code>START_SOLVER.bat</code>), then open this view again.</div>`;
    return;
  }
  V.innerHTML = '<div class="empty">Reading the model…</div>';
  try {
    if (!RDV.design) RDV.design = await rdLoad();
    if (!MCV.cat) MCV.cat = await api('/api/mc/catalog');
    if (!MCV.design) MCV.design = await mcLoad();
    MCV.det = await jp('/api/mc/detect', {model: mcModel(), data: writeData({apply: []})});
    if (MCV.det.error) throw new Error(MCV.det.error);
  } catch (e) {
    V.innerHTML = `<div class="ck error" style="margin:24px"><div class="ck-d">Could not read the model: ${esc(e.message)}</div></div>`;
    return;
  }
  renderRDM();
}

function renderRDM() {
  const V = document.getElementById('rdmview'),
    D = RDV.design,
    F = rdFactors();
  const tabs = [
    ['setup', 'Set up'],
    ['run', 'Run'],
    ['results', 'Results']
  ];
  V.innerHTML = `<div class="mcw rdw"><div class="mchead"><div><h2 class="mct">Robust decisions <span class="betab" title="Under construction: results and options may change">Beta</span></h2><p class="muted">${D.strategies.length} strateg${D.strategies.length === 1 ? 'y' : 'ies'} × ${D.sampling.n} futures (${F.length} uncertain parameter${F.length === 1 ? '' : 's'}) · ${D.metrics.length} metric${D.metrics.length === 1 ? '' : 's'}</p></div>
    <div class="seg" role="tablist">${tabs.map(([k, l]) => `<button type="button" data-tab="${k}" aria-pressed="${RDV.tab === k}">${l}</button>`).join('')}</div></div><div id="rdbody"></div></div>`;
  V.querySelectorAll('[data-tab]').forEach(
    b =>
      (b.onclick = () => {
        RDV.tab = b.dataset.tab;
        renderRDM();
      })
  );
  ({setup: rdSetupTab, run: rdRunTab, results: rdResultsTab})[RDV.tab](V.querySelector('#rdbody'));
}

/* ---------- tab 1: strategies (L), futures (X), metrics (M) ---------- */
function rdSetupTab(B) {
  const D = RDV.design,
    F = rdFactors(),
    SC = scenData().list,
    I = SERVER.info || {},
    sv = I.solvers || [];
  const strow = (s, i) => `<div class="rdst" data-i="${i}"><span class="rdsw" style="background:${rdCol(i)}"></span>
      <input class="rdc" data-f="id" value="${esc(s.id)}" aria-label="Code" maxlength="40"><input data-f="name" value="${esc(s.name)}" aria-label="Name" placeholder="Name">
      <input data-f="desc" value="${esc(s.desc || '')}" aria-label="Description" placeholder="What this strategy does">
      <div class="rdsc">${SC.length ? SC.map(sc => `<button type="button" class="chip${s.scenarios.includes(sc.id) ? ' on' : ''}" data-sc="${esc(sc.id)}" aria-pressed="${s.scenarios.includes(sc.id)}" title="${esc(sc.desc || '')}">${esc(sc.name)}</button>`).join('') : '<span class="muted small">No scenario in this model yet</span>'}</div>
      <button type="button" class="btn sm danger" data-del="${i}" ${D.strategies.length < 2 ? 'disabled' : ''} aria-label="Remove ${esc(s.name)}">✕</button></div>`;
  const mcard = (m, i) => {
    if (m.kind === 'formula') return rdFormulaCard(m, i, RDV.openM === i);
    const dims = rdDims(m.var).filter(d => d !== 'YEAR' && d !== 'TIMESLICE');
    return `<details class="rdm" data-i="${i}" ${RDV.openM === i ? 'open' : ''}><summary><b>${esc(m.name || m.var)}</b><span class="muted">${esc(rdMetricText(m))}</span><span class="rdbad">${m.dir === 'max' ? 'higher is better' : 'lower is better'}${m.limit != null && m.limit !== '' ? ` · target ${m.dir === 'max' ? '≥' : '≤'} ${rdF(+m.limit)}` : ''}</span></summary>
      <div class="rdmb"><div class="row3"><label>Name<input data-m="name" value="${esc(m.name || '')}"></label><label>Kind<select data-m="kind"><option value="result" selected>One result</option><option value="formula">Formula of inputs and outputs</option></select></label><label>Result<select data-m="var">${rdVars()
        .map(v => `<option ${v === m.var ? 'selected' : ''}>${esc(v)}</option>`)
        .join('')}</select></label></div>
      ${dims
        .map(d => {
          const mem = setOf(d) || [],
            cur = (m.filters || {})[d] || [];
          return `<div class="rdfl"><span>${esc(d.toLowerCase())}</span><select multiple data-flt="${esc(d)}" size="${Math.min(6, Math.max(2, mem.length))}" aria-label="Only these ${esc(d.toLowerCase())}">${mem.map(x => `<option ${cur.includes(String(x)) ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select><span class="muted small">${cur.length ? cur.length + ' selected' : 'all (none selected)'}</span></div>`;
        })
        .join('')}
      ${m.var !== 'Objective' ? `<div class="row3"><label>Years from<input data-m="y0" type="number" value="${m.years && m.years[0] != null ? m.years[0] : ''}" placeholder="First"></label><label>to<input data-m="y1" type="number" value="${m.years && m.years[1] != null ? m.years[1] : ''}" placeholder="Last"></label><label>Over the years${mcSel('agg', RD_AGG, m.agg || 'sum').replace('data-k="agg"', 'data-m="agg"')}</label></div>${rdAggExtra(m)}` : ''}
      <div class="row3"><label>Divide by<input data-m="divide" type="number" step="any" value="${m.divide || 1}"></label><label>Unit<input data-m="unit" value="${esc(m.unit || '')}" placeholder="e.g. bn$"></label><label>Better when${mcSel(
        'dir',
        [
          ['min', 'lower'],
          ['max', 'higher']
        ],
        m.dir || 'min'
      ).replace('data-k="dir"', 'data-m="dir"')}</label></div>
      <div class="row2"><label>Target (optional)<input data-m="limit" type="number" step="any" value="${m.limit != null ? m.limit : ''}" placeholder="None"></label><div class="acts" style="align-self:end"><button type="button" class="btn sm danger" data-mdel="${i}">Remove the metric</button></div></div>
      <p class="hint">A target turns the metric into a test: a strategy "satisfies" a future when it meets every target there. Targets and metrics can be changed after the run: they are computed from the kept results.</p></div></details>`;
  };
  const solves = D.strategies.length * D.sampling.n,
    sub = RDV.sub || 'matrix';
  // the XLRM matrix
  const XL = [
    [
      'X',
      'Futures',
      'what you cannot control',
      `${F.length} uncertain parameter${F.length === 1 ? '' : 's'} · ${D.sampling.n} futures (${esc(D.sampling.method)})`
    ],
    [
      'L',
      'Strategies',
      'what you can decide',
      `${D.strategies.length} strateg${D.strategies.length === 1 ? 'y' : 'ies'}: ${D.strategies
        .map(x => esc(x.name || x.id))
        .slice(0, 4)
        .join(', ')}${D.strategies.length > 4 ? '…' : ''}`
    ],
    [
      'R',
      'Model',
      'how decisions and futures become results',
      `${esc(M.meta.name || 'model')} · ${setOf('TECHNOLOGY').length} technologies · ${(M.years || []).length} years`
    ],
    [
      'M',
      'Metrics',
      'how you judge a strategy in a future',
      `${D.metrics.length} metric${D.metrics.length === 1 ? '' : 's'}${D.metrics.filter(m => m.limit != null && m.limit !== '').length ? ` · ${D.metrics.filter(m => m.limit != null && m.limit !== '').length} with a target` : ''}`
    ]
  ];
  const nav = `<div class="seg rdsub" role="tablist">${[['matrix', 'XLRM'], ...XL.map(x => [x[0], x[1]])].map(([k, l]) => `<button type="button" data-sub="${k}" aria-pressed="${sub === k}">${k !== 'matrix' ? `<span class="rdn">${k}</span>` : ''}${l}</button>`).join('')}</div>`;
  const secL = `<section class="rdsec rdwide"><h3><span class="rdn">L</span>Strategies <span class="muted">What you can decide</span></h3>
     <p class="hint">A strategy is a set of Studio scenarios applied to the base model (for example batteries on, a carbon price, a new interconnector). Every strategy is solved on the same futures, so the comparison is fair: the differences come from the strategies, not from the draws.</p>
     <div id="rdsts">${D.strategies.map(strow).join('')}</div>
     <div class="acts"><button type="button" class="btn" id="rdadd">+ Strategy</button>${SC.length ? '<button type="button" class="btn" id="rdeach" title="Base + one strategy per scenario">One strategy per scenario</button>' : ''}<button type="button" class="btn" id="rdscen">Scenarios…</button></div></section>`;
  const secX = `<section class="rdsec rdwide"><h3><span class="rdn">X</span>Futures <span class="muted">What you cannot control</span></h3>
     <p class="hint">The futures are drawn from the uncertain parameters of the Monte Carlo page (distributions, time paths, correlations): one place to describe the uncertainty, used by both.</p>
     ${F.length ? `<ul class="rdfx">${F.map(f => `<li><b>${esc(f.name || f.param)}</b><span class="muted">${esc(f.param)} · ${esc(factorSummary(f))}</span></li>`).join('')}</ul>` : '<div class="empty">No uncertain parameter yet: add them on the Monte Carlo page.</div>'}
     <div class="acts"><button type="button" class="btn" id="rdmc">${F.length ? 'Edit the uncertainties' : 'Add uncertainties'} (Monte Carlo)</button></div>
     <form id="rdsf" class="frm"><div class="row3"><label>Futures<input name="n" type="number" min="10" max="100000" value="${D.sampling.n}"></label><label>Sampling${mcSel(
       'm',
       [
         ['lhs', 'Latin hypercube'],
         ['sobol', 'Sobol'],
         ['halton', 'Halton'],
         ['mc', 'plain Monte Carlo']
       ],
       D.sampling.method
     ).replace('data-k="m"', 'name="method"')}</label><label>Seed<input name="seed" type="number" value="${D.sampling.seed}"></label></div>
       <div class="row2"><label>Solver<select name="solver">${sv.map(s => `<option value="${esc(s.id)}" ${s.id === D.solver ? 'selected' : ''}>${esc(s.name || s.id)}</option>`).join('')}</select></label><label>Solves at the same time<input name="workers" type="number" min="1" max="256" value="${D.workers}"></label></div>
       ${rdSolverBox(D, I)}</form></section>`;
  const secM = `<section class="rdsec rdwide"><h3><span class="rdn">M</span>Metrics <span class="muted">How you judge a strategy in a future</span></h3>
     <p class="hint">Each metric is one number per strategy and future, read from the results (the objective, emissions, imports, capacity…), filtered and summed over the years you choose. Lower or higher is better; a target is optional. A formula metric is drawn as you type it and checked on the base data or a run.</p>
     <div id="rdms">${D.metrics.map(mcard).join('')}</div>
     <div class="acts"><button type="button" class="btn" id="rdmadd">+ Metric</button><button type="button" class="btn" id="rdfadd" title="A formula of inputs (parameters of each future) and outputs (results), e.g. A * B / log(A * B)">+ Formula metric</button><button type="button" class="btn" data-tpl="co2">+ Emissions (total)</button><button type="button" class="btn" data-tpl="inv">+ Investment (total)</button></div></section>`;
  const matrix = `<div class="rdxlrm">${XL.map(([k, t, mean, sum]) => `<button type="button" class="rdbox" data-sub="${k}"><span class="rdbig">${k}</span><span class="rdbt">${t}</span><span class="rdbm">${mean}</span><span class="rdbs muted">${sum}</span><span class="rdbo">Open ${t.toLowerCase()} →</span></button>`).join('')}</div>
    <section class="rdsec rdwide rdlegend"><h3>Robust decision making (XLRM)</h3><dl>
      <dt><span class="rdn">X</span>eXogenous uncertainties: <b>Futures</b></dt><dd>Factors outside the planner's control (prices, demand, rain, costs): each future is one draw of all of them, from the Monte Carlo uncertainties.</dd>
      <dt><span class="rdn">L</span>PoLicy Levers: <b>Strategies</b></dt><dd>The choices to compare (programmes, policies, investments): each strategy is a set of Studio scenarios on the base model.</dd>
      <dt><span class="rdn">R</span>Relationships: <b>The Model</b></dt><dd>The model that turns a strategy and a future into results: ${esc(M.meta.name || 'this model')}, solved once for every strategy in every future.</dd>
      <dt><span class="rdn">M</span>Measures: <b>Metrics</b></dt><dd>The numbers that judge a strategy in a future (cost, water, emissions, formulas of inputs and outputs), with optional targets; computed after the run, they can change without solving again.</dd></dl></section>`;
  B.innerHTML = `${nav}<div class="rdgrid">${sub === 'matrix' ? matrix : sub === 'L' ? secL : sub === 'X' ? secX : sub === 'R' ? rdRSection() : secM}
   <section class="rdsec rdwide rdgo"><div><b>${D.strategies.length} × ${D.sampling.n} = ${solves.toLocaleString()} solves</b><span class="muted"> · ${D.workers} at the same time · ${esc(D.solver)}</span></div>
     <button type="button" class="btn pri" id="rdgo" ${F.length && D.strategies.length && D.metrics.length ? '' : 'disabled'}>Go to Run</button></section></div>`;
  const on = (sel, ev, fn) => {
    const e = B.querySelector(sel);
    if (e) e[ev] = fn;
  };
  B.querySelectorAll('[data-sub]').forEach(
    b =>
      (b.onclick = () => {
        RDV.sub = b.dataset.sub;
        rdSetupTab(B);
      })
  );
  const save = () => {
    rdSave();
  };
  B.querySelectorAll('.rdst input').forEach(
    inp =>
      (inp.onchange = () => {
        const s = D.strategies[+inp.closest('.rdst').dataset.i];
        let v = inp.value.trim();
        if (inp.dataset.f === 'id') {
          v = v.replace(/[^\w.-]/g, '_').slice(0, 40);
          if (!v || D.strategies.some(x => x !== s && x.id === v)) {
            toast('Each strategy needs its own code');
            inp.value = s.id;
            return;
          }
        }
        s[inp.dataset.f] = v;
        save();
      })
  );
  B.querySelectorAll('.rdst [data-sc]').forEach(
    b =>
      (b.onclick = () => {
        const s = D.strategies[+b.closest('.rdst').dataset.i],
          id = b.dataset.sc;
        s.scenarios = s.scenarios.includes(id) ? s.scenarios.filter(x => x !== id) : [...s.scenarios, id];
        save();
        rdSetupTab(B);
      })
  );
  B.querySelectorAll('.rdst [data-del]').forEach(
    b =>
      (b.onclick = () => {
        D.strategies.splice(+b.dataset.del, 1);
        save();
        renderRDM();
      })
  );
  on('#rdadd', 'onclick', () => {
    let k = D.strategies.length + 1;
    while (D.strategies.some(s => s.id === 'S' + k)) k++;
    D.strategies.push({id: 'S' + k, name: 'Strategy ' + k, desc: '', scenarios: []});
    save();
    renderRDM();
  });
  on('#rdeach', 'onclick', async () => {
    if (D.strategies.length > 1 && !await uiConfirm('Replace the strategies by: Base + one strategy per scenario?')) return;
    D.strategies = [
      {id: 'BASE', name: 'Base', desc: 'the model as it is, no scenario', scenarios: []},
      ...SC.map(sc => ({id: sc.id.replace(/[^\w.-]/g, '_'), name: sc.name, desc: sc.desc || '', scenarios: [sc.id]}))
    ];
    save();
    renderRDM();
  });
  on('#rdscen', 'onclick', () => openScenarios());
  on('#rdmc', 'onclick', () => showMC());
  on('#rdsf', 'onchange', ev => {
    const fd = new FormData(ev.currentTarget);
    D.sampling = {n: Math.max(2, +fd.get('n') || 100), method: fd.get('method'), seed: +fd.get('seed') || 0};
    D.solver = fd.get('solver') || D.solver;
    D.workers = Math.max(1, +fd.get('workers') || 1);
    D.options = {};
    for (const k of ['algorithm', 'crossover', 'presolve', 'threads', 'time_limit', 'tolerance']) {
      const v = String(fd.get(k) ?? '').trim();
      if (v) D.options[k] = v;
    }
    save();
    renderRDM();
  });
  B.querySelectorAll('details.rdm').forEach(d => {
    const i = +d.dataset.i,
      m = D.metrics[i];
    d.ontoggle = () => {
      if (d.open) RDV.openM = i;
      else if (RDV.openM === i) RDV.openM = -1;
    };
    d.querySelectorAll('[data-m]').forEach(
      inp =>
        (inp.onchange = () => {
          const k = inp.dataset.m,
            v = inp.value;
          if (k === 'y0' || k === 'y1') {
            m.years = m.years || [null, null];
            m.years[k === 'y0' ? 0 : 1] = v === '' ? null : +v;
          } else if (k === 'limit') m.limit = v === '' ? null : +v;
          else if (k === 'divide') m.divide = +v || 1;
          else if (k === 'kind') {
            if (v === 'formula') {
              m.kind = 'formula';
              m.terms =
                m.terms && m.terms.length
                  ? m.terms
                  : [
                      {
                        n: 'A',
                        src: m.var === 'Objective' ? 'objective' : 'output',
                        var: m.var === 'Objective' ? '' : m.var,
                        filters: m.filters || {},
                        how: 'sum'
                      }
                    ];
              m.expr = m.expr || 'A';
            } else m.kind = 'result';
          } else {
            m[k] = v;
            if (k === 'var') {
              m.filters = {};
              if (!m.name || m.name === m._auto) m.name = m._auto = v;
            }
          }
          RDV.openM = i;
          save();
          rdSetupTab(B);
        })
    );
    rdFormulaWire(d, m, () => {
      RDV.openM = i;
      save();
      rdSetupTab(B);
    });
    d.querySelectorAll('[data-flt]').forEach(
      sel =>
        (sel.onchange = () => {
          m.filters = m.filters || {};
          m.filters[sel.dataset.flt] = [...sel.selectedOptions].map(o => o.value);
          RDV.openM = i;
          save();
          rdSetupTab(B);
        })
    );
  });
  const nid = () => {
    let k = D.metrics.length + 1;
    while (D.metrics.some(m => m.id === 'M' + k)) k++;
    return 'M' + k;
  };
  on('#rdfadd', 'onclick', () => {
    D.metrics.push({
      id: nid(),
      name: 'Formula metric',
      kind: 'formula',
      terms: [
        {n: 'A', src: 'input', param: 'SpecifiedAnnualDemand', filters: {}, how: 'sum'},
        {n: 'B', src: 'output', var: 'TotalTechnologyAnnualActivity', filters: {}, how: 'sum'}
      ],
      expr: 'B / A',
      agg: 'mean',
      divide: 1,
      unit: '',
      dir: 'max',
      limit: null,
      years: [null, null]
    });
    RDV.openM = D.metrics.length - 1;
    save();
    renderRDM();
  });
  B.querySelectorAll('[data-mdel]').forEach(
    b =>
      (b.onclick = () => {
        D.metrics.splice(+b.dataset.mdel, 1);
        RDV.openM = -1;
        save();
        renderRDM();
      })
  );
  on('#rdmadd', 'onclick', () => {
    D.metrics.push({
      id: nid(),
      name: 'Total system cost',
      var: 'Objective',
      agg: 'sum',
      divide: 1,
      unit: '',
      dir: 'min',
      limit: null,
      filters: {},
      years: [null, null]
    });
    RDV.openM = D.metrics.length - 1;
    save();
    renderRDM();
  });
  B.querySelectorAll('[data-tpl]').forEach(
    b =>
      (b.onclick = () => {
        const t = b.dataset.tpl;
        D.metrics.push(
          t === 'co2'
            ? {
                id: nid(),
                name: 'Emissions (total)',
                var: 'AnnualEmissions',
                agg: 'sum',
                divide: 1,
                unit: '',
                dir: 'min',
                limit: null,
                filters: {},
                years: [null, null]
              }
            : {
                id: nid(),
                name: 'Investment (total)',
                var: 'CapitalInvestment',
                agg: 'sum',
                divide: 1,
                unit: '',
                dir: 'min',
                limit: null,
                filters: {},
                years: [null, null]
              }
        );
        RDV.openM = D.metrics.length - 1;
        save();
        renderRDM();
      })
  );
  on('#rdgo', 'onclick', () => {
    RDV.tab = 'run';
    renderRDM();
  });
  {
    const rw = B.querySelector('.rdR .smwrap');
    if (rw && typeof sysMapWire === 'function') {
      const sv = rw.querySelector('svg');
      if (sv) {
        sv.removeAttribute('width');
        sv.removeAttribute('height');
      }
      sysMapWire(rw, () => {});
    }
    on('#rdrdiag', 'onclick', () => setView('diagram'));
    on('#rdrsys', 'onclick', () => openSystems(SYSTEMS.list.length ? 'map' : 'list'));
  }
}
const rdF = v =>
  v == null || !isFinite(v)
    ? '–'
    : Math.abs(v) >= 1e5
      ? v.toLocaleString(undefined, {maximumFractionDigits: 0})
      : Math.abs(v) >= 100
        ? v.toLocaleString(undefined, {maximumFractionDigits: 1})
        : Math.abs(v) >= 1
          ? v.toLocaleString(undefined, {maximumFractionDigits: 2})
          : v.toPrecision(3);
function rdMetricText(m) {
  if (m.kind === 'formula')
    return `${m.expr || '?'} with ${(m.terms || []).map(t => `${t.n} = ${t.src === 'objective' ? 'objective' : t.src === 'input' ? t.param + ' (input)' : t.var}`).join(', ')}, ${(RD_AGG.find(a => a[0] === (m.agg || 'sum')) || [0, ''])[1]}${m.unit ? ' (' + m.unit + ')' : ''}`;
  if (m.var === 'Objective')
    return 'objective of the model' + (m.divide && m.divide !== 1 ? ' / ' + m.divide : '') + (m.unit ? ' (' + m.unit + ')' : '');
  const f = Object.entries(m.filters || {})
    .filter(([, v]) => v && v.length)
    .map(([k, v]) => `${k.toLowerCase()} ${v.length > 3 ? v.length + ' selected' : v.join('+')}`)
    .join(', ');
  const y = m.years && (m.years[0] != null || m.years[1] != null) ? ` ${m.years[0] ?? 'first'}–${m.years[1] ?? 'last'}` : '';
  return `${m.var}${f ? ' (' + f + ')' : ''}, ${(RD_AGG.find(a => a[0] === (m.agg || 'sum')) || [0, ''])[1]}${y}${m.divide && m.divide !== 1 ? ' / ' + m.divide : ''}${m.unit ? ' (' + m.unit + ')' : ''}`;
}

/* ---------- tab 2: run ---------- */
async function rdRunTab(B) {
  const D = RDV.design,
    F = rdFactors(),
    runs = await api('/api/rdm').catch(() => []);
  B.innerHTML = `<div class="mcgrid2"><section><h3>Start a robust-decision run</h3>
     <p class="muted small">${D.strategies.map(s => esc(s.name)).join(' · ')} — each on the same ${D.sampling.n} futures (${F.length} uncertain parameter${F.length === 1 ? '' : 's'}): ${(D.strategies.length * D.sampling.n).toLocaleString()} solves, ${D.workers} at the same time with ${esc(D.solver)}. Futures are solved one after the other for every strategy: if you stop early, the strategies are still compared on the futures done, and "Resume" goes on.</p>
     <form id="rdrf" class="frm"><label>Name<input name="name" value="${esc((M.meta.name || 'model').replace(/\.(txt|dat)$/i, '') + '_rdm')}"></label><div class="acts"><button class="btn pri" type="submit" ${F.length && D.strategies.length ? '' : 'disabled'}>Start</button></div></form>
     ${F.length ? '' : '<p class="muted">Add uncertain parameters first (Monte Carlo page).</p>'}<div id="rdlive"></div></section>
   <section><h3>Robust-decision runs on this computer</h3>${
     runs
       .map(
         r => `<div class="ck ${r.state === 'failed' ? 'error' : ''}"><div class="ck-h"><b>${esc(r.name || r.id)}</b><span class="sev ${r.state === 'done' ? 'info' : r.state === 'failed' ? 'error' : 'warn'}">${esc(r.state || '')}</span></div>
      <div class="ck-w">${esc(r.created || '')} · ${r.strategies} strategies × ${r.n} futures · ${r.ok ?? 0} optimal of ${r.done ?? 0} solved / ${r.total ?? '?'} · ${esc(r.solver || '')}${r.case ? ' · case ' + esc(r.case) : ''}</div>
      ${['running', 'queued'].includes(r.state) ? `<div class="pbar"><i style="width:${Math.round((100 * (r.done || 0)) / (r.total || 1))}%"></i></div>` : ''}
      <div class="acts" style="margin-top:6px">${r.done ? `<button class="btn" data-res="${r.id}">Results</button>` : ''}<button class="btn" data-watch="${r.id}">Progress and log</button>${['running', 'queued'].includes(r.state) ? `<button class="btn" data-stop="${r.id}">Stop</button>` : ''}${r.state === 'stopped' || r.state === 'failed' ? `<button class="btn" data-resume="${r.id}">Resume</button>` : ''}<button class="btn danger" data-del="${r.id}">Delete</button></div></div>`
       )
       .join('') || '<div class="empty">No robust-decision run yet.</div>'
   }</section></div>`;
  B.querySelector('#rdrf').onsubmit = async ev => {
    ev.preventDefault();
    const name = new FormData(ev.target).get('name'),
      MD = MCV.design;
    const data = {};
    for (const s of D.strategies) data[s.id] = writeData({apply: s.scenarios});
    // a formula metric keeps the results its output terms read (it has no single result of its own)
    const outs = [
      ...new Set([
        ...(MD.outputs || []),
        ...D.metrics.filter(m => m.kind !== 'formula' && m.var && m.var !== 'Objective').map(m => m.var),
        ...D.metrics
          .filter(m => m.kind === 'formula')
          .flatMap(m => (m.terms || []).filter(t => t.src === 'output' && t.var).map(t => t.var))
      ])
    ];
    const body = {
      name,
      model: mcModel(),
      data,
      model_name: SCHEMA ? SCHEMA.name : 'MUIO 5.4',
      metrics: D.metrics,
      strategies: D.strategies.map(s => ({...s, scenarios: s.scenarios.map(scenName)})),
      design: {
        factors: MD.factors,
        corr: MD.corr,
        sampling: D.sampling,
        solver: D.solver,
        options: D.options || {},
        workers: D.workers,
        outputs: outs
      }
    };
    if (LIB.srv && LIB.current) {
      await rdSave();
      body.case = LIB.current;
    }
    const r = await jp('/api/rdm/run', body);
    if (!r.ok) return toast('Could not start: ' + (r.error || ''));
    toast('Robust-decision run started');
    rdWatch(r.id);
  };
  B.querySelectorAll('[data-res]').forEach(
    b =>
      (b.onclick = () => {
        RDV.run = b.dataset.res;
        RDV.tab = 'results';
        renderRDM();
      })
  );
  B.querySelectorAll('[data-watch]').forEach(b => (b.onclick = () => rdWatch(b.dataset.watch)));
  B.querySelectorAll('[data-stop]').forEach(
    b =>
      (b.onclick = async () => {
        await jp(`/api/rdm/${b.dataset.stop}/stop`, {});
        toast('Stopping after the solves under way');
        setTimeout(() => rdRunTab(B), 1500);
      })
  );
  B.querySelectorAll('[data-resume]').forEach(
    b =>
      (b.onclick = async () => {
        await jp(`/api/rdm/${b.dataset.resume}/resume`, {});
        toast('Resumed: the futures already solved are kept');
        rdWatch(b.dataset.resume);
      })
  );
  B.querySelectorAll('[data-del]').forEach(
    b =>
      (b.onclick = async () => {
        if (!await uiConfirm('Delete this run and all its solved futures?')) return;
        await jp(`/api/rdm/${b.dataset.del}/delete`, {});
        if (RDV.run === b.dataset.del) RDV.run = null;
        rdRunTab(B);
      })
  );
}
function rdWatch(id) {
  clearInterval(RDPOLL);
  const tick = async () => {
    const box = document.getElementById('rdlive');
    if (!box) {
      clearInterval(RDPOLL);
      return;
    }
    const s = await api('/api/rdm/' + id).catch(() => null);
    if (!s) return;
    const fin = ['done', 'failed', 'stopped'].includes(s.state);
    box.innerHTML = `<div class="ck ${s.state === 'failed' ? 'error' : 'cur'}"><div class="ck-h"><b>${esc(s.name || id)}</b><span class="sev ${s.state === 'done' ? 'info' : s.state === 'failed' ? 'error' : 'warn'}">${esc(s.state)}</span></div>
      <div class="ck-w">${esc(s.stage || '')} · ${s.ok ?? 0} optimal of ${s.done ?? 0} / ${s.total}${s.eta != null && !fin ? ' · about ' + Math.ceil(s.eta / 60) + ' min left' : ''}${s.elapsed != null ? ' · ' + s.elapsed + ' s' : ''}</div>
      <div class="pbar"><i style="width:${Math.round((100 * (s.done || 0)) / (s.total || 1))}%"></i></div><pre class="log">${esc((s.log || []).slice(-14).join('\n'))}</pre>
      <div class="acts">${s.done ? '<button class="btn pri" id="rdgo2">Results</button>' : ''}${!fin ? '<button class="btn" id="rdstop">Stop</button>' : ''}</div></div>`;
    const g = document.getElementById('rdgo2');
    if (g)
      g.onclick = () => {
        RDV.run = id;
        RDV.tab = 'results';
        renderRDM();
      };
    const st = document.getElementById('rdstop');
    if (st)
      st.onclick = async () => {
        await jp(`/api/rdm/${id}/stop`, {});
        toast('Stopping after the solves under way');
      };
    if (fin) clearInterval(RDPOLL);
  };
  tick();
  RDPOLL = setInterval(tick, 2000);
}

/* ---------- tab 3: results for practitioners ---------- */
const RD_VIEWS = [
  ['score', 'Scorecard', 'Every strategy against every metric: typical value, spread and worst case.'],
  ['regret', 'Regret', 'In each future, how much worse a strategy is than the best strategy of that future.'],
  ['targets', 'Targets', 'In how many futures each strategy meets your targets.'],
  ['vuln', 'Vulnerabilities', 'Which combinations of uncertainties make a strategy fail (scenario discovery: PRIM and a decision tree).'],
  ['trade', 'Trade-offs', 'Two metrics at once, every future, every strategy.'],
  ['futures', 'Futures', 'The table: every future, its uncertainties and the metrics of each strategy (CSV).'],
  ['plot', 'Chart builder', 'Any metric or uncertainty against any other, one or two y-axes, futures filtered by ranges.'],
  ['enhance', 'Enhance a strategy', 'A new scenario on top of a strategy, edited in the diagram, solved on its failed futures or on all.']
];
const rdQ = (a, p) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y),
    i = (s.length - 1) * p,
    lo = Math.floor(i),
    hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
};
const rdMean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const rdBetter = (m, a, b) => (m.dir === 'max' ? a > b : a < b);
const rdMeets = (m, v) => m.limit == null || m.limit === '' || (m.dir === 'max' ? v >= +m.limit : v <= +m.limit);
// how the targets combine into "the strategy
// satisfies this future": all of them (AND), any of them (OR), one metric alone, or an expression of the metric codes (M1 and (M2 or M3))
const rdLogic = () => (RDV.design && RDV.design.logic) || {mode: 'all'};
function rdSatFn(T) {
  const L = rdLogic();
  if (L.mode === 'any') return meets => T.some(m => meets(m));
  if (L.mode === 'atleast') return meets => T.filter(m => meets(m)).length >= Math.min(T.length, Math.max(1, +L.k || 1)); // at least k targets
  if (L.mode === 'one') {
    const m = T.find(x => x.id === L.metric) || T[0];
    return meets => !m || meets(m);
  }
  if (L.mode === 'expr' && L.expr) {
    const src = String(L.expr)
      .replace(/\band\b/gi, '&&')
      .replace(/\bor\b/gi, '||')
      .replace(/\bnot\b/gi, '!');
    if (!/^[\sA-Za-z0-9_()&|!]*$/.test(src)) return null;
    const ids = [...new Set(src.match(/[A-Za-z_]\w*/g) || [])];
    if (ids.some(id => !T.some(m => m.id === id))) return null;
    let f;
    try {
      f = new Function(...ids, 'return !!(' + src + ');');
      f(...ids.map(() => true));
    } catch (e) {
      return null;
    }
    return meets => f(...ids.map(id => meets(T.find(m => m.id === id))));
  }
  return meets => T.every(m => meets(m));
}
const rdSat = (ev, T, s, f) => {
  const fn = rdSatFn(T) || (meets => T.every(m => meets(m)));
  return fn(m => rdMeets(m, ev.values[m.id][s][f]));
};
const rdLogicText = T => {
  const L = rdLogic();
  return L.mode === 'any'
    ? 'any target (OR)'
    : L.mode === 'atleast'
      ? `at least ${Math.min(T.length, Math.max(1, +L.k || 1))} of ${T.length} targets`
    : L.mode === 'one'
      ? `${(T.find(m => m.id === L.metric) || T[0] || {}).name || 'one target'} alone`
      : L.mode === 'expr' && L.expr
        ? L.expr + (rdSatFn(T) ? '' : ' (not valid: all targets used)')
        : 'all targets (AND)';
};
function rdRegret(ev, m, rel) {
  // [strategy][future]: distance to the best strategy of the future (0 for the best)
  const V = ev.values[m.id];
  if (!Array.isArray(V)) return null;
  const nF = ev.futures.length;
  const best = Array.from({length: nF}, (_, f) =>
    V.reduce((b, row) => (m.dir === 'max' ? Math.max(b, row[f]) : Math.min(b, row[f])), m.dir === 'max' ? -Infinity : Infinity)
  );
  return V.map(row =>
    row.map((v, f) => {
      const r = m.dir === 'max' ? best[f] - v : v - best[f];
      return rel ? (100 * r) / Math.max(Math.abs(best[f]), 1e-12) : r;
    })
  );
}
function rdScaledRegret(ev, mets) {
  // all metrics at once: each regret divided by the metric's spread over all strategies and futures, worst metric kept
  const L = mets
    .map(m => {
      const R = rdRegret(ev, m, false);
      if (!R) return null;
      const V = ev.values[m.id].flat(),
        sp = Math.max(...V) - Math.min(...V) || 1;
      return R.map(row => row.map(r => r / sp));
    })
    .filter(Boolean);
  if (!L.length) return null;
  return L[0].map((row, s) => row.map((_, f) => Math.max(...L.map(R => R[s][f]))));
}
async function rdLay(extra) {
  await needLib('plotly');
  const dark = isDark(),
    ink = dark ? '#e6e5e1' : '#2f3437',
    mut = dark ? '#9b9a97' : '#787774',
    grid = dark ? '#2c2c2c' : '#eeede9';
  return Object.assign(
    {
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      font: {family: getComputedStyle(document.body).fontFamily, size: 12, color: ink},
      margin: {l: 64, r: 16, t: 12, b: 48},
      xaxis: {gridcolor: grid, zerolinecolor: grid, linecolor: mut, tickcolor: mut},
      yaxis: {gridcolor: grid, zerolinecolor: grid, linecolor: mut, tickcolor: mut},
      legend: {orientation: 'h', y: -0.18},
      hoverlabel: {font: {family: getComputedStyle(document.body).fontFamily}}
    },
    extra || {},
    RD_MCSTYLE(extra, ink)
  );
}
// the RDM charts take the type of the Monte Carlo charts: titles in the
// serif face (14 px, left), text in Geist 11 px muted; the chart style (background, legend, titles) and PNG / SVG as the MC charts
const RD_MCSTYLE = (extra, ink) => {
  const o = {font: {family: '"Geist", "Segoe UI", sans-serif', size: 11, color: isDark() ? '#9b9a97' : '#787774'}};
  const t = extra && extra.title;
  if (t)
    o.title = {
      x: 0,
      xanchor: 'left',
      ...(typeof t === 'object' ? t : {text: t}),
      font: {family: '"Newsreader", Georgia, serif', size: 14, color: ink}
    };
  return o;
};
const RDPC = {
  displaylogo: false,
  responsive: true,
  modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d'],
  toImageButtonOptions: {format: 'png', scale: 3, filename: 'robust_decision_chart'}
};

async function rdResultsTab(B) {
  const runs = (await api('/api/rdm').catch(() => [])).filter(r => r.done);
  if (!runs.length) {
    B.innerHTML = '<div class="empty" style="margin:24px">No results yet: start a run on the "Run" tab.</div>';
    return;
  }
  if (!RDV.run || !runs.some(r => r.id === RDV.run)) RDV.run = runs[0].id;
  if (!RDV.info || RDV.info.id !== RDV.run) {
    RDV.info = await api('/api/rdm/' + RDV.run);
    RDV.mets = JSON.parse(JSON.stringify(RDV.info.metrics || []));
    RDV.ev = null;
    RDV.an.box = -1;
  }
  const I = RDV.info,
    key =
      RDV.run +
      '|' +
      (runs.find(r => r.id === RDV.run) || {}).done +
      '|' +
      JSON.stringify(RDV.mets.map(m => [m.id, m.var, m.filters, m.years, m.agg, m.divide, m.kind, m.terms, m.expr]));
  if (!RDV.ev || RDV.evKey !== key) {
    B.innerHTML = '<div class="empty">Computing the metrics of every strategy and future…</div>';
    RDV.ev = await jp(`/api/rdm/${RDV.run}/eval`, {metrics: RDV.mets});
    RDV.evKey = key;
  }
  const ev = RDV.ev,
    A = RDV.an;
  if (ev.error) {
    B.innerHTML = `<div class="ck error"><div class="ck-d">${esc(ev.error)}</div></div>`;
    return;
  }
  const bad = RDV.mets.filter(m => !Array.isArray(ev.values[m.id]));
  const okM = RDV.mets.filter(m => Array.isArray(ev.values[m.id]));
  if (!A.metric || !okM.some(m => m.id === A.metric)) A.metric = okM[0] ? okM[0].id : null;
  if (!A.strat || !ev.strategies.some(s => s.id === A.strat)) A.strat = ev.strategies[0] && ev.strategies[0].id;
  const st = I.state,
    nF = ev.futures.length;
  B.innerHTML = `<div class="rdres"><aside class="rdside">
      <label>Run<select id="rdrun">${runs.map(r => `<option value="${esc(r.id)}" ${r.id === RDV.run ? 'selected' : ''}>${esc(r.name || r.id)} (${r.strategies} × ${r.n})</option>`).join('')}</select></label>
      <p class="muted small">${nF} future${nF === 1 ? '' : 's'} solved for every strategy${st !== 'done' ? ` · run ${esc(st)}` : ''}${
        ev.strategies.some(s => s.failed.length)
          ? ' · not optimal: ' +
            ev.strategies
              .filter(s => s.failed.length)
              .map(s => `${esc(s.name)} ${s.failed.length}`)
              .join(', ')
          : ''
      }</p>
      <nav class="rdnav">${RD_VIEWS.map(([k, l, t]) => `<button type="button" data-v="${k}" aria-pressed="${A.view === k}"><b>${l}</b><span>${t}</span></button>`).join('')}</nav>
      <details class="rdmt" ${RDV.metOpen ? 'open' : ''}><summary>Metrics and targets <span class="muted">${okM.length}</span></summary>
        <div class="rdtt">${RDV.mets
          .map(
            (
              m,
              i
            ) => `<div class="rdtm"><b>${esc(m.name || m.var)}</b><div class="muted small">${esc(rdMetricText(m))}</div>${Array.isArray(ev.values[m.id]) ? '' : `<div class="sev error">${esc((ev.values[m.id] || {}).error || 'not computed')}</div>`}
          <div class="rdtr">${mcSel(
            'd' + i,
            [
              ['min', 'lower is better'],
              ['max', 'higher is better']
            ],
            m.dir || 'min'
          ).replace(
            `data-k="d${i}"`,
            `data-mi="${i}" data-mk="dir"`
          )}<label>Target ${m.dir === 'max' ? '≥' : '≤'}<input type="number" step="any" data-mi="${i}" data-mk="limit" value="${m.limit != null ? m.limit : ''}" placeholder="None" aria-label="Target of ${esc(m.name)}"></label></div></div>`
          )
          .join('')}</div>
        <div class="rdlogic"><label>Targets combined<select id="rdlg"><option value="all">All of them (AND)</option><option value="any">Any of them (OR)</option><option value="atleast">At least k of them</option><option value="one">One metric alone</option><option value="expr">Expression…</option></select></label>
          <select id="rdlgm" title="The metric whose target decides alone">${RDV.mets
            .filter(m => m.limit != null && m.limit !== '')
            .map(m => `<option value="${esc(m.id)}">${esc(m.id)} · ${esc(m.name || m.var)}</option>`)
            .join('')}</select>
          <input id="rdlge" placeholder="e.g. M1 and (M2 or M3)" title="Metric codes with and, or, not, ( )"><div class="muted small" id="rdlgt"></div></div>
        <div class="acts"><button type="button" class="btn sm" id="rdcopy" title="Use the metrics of the Set up page for this run (computed from its kept results, no new solve)">Use the Set up metrics</button></div></details>
    </aside><div class="rdmain" id="rdview"></div></div>`;
  B.querySelector('#rdrun').onchange = e => {
    RDV.run = e.target.value;
    RDV.info = null;
    rdResultsTab(B);
  };
  B.querySelectorAll('.rdnav [data-v]').forEach(
    b =>
      (b.onclick = () => {
        A.view = b.dataset.v;
        rdResultsTab(B);
      })
  );
  B.querySelector('details.rdmt').ontoggle = e => {
    RDV.metOpen = e.target.open;
  };
  const keepM = async () => {
    await jp(`/api/rdm/${RDV.run}/metrics`, {metrics: RDV.mets});
    RDV.info.metrics = JSON.parse(JSON.stringify(RDV.mets));
  };
  B.querySelectorAll('[data-mi]').forEach(
    inp =>
      (inp.onchange = async () => {
        const m = RDV.mets[+inp.dataset.mi];
        if (inp.dataset.mk === 'limit') m.limit = inp.value === '' ? null : +inp.value;
        else m.dir = inp.value;
        await keepM();
        rdResultsTab(B);
      })
  );
  {
    const L = rdLogic(),
      lg = B.querySelector('#rdlg'),
      lm = B.querySelector('#rdlgm'),
      le = B.querySelector('#rdlge'),
      lt = B.querySelector('#rdlgt');
    const T = RDV.mets.filter(m => m.limit != null && m.limit !== '');
    lg.value = L.mode || 'all';
    lm.value = L.metric || (T[0] && T[0].id) || '';
    le.value = L.expr || '';
    const show = () => {
      lm.hidden = lg.value !== 'one';
      le.hidden = lg.value !== 'expr';
      lt.textContent = T.length
        ? 'now: ' + rdLogicText(T) + ` · codes: ${T.map(m => m.id).join(', ')}`
        : 'give targets to the metrics first';
    };
    const apply = () => {
      RDV.design.logic = {mode: lg.value, metric: lm.value, expr: le.value.trim()};
      rdSave();
      show();
      rdResultsTab(B);
    };
    show();
    lg.onchange = apply;
    lm.onchange = apply;
    le.onchange = apply;
  }
  B.querySelector('#rdcopy').onclick = async () => {
    RDV.mets = JSON.parse(JSON.stringify(RDV.design.metrics));
    await keepM();
    toast('Metrics of the Set up page used for this run');
    rdResultsTab(B);
  };
  const V = B.querySelector('#rdview');
  if (!nF) {
    V.innerHTML = '<div class="empty">No future is solved optimally for every strategy yet.</div>';
    return;
  }
  if (!okM.length) {
    V.innerHTML = `<div class="ck error"><div class="ck-d">No metric could be computed: ${bad.map(m => esc(m.name + ': ' + ((ev.values[m.id] || {}).error || ''))).join('; ')}</div></div>`;
    return;
  }
  await {
    score: rdScore,
    regret: rdRegretView,
    targets: rdTargets,
    vuln: rdVuln,
    trade: rdTrade,
    futures: rdFutures,
    plot: rdPlot,
    enhance: rdEnhance
  }[A.view](V, ev, okM);
}
const rdMetSel = (id, mets, cur, all) =>
  `<select id="${id}">${all ? `<option value="__all" ${cur === '__all' ? 'selected' : ''}>All metrics at once (each scaled to its spread)</option>` : ''}${mets.map(m => `<option value="${esc(m.id)}" ${m.id === cur ? 'selected' : ''}>${esc(m.name || m.var)}</option>`).join('')}</select>`;
const rdUnit = m => (m.unit ? ' ' + esc(m.unit) : '');
const rdSw = i => `<span class="rdsw" style="background:${rdCol(i)}"></span>`;

/* Scorecard: one row per strategy; per metric the median, the 10-90 % range and the worst future; the robust choices in words */
async function rdScore(V, ev, mets) {
  const S = ev.strategies,
    tgt = mets.filter(m => m.limit != null && m.limit !== '');
  const cell = (m, s) => {
    const v = ev.values[m.id][s],
      md = rdQ(v, 0.5),
      lo = rdQ(v, 0.1),
      hi = rdQ(v, 0.9),
      w = m.dir === 'max' ? Math.min(...v) : Math.max(...v);
    return {md, lo, hi, w};
  };
  const best = m => {
    const c = S.map((_, s) => cell(m, s));
    const bm = c.reduce((b, x, i) => (rdBetter(m, x.md, c[b].md) ? i : b), 0),
      bw = c.reduce((b, x, i) => (rdBetter(m, x.w, c[b].w) ? i : b), 0);
    return {bm, bw};
  };
  const reg = rdScaledRegret(ev, mets),
    mr = reg.map(r => Math.max(...r)),
    p90 = reg.map(r => rdQ(r, 0.9)),
    robust = mr.indexOf(Math.min(...mr));
  const sat = tgt.length ? S.map((_, s) => ev.futures.filter((_, f) => rdSat(ev, tgt, s, f)).length / ev.futures.length) : null;
  const wins = S.map((_, s) => ev.futures.filter((_, f) => reg.every((r, o) => r[f] >= reg[s][f] - 1e-12)).length);
  const lines = [
    `<li><b>${esc(S[robust].name)}</b> has the smallest worst-case regret over all metrics: in no future is it far from the best strategy of that future.</li>`
  ];
  mets.forEach(m => {
    const {bm, bw} = best(m);
    lines.push(
      `<li>${esc(m.name || m.var)}: <b>${esc(S[bm].name)}</b> is best in a typical future (median)${bw !== bm ? `, <b>${esc(S[bw].name)}</b> in the worst future` : ' and in the worst future'}.</li>`
    );
  });
  if (sat) {
    const bs = sat.indexOf(Math.max(...sat));
    // the rule chosen for the targets (all, any, at least k, one, an expression), not always "all"
    lines.push(`<li>Targets (${esc(rdLogicText(tgt))}): <b>${esc(S[bs].name)}</b> meets them in ${Math.round(100 * sat[bs])} % of the futures.</li>`);
  }
  V.innerHTML = `<div class="rdhead"><h3>Scorecard</h3><p class="hint">For each strategy and metric: the median over the ${ev.futures.length} futures, the range that holds 80 % of them (10 % – 90 %) and the worst future. Best values in bold. "Regret" is the distance to the best strategy of each future, each metric scaled by its spread, the worst metric kept: a robust strategy keeps it small everywhere.</p></div>
    <ul class="rdkey">${lines.join('')}</ul>
    <div class="rdtw"><table class="rdtab"><thead><tr><th>Strategy</th>${mets.map(m => `<th>${esc(m.name || m.var)}${rdUnit(m)}<div class="muted small">${m.dir === 'max' ? 'higher' : 'lower'} is better</div></th>`).join('')}<th>Worst regret<div class="muted small">All metrics, scaled</div></th><th>Regret, 90 %</th><th>Best strategy in</th>${sat ? '<th>Meets all targets</th>' : ''}</tr></thead>
    <tbody>${S.map(
      (s, i) => `<tr><td>${rdSw(i)}<b>${esc(s.name)}</b></td>${mets
        .map(m => {
          const c = cell(m, i),
            b = best(m);
          return `<td><span class="${b.bm === i ? 'rdbest' : ''}">${rdF(c.md)}</span><div class="muted small">${rdF(c.lo)} – ${rdF(c.hi)}</div><div class="small">Worst <span class="${b.bw === i ? 'rdbest' : ''}">${rdF(c.w)}</span></div></td>`;
        })
        .join('')}
      <td><span class="${i === robust ? 'rdbest' : ''}">${rdF(mr[i])}</span></td><td>${rdF(p90[i])}</td><td>${Math.round((100 * wins[i]) / ev.futures.length)} % of futures</td>${sat ? `<td><span class="${sat[i] === Math.max(...sat) ? 'rdbest' : ''}">${Math.round(100 * sat[i])} %</span></td>` : ''}</tr>`
    ).join('')}</tbody></table></div>
    <div id="rdsc" class="rdplot"></div>`;
  const m = mets.find(x => x.id === RDV.an.metric) || mets[0],
    L = await rdLay({
      margin: {l: 140, r: 16, t: 28, b: 40},
      showlegend: false,
      title: {text: esc(m.name || m.var) + (m.unit ? ' (' + esc(m.unit) + ')' : '') + ' — every future', font: {size: 13}, x: 0},
      xaxis: Object.assign((await rdLay()).xaxis, {title: ''})
    });
  Plotly.newPlot(
    'rdsc',
    S.map((s, i) => ({
      type: 'box',
      orientation: 'h',
      x: ev.values[m.id][i],
      name: s.name,
      marker: {color: rdCol(i), size: 4},
      line: {width: 1.5},
      boxpoints: 'all',
      jitter: 0.4,
      pointpos: 0,
      fillcolor: rdCol(i) + '22',
      hovertemplate: '%{x}<extra>' + esc(s.name) + '</extra>'
    })),
    Object.assign(L, {height: 70 + 46 * S.length}),
    RDPC
  );
}

/* Regret: per strategy the distribution over the futures, mean / 90 % / worst, absolute or relative to the best */
async function rdRegretView(V, ev, mets) {
  const A = RDV.an,
    S = ev.strategies,
    all = A.rmetric === '__all',
    m = mets.find(x => x.id === A.rmetric) || mets[0];
  if (!all) A.rmetric = m.id;
  const R = all ? rdScaledRegret(ev, mets) : rdRegret(ev, m, A.rel),
    u = all ? ' (share of the spread)' : A.rel ? ' %' : rdUnit(m);
  const rows = S.map((s, i) => ({
    i,
    mean: rdMean(R[i]),
    p90: rdQ(R[i], 0.9),
    max: Math.max(...R[i]),
    zero: R[i].filter(x => x <= 1e-9).length
  })).sort((a, b) => a.max - b.max);
  V.innerHTML = `<div class="rdhead"><h3>Regret</h3><p class="hint">Regret = how much worse a strategy is, in a given future, than the best strategy for that same future (0 when it is the best). It does not need probabilities: a strategy with a small worst regret is a safe choice whatever happens ("minimax regret"); the 90 % value is less sensitive to a few extreme futures.</p></div>
    <div class="rdctl"><label>Metric${rdMetSel('rdrm', mets, all ? '__all' : m.id, true)}</label>${all ? '' : `<label class="chk"><input type="checkbox" id="rdrel" ${A.rel ? 'checked' : ''}> relative to the best (%)</label>`}</div>
    <div class="rdtw"><table class="rdtab"><thead><tr><th>Strategy (by worst regret)</th><th>Mean</th><th>90 % of futures below</th><th>Worst</th><th>Best strategy in</th></tr></thead><tbody>
    ${rows.map((r, k) => `<tr><td>${rdSw(r.i)}<b>${esc(S[r.i].name)}</b>${k === 0 ? ' <span class="sev info">Most robust</span>' : ''}</td><td>${rdF(r.mean)}${u}</td><td>${rdF(r.p90)}${u}</td><td>${rdF(r.max)}${u}</td><td>${Math.round((100 * r.zero) / ev.futures.length)} %</td></tr>`).join('')}</tbody></table></div>
    <div id="rdrg" class="rdplot"></div>`;
  V.querySelector('#rdrm').onchange = e => {
    A.rmetric = e.target.value;
    rdRegretView(V, ev, mets);
  };
  const rl = V.querySelector('#rdrel');
  if (rl)
    rl.onchange = () => {
      A.rel = rl.checked;
      rdRegretView(V, ev, mets);
    };
  const L = await rdLay({margin: {l: 140, r: 16, t: 10, b: 48}, showlegend: false});
  L.xaxis.title = {text: 'regret' + u};
  L.xaxis.rangemode = 'tozero';
  Plotly.newPlot(
    'rdrg',
    rows.map(r => ({
      type: 'violin',
      orientation: 'h',
      x: R[r.i],
      name: S[r.i].name,
      line: {color: rdCol(r.i), width: 1.5},
      fillcolor: rdCol(r.i) + '2e',
      points: 'all',
      pointpos: 0,
      jitter: 0.35,
      marker: {size: 3, color: rdCol(r.i)},
      meanline: {visible: true},
      spanmode: 'hard',
      hoverinfo: 'x'
    })),
    Object.assign(L, {height: 80 + 60 * S.length}),
    RDPC
  );
}

/* Targets (satisficing): share of futures where each target, and all of them, are met */
async function rdTargets(V, ev, mets) {
  const S = ev.strategies,
    T = mets.filter(m => m.limit != null && m.limit !== '');
  if (!T.length) {
    V.innerHTML = `<div class="rdhead"><h3>Targets</h3><p class="hint">A target is a limit a metric must respect (for example emissions at most X, cost at most Y). Give one or more in "Metrics and targets" (left): this view then shows in how many futures each strategy meets them — the "satisficing" view of robustness: a good strategy is one that is good enough in as many futures as possible.</p></div><div class="empty">No target yet.</div>`;
    return;
  }
  const share = (s, list) => ev.futures.filter((_, f) => list.every(m => rdMeets(m, ev.values[m.id][s][f]))).length / ev.futures.length;
  const all = S.map((_, s) => ev.futures.filter((_, f) => rdSat(ev, T, s, f)).length / ev.futures.length),
    ord = S.map((_, i) => i).sort((a, b) => all[b] - all[a]);
  V.innerHTML = `<div class="rdhead"><h3>Targets</h3><p class="hint">Share of the ${ev.futures.length} futures in which each strategy meets each target, and all of them together. Change a target on the left: the table follows at once.</p></div>
    <div class="rdtw"><table class="rdtab"><thead><tr><th>Strategy</th>${T.map(m => `<th>${esc(m.name || m.var)}<div class="muted small">${m.dir === 'max' ? '≥' : '≤'} ${rdF(+m.limit)}${rdUnit(m)}</div></th>`).join('')}<th>Combined<div class="muted small">${esc(rdLogicText(T))}</div></th></tr></thead><tbody>
    ${ord.map((s, k) => `<tr><td>${rdSw(s)}<b>${esc(S[s].name)}</b>${k === 0 ? ' <span class="sev info">Most often satisfying</span>' : ''}</td>${T.map(m => `<td>${Math.round(100 * share(s, [m]))} %</td>`).join('')}<td><b>${Math.round(100 * all[s])} %</b></td></tr>`).join('')}</tbody></table></div>
    <div id="rdtg" class="rdplot"></div>`;
  const L = await rdLay({margin: {l: 140, r: 24, t: 10, b: 48}, showlegend: false, barmode: 'group'});
  L.xaxis.range = [0, 100];
  L.xaxis.title = {text: '% of futures satisfied (' + rdLogicText(T) + ')'};
  Plotly.newPlot(
    'rdtg',
    [
      {
        type: 'bar',
        orientation: 'h',
        y: ord.map(s => S[s].name).reverse(),
        x: ord.map(s => 100 * all[s]).reverse(),
        marker: {color: ord.map(s => rdCol(s)).reverse()},
        text: ord.map(s => Math.round(100 * all[s]) + ' %').reverse(),
        textposition: 'outside',
        cliponaxis: false,
        hovertemplate: '%{y}: %{x:.0f} %<extra></extra>'
      }
    ],
    Object.assign(L, {height: 70 + 44 * S.length}),
    RDPC
  );
}

/* ---------- scenario discovery ---------- */
// PRIM (Friedman and Fisher 1999), peeling only: at each step remove the alpha share of the futures at the low or high end of
// one uncertainty, the cut that leaves the highest share of "cases of interest" in the box; the trajectory keeps every box
function rdPRIM(X, y, alpha = 0.05, minN = 5) {
  const n = X.length,
    K = n ? X[0].length : 0,
    lo0 = Array.from({length: K}, (_, d) => Math.min(...X.map(r => r[d]))),
    hi0 = Array.from({length: K}, (_, d) => Math.max(...X.map(r => r[d])));
  const tot = y.filter(Boolean).length;
  let idx = X.map((_, i) => i),
    lo = [...lo0],
    hi = [...hi0];
  const traj = [];
  const stat = () => {
    const pos = idx.filter(i => y[i]).length;
    traj.push({
      n: idx.length,
      pos,
      coverage: tot ? pos / tot : 0,
      density: idx.length ? pos / idx.length : 0,
      lo: [...lo],
      hi: [...hi],
      dims: lo.map((l, d) => (l > lo0[d] + 1e-12 || hi[d] < hi0[d] - 1e-12 ? d : -1)).filter(d => d >= 0)
    });
  };
  stat();
  while (idx.length > minN) {
    let best = null;
    for (let d = 0; d < K; d++) {
      const v = idx.map(i => X[i][d]).sort((a, b) => a - b),
        ql = rdQ(v, alpha),
        qu = rdQ(v, 1 - alpha);
      for (const side of ['lo', 'hi']) {
        let keep = idx.filter(i => (side === 'lo' ? X[i][d] > ql || (ql === v[0] ? false : X[i][d] >= ql && false) : X[i][d] < qu));
        if (side === 'lo' && keep.length === idx.length) continue;
        if (side === 'hi' && keep.length === idx.length) continue;
        if (keep.length < minN || !keep.length) continue;
        const mean = keep.filter(i => y[i]).length / keep.length;
        if (!best || mean > best.mean + 1e-12 || (Math.abs(mean - best.mean) <= 1e-12 && keep.length > best.keep.length))
          best = {d, side, cut: side === 'lo' ? ql : qu, keep, mean};
      }
    }
    if (!best) break;
    idx = best.keep;
    const v = idx.map(i => X[i][best.d]);
    lo[best.d] = Math.min(...v);
    hi[best.d] = Math.max(...v);
    stat();
  }
  return {traj, lo0, hi0, tot, n};
}
// a classification tree (Gini), small and readable: depth <= 3, leaves of at least minLeaf futures
function rdTree(X, y, depth = 3, minLeaf = 5) {
  const gini = ix => {
    const p = ix.filter(i => y[i]).length / (ix.length || 1);
    return 2 * p * (1 - p);
  };
  const K = X.length ? X[0].length : 0,
    imp = new Array(K).fill(0);
  const grow = (ix, dep) => {
    const pos = ix.filter(i => y[i]).length,
      node = {n: ix.length, pos};
    if (dep >= depth || ix.length < 2 * minLeaf || pos === 0 || pos === ix.length) return node;
    let best = null;
    const g0 = gini(ix);
    for (let d = 0; d < K; d++) {
      const vals = [...new Set(ix.map(i => X[i][d]))].sort((a, b) => a - b);
      if (vals.length < 2) continue;
      const step = Math.max(1, Math.floor(vals.length / 40));
      for (let j = step - 1; j < vals.length - 1; j += step) {
        const t = (vals[j] + vals[j + 1]) / 2,
          L = ix.filter(i => X[i][d] <= t),
          R = ix.filter(i => X[i][d] > t);
        if (L.length < minLeaf || R.length < minLeaf) continue;
        const g = g0 - (L.length * gini(L) + R.length * gini(R)) / ix.length;
        if (!best || g > best.g) best = {d, t, L, R, g};
      }
    }
    if (!best || best.g <= 1e-9) return node;
    imp[best.d] += best.g * ix.length;
    node.d = best.d;
    node.t = best.t;
    node.L = grow(best.L, dep + 1);
    node.R = grow(best.R, dep + 1);
    return node;
  };
  const root = grow(
      X.map((_, i) => i),
      0
    ),
    s = imp.reduce((a, b) => a + b, 0) || 1;
  return {root, importance: imp.map(v => v / s)};
}
function rdLeaves(node, names, box = {}) {
  // each leaf with its rule: one range per uncertainty (repeated cuts merged)
  if (node.d == null)
    return [
      {
        n: node.n,
        pos: node.pos,
        rule: Object.entries(box).map(([d, [lo, hi]]) =>
          lo != null && hi != null
            ? `${names[d]} between ${rdF(lo)} and ${rdF(hi)}`
            : lo != null
              ? `${names[d]} > ${rdF(lo)}`
              : `${names[d]} ≤ ${rdF(hi)}`
        )
      }
    ];
  const cur = box[node.d] || [null, null];
  return [
    ...rdLeaves(node.L, names, {...box, [node.d]: [cur[0], cur[1] == null ? node.t : Math.min(cur[1], node.t)]}),
    ...rdLeaves(node.R, names, {...box, [node.d]: [cur[0] == null ? node.t : Math.max(cur[0], node.t), cur[1]]})
  ];
}
// how strongly each uncertainty separates the cases of interest from the others (Kolmogorov-Smirnov distance, 0 to 1)
function rdKS(X, y) {
  const K = X.length ? X[0].length : 0;
  return Array.from({length: K}, (_, d) => {
    const a = X.filter((_, i) => y[i])
        .map(r => r[d])
        .sort((p, q) => p - q),
      b = X.filter((_, i) => !y[i])
        .map(r => r[d])
        .sort((p, q) => p - q);
    if (!a.length || !b.length) return 0;
    const all = [...new Set([...a, ...b])].sort((p, q) => p - q);
    let mx = 0,
      i = 0,
      j = 0;
    for (const v of all) {
      while (i < a.length && a[i] <= v) i++;
      while (j < b.length && b[j] <= v) j++;
      mx = Math.max(mx, Math.abs(i / a.length - j / b.length));
    }
    return mx;
  });
}

async function rdVuln(V, ev, mets) {
  const A = RDV.an,
    S = ev.strategies,
    si = Math.max(
      0,
      S.findIndex(s => s.id === A.strat)
    ),
    names = ev.factors,
    X = ev.X,
    T = mets.filter(m => m.limit != null && m.limit !== '');
  if (!names.length || !X.length) {
    V.innerHTML = '<div class="empty">The factor values of the futures are missing.</div>';
    return;
  }
  if (A.cond === 'targets' && !T.length) A.cond = 'regret';
  const m = mets.find(x => x.id === A.vmetric) || mets[0];
  A.vmetric = m.id;
  let y, what;
  if (A.cond === 'targets') {
    y = ev.futures.map((_, f) => !rdSat(ev, T, si, f));
    what = 'is not satisfied (' + rdLogicText(T) + ')';
  } else if (A.cond === 'regret') {
    const R = rdRegret(ev, m, true);
    y = R[si].map(r => r > +A.thr);
    what = `is more than ${A.thr} % worse than the best strategy on ${m.name || m.var}`;
  } else {
    const v = ev.values[m.id][si],
      lim = A.mval != null ? +A.mval : rdQ(v, m.dir === 'max' ? 0.25 : 0.75);
    A.mval = lim;
    y = v.map(x => (m.dir === 'max' ? x < lim : x > lim));
    what = `has ${m.name || m.var} ${m.dir === 'max' ? 'below' : 'above'} ${rdF(lim)}${rdUnit(m)}`;
  }
  const nPos = y.filter(Boolean).length,
    nF = y.length;
  const P = rdPRIM(X, y, 0.05, Math.max(5, Math.round(0.05 * nF))),
    tr = rdTree(X, y, 3, Math.max(3, Math.round(0.04 * nF))),
    ks = rdKS(X, y);
  if (A.box < 0 || A.box >= P.traj.length || A.boxKey !== JSON.stringify([A.strat, A.cond, A.vmetric, A.thr, A.mval, RDV.run])) {
    // the box with the best balance (density x coverage) that restricts few uncertainties
    let b = 0,
      sc = -1;
    P.traj.forEach((t, i) => {
      const s = t.coverage * t.density - 0.02 * t.dims.length;
      if (t.dims.length && s > sc) {
        sc = s;
        b = i;
      }
    });
    A.box = b;
    A.boxKey = JSON.stringify([A.strat, A.cond, A.vmetric, A.thr, A.mval, RDV.run]);
  }
  const bx = P.traj[A.box],
    leaves = rdLeaves(tr.root, names)
      .filter(l => l.pos / l.n >= 0.5 && l.pos >= 2)
      .sort((a, b) => b.pos - a.pos);
  const rng = d => {
    const lo = bx.lo[d],
      hi = bx.hi[d],
      a = P.lo0[d],
      b = P.hi0[d],
      w = b - a || 1;
    return `<div class="rdrng" title="${rdF(lo)} to ${rdF(hi)} of ${rdF(a)} to ${rdF(b)}"><i style="left:${(100 * (lo - a)) / w}%;width:${Math.max(1.5, (100 * (hi - lo)) / w)}%"></i></div>`;
  };
  const words = bx.dims.map(d => {
    const lo = bx.lo[d] > P.lo0[d] + 1e-12,
      hi = bx.hi[d] < P.hi0[d] - 1e-12;
    return `<b>${esc(names[d])}</b> ${lo && hi ? `between ${rdF(bx.lo[d])} and ${rdF(bx.hi[d])}` : lo ? `above ${rdF(bx.lo[d])}` : `below ${rdF(bx.hi[d])}`}`;
  });
  V.innerHTML = `<div class="rdhead"><h3>Vulnerabilities</h3><p class="hint">Scenario discovery: which combinations of the uncertainties lead to the futures where a strategy does badly? PRIM shrinks a "box" step by step around those futures; each step is a point of the trajectory (coverage: share of the bad futures inside the box; density: share of the futures in the box that are bad). Pick a point: a box with few uncertainties, high density and good coverage is a clear, usable story. The decision tree gives the same answer as rules. Values are the average draw of each uncertain parameter in a future (a multiplier, unless the factor sets values).</p></div>
    <div class="rdctl"><label>Strategy<select id="rdvs">${S.map(s => `<option value="${esc(s.id)}" ${s.id === A.strat ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <label>A future is bad when the strategy<select id="rdvc">${T.length ? `<option value="targets" ${A.cond === 'targets' ? 'selected' : ''}>Misses a target</option>` : ''}<option value="regret" ${A.cond === 'regret' ? 'selected' : ''}>Is far from the best strategy</option><option value="value" ${A.cond === 'value' ? 'selected' : ''}>Has a metric worse than a value</option></select></label>
      ${A.cond !== 'targets' ? `<label>Metric${rdMetSel('rdvm', mets, m.id)}</label>` : ''}${A.cond === 'regret' ? `<label>By more than (%)<input id="rdvt" type="number" min="0" step="any" value="${A.thr}"></label>` : ''}${A.cond === 'value' ? `<label>Value${rdUnit(m)}<input id="rdvv" type="number" step="any" value="${A.mval}"></label>` : ''}</div>
    <p class="rdsum"><b>${nPos}</b> of ${nF} futures are bad for <b>${esc(S[si].name)}</b> (it ${esc(what)}).</p>
    ${
      nPos === 0 || nPos === nF
        ? `<div class="empty">${nPos === 0 ? 'No bad future: nothing to discover with this definition (try a stricter one).' : 'Every future is bad: nothing to separate (try a looser definition).'}</div>`
        : `
    <div class="rdgrid2"><div><h4>PRIM trajectory</h4><div id="rdtr" class="rdplot"></div></div>
      <div><h4>The chosen box <span class="muted">${bx.n} futures · coverage ${Math.round(100 * bx.coverage)} % · density ${Math.round(100 * bx.density)} %</span></h4>
        ${bx.dims.length ? `<p class="rdsum">${esc(S[si].name)} does badly mostly when ${words.join(' and ')}: ${bx.pos} of the ${nPos} bad futures (${Math.round(100 * bx.coverage)} %) are in this box, and ${Math.round(100 * bx.density)} % of the futures in it are bad (${Math.round((100 * nPos) / nF)} % overall).</p>` : '<p class="muted">The first point: no uncertainty restricted yet. Pick a point to the left.</p>'}
        <div class="rdtw"><table class="rdtab rdbox"><thead><tr><th>Uncertainty</th><th>Range in the box (bar) within all futures</th><th>Separates bad futures</th></tr></thead><tbody>
        ${names.map((nm, d) => `<tr class="${bx.dims.includes(d) ? 'on' : ''}"><td>${esc(nm)}</td><td>${rng(d)}<span class="muted small">${rdF(bx.lo[d])} – ${rdF(bx.hi[d])}</span></td><td><div class="rdbar"><i style="width:${Math.round(100 * ks[d])}%"></i></div><span class="small">${ks[d].toFixed(2)}</span></td></tr>`).join('')}</tbody></table></div></div></div>
    <div class="rdgrid2"><div><h4>Decision tree <span class="muted">Groups of futures that are mostly bad</span></h4>
      ${leaves.length ? `<ol class="rdrules">${leaves.map(l => `<li><b>${l.pos} of ${l.n}</b> futures bad (${Math.round((100 * l.pos) / l.n)} %) when ${l.rule.map(esc).join(' and ') || 'always'}</li>`).join('')}</ol>` : '<p class="muted">No group of futures where most are bad: the bad futures are scattered.</p>'}
      <p class="muted small">Importance in the tree: ${names.map((nm, d) => `${esc(nm)} ${Math.round(100 * tr.importance[d])} %`).join(' · ')}</p></div>
      <div><h4>Two uncertainties <span class="muted">Every future, bad ones marked</span></h4><div class="rdctl"><label>x<select id="rdx">${names.map((nm, d) => `<option value="${d}" ${d === (A.px ?? bx.dims[0] ?? 0) ? 'selected' : ''}>${esc(nm)}</option>`).join('')}</select></label><label>y<select id="rdy">${names.map((nm, d) => `<option value="${d}" ${d === (A.py ?? bx.dims[1] ?? (names.length > 1 ? 1 : 0)) ? 'selected' : ''}>${esc(nm)}</option>`).join('')}</select></label></div><div id="rdxy" class="rdplot"></div></div></div>`
    }`;
  V.querySelector('#rdvs').onchange = e => {
    A.strat = e.target.value;
    A.box = -1;
    rdVuln(V, ev, mets);
  };
  V.querySelector('#rdvc').onchange = e => {
    A.cond = e.target.value;
    A.box = -1;
    A.mval = null;
    rdVuln(V, ev, mets);
  };
  const vm = V.querySelector('#rdvm');
  if (vm)
    vm.onchange = e => {
      A.vmetric = e.target.value;
      A.mval = null;
      A.box = -1;
      rdVuln(V, ev, mets);
    };
  const vt = V.querySelector('#rdvt');
  if (vt)
    vt.onchange = () => {
      A.thr = Math.max(0, +vt.value || 0);
      A.box = -1;
      rdVuln(V, ev, mets);
    };
  const vv = V.querySelector('#rdvv');
  if (vv)
    vv.onchange = () => {
      A.mval = +vv.value;
      A.box = -1;
      rdVuln(V, ev, mets);
    };
  if (nPos === 0 || nPos === nF) return;
  const L = await rdLay({margin: {l: 56, r: 16, t: 10, b: 48}, showlegend: false});
  L.xaxis.title = {text: 'coverage (% of the bad futures in the box)'};
  L.yaxis.title = {text: 'density (% bad in the box)'};
  L.xaxis.range = [0, 105];
  L.yaxis.range = [0, 105];
  Plotly.newPlot(
    'rdtr',
    [
      {
        type: 'scatter',
        mode: 'lines+markers',
        x: P.traj.map(t => 100 * t.coverage),
        y: P.traj.map(t => 100 * t.density),
        text: P.traj.map((t, i) => `step ${i}: ${t.dims.length} uncertaint${t.dims.length === 1 ? 'y' : 'ies'} restricted, ${t.n} futures`),
        hovertemplate: '%{text}<br>coverage %{x:.0f} % · density %{y:.0f} %<extra></extra>',
        line: {color: '#9a9993', width: 1},
        marker: {
          size: P.traj.map(t => 6 + 2 * t.dims.length),
          color: P.traj.map(t => t.dims.length),
          colorscale: [
            [0, '#d7e1ee'],
            [1, rdCol(0)]
          ],
          line: {width: 0}
        }
      },
      {
        type: 'scatter',
        mode: 'markers',
        x: [100 * bx.coverage],
        y: [100 * bx.density],
        marker: {size: 16, color: 'rgba(0,0,0,0)', line: {width: 2, color: '#b8503c'}},
        hoverinfo: 'skip'
      }
    ],
    Object.assign(L, {height: 320}),
    RDPC
  );
  document.getElementById('rdtr').on('plotly_click', e => {
    const p = e.points.find(q => q.curveNumber === 0);
    if (p) {
      A.box = p.pointIndex;
      rdVuln(V, ev, mets);
    }
  });
  const px = +V.querySelector('#rdx').value,
    py = +V.querySelector('#rdy').value;
  const drawXY = async (dx, dy) => {
    const L2 = await rdLay({margin: {l: 56, r: 16, t: 10, b: 48}});
    L2.xaxis.title = {text: names[dx]};
    L2.yaxis.title = {text: names[dy]};
    const inBox = r => bx.lo.every((l, d) => r[d] >= l - 1e-12 && r[d] <= bx.hi[d] + 1e-12);
    const shapes = bx.dims.length
      ? [
          {
            type: 'rect',
            x0: bx.lo[dx],
            x1: bx.hi[dx],
            y0: bx.lo[dy],
            y1: bx.hi[dy],
            line: {color: '#b8503c', width: 1.5, dash: 'dot'},
            fillcolor: 'rgba(184,80,60,0.05)'
          }
        ]
      : [];
    Plotly.newPlot(
      'rdxy',
      [
        {
          type: 'scatter',
          mode: 'markers',
          name: 'good',
          x: X.filter((_, i) => !y[i]).map(r => r[dx]),
          y: X.filter((_, i) => !y[i]).map(r => r[dy]),
          marker: {size: 7, color: '#9a9993', opacity: 0.55, line: {width: 0}}
        },
        {
          type: 'scatter',
          mode: 'markers',
          name: 'bad',
          x: X.filter((_, i) => y[i]).map(r => r[dx]),
          y: X.filter((_, i) => y[i]).map(r => r[dy]),
          marker: {size: 8, symbol: 'x', color: '#b8503c', line: {width: 0}},
          text: X.map((r, i) => [r, i])
            .filter(([, i]) => y[i])
            .map(([r]) => (inBox(r) ? 'in the box' : 'outside the box')),
          hovertemplate: '%{text}<extra>Bad</extra>'
        }
      ],
      Object.assign(L2, {height: 320, shapes, legend: {orientation: 'h', y: -0.25}}),
      RDPC
    );
  };
  await drawXY(px, py);
  V.querySelector('#rdx').onchange = e => {
    A.px = +e.target.value;
    drawXY(A.px, +V.querySelector('#rdy').value);
  };
  V.querySelector('#rdy').onchange = e => {
    A.py = +e.target.value;
    drawXY(+V.querySelector('#rdx').value, A.py);
  };
}

/* Trade-offs: two metrics, every future (one point per strategy and future), medians as large marks */
async function rdTrade(V, ev, mets) {
  const A = RDV.an,
    S = ev.strategies;
  if (mets.length < 2) {
    V.innerHTML = `<div class="rdhead"><h3>Trade-offs</h3></div><div class="empty">Add a second metric (for example emissions next to cost) to see the trade-off between them.</div>`;
    return;
  }
  const mx = mets.find(m => m.id === A.tx) || mets[0],
    my = mets.find(m => m.id === A.ty && m.id !== mx.id) || mets.find(m => m.id !== mx.id);
  A.tx = mx.id;
  A.ty = my.id;
  V.innerHTML = `<div class="rdhead"><h3>Trade-offs</h3><p class="hint">Each small point is one future for one strategy; the large mark is the strategy's median. A strategy whose cloud is lower-left (when lower is better on both) dominates; overlapping clouds mean the choice depends on the future.</p></div>
    <div class="rdctl"><label>x${rdMetSel('rdtx', mets, mx.id)}</label><label>y${rdMetSel('rdty', mets, my.id)}</label><label class="chk"><input type="checkbox" id="rdtl" ${A.tlines ? 'checked' : ''}> link each future across strategies</label></div><div id="rdto" class="rdplot"></div>`;
  V.querySelector('#rdtx').onchange = e => {
    A.tx = e.target.value;
    rdTrade(V, ev, mets);
  };
  V.querySelector('#rdty').onchange = e => {
    A.ty = e.target.value;
    rdTrade(V, ev, mets);
  };
  V.querySelector('#rdtl').onchange = e => {
    A.tlines = e.target.checked;
    rdTrade(V, ev, mets);
  };
  const X = ev.values[mx.id],
    Y = ev.values[my.id],
    L = await rdLay({margin: {l: 72, r: 16, t: 10, b: 60}});
  L.xaxis.title = {
    text: (mx.name || mx.var) + (mx.unit ? ' (' + mx.unit + ')' : '') + (mx.dir === 'max' ? ' — higher is better' : ' — lower is better')
  };
  L.yaxis.title = {text: (my.name || my.var) + (my.unit ? ' (' + my.unit + ')' : '')};
  const tr = [];
  if (A.tlines)
    ev.futures.forEach((fu, f) =>
      tr.push({
        type: 'scatter',
        mode: 'lines',
        x: S.map((_, s) => X[s][f]),
        y: S.map((_, s) => Y[s][f]),
        line: {color: '#9a9993', width: 0.5},
        opacity: 0.35,
        hoverinfo: 'skip',
        showlegend: false
      })
    );
  S.forEach((s, i) => {
    tr.push({
      type: 'scatter',
      mode: 'markers',
      name: s.name,
      x: X[i],
      y: Y[i],
      text: ev.futures.map(f => 'future ' + f),
      marker: {size: 6, color: rdCol(i), opacity: 0.45, line: {width: 0}},
      hovertemplate: '%{text}<br>%{x:,.4g} · %{y:,.4g}<extra>' + esc(s.name) + '</extra>'
    });
    tr.push({
      type: 'scatter',
      mode: 'markers+text',
      name: s.name + ' (median)',
      x: [rdQ(X[i], 0.5)],
      y: [rdQ(Y[i], 0.5)],
      text: [s.name],
      textposition: 'top center',
      textfont: {size: 11},
      marker: {size: 15, color: rdCol(i), line: {width: 2, color: isDark() ? '#1a1a19' : '#fcfcfb'}},
      showlegend: false,
      hovertemplate: 'median<extra>' + esc(s.name) + '</extra>'
    });
  });
  Plotly.newPlot('rdto', tr, Object.assign(L, {height: 460}), RDPC);
}

/* Futures: the table (factor values and metrics), CSV for R / Python / Excel */
function rdFutures(V, ev, mets) {
  const S = ev.strategies,
    nm = ev.factors,
    A = RDV.an,
    m = mets.find(x => x.id === A.fmetric) || mets[0];
  A.fmetric = m.id;
  const MAXR = 300;
  V.innerHTML = `<div class="rdhead"><h3>Futures</h3><p class="hint">Every future solved for every strategy: the draw of each uncertainty (average over its items and years) and the metric of each strategy; the best strategy of the future in bold. The CSV holds every metric.</p></div>
    <div class="rdctl"><label>Metric${rdMetSel('rdfm', mets, m.id)}</label><button type="button" class="btn" id="rdcsv">Download CSV (all metrics)</button></div>
    <div class="rdtw rdtall"><table class="rdtab"><thead><tr><th>Future</th>${nm.map(n => `<th>${esc(n)}</th>`).join('')}${S.map((s, i) => `<th>${rdSw(i)}${esc(s.name)}</th>`).join('')}</tr></thead><tbody>
    ${ev.futures
      .slice(0, MAXR)
      .map((fu, f) => {
        const v = S.map((_, s) => ev.values[m.id][s][f]),
          b = v.reduce((bi, x, i) => (rdBetter(m, x, v[bi]) ? i : bi), 0);
        return `<tr><td>${fu}</td>${ev.X[f].map(x => `<td>${rdF(x)}</td>`).join('')}${v.map((x, i) => `<td class="${i === b ? 'rdbest' : ''}">${rdF(x)}</td>`).join('')}</tr>`;
      })
      .join('')}</tbody></table></div>
    ${ev.futures.length > MAXR ? `<p class="muted small">First ${MAXR} of ${ev.futures.length} futures shown; the CSV has all.</p>` : ''}`;
  V.querySelector('#rdfm').onchange = e => {
    A.fmetric = e.target.value;
    rdFutures(V, ev, mets);
  };
  V.querySelector('#rdcsv').onclick = () => {
    const q = s => (/[",\n]/.test(s) ? '"' + String(s).replace(/"/g, '""') + '"' : s);
    const head = ['future', ...nm.map(n => 'X: ' + n), ...mets.flatMap(mt => S.map(s => `${mt.name || mt.var} | ${s.name}`))];
    const rows = ev.futures.map((fu, f) => [fu, ...ev.X[f], ...mets.flatMap(mt => S.map((_, s) => ev.values[mt.id][s][f]))]);
    const blob = new Blob([[head, ...rows].map(r => r.map(q).join(',')).join('\n')], {type: 'text/csv'});
    saveFile(`${RDV.info.name || RDV.run}_futures.csv`, blob, 'text/csv');
  };
}

/* ---------- formula metrics: a metric written as a formula of inputs and outputs.
   Each term is a series over the years, filtered on its sets: an OUTPUT (a result kept by the run), an INPUT (a parameter of the
   model in that future: its drawn value when it is uncertain, otherwise the value of the strategy) or the OBJECTIVE. The formula is
   applied year by year (a term without years counts in every year), then the years are reduced (sum, average, last…): engine rdm.py. */
const RD_FUN = 'log (natural), ln, log10, exp, sqrt, abs, min, max, pow, ^ (power), pi, e';
const rdParams = () => {
  const P =
    SCHEMA && SCHEMA.params
      ? [...SCHEMA.params.values()].filter(x => !x.computed && x.dims.length).map(x => x.name)
      : Object.keys(M.D.params);
  const has = new Set(Object.keys(M.D.params).filter(p => M.D.params[p].recs.length));
  return [...P.filter(p => has.has(p)).sort(), ...P.filter(p => !has.has(p)).sort()];
};
function rdFormulaCard(m, i, open) {
  const T = m.terms || [],
    dimsT = t =>
      (t.src === 'input'
        ? typeof dimsOf === 'function' && t.param
          ? dimsOf(t.param)
          : []
        : t.src === 'output'
          ? rdDims(t.var)
          : []
      ).filter(d => (d !== 'YEAR' && d !== 'TIMESLICE' && d !== 'REGION') || (d === 'REGION' && (setOf('REGION') || []).length > 1));
  const trow = (t, j) => {
    const dims = dimsT(t);
    return `<div class="rdterm" data-j="${j}"><div class="row4"><label>Name<input data-t="n" value="${esc(t.n)}" maxlength="12" style="width:60px"></label>
      <label>Kind<select data-t="src"><option value="output" ${t.src === 'output' ? 'selected' : ''}>Output (result)</option><option value="input" ${t.src === 'input' ? 'selected' : ''}>Input (parameter)</option><option value="objective" ${t.src === 'objective' ? 'selected' : ''}>Objective</option></select></label>
      ${
        t.src === 'objective'
          ? '<span></span>'
          : t.src === 'input'
            ? `<label>Parameter<select data-t="param">${rdParams()
                .map(p => `<option ${p === t.param ? 'selected' : ''}>${esc(p)}</option>`)
                .join('')}</select></label>`
            : `<label>Result<select data-t="var">${rdVars()
                .filter(v => v !== 'Objective')
                .map(v => `<option ${v === t.var ? 'selected' : ''}>${esc(v)}</option>`)
                .join('')}</select></label>`
      }
      ${
        t.src === 'objective'
          ? '<span></span>'
          : `<label>Over the items${mcSel(
              'how' + j,
              [
                ['sum', 'Sum'],
                ['mean', 'Average'],
                ['max', 'Largest item'],
                ['min', 'Smallest item']
              ],
              t.how || 'sum'
            ).replace(`data-k="how${j}"`, 'data-t="how"')}</label>`
      }</div>
      ${dims
        .map(d => {
          const mem = setOf(d) || [],
            cur = (t.filters || {})[d] || [];
          return `<div class="rdfl"><span>${esc(d.toLowerCase())}</span><select multiple data-tf="${esc(d)}" size="${Math.min(5, Math.max(2, mem.length))}">${mem.map(x => `<option ${cur.includes(String(x)) ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select><span class="muted small">${cur.length ? cur.length + ' selected' : 'all'}</span></div>`;
        })
        .join('')}
      <div class="acts"><button type="button" class="btn sm danger" data-tdel="${j}" ${T.length < 2 ? 'disabled' : ''}>Remove ${esc(t.n)}</button></div></div>`;
  };
  return `<details class="rdm rdform" data-i="${i}" ${open ? 'open' : ''}><summary><b>${esc(m.name || 'Formula')}</b><span class="muted">${esc(rdMetricText(m))}</span><span class="rdbad">${m.dir === 'max' ? 'higher is better' : 'lower is better'}${m.limit != null && m.limit !== '' ? ` · target ${m.dir === 'max' ? '≥' : '≤'} ${rdF(+m.limit)}` : ''}</span></summary>
    <div class="rdmb"><div class="row2"><label>Name<input data-m="name" value="${esc(m.name || '')}"></label><label>Kind<select data-m="kind"><option value="result">One result</option><option value="formula" selected>Formula of inputs and outputs</option></select></label></div>
    <div class="rdterms">${T.map(trow).join('')}</div>
    <div class="acts"><button type="button" class="btn sm" data-tadd="1">+ Term</button></div>
    <label class="rdexpr">Formula<input data-m="expr" value="${esc(m.expr || '')}" placeholder="e.g. A * B / log(A * B)" spellcheck="false"></label>
    <div class="rdlive" aria-live="polite"><div class="rdmath"></div><div class="rdwhere"></div>
      <div class="rdchk"><label>Check it on<select class="rdrun"><option value="">The base data (inputs only)</option></select></label><button type="button" class="btn sm rdcalc">Compute</button><button type="button" class="btn sm rdxl" hidden title="The years, every term and the formula in an Excel sheet">Excel</button><span class="rdval muted"></span></div><div class="rdyears"></div><div class="rdspark"></div></div>
    <p class="hint">Terms: ${T.map(t => `<b>${esc(t.n)}</b>`).join(', ')}. Functions: ${RD_FUN}. Applied in each year (a term without years, like the objective, counts in every year), then the years are reduced as chosen below. A year where the formula cannot be computed (log of 0, division by 0) is left out.</p>
    <div class="row3"><label>Years from<input data-m="y0" type="number" value="${m.years && m.years[0] != null ? m.years[0] : ''}" placeholder="First"></label><label>to<input data-m="y1" type="number" value="${m.years && m.years[1] != null ? m.years[1] : ''}" placeholder="Last"></label><label>Over the years${mcSel('agg', RD_AGG, m.agg || 'sum').replace('data-k="agg"', 'data-m="agg"')}</label></div>${rdAggExtra(m)}
    <div class="row3"><label>Divide by<input data-m="divide" type="number" step="any" value="${m.divide || 1}"></label><label>Unit<input data-m="unit" value="${esc(m.unit || '')}"></label><label>Better when${mcSel(
      'dir',
      [
        ['min', 'lower'],
        ['max', 'higher']
      ],
      m.dir || 'min'
    ).replace('data-k="dir"', 'data-m="dir"')}</label></div>
    <div class="row2"><label>Target (optional)<input data-m="limit" type="number" step="any" value="${m.limit != null ? m.limit : ''}" placeholder="None"></label><div class="acts" style="align-self:end"><button type="button" class="btn sm danger" data-mdel="${i}">Remove the metric</button></div></div></div></details>`;
}
function rdFormulaWire(d, m, redo) {
  if (m.kind !== 'formula') return;
  const T = (m.terms = m.terms || []);
  const ex = d.querySelector('[data-m="expr"]'),
    live = d.querySelector('.rdlive');
  if (ex && live) {
    const upd = () => rdLiveFormula(live, {...m, expr: ex.value});
    ex.oninput = upd;
    upd();
    rdRunList().then(rs => {
      const sel = live.querySelector('.rdrun');
      if (!sel) return;
      sel.innerHTML =
        '<option value="">The base data (inputs only)</option>' +
        rs
          .map(r => `<option value="${esc(r.id)}">${esc(r.name || r.id)}${r.objective != null ? ' · ' + rdF(r.objective) : ''}</option>`)
          .join('');
    });
    live.querySelector('.rdcalc').onclick = () => rdCheckFormula(live, {...m, expr: ex.value}, live.querySelector('.rdrun').value);
    live.querySelector('.rdxl').onclick = () => rdFormulaXlsx(live);
  }
  d.querySelectorAll('.rdterm').forEach(row => {
    const t = T[+row.dataset.j];
    row.querySelectorAll('[data-t]').forEach(
      inp =>
        (inp.onchange = () => {
          const k = inp.dataset.t,
            v = inp.value.trim();
          if (k === 'n') {
            const n = v.replace(/[^A-Za-z0-9_]/g, '').replace(/^\d+/, '');
            if (!n || T.some(x => x !== t && x.n === n)) {
              toast('Each term needs its own name (letters, digits, _)');
              inp.value = t.n;
              return;
            }
            if (m.expr) m.expr = m.expr.replace(new RegExp('\\b' + t.n + '\\b', 'g'), n);
            t.n = n;
          } else {
            t[k] = v;
            if (k === 'src' || k === 'param' || k === 'var') t.filters = {};
          }
          redo();
        })
    );
    row.querySelectorAll('[data-tf]').forEach(
      sel =>
        (sel.onchange = () => {
          t.filters = t.filters || {};
          t.filters[sel.dataset.tf] = [...sel.selectedOptions].map(o => o.value);
          redo();
        })
    );
    const del = row.querySelector('[data-tdel]');
    if (del)
      del.onclick = () => {
        T.splice(+del.dataset.tdel, 1);
        redo();
      };
  });
  const add = d.querySelector('[data-tadd]');
  if (add)
    add.onclick = () => {
      const used = new Set(T.map(t => t.n));
      const n = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find(c => !used.has(c)) || 'T' + (T.length + 1);
      T.push({n, src: 'output', var: 'TotalCapacityAnnual', filters: {}, how: 'sum'});
      redo();
    };
}

/* ---------- R of XLRM — the model (the interlinkage diagram of the model used in the RDM):
   the systems of the model and the commodities that link them (the interlinkage diagram), with the size of the model. */
function rdRSection() {
  const S = typeof SYSTEMS !== 'undefined' ? SYSTEMS.list : [],
    nT = setOf('TECHNOLOGY').length,
    nC = setOf('COMMODITY').length,
    nS = setOf('STORAGE').length,
    nU = setOf('UDC').length;
  const m = S.length && typeof sysMapSVG === 'function' ? sysMapSVG('rdr') : null;
  return `<section class="rdsec rdwide rdR"><h3><span class="rdn">R</span>Model <span class="muted">how the decisions and the futures become results</span></h3>
    <p class="hint">The model solved for every strategy and future: ${esc(M.meta.name || 'model')} · ${esc(SCHEMA ? SCHEMA.name : '')} · ${nT} technologies, ${nC} commodities, ${nS} storages, ${nU} user constraints, ${(M.years || []).length} years, ${setOf('TIMESLICE').length} time slices.
      ${S.length ? `Its systems and the commodities that link them (interlinkages): an uncertainty in one system reaches the others through these links.` : ''}</p>
    ${m ? `<div class="smwrap rdmap">${m.svg}</div>` : '<div class="empty">No systems yet: define them (Systems) to see how the parts of the model are linked.</div>'}
    <div class="acts"><button type="button" class="btn" id="rdrdiag">Open the diagram</button><button type="button" class="btn" id="rdrsys">${S.length ? 'Interlinkages (table)…' : 'Systems…'}</button></div></section>`;
}

/* ---------- chart builder (any variable, filters, two y-axes).
   X: a metric, an uncertainty (its draw in each future) or the future number. Y (left axis): one or more metrics; Y2 (right axis,
   optional): one metric. Marks: points, lines (sorted by X), box plots by strategy. Colour = strategy. Filters: keep only the futures
   where chosen metrics or uncertainties are inside ranges (several filters = all of them). */
async function rdPlot(V, ev, mets) {
  const S = ev.strategies,
    P = (RDV.plot = RDV.plot || {x: 'f:0', y: [mets[0].id], y2: '', mark: 'points', flt: [], strat: S.map(s => s.id)});
  const srcs = [
    ...mets.map(m => ['m:' + m.id, (m.name || m.var) + ' (metric)']),
    ...ev.factors.map((n, i) => ['f:' + i, n + ' (uncertainty)']),
    ['k', 'future number']
  ];
  const valOf = (src, s, f) =>
    src === 'k'
      ? ev.futures[f]
      : src.startsWith('f:')
        ? (ev.X[f] || [])[+src.slice(2)]
        : ev.values[src.slice(2)]
          ? ev.values[src.slice(2)][s][f]
          : null;
  const lab = src => (srcs.find(x => x[0] === src) || [0, src])[1];
  const keep = (s, f) =>
    P.flt.every(c => {
      const v = valOf(c.src, s, f);
      return v != null && (c.lo === '' || c.lo == null || v >= +c.lo) && (c.hi === '' || c.hi == null || v <= +c.hi);
    });
  const sel = (id, cur, opts, multi) =>
    `<select id="${id}" ${multi ? 'multiple size="4"' : ''}>${opts.map(([v, l]) => `<option value="${esc(v)}" ${(multi ? cur.includes(v) : cur === v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  V.innerHTML = `<div class="rdhead"><h3>Chart builder</h3><p class="hint">Choose what goes on each axis; the right axis takes a metric of another unit. Filters keep only the futures inside the ranges (for example "gas price above 1.2" and "emissions below 500"). Colour = strategy. Chart toolbar: chart style, PNG, SVG.</p></div>
    <div class="rdctl rdpb"><label>X axis${sel('pbx', P.x, srcs)}</label><label>Y axis (left)${sel(
      'pby',
      P.y,
      srcs.filter(x => x[0].startsWith('m:')),
      true
    )}</label>
      <label>Y axis (right, optional)${sel('pby2', P.y2, [['', '— none —'], ...srcs.filter(x => x[0].startsWith('m:'))])}</label>
      <label>Marks${sel('pbm', P.mark, [
        ['points', 'points'],
        ['lines', 'lines (sorted by X)'],
        ['box', 'box plots by strategy'],
        ['mean', 'mean by strategy (bars)']
      ])}</label>
      <label>Strategies${sel(
        'pbs',
        P.strat,
        S.map(s => [s.id, s.name]),
        true
      )}</label></div>
    <div class="rdflts">${P.flt.map((c, i) => `<div class="rdflt">${sel('pfs' + i, c.src, srcs)}<input data-fl="${i}" data-k="lo" value="${c.lo ?? ''}" placeholder="From"><input data-fl="${i}" data-k="hi" value="${c.hi ?? ''}" placeholder="To"><button type="button" class="btn sm" data-fx="${i}">✕</button></div>`).join('')}
      <button type="button" class="btn sm" id="pbadd">+ Filter on a variable</button><span class="muted small" id="pbn"></span></div>
    <div id="rdpbc" class="rdplot"></div>`;
  const redraw = () => rdPlot(V, ev, mets);
  V.querySelector('#pbx').onchange = e => {
    P.x = e.target.value;
    redraw();
  };
  V.querySelector('#pby').onchange = e => {
    P.y = [...e.target.selectedOptions].map(o => o.value);
    redraw();
  };
  V.querySelector('#pby2').onchange = e => {
    P.y2 = e.target.value;
    redraw();
  };
  V.querySelector('#pbm').onchange = e => {
    P.mark = e.target.value;
    redraw();
  };
  V.querySelector('#pbs').onchange = e => {
    P.strat = [...e.target.selectedOptions].map(o => o.value);
    redraw();
  };
  V.querySelector('#pbadd').onclick = () => {
    P.flt.push({src: srcs[0][0], lo: '', hi: ''});
    redraw();
  };
  P.flt.forEach((c, i) => {
    V.querySelector('#pfs' + i).onchange = e => {
      c.src = e.target.value;
      redraw();
    };
  });
  V.querySelectorAll('[data-fl]').forEach(
    inp =>
      (inp.onchange = () => {
        P.flt[+inp.dataset.fl][inp.dataset.k] = inp.value.trim();
        redraw();
      })
  );
  V.querySelectorAll('[data-fx]').forEach(
    b =>
      (b.onclick = () => {
        P.flt.splice(+b.dataset.fx, 1);
        redraw();
      })
  );
  const L = await rdLay({margin: {l: 70, r: P.y2 ? 70 : 16, t: 16, b: 56}, showlegend: true, legend: {orientation: 'h', y: -0.18}});
  const tr = [],
    dash = ['solid', 'dot', 'dash', 'dashdot'];
  let nk = 0;
  S.forEach((s, si) => {
    if (!P.strat.includes(s.id)) return;
    const fs = ev.futures.map((_, f) => f).filter(f => keep(si, f));
    nk = Math.max(nk, fs.length);
    const series = [...P.y.map((y, j) => [y, 'y', j]), ...(P.y2 ? [[P.y2, 'y2', P.y.length]] : [])];
    for (const [y, ax, j] of series) {
      const nm = `${s.name} · ${lab(y)}${ax === 'y2' ? ' (right)' : ''}`;
      if (P.mark === 'box')
        tr.push({
          type: 'box',
          name: nm,
          y: fs.map(f => valOf(y, si, f)),
          x: fs.map(() => s.name + (series.length > 1 ? ' · ' + lab(y) : '')),
          yaxis: ax,
          marker: {color: rdCol(si)},
          line: {color: rdCol(si)},
          boxpoints: 'outliers'
        });
      else if (P.mark === 'mean') {
        const v = fs.map(f => valOf(y, si, f)).filter(v => v != null);
        tr.push({
          type: 'bar',
          name: nm,
          x: [s.name],
          y: [rdMean(v)],
          yaxis: ax,
          marker: {color: rdCol(si), opacity: ax === 'y2' ? 0.55 : 1},
          offsetgroup: ax + j
        });
      } else {
        let pts = fs.map(f => [valOf(P.x, si, f), valOf(y, si, f), ev.futures[f]]).filter(p => p[0] != null && p[1] != null);
        if (P.mark === 'lines') pts.sort((a, b) => a[0] - b[0]);
        tr.push({
          type: 'scatter',
          mode: P.mark === 'lines' ? 'lines+markers' : 'markers',
          name: nm,
          x: pts.map(p => p[0]),
          y: pts.map(p => p[1]),
          customdata: pts.map(p => p[2]),
          yaxis: ax,
          marker: {
            color: rdCol(si),
            size: 6,
            symbol: ax === 'y2' ? 'diamond-open' : j ? ['circle-open', 'square', 'triangle-up'][j % 3] : 'circle'
          },
          line: {color: rdCol(si), width: 1.5, dash: dash[(ax === 'y2' ? 2 : j) % 4]},
          hovertemplate: `future %{customdata}<br>${esc(lab(P.x))}: %{x:.4g}<br>${esc(lab(y))}: %{y:.4g}<extra>${esc(s.name)}</extra>`
        });
      }
    }
  });
  V.querySelector('#pbn').textContent = `${nk} of ${ev.futures.length} futures kept`;
  if (P.mark !== 'box' && P.mark !== 'mean') L.xaxis.title = {text: lab(P.x)};
  L.yaxis = Object.assign(L.yaxis || {}, {title: {text: P.y.map(lab).join(', ')}});
  if (P.y2) L.yaxis2 = {title: {text: lab(P.y2)}, overlaying: 'y', side: 'right', showgrid: false, zeroline: false, color: L.yaxis.color};
  if (P.mark === 'box') L.boxmode = 'group';
  Plotly.newPlot('rdpbc', tr, Object.assign(L, {height: 520}), RDPC);
}

/* ---------- strategic enhancement: a strategy improved as a new scenario, tested on the same futures.
   1) a new Studio scenario is made and opened for editing (the diagram shows the banner); 2) the enhanced strategy = the scenarios of
   the strategy + the new one; 3) it is added to the SAME run and solved on its failed futures or on all of them: the futures are drawn
   again with the same seed (identical), the strategies already solved are not solved again. */
async function rdEnhance(V, ev, mets) {
  const S = ev.strategies,
    I = RDV.info,
    A = RDV.an,
    T = mets.filter(m => m.limit != null && m.limit !== '');
  if (!A.ebase || !S.some(s => s.id === A.ebase))
    A.ebase = (S.find(s => !(I.strategies.find(x => x.id === s.id) || {}).enhances) || S[0]).id;
  const si = S.findIndex(s => s.id === A.ebase),
    base = I.strategies.find(s => s.id === A.ebase) || {scenarios: []};
  const failed = T.length
    ? ev.futures
        .map((k, f) => [k, f])
        .filter(([, f]) => !rdSat(ev, T, si, f))
        .map(([k]) => k - 1)
    : [];
  const E = RDV.enh && RDV.enh.run === RDV.run && RDV.enh.base === A.ebase ? RDV.enh : null;
  const enh = I.strategies.filter(s => s.enhances),
    only = I.only || {};
  V.innerHTML = `<div class="rdhead"><h3>Enhance a strategy</h3><p class="hint">Improve a strategy where it fails: add a new scenario on top of it, edit it in the diagram, then solve the enhanced strategy on the futures where the original failed (to see what the enhancement repairs) or on all futures (to look for new failures). The futures are drawn again with the same seed: they are exactly the same futures. Nothing of the strategies already solved is changed.</p></div>
    <div class="rdctl"><label>Strategy to enhance<select id="enb">${S.map(s => `<option value="${esc(s.id)}" ${s.id === A.ebase ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <span class="muted small">${T.length ? `fails in <b>${failed.length}</b> of ${ev.futures.length} futures (${esc(rdLogicText(T))})` : 'give targets to the metrics (left) to know where it fails'}</span></div>
    <ol class="rdsteps">
      <li><b>New scenario</b> on top of <i>${esc(S[si].name)}</i> (${base.scenarios.length ? base.scenarios.map(id => esc(scenName(id))).join(' + ') : 'the base model'}).
        <div class="row2"><label>Name<input id="enn" value="${esc(E ? scenName(E.scen) : S[si].name + ' enhanced')}"></label><div class="acts" style="align-self:end">${E ? `<button type="button" class="btn" id="enedit">Edit it in the diagram</button>` : `<button type="button" class="btn pri" id="enmk">Create and edit in the diagram</button>`}</div></div>
        ${E ? `<p class="muted small">Scenario <b>${esc(scenName(E.scen))}</b>: ${scenCount(E.scen)} change(s) so far.</p>` : ''}</li>
      <li><b>Solve the enhanced strategy</b> <span class="muted">(${esc(S[si].name)} + the new scenario)</span>
        <div class="regs"><label class="chk"><input type="radio" name="enk" value="failed" ${failed.length ? 'checked' : 'disabled'}> only the ${failed.length} failed futures</label><label class="chk"><input type="radio" name="enk" value="all" ${failed.length ? '' : 'checked'}> all ${I.n || ev.n} futures</label></div>
        <div class="acts"><button type="button" class="btn pri" id="engo" ${E ? '' : 'disabled'}>Solve</button><span class="muted small" id="enmsg"></span></div></li></ol>
    ${
      enh.length
        ? `<h4>Enhanced strategies of this run</h4><table class="rdtab"><thead><tr><th>Strategy</th><th>Enhances</th><th>Futures</th><th></th></tr></thead><tbody>${enh
            .map(s => {
              const st = S.find(x => x.id === s.id) || {};
              return `<tr><td><b>${esc(s.name)}</b></td><td>${esc((I.strategies.find(x => x.id === s.enhances) || {}).name || s.enhances)}</td><td>${only[s.id] ? only[s.id].length + ' (failed futures)' : 'all'} · ${st.optimal || 0} solved</td><td>${only[s.id] ? `<button type="button" class="btn sm" data-wid="${esc(s.id)}">Solve on all futures</button>` : ''}</td></tr>`;
            })
            .join('')}</tbody></table>
      <p class="hint">The other views compare the strategies on the futures solved for every strategy: with an enhancement solved on its failed futures only, that is those futures.</p>`
        : ''
    }`;
  V.querySelector('#enb').onchange = e => {
    A.ebase = e.target.value;
    rdEnhance(V, ev, mets);
  };
  const mk = V.querySelector('#enmk');
  if (mk)
    mk.onclick = () => {
      const S_ = scenData(),
        nm = V.querySelector('#enn').value.trim() || 'Enhancement';
      let id = 'ENH_' + A.ebase.replace(/[^\w]/g, '').slice(0, 20),
        k = 2;
      while (S_.list.some(x => x.id === id)) id = `ENH_${A.ebase.replace(/[^\w]/g, '').slice(0, 20)}_${k++}`;
      S_.list.push({id, name: nm, desc: `Strategic enhancement of ${S[si].name} (robust decisions run ${RDV.run})`});
      RDV.enh = {run: RDV.run, base: A.ebase, baseName: S[si].name, scen: id, scenarios: [...base.scenarios, id]};
      if (typeof afterEdit === 'function') afterEdit('Scenario ' + nm + ' created');
      rdEnhEdit();
    };
  const ed = V.querySelector('#enedit');
  if (ed) ed.onclick = rdEnhEdit;
  V.querySelector('#engo').onclick = async () => {
    const msg = V.querySelector('#enmsg'),
      mode = (V.querySelector('[name=enk]:checked') || {}).value;
    const ids = E.scenarios.filter(id => scenData().list.some(x => x.id === id));
    const r = await jp(`/api/rdm/${RDV.run}/enhance`, {
      base: A.ebase,
      strategy: {id: E.scen, name: scenName(E.scen), desc: `${S[si].name} + ${scenName(E.scen)}`, scenarios: ids},
      data: writeData({apply: ids}),
      ks: mode === 'failed' ? failed : null
    }).catch(e => ({error: e.message}));
    if (!r || r.error || !r.ok) {
      msg.textContent = (r && r.error) || 'could not start';
      return;
    }
    msg.textContent = `solving ${mode === 'failed' ? failed.length + ' futures' : 'all futures'} for ${r.id}…`;
    toast('Enhanced strategy added to the run: see Run for the progress');
    RDV.info = null;
    RDV.tab = 'run';
    renderRDM();
  };
  V.querySelectorAll('[data-wid]').forEach(
    b =>
      (b.onclick = async () => {
        const r = await jp(`/api/rdm/${RDV.run}/widen`, {strategy: b.dataset.wid}).catch(e => ({error: e.message}));
        if (!r || !r.ok) return toast((r && r.error) || 'could not start');
        RDV.info = null;
        RDV.tab = 'run';
        renderRDM();
      })
  );
}
function rdEnhEdit() {
  const E = RDV.enh;
  if (!E) return;
  SCEN.edit = E.scen;
  if (typeof scenChip === 'function') scenChip();
  setView('diagram');
  if (typeof draw === 'function') draw();
  rdEnhBar();
}
// the banner of the diagram while a strategic enhancement is edited
function rdEnhBar() {
  const st = document.getElementById('stage');
  if (!st) return;
  let b = document.getElementById('enhbar');
  const on = RDV.enh && SCEN.edit === RDV.enh.scen;
  if (!on) {
    if (b) b.remove();
    return;
  }
  if (!b) {
    b = document.createElement('div');
    b.id = 'enhbar';
    st.prepend(b);
  }
  b.innerHTML = `<b>Strategic Enhancement Model</b> · strategy <i>${esc(RDV.enh.baseName)}</i> + new scenario <b>${esc(scenName(RDV.enh.scen))}</b> (${scenCount(RDV.enh.scen)} change(s)). Your edits go into this scenario only: the base model, ${esc(RDV.enh.baseName)} and the earlier scenarios are not changed.
    <button type="button" class="btn sm" id="enhback">Back to Robust decisions</button><button type="button" class="btn sm" id="enhstop" title="Stop editing the scenario (it is kept)">Leave enhancement</button>`;
  b.querySelector('#enhback').onclick = () => {
    RDV.tab = 'results';
    RDV.an.view = 'enhance';
    showRDM();
  };
  b.querySelector('#enhstop').onclick = () => {
    SCEN.edit = 'SC_0';
    if (typeof scenChip === 'function') scenChip();
    rdEnhBar();
  };
}

/* ---------- the formula of a metric, drawn as you type it (MathML) and checked on the base data or a run ----------
   The same grammar as the engine (engine/rdm.py): terms, numbers, + - * / ^ %, ( ), log ln log10 exp sqrt abs
   min max pow pi e. */
const RD_FN = new Set([
  'log',
  'ln',
  'log10',
  'log2',
  'exp',
  'sqrt',
  'abs',
  'min',
  'max',
  'pow',
  'sin',
  'cos',
  'tan',
  'atan',
  'floor',
  'ceil'
]);
function rdParse(src, names) {
  const tk = [];
  const re = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)|([A-Za-z_]\w*)|(\*\*|[-+*/^%(),]))/y;
  let m,
    i = 0;
  src = String(src || '');
  while (i < src.length) {
    re.lastIndex = i;
    m = re.exec(src);
    if (!m || m[0] === '') {
      if (/^\s*$/.test(src.slice(i))) break;
      throw new Error(`cannot read "${src.slice(i, i + 12)}"`);
    }
    i = re.lastIndex;
    tk.push(m[1] ? {k: 'n', v: +m[1]} : m[2] ? {k: 'id', v: m[2]} : {k: 'op', v: m[3] === '**' ? '^' : m[3]});
  }
  let p = 0;
  const peek = () => tk[p],
    eat = v => {
      if (!tk[p] || tk[p].v !== v) throw new Error(`"${v}" expected`);
      p++;
    };
  const expr = () => {
    let a = term();
    while (peek() && (peek().v === '+' || peek().v === '-')) {
      const o = tk[p++].v;
      a = {t: 'bin', o, a, b: term()};
    }
    return a;
  };
  const term = () => {
    let a = un();
    while (peek() && ['*', '/', '%'].includes(peek().v)) {
      const o = tk[p++].v;
      a = {t: 'bin', o, a, b: un()};
    }
    return a;
  };
  const un = () => {
    if (peek() && (peek().v === '-' || peek().v === '+')) {
      const o = tk[p++].v;
      const a = un();
      return o === '-' ? {t: 'neg', a} : a;
    }
    return pw();
  };
  const pw = () => {
    const a = at();
    if (peek() && peek().v === '^') {
      p++;
      return {t: 'bin', o: '^', a, b: un()};
    }
    return a;
  };
  const at = () => {
    const x = tk[p++];
    if (!x) throw new Error('the formula ends too early');
    if (x.k === 'n') return {t: 'num', v: x.v};
    if (x.k === 'id') {
      if (peek() && peek().v === '(' && RD_FN.has(x.v)) {
        p++;
        const args = [expr()];
        while (peek() && peek().v === ',') {
          p++;
          args.push(expr());
        }
        eat(')');
        return {t: 'fn', f: x.v, args};
      }
      if (x.v === 'pi' || x.v === 'e') return {t: 'const', v: x.v};
      if (!names.includes(x.v)) throw new Error(`unknown name "${x.v}" (terms: ${names.join(', ')})`);
      return {t: 'var', n: x.v};
    }
    if (x.v === '(') {
      const a = expr();
      eat(')');
      return {t: 'par', a};
    }
    throw new Error(`"${x.v}" not expected`);
  };
  const ast = expr();
  if (p < tk.length) throw new Error(`"${tk[p].v}" not expected`);
  return ast;
}
function rdMML(n) {
  const mo = o => `<mo>${o}</mo>`,
    strip = x => (x.t === 'par' ? x.a : x),
    wrap = x => (x.t === 'bin' && x.o !== '^' ? `<mrow>${mo('(')}${rdMML(x)}${mo(')')}</mrow>` : rdMML(x));
  switch (n.t) {
    case 'num':
      return `<mn>${+n.v === n.v ? n.v.toLocaleString('en', {maximumFractionDigits: 6}).replace(/,/g, '') : n.v}</mn>`;
    case 'const':
      return `<mi>${n.v === 'pi' ? 'π' : 'e'}</mi>`;
    case 'var':
      return `<msub><mi>${esc(n.n)}</mi><mi>y</mi></msub>`;
    case 'par':
      return `<mrow>${mo('(')}${rdMML(n.a)}${mo(')')}</mrow>`;
    case 'neg':
      return `<mrow>${mo('−')}${wrap(n.a)}</mrow>`;
    case 'bin':
      if (n.o === '/') return `<mfrac><mrow>${rdMML(strip(n.a))}</mrow><mrow>${rdMML(strip(n.b))}</mrow></mfrac>`;
      if (n.o === '^')
        return `<msup><mrow>${n.a.t === 'var' || n.a.t === 'num' || n.a.t === 'const' ? rdMML(n.a) : `${mo('(')}${rdMML(strip(n.a))}${mo(')')}`}</mrow><mrow>${rdMML(strip(n.b))}</mrow></msup>`;
      return `<mrow>${rdMML(n.a)}${mo(n.o === '*' ? '·' : n.o === '-' ? '−' : n.o === '%' ? 'mod' : n.o)}${n.o === '-' ? wrap(n.b) : rdMML(n.b)}</mrow>`;
    case 'fn': {
      const A = n.args.map(a => rdMML(strip(a))),
        arg = `<mrow>${mo('(')}${A.join(mo(','))}${mo(')')}</mrow>`;
      if (n.f === 'sqrt') return `<msqrt>${A[0]}</msqrt>`;
      if (n.f === 'abs') return `<mrow>${mo('|')}${A[0]}${mo('|')}</mrow>`;
      if (n.f === 'exp') return `<msup><mi>e</mi><mrow>${A[0]}</mrow></msup>`;
      if (n.f === 'pow') return `<msup><mrow>${mo('(')}${A[0]}${mo(')')}</mrow><mrow>${A[1] || ''}</mrow></msup>`;
      if (n.f === 'log10' || n.f === 'log2') return `<mrow><msub><mi>log</mi><mn>${n.f.slice(3)}</mn></msub>${arg}</mrow>`;
      return `<mrow><mi>${n.f === 'log' ? 'ln' : n.f}</mi>${arg}</mrow>`;
    }
  }
  return '';
}
function rdEvalAst(n, env) {
  switch (n.t) {
    case 'num':
      return n.v;
    case 'const':
      return n.v === 'pi' ? Math.PI : Math.E;
    case 'var':
      return env[n.n];
    case 'par':
      return rdEvalAst(n.a, env);
    case 'neg':
      return -rdEvalAst(n.a, env);
    case 'bin': {
      const a = rdEvalAst(n.a, env),
        b = rdEvalAst(n.b, env);
      return n.o === '+'
        ? a + b
        : n.o === '-'
          ? a - b
          : n.o === '*'
            ? a * b
            : n.o === '/'
              ? b === 0
                ? NaN
                : a / b
              : n.o === '%'
                ? a % b
                : Math.pow(a, b);
    }
    case 'fn': {
      const A = n.args.map(a => rdEvalAst(a, env)),
        F = {
          log: Math.log,
          ln: Math.log,
          log10: Math.log10,
          log2: Math.log2,
          exp: Math.exp,
          sqrt: Math.sqrt,
          abs: Math.abs,
          min: Math.min,
          max: Math.max,
          pow: Math.pow,
          sin: Math.sin,
          cos: Math.cos,
          tan: Math.tan,
          atan: Math.atan,
          floor: Math.floor,
          ceil: Math.ceil
        };
      const v = F[n.f](...A);
      return n.f.startsWith('log') && A[0] <= 0 ? NaN : v;
    }
  }
  return NaN;
}
function rdTermText(t) {
  const f = Object.entries(t.filters || {})
    .filter(([, v]) => v && v.length)
    .map(([k, v]) => `${k.toLowerCase()} ${v.length > 3 ? v.length + ' selected' : v.join(', ')}`)
    .join('; ');
  return t.src === 'objective'
    ? 'objective of the model (the same in every year)'
    : `${t.src === 'input' ? 'input' : 'result'} <b>${esc(t.src === 'input' ? t.param : t.var)}</b>${f ? ' (' + esc(f) + ')' : ' (all items)'}, ${({mean: 'average', max: 'largest', min: 'smallest'})[t.how] || 'sum'} over the items, in year y`;
}
function rdLiveFormula(box, m) {
  const T = m.terms || [],
    mb = box.querySelector('.rdmath'),
    wb = box.querySelector('.rdwhere'),
    names = T.map(t => t.n);
  try {
    const ast = rdParse(m.expr, names),
      y0 = m.years && m.years[0] != null ? m.years[0] : 'y₀',
      y1 = m.years && m.years[1] != null ? m.years[1] : 'y₁',
      agg = m.agg || 'sum';
    const red =
      agg === 'sum'
        ? `<munderover><mo>∑</mo><mrow><mi>y</mi><mo>=</mo><mn>${y0}</mn></mrow><mn>${y1}</mn></munderover>`
        : agg === 'mean'
          ? `<mfrac><mn>1</mn><mi>N</mi></mfrac><munderover><mo>∑</mo><mrow><mi>y</mi><mo>=</mo><mn>${y0}</mn></mrow><mn>${y1}</mn></munderover>`
          : `<munder><mo>${agg === 'max' ? 'max' : agg === 'min' ? 'min' : ''}</mo><mrow><mi>y</mi></mrow></munder>`;
    const inner =
      agg === 'last' || agg === 'first'
        ? rdMML(ast).replace(/<mi>y<\/mi>/g, `<mi>${agg === 'last' ? y1 : y0}</mi>`)
        : `<mrow><mo>(</mo>${rdMML(ast)}<mo>)</mo></mrow>`;
    const dv = +m.divide && +m.divide !== 1 ? `<mo>/</mo><mn>${m.divide}</mn>` : '';
    mb.innerHTML = `<math display="block"><mi>${esc((m.name || 'M').replace(/\s+/g, ' ').slice(0, 30))}</mi><mo>=</mo>${agg === 'last' || agg === 'first' ? '' : red}${inner}${dv}${m.unit ? `<mspace width="0.4em"/><mtext>[${esc(m.unit)}]</mtext>` : ''}</math>`;
    mb.classList.remove('rdbad');
  } catch (e) {
    mb.innerHTML = `<span class="rdwarn">${esc(e.message)}</span>`;
    mb.classList.add('rdbad');
  }
  wb.innerHTML = `<p class="small">where ${T.map(t => `<span class="rdtw"><i>${esc(t.n)}<sub>y</sub></i> = ${rdTermText(t)}</span>`).join('; ')}${(m.agg || 'sum') === 'mean' ? '; N = the years kept' : ''}. A year where it cannot be computed (log of 0, division by 0) is left out.</p>`;
}
async function rdRunList() {
  try {
    const rs = await api('/api/runs');
    return rs
      .filter(r => r.state === 'done')
      .slice(-30)
      .reverse();
  } catch (e) {
    return [];
  }
}
async function rdCheckFormula(box, m, runId) {
  const T = m.terms || [],
    vb = box.querySelector('.rdval'),
    yb = box.querySelector('.rdyears'),
    sp = box.querySelector('.rdspark'),
    xb = box.querySelector('.rdxl');
  vb.textContent = 'computing…';
  yb.innerHTML = '';
  if (sp) sp.innerHTML = '';
  if (xb) xb.hidden = true;
  box._calc = null;
  try {
    const ast = rdParse(
        m.expr,
        T.map(t => t.n)
      ),
      ser = {},
      rows2ser = (rows, dims, t) => {
        const yi = dims.indexOf('YEAR'),
          fl = Object.entries(t.filters || {})
            .filter(([, v]) => v && v.length)
            .map(([k, v]) => [dims.indexOf(k), new Set(v.map(String))])
            .filter(([i]) => i >= 0),
          acc = {},
          cnt = {},
          hi = {},
          lo = {};
        for (const r of rows) {
          if (!fl.every(([i, S]) => S.has(String(r[i])))) continue;
          const y = yi >= 0 ? +r[yi] : null,
            x = +r[r.length - 1];
          acc[y] = (acc[y] || 0) + x;
          cnt[y] = (cnt[y] || 0) + 1;
          hi[y] = y in hi ? Math.max(hi[y], x) : x;
          lo[y] = y in lo ? Math.min(lo[y], x) : x;
        }
        const o = {};
        for (const y in acc) o[y] = t.how === 'mean' ? acc[y] / cnt[y] : t.how === 'max' ? hi[y] : t.how === 'min' ? lo[y] : acc[y];
        return o;
      };
    let obj = null;
    for (const t of T) {
      if (t.src === 'objective') {
        if (!runId) throw new Error(`${t.n} is the objective: choose a run to check it`);
        if (obj == null) {
          const rs = await rdRunList();
          const r = rs.find(x => x.id === runId);
          obj = r ? +r.objective : NaN;
        }
        ser[t.n] = {null: obj};
      } else if (t.src === 'input') {
        const dims = dimsOf(t.param),
          P = P_(t.param);
        ser[t.n] = rows2ser(
          P.recs.map(r => [...r.idx, r.v]),
          dims,
          t
        );
      } else {
        if (!runId) throw new Error(`${t.n} is a result (${t.var}): choose a run to check it`);
        const V = await api(`/api/run/${runId}/var/${t.var}`);
        ser[t.n] = rows2ser(V.rows || [], rdDims(t.var), t);
      }
    }
    const ys = [
      ...new Set(
        Object.values(ser).flatMap(o =>
          Object.keys(o)
            .filter(k => k !== 'null')
            .map(Number)
        )
      )
    ]
      .sort((a, b) => a - b)
      .filter(y => (m.years && m.years[0] != null ? y >= m.years[0] : true) && (m.years && m.years[1] != null ? y <= m.years[1] : true));
    const by = {},
      envs = {};
    for (const y of ys.length ? ys : [null]) {
      const env = {};
      for (const n in ser) env[n] = 'null' in ser[n] ? ser[n].null : ser[n][y] || 0;
      envs[y] = env;
      const v = rdEvalAst(ast, env);
      if (isFinite(v)) by[y] = v;
    }
    const vals = Object.values(by);
    let v = rdReduce(by, {...m, divide: 1});
    v = v / (+m.divide || 1);
    vb.innerHTML = `<b>${rdF(v)}</b>${m.unit ? ' ' + esc(m.unit) : ''} <span class="muted">(${vals.length} year${vals.length === 1 ? '' : 's'}${runId ? '' : ', base data'})</span>`;
    yb.innerHTML =
      vals.length > 1
        ? `<div class="rdyr">${Object.entries(by)
            .map(([y, x]) => `<span><i>${esc(y)}</i> ${rdF(x)}</span>`)
            .join('')}</div>`
        : '';
    let runName = '';
    if (runId) {
      const rs = await rdRunList();
      const r = rs.find(x => x.id === runId);
      runName = r ? r.name || r.id : runId;
    }
    box._calc = {m, terms: T.map(t => t.n), envs, by, value: v, run: runName || 'the base data (inputs only)'};
    if (sp && vals.length > 1) await rdFormulaCharts(sp, box._calc);
    if (xb) xb.hidden = false;
  } catch (e) {
    vb.innerHTML = `<span class="rdwarn">${esc(e.message)}</span>`;
  }
}

/* charts of the formula year by year and its Excel sheet, drawn as the Monte Carlo charts (Plotly, pvLayout / PVCFG: serif title, transparent,
   hover, chart style, PNG 3x and SVG in the toolbar): the formula by year with its value, and every term of the formula by year. */
async function rdFormulaCharts(sp, c) {
  const by = c.by,
    m = c.m,
    ys = Object.keys(by)
      .map(Number)
      .sort((a, b) => a - b);
  if (ys.length < 2) {
    sp.innerHTML = '';
    return;
  }
  await needLib('plotly');
  if (!sp.isConnected) return;
  const pal = PAL[isDark() ? 'dark' : 'light'],
    u = m.unit ? ' ' + m.unit : '',
    agg = (RD_AGG.find(a => a[0] === (m.agg || 'sum')) || [0, m.agg || 'sum'])[1];
  sp.innerHTML = `<div class="mcpv rdpv"><div class="mcpv-h"><b>Charts</b><span class="muted small">${esc(c.run)} · ${ys.length} years</span></div><div class="pvc rdpv1"></div>${c.terms.length ? '<div class="pvc rdpv2"></div>' : ''}</div>`;
  const vs = ys.map(y => by[y]),
    mean = vs.reduce((a, b) => a + b, 0) / vs.length,
    ink = isDark() ? '#e6e5e1' : '#2f3437';
  Plotly.react(
    sp.querySelector('.rdpv1'),
    [
      {
        x: ys,
        y: vs,
        mode: 'lines+markers',
        line: {color: pal[0], width: 2},
        marker: {color: pal[0], size: 5},
        fill: 'tozeroy',
        fillcolor: pal[0] + '18',
        name: m.name || 'formula',
        hovertemplate: '%{x}: %{y:.4g}' + esc(u) + '<extra></extra>'
      }
    ],
    pvLayout(`${esc(m.name || 'Formula')} by year · ${esc(agg)}: ${rdF(c.value)}${esc(u)} · mean of the years ${rdF(mean)} (dotted)`, {
      shapes: [{type: 'line', x0: ys[0], x1: ys[ys.length - 1], y0: mean, y1: mean, line: {color: ink, width: 1, dash: 'dot'}}],
      yaxis: {gridcolor: isDark() ? '#2c2c2c' : '#eeede9', zeroline: false, title: {text: m.unit || ''}}
    }),
    PVCFG
  );
  const el2 = sp.querySelector('.rdpv2');
  if (!el2) return;
  const T = c.terms.filter(n => ys.some(y => c.envs[y] && c.envs[y][n] != null));
  Plotly.react(
    el2,
    T.map((n, i) => ({
      x: ys,
      y: ys.map(y => c.envs[y][n]),
      mode: 'lines',
      line: {color: pal[(i + 1) % pal.length], width: 2},
      name: n,
      hovertemplate: n + ' %{x}: %{y:.4g}<extra></extra>'
    })),
    pvLayout(`The terms by year · ${T.map(esc).join(', ')}`, {
      showlegend: true,
      legend: {orientation: 'h', x: 0, y: -0.2},
      margin: {t: 34, l: 52, r: 12, b: 50},
      height: 250
    }),
    PVCFG
  );
}
function rdFormulaXlsx(box) {
  const c = box._calc;
  if (!c) return toast('Compute first');
  const ys = Object.keys(c.envs)
      .filter(y => y !== 'null')
      .map(Number)
      .sort((a, b) => a - b),
    m = c.m;
  const rows = [
    ['year', ...c.terms, `${m.name || 'formula'} = ${m.expr}`],
    ...(ys.length ? ys : [null]).map(y => [y ?? 'all', ...c.terms.map(n => c.envs[y][n]), c.by[y] ?? ''])
  ];
  const T = m.terms || [],
    about = [
      [APPNAME, 'robust decisions · formula metric'],
      ['Metric', m.name || ''],
      ['Formula', m.expr || ''],
      ...T.map((t, i) => [
        i ? '' : 'Terms',
        `${t.n} = ${t.src === 'objective' ? 'objective' : t.src === 'input' ? 'input ' + t.param : 'result ' + t.var}${Object.entries(
          t.filters || {}
        )
          .filter(([, v]) => v && v.length)
          .map(([k, v]) => `; ${k}: ${v.join(', ')}`)
          .join('')}; ${({mean: 'average', max: 'largest', min: 'smallest'})[t.how] || 'sum'} over the items`
      ]),
      ['Over the years', (RD_AGG.find(a => a[0] === (m.agg || 'sum')) || [0, m.agg])[1]],
      ['Years', `${m.years && m.years[0] != null ? m.years[0] : 'first'} - ${m.years && m.years[1] != null ? m.years[1] : 'last'}`],
      ['Divided by', m.divide || 1],
      ['Unit', m.unit || ''],
      ['Value of the metric', c.value],
      ['Computed on', c.run],
      ['Exported', new Date().toLocaleString()]
    ];
  saveFile(
    `${(m.name || 'formula').replace(/[^\w.-]+/g, '_')}_by_year.xlsx`,
    makeXlsx([
      {name: 'Values', rows, bold: [0]},
      {name: 'About', rows: about, freeze: false, bold: [0]}
    ]),
    XLSX_MIME
  );
}
