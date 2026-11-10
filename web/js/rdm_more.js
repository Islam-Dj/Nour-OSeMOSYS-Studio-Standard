'use strict';
/* ============================== ROBUST DECISIONS: more charts, Excel, the full package ==============================
   Each view of the results gets, under its table:
     - a list of charts to choose from (every chart has the Chart style editor in its toolbar: kind, axes, colours, titles);
     - "Excel": one workbook with the table of the view and the data behind it (every metric for every strategy and future, the
       futures and their uncertainties, the regret, the targets met);
     - on Futures: "Full package (zip)": every drawn value with all its index sets, the metrics, the kept results, and if asked
       the data file of each strategy in each future (engine/rdm_export.py).
   The views themselves are in rdm.js; this file wraps them (the original function is called first). */

const RDX = {kind: {score: 'box', regret: 'violin', targets: 'combined', trade: 'scatter'}};

/* the futures where a strategy meets a list of targets */
const rdxMeets = (ev, list, s, f) => list.every(m => rdMeets(m, ev.values[m.id][s][f]));
/* a metric's medians, scaled 0 (best strategy) to 1 (worst) */
function rdxScaled(ev, m) {
  const md = ev.values[m.id].map(v => rdQ(v, 0.5)),
    lo = Math.min(...md),
    hi = Math.max(...md),
    sp = hi - lo || 1;
  return md.map(v => (m.dir === 'max' ? (hi - v) / sp : (v - lo) / sp));
}
const rdxName = m => (m.name || m.var) + (m.unit ? ' (' + m.unit + ')' : '');

/* the chart bar of a view: a list of charts and the Excel button */
function rdxBar(V, view, kinds, redraw) {
  const old = V.querySelector('.rdxbar');
  if (old) old.remove();
  const bar = document.createElement('div');
  bar.className = 'rdctl rdxbar';
  bar.innerHTML = `<label>Chart<select class="rdxk">${kinds.map(([k, l]) => `<option value="${k}" ${RDX.kind[view] === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <button type="button" class="btn" data-x="xlsx" title="The table of this view and the data behind it: every metric of every strategy in every future, the futures, the regret, the targets">Excel</button>`;
  bar.querySelector('.rdxk').onchange = e => {
    RDX.kind[view] = e.target.value;
    redraw();
  };
  bar.querySelector('[data-x="xlsx"]').onclick = () => rdxExcel(V, view);
  return bar;
}

/* ---------------- Excel: the table of the view and the data behind it ---------------- */
function rdxExcel(V, view) {
  const ev = RDV.ev,
    mets = RDV.mets.filter(m => Array.isArray(ev.values[m.id])),
    S = ev.strategies,
    sheets = [];
  const tab = V.querySelector('table.rdtab');
  if (tab) {
    const rows = [...tab.querySelectorAll('tr')].map(tr =>
      [...tr.children].map(td => {
        const t = td.innerText.replace(/\s+/g, ' ').trim(),
          n = Number(t.replace(/[,\s%]/g, ''));
        return t !== '' && isFinite(n) && /^[-\d.,\s%e+]+$/i.test(t) ? n : t;
      })
    );
    sheets.push({name: 'This view', rows, bold: [0]});
  }
  // every metric of every strategy in every future (long and wide)
  const long = [['Strategy', 'Future', 'Metric', 'Unit', 'Value']];
  mets.forEach(m => S.forEach((s, si) => ev.futures.forEach((f, fi) => long.push([s.name, f, m.name || m.var, m.unit || '', ev.values[m.id][si][fi]]))));
  sheets.push({name: 'Metrics', rows: long, bold: [0]});
  const wide = [['Future', ...ev.factors, ...mets.flatMap(m => S.map(s => `${m.name || m.var} · ${s.name}`))]];
  ev.futures.forEach((f, fi) => wide.push([f, ...(ev.X[fi] || []), ...mets.flatMap(m => S.map((_, si) => ev.values[m.id][si][fi]))]));
  sheets.push({name: 'Futures', rows: wide, bold: [0]});
  // regret of each metric (absolute) and all metrics scaled
  const reg = [['Strategy', 'Future', ...mets.map(m => 'Regret ' + (m.name || m.var)), 'Worst regret (all metrics, scaled)']];
  const R = mets.map(m => rdRegret(ev, m, false)),
    SR = rdScaledRegret(ev, mets);
  S.forEach((s, si) => ev.futures.forEach((f, fi) => reg.push([s.name, f, ...R.map(r => (r ? r[si][fi] : '')), SR ? SR[si][fi] : ''])));
  sheets.push({name: 'Regret', rows: reg, bold: [0]});
  const T = mets.filter(m => m.limit != null && m.limit !== '');
  if (T.length) {
    const tg = [['Strategy', 'Future', ...T.map(m => `${m.name || m.var} ${m.dir === 'max' ? '≥' : '≤'} ${m.limit}`), 'Combined: ' + rdLogicText(T)]];
    S.forEach((s, si) => ev.futures.forEach((f, fi) => tg.push([s.name, f, ...T.map(m => (rdMeets(m, ev.values[m.id][si][fi]) ? 'met' : 'missed')), rdSat(ev, T, si, fi) ? 'met' : 'missed'])));
    sheets.push({name: 'Targets', rows: tg, bold: [0]});
  }
  sheets.push({
    name: 'About',
    rows: [
      ['Robust decisions', (RDV.info && (RDV.info.name || RDV.info.id)) || RDV.run],
      ['View', view],
      ['Strategies', S.map(s => s.name).join(', ')],
      ['Futures solved for every strategy', ev.futures.length],
      ['Metrics', mets.map(m => `${m.name || m.var}: ${rdMetricText(m)}`).join(' | ')],
      ['Exported', new Date().toLocaleString()]
    ],
    bold: []
  });
  saveFile(`robust_decisions_${view}.xlsx`, makeXlsx(sheets), XLSX_MIME);
}

/* ---------------- Scorecard: every metric visible; heat map, parallel lines, ranges, radar ---------------- */
const RDX_SCORE = [
  ['box', 'Every metric: each future (one panel per metric)'],
  ['range', 'Every metric: median and 10 – 90 % (one panel per metric)'],
  ['heat', 'Heat map: strategies × metrics (0 = best, 1 = worst)'],
  ['parallel', 'Lines: each strategy across the metrics (0 = best)'],
  ['radar', 'Radar: each strategy across the metrics (1 = best)']
];
async function rdxScoreCharts(V, ev, mets) {
  const old = V.querySelector('#rdsc');
  if (old) old.remove(); // the one-metric chart of rdm.js: replaced by these
  let host = V.querySelector('#rdxsc');
  if (!host) {
    V.appendChild(rdxBar(V, 'score', RDX_SCORE, () => rdxScoreCharts(V, ev, mets)));
    host = document.createElement('div');
    host.id = 'rdxsc';
    V.appendChild(host);
  }
  host.innerHTML = '';
  const S = ev.strategies,
    k = RDX.kind.score,
    base = await rdLay();
  if (k === 'box' || k === 'range') {
    host.className = 'rdxgrid';
    for (const [j, m] of mets.entries()) {
      const d = document.createElement('div');
      d.id = 'rdxsc' + j;
      d.className = 'rdplot';
      host.appendChild(d);
      const L = await rdLay({margin: {l: 130, r: 16, t: 30, b: 40}, showlegend: false, title: {text: esc(rdxName(m)) + (m.dir === 'max' ? ' · higher is better' : ' · lower is better')}});
      const tr =
        k === 'box'
          ? S.map((s, i) => ({
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
              hovertemplate: '%{x:,.4g}<extra>' + esc(s.name) + '</extra>'
            }))
          : [
              {
                type: 'scatter',
                mode: 'markers',
                orientation: 'h',
                y: S.map(s => s.name),
                x: S.map((_, i) => rdQ(ev.values[m.id][i], 0.5)),
                marker: {size: 11, color: S.map((_, i) => rdCol(i))},
                error_x: {
                  type: 'data',
                  symmetric: false,
                  array: S.map((_, i) => rdQ(ev.values[m.id][i], 0.9) - rdQ(ev.values[m.id][i], 0.5)),
                  arrayminus: S.map((_, i) => rdQ(ev.values[m.id][i], 0.5) - rdQ(ev.values[m.id][i], 0.1)),
                  thickness: 2,
                  width: 6,
                  color: '#8a8984'
                },
                hovertemplate: 'median %{x:,.4g}<extra>%{y}</extra>'
              }
            ];
      Plotly.newPlot(d, tr, Object.assign(L, {height: 70 + 42 * S.length}), RDPC);
    }
    return;
  }
  host.className = '';
  const d = document.createElement('div');
  d.id = 'rdxsc_all';
  d.className = 'rdplot';
  host.appendChild(d);
  const sc = mets.map(m => rdxScaled(ev, m)),
    names = mets.map(m => m.name || m.var);
  if (k === 'heat') {
    const L = await rdLay({margin: {l: 140, r: 20, t: 30, b: 90}, title: {text: 'Median of each metric, scaled: 0 = the best strategy, 1 = the worst'}});
    Plotly.newPlot(
      d,
      [
        {
          type: 'heatmap',
          x: names,
          y: S.map(s => s.name),
          z: S.map((_, i) => sc.map(r => r[i])),
          zmin: 0,
          zmax: 1,
          colorscale: [
            [0, '#f2f6fa'],
            [1, '#2e5480']
          ],
          text: S.map((_, i) => mets.map(m => rdF(rdQ(ev.values[m.id][i], 0.5)))),
          texttemplate: '%{text}',
          hovertemplate: '%{y} · %{x}<br>median %{text}<br>scaled %{z:.2f}<extra></extra>',
          colorbar: {title: {text: 'Scaled'}, thickness: 12}
        }
      ],
      Object.assign(L, {height: 120 + 48 * S.length}),
      RDPC
    );
  } else if (k === 'parallel') {
    const L = await rdLay({margin: {l: 60, r: 20, t: 30, b: 90}, title: {text: 'Each strategy across the metrics: 0 = the best strategy, 1 = the worst'}});
    L.yaxis.range = [-0.05, 1.05];
    Plotly.newPlot(
      d,
      S.map((s, i) => ({type: 'scatter', mode: 'lines+markers', name: s.name, x: names, y: sc.map(r => r[i]), line: {color: rdCol(i), width: 2}, marker: {size: 8}})),
      Object.assign(L, {height: 420}),
      RDPC
    );
  } else {
    const L = await rdLay({margin: {l: 40, r: 40, t: 40, b: 40}, title: {text: 'Each strategy across the metrics: 1 = the best strategy, 0 = the worst'}});
    L.polar = {radialaxis: {range: [0, 1], showline: false, gridcolor: base.xaxis.gridcolor}, angularaxis: {gridcolor: base.xaxis.gridcolor}, bgcolor: 'rgba(0,0,0,0)'};
    Plotly.newPlot(
      d,
      S.map((s, i) => ({
        type: 'scatterpolar',
        r: [...sc.map(r => 1 - r[i]), 1 - sc[0][i]],
        theta: [...names, names[0]],
        name: s.name,
        fill: 'toself',
        opacity: 0.55,
        line: {color: rdCol(i)}
      })),
      Object.assign(L, {height: 460}),
      RDPC
    );
  }
}

/* ---------------- Regret: violin, box, bars, cumulative, heat map ---------------- */
const RDX_REGRET = [
  ['violin', 'Spread over the futures (violins)'],
  ['box', 'Spread over the futures (boxes)'],
  ['bars', 'Mean, 90 % and worst regret (bars)'],
  ['cdf', 'Share of futures below a regret (cumulative lines)'],
  ['heat', 'Heat map: strategies × futures']
];
async function rdxRegretCharts(V, ev, mets) {
  const A = RDV.an,
    S = ev.strategies,
    all = A.rmetric === '__all',
    m = mets.find(x => x.id === A.rmetric) || mets[0];
  const R = all ? rdScaledRegret(ev, mets) : rdRegret(ev, m, A.rel),
    u = all ? ' (share of the spread)' : A.rel ? ' %' : m.unit ? ' ' + m.unit : '';
  let host = V.querySelector('#rdxrg');
  if (!host) {
    V.appendChild(rdxBar(V, 'regret', RDX_REGRET, () => rdxRegretCharts(V, ev, mets)));
    host = document.createElement('div');
    host.id = 'rdxrg';
    host.className = 'rdplot';
    V.appendChild(host);
  }
  const k = RDX.kind.regret,
    rg = V.querySelector('#rdrg');
  if (rg) rg.hidden = k !== 'violin'; // the violins of rdm.js
  host.hidden = k === 'violin';
  if (k === 'violin') return;
  const L = await rdLay({margin: {l: 140, r: 16, t: 10, b: 50}, showlegend: k === 'bars' || k === 'cdf'});
  let tr;
  if (k === 'box') {
    L.xaxis.title = {text: 'Regret' + u};
    tr = S.map((s, i) => ({type: 'box', orientation: 'h', x: R[i], name: s.name, marker: {color: rdCol(i), size: 3}, boxpoints: 'outliers', boxmean: true}));
    L.showlegend = false;
  } else if (k === 'bars') {
    L.xaxis.title = {text: 'Regret' + u};
    L.barmode = 'group';
    tr = [
      ['Mean', r => rdMean(r), '#9dbbd9'],
      ['90 % of futures below', r => rdQ(r, 0.9), '#5f8bb8'],
      ['Worst', r => Math.max(...r), '#2e5480']
    ].map(([n, f, c]) => ({type: 'bar', orientation: 'h', name: n, y: S.map(s => s.name), x: R.map(f), marker: {color: c}}));
  } else if (k === 'cdf') {
    L.xaxis.title = {text: 'Regret' + u};
    L.yaxis.title = {text: '% of futures with a regret at most this'};
    tr = S.map((s, i) => {
      const x = [...R[i]].sort((a, b) => a - b);
      return {type: 'scatter', mode: 'lines', line: {shape: 'hv', color: rdCol(i), width: 2}, name: s.name, x, y: x.map((_, j) => (100 * (j + 1)) / x.length)};
    });
  } else {
    L.xaxis.title = {text: 'Future'};
    tr = [
      {
        type: 'heatmap',
        x: ev.futures,
        y: S.map(s => s.name),
        z: R,
        colorscale: [
          [0, '#f2f6fa'],
          [1, '#2e5480']
        ],
        colorbar: {title: {text: 'Regret' + u}, thickness: 12},
        hovertemplate: 'future %{x} · %{y}<br>regret %{z:,.4g}<extra></extra>'
      }
    ];
  }
  Plotly.newPlot(host, tr, Object.assign(L, {height: k === 'cdf' ? 420 : 90 + 60 * S.length}), RDPC);
}

/* ---------------- Targets: how they combine (AND / OR / at least k / one / expression), more charts ---------------- */
const RDX_TARGETS = [
  ['combined', 'Combined targets: % of futures (bars)'],
  ['each', 'Each target: % of futures (grouped bars)'],
  ['count', 'How many targets are met (stacked bars)'],
  ['heat', 'Futures met or missed (strategies × futures)']
];
async function rdxTargetCharts(V, ev, mets) {
  const S = ev.strategies,
    T = mets.filter(m => m.limit != null && m.limit !== '');
  if (!T.length) return;
  // how the targets combine, here as well as on the left
  if (!V.querySelector('.rdxlogic')) {
    const L = rdLogic(),
      d = document.createElement('div');
    d.className = 'rdctl rdxlogic';
    d.innerHTML = `<label>A future is satisfied when<select class="rdxl">
        <option value="all" ${L.mode === 'all' || !L.mode ? 'selected' : ''}>All targets are met (AND)</option>
        <option value="any" ${L.mode === 'any' ? 'selected' : ''}>Any target is met (OR)</option>
        <option value="atleast" ${L.mode === 'atleast' ? 'selected' : ''}>At least k targets are met</option>
        <option value="one" ${L.mode === 'one' ? 'selected' : ''}>One target alone</option>
        <option value="expr" ${L.mode === 'expr' ? 'selected' : ''}>An expression (M1 and (M2 or M3))</option></select></label>
      <label ${L.mode === 'atleast' ? '' : 'hidden'} class="rdxk2">k<input type="number" min="1" max="${T.length}" value="${L.k || Math.max(1, T.length - 1)}"></label>
      <label ${L.mode === 'one' ? '' : 'hidden'} class="rdxone">Target<select>${T.map(m => `<option value="${esc(m.id)}" ${L.metric === m.id ? 'selected' : ''}>${esc(m.id)} · ${esc(m.name || m.var)}</option>`).join('')}</select></label>
      <label ${L.mode === 'expr' ? '' : 'hidden'} class="rdxexpr">Expression<input value="${esc(L.expr || '')}" placeholder="e.g. ${esc(T.map(m => m.id).slice(0, 2).join(' and '))}"></label>`;
    const head = V.querySelector('.rdhead');
    head ? head.after(d) : V.prepend(d);
    const apply = () => {
      const mode = d.querySelector('.rdxl').value;
      RDV.design.logic = {
        mode,
        k: +d.querySelector('.rdxk2 input').value || 1,
        metric: d.querySelector('.rdxone select').value,
        expr: d.querySelector('.rdxexpr input').value.trim()
      };
      rdSave();
      const B = V.closest('#rdbody') || V.parentElement.parentElement;
      if (typeof rdResultsTab === 'function' && B) rdResultsTab(B);
    };
    d.querySelectorAll('select, input').forEach(x => (x.onchange = apply));
  }
  let host = V.querySelector('#rdxtg');
  if (!host) {
    V.appendChild(rdxBar(V, 'targets', RDX_TARGETS, () => rdxTargetCharts(V, ev, mets)));
    host = document.createElement('div');
    host.id = 'rdxtg';
    host.className = 'rdplot';
    V.appendChild(host);
  }
  const k = RDX.kind.targets,
    tg = V.querySelector('#rdtg');
  if (tg) tg.hidden = k !== 'combined';
  host.hidden = k === 'combined';
  if (k === 'combined') return;
  const nF = ev.futures.length,
    L = await rdLay({margin: {l: 140, r: 20, t: 10, b: 50}});
  let tr;
  if (k === 'each') {
    L.barmode = 'group';
    L.xaxis.title = {text: '% of futures where the target is met'};
    L.xaxis.range = [0, 100];
    const pal = typeof CHST !== 'undefined' ? CHST.family(T.length) : T.map((_, i) => rdCol(i));
    tr = T.map((m, j) => ({
      type: 'bar',
      orientation: 'h',
      name: `${m.name || m.var} ${m.dir === 'max' ? '≥' : '≤'} ${rdF(+m.limit)}`,
      y: S.map(s => s.name),
      x: S.map((_, s) => (100 * ev.futures.filter((_, f) => rdxMeets(ev, [m], s, f)).length) / nF),
      marker: {color: pal[j]}
    }));
  } else if (k === 'count') {
    L.barmode = 'stack';
    L.xaxis.title = {text: '% of futures'};
    const pal = typeof CHST !== 'undefined' ? CHST.family(T.length + 1) : [];
    tr = Array.from({length: T.length + 1}, (_, c) => ({
      type: 'bar',
      orientation: 'h',
      name: `${c} of ${T.length} met`,
      y: S.map(s => s.name),
      x: S.map((_, s) => (100 * ev.futures.filter((_, f) => T.filter(m => rdMeets(m, ev.values[m.id][s][f])).length === c).length) / nF),
      marker: {color: pal[T.length - c]}
    }));
  } else {
    L.xaxis.title = {text: 'Future'};
    L.showlegend = false;
    tr = [
      {
        type: 'heatmap',
        x: ev.futures,
        y: S.map(s => s.name),
        z: S.map((_, s) => ev.futures.map((_, f) => (rdSat(ev, T, s, f) ? 1 : 0))),
        zmin: 0,
        zmax: 1,
        colorscale: [
          [0, '#e8e7e3'],
          [1, '#2e5480']
        ],
        showscale: false,
        hovertemplate: 'future %{x} · %{y}: %{z}<extra>1 = satisfied</extra>'
      }
    ];
  }
  Plotly.newPlot(host, tr, Object.assign(L, {height: 90 + 50 * S.length}), RDPC);
}

/* ---------------- Trade-offs: scatter, Pareto, all pairs, density ---------------- */
const RDX_TRADE = [
  ['scatter', 'Two metrics, every future (points)'],
  ['pareto', 'Two metrics: the best compromises of each strategy (Pareto front)'],
  ['splom', 'Every pair of metrics (matrix)'],
  ['density', 'Two metrics: where the futures gather (contours)']
];
async function rdxTradeCharts(V, ev, mets) {
  if (mets.length < 2) return;
  const A = RDV.an,
    S = ev.strategies;
  let host = V.querySelector('#rdxto');
  if (!host) {
    V.appendChild(rdxBar(V, 'trade', RDX_TRADE, () => rdxTradeCharts(V, ev, mets)));
    host = document.createElement('div');
    host.id = 'rdxto';
    host.className = 'rdplot';
    V.appendChild(host);
  }
  const k = RDX.kind.trade,
    to = V.querySelector('#rdto');
  if (to) to.hidden = k !== 'scatter';
  host.hidden = k === 'scatter';
  if (k === 'scatter') return;
  const mx = mets.find(m => m.id === A.tx) || mets[0],
    my = mets.find(m => m.id === A.ty) || mets[1],
    X = ev.values[mx.id],
    Y = ev.values[my.id];
  const L = await rdLay({margin: {l: 72, r: 16, t: 10, b: 60}});
  let tr;
  if (k === 'pareto') {
    L.xaxis.title = {text: rdxName(mx)};
    L.yaxis.title = {text: rdxName(my)};
    const better = (m, a, b) => (m.dir === 'max' ? a >= b : a <= b);
    tr = [];
    S.forEach((s, i) => {
      const P = X[i].map((x, f) => [x, Y[i][f]]),
        front = P.filter(p => !P.some(q => q !== p && better(mx, q[0], p[0]) && better(my, q[1], p[1]) && (q[0] !== p[0] || q[1] !== p[1]))).sort((a, b) => a[0] - b[0]);
      tr.push({type: 'scatter', mode: 'markers', name: s.name, x: X[i], y: Y[i], marker: {size: 5, color: rdCol(i), opacity: 0.25}, showlegend: false, hoverinfo: 'skip'});
      tr.push({type: 'scatter', mode: 'lines+markers', name: s.name, x: front.map(p => p[0]), y: front.map(p => p[1]), line: {color: rdCol(i), width: 2, shape: 'hv'}, marker: {size: 7, color: rdCol(i)}});
    });
  } else if (k === 'splom') {
    const dims = mets.map(m => ({label: m.name || m.var, values: S.flatMap((_, i) => ev.values[m.id][i])}));
    tr = [
      {
        type: 'splom',
        dimensions: dims,
        text: S.flatMap(s => ev.futures.map(f => `${s.name} · future ${f}`)),
        marker: {size: 4, opacity: 0.55, color: S.flatMap((_, i) => ev.futures.map(() => rdCol(i))), line: {width: 0}},
        diagonal: {visible: false},
        showupperhalf: false
      }
    ];
    Object.assign(L, {margin: {l: 70, r: 16, t: 10, b: 60}, dragmode: 'select', hovermode: 'closest', showlegend: false});
    Plotly.newPlot(host, tr, Object.assign(L, {height: Math.min(900, 220 * mets.length)}), RDPC);
    return;
  } else {
    L.xaxis.title = {text: rdxName(mx)};
    L.yaxis.title = {text: rdxName(my)};
    tr = S.map((s, i) => ({
      type: 'histogram2dcontour',
      name: s.name,
      x: X[i],
      y: Y[i],
      ncontours: 8,
      contours: {coloring: 'lines'},
      line: {width: 1.5},
      colorscale: [
        [0, rdCol(i)],
        [1, rdCol(i)]
      ],
      showscale: false,
      showlegend: true
    }));
  }
  Plotly.newPlot(host, tr, Object.assign(L, {height: 480}), RDPC);
}

/* ---------------- Futures: Excel and the full package ---------------- */
function rdxFuturesTools(V) {
  if (V.querySelector('.rdxpkg')) return;
  const S = RDV.ev.strategies,
    n = RDV.ev.n || RDV.ev.futures.length;
  const d = document.createElement('details');
  d.className = 'rdxpkg';
  d.open = true;
  d.innerHTML = `<summary>Export everything</summary>
    <div class="rdctl"><button type="button" class="btn" data-x="xlsx">Excel (this table, every metric, the futures, regret, targets)</button></div>
    <fieldset><legend>Full package (zip): to assess the run outside the Studio</legend>
      <p class="hint">Every drawn value of every uncertain parameter with all its index sets (region, technology, commodity, time slice, year...) in its own column, for each strategy and future; the metrics; the results kept for each solve; the status of each solve; the design and the model file.</p>
      <label class="chk"><input type="checkbox" class="pall"> <b>Everything</b>: every strategy, every future, every data file, every solve record</label>
      <label class="chk"><input type="checkbox" class="pd"> The complete data file of each strategy in each future (ready for GLPK)</label>
      <label class="chk"><input type="checkbox" class="pr" checked> Every solve record as kept (status, objective, kept results, solver log when not optimal)</label>
      <div class="row2"><label>Strategies<select class="ps" multiple size="${Math.min(6, S.length)}">${S.map(s => `<option value="${esc(s.id)}" selected>${esc(s.name)}</option>`).join('')}</select></label>
      <label>Futures (empty = all ${n})<input class="pf" placeholder="e.g. 1-20, 35"></label></div>
      <p class="muted small pz"></p>
      <div class="acts"><button type="button" class="btn pri" data-x="pkg">Make the package</button></div></fieldset>`;
  const head = V.querySelector('.rdctl') || V.querySelector('.rdhead');
  head.after(d);
  const est = () => {
    const ns = d.querySelectorAll('.ps option:checked').length,
      f = d.querySelector('.pf').value.trim(),
      nf = f ? f.split(',').reduce((a, p) => a + (p.includes('-') ? Math.max(0, +p.split('-')[1] - +p.split('-')[0] + 1) : 1), 0) : n,
      kb = Math.round(((M && typeof writeData === 'function' ? writeData().length : 0) / 1024) * ns * nf);
    d.querySelector('.pz').textContent = d.querySelector('.pd').checked
      ? `${ns * nf} data files, about ${kb > 2048 ? (kb / 1024).toFixed(0) + ' MB' : kb + ' kB'} before compression.`
      : `${ns} strateg${ns === 1 ? 'y' : 'ies'} × ${nf} future${nf === 1 ? '' : 's'}.`;
  };
  d.querySelectorAll('input, select').forEach(x => (x.oninput = x.onchange = est));
  d.querySelector('.pall').onchange = e => {
    if (e.target.checked) {
      d.querySelector('.pd').checked = true;
      d.querySelector('.pr').checked = true;
      d.querySelectorAll('.ps option').forEach(o => (o.selected = true));
      d.querySelector('.pf').value = '';
    }
    est();
  };
  est();
  d.querySelector('[data-x="xlsx"]').onclick = () => rdxExcel(V, 'futures');
  d.querySelector('[data-x="pkg"]').onclick = async () => {
    const st = [...d.querySelectorAll('.ps option:checked')].map(o => o.value).join(','),
      q = `data=${d.querySelector('.pd').checked ? 1 : 0}&raw=${d.querySelector('.pr').checked ? 1 : 0}&strategies=${encodeURIComponent(st)}&futures=${encodeURIComponent(d.querySelector('.pf').value.trim())}`;
    await rdxDownload(`/api/rdm/${encodeURIComponent(RDV.run)}/package?${q}`, `robust_decisions_${RDV.run}_package.zip`);
  };
}
/* a large file from the server: straight to a file in the desktop app, else through the page */
async function rdxDownload(path, name) {
  toast('Preparing the package…');
  const api = window.pywebview && window.pywebview.api;
  try {
    if (api && api.save_url) {
      const r = await api.save_url(SERVER.url + path, name);
      if (!r) return toast('Cancelled');
      if (r.error) throw new Error(r.error);
      return toast(`Saved: ${r.path} (${(r.bytes / 1e6).toFixed(1)} MB)`);
    }
    const r = await fetch(SERVER.url + path);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
    const blob = await r.blob();
    await saveFile(r.headers.get('X-File-Name') || name, blob, 'application/zip');
    toast(`Package ${(blob.size / 1e6).toFixed(1)} MB`);
  } catch (e) {
    toast('The package could not be made: ' + (e.message || e));
  }
}

/* ---------------- the views of rdm.js, wrapped ---------------- */
{
  const wrap = (orig, after) =>
    async function (V, ev, mets) {
      await orig(V, ev, mets);
      try {
        await after(V, ev, mets);
      } catch (e) {
        console.error(e);
      }
    };
  rdScore = wrap(rdScore, rdxScoreCharts);
  rdRegretView = wrap(rdRegretView, rdxRegretCharts);
  rdTargets = wrap(rdTargets, rdxTargetCharts);
  rdTrade = wrap(rdTrade, rdxTradeCharts);
  rdFutures = wrap(rdFutures, V => rdxFuturesTools(V));
  // the export is one click away from every view (left panel)
  const RT = rdResultsTab;
  rdResultsTab = async function (B) {
    await RT(B);
    const side = B && B.querySelector('.rdside');
    if (side && !side.querySelector('.rdxgo')) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn rdxgo';
      b.textContent = 'Export everything (zip)…';
      b.title = 'Every drawn value with its index sets, metrics, results, the data file of each strategy in each future, the run itself';
      b.onclick = () => {
        RDV.an.view = 'futures';
        rdResultsTab(B).then(() => {
          const x = B.querySelector('.rdxpkg');
          if (x) x.scrollIntoView({block: 'start'});
        });
      };
      side.querySelector('.rdnav').after(b);
    }
  };
  rdVuln = wrap(rdVuln, V => {
    if (!V.querySelector('.rdxbar')) {
      const b = rdxBar(V, 'vuln', [['', 'As shown']], () => {});
      b.querySelector('label').remove();
      V.appendChild(b);
    }
  });
}
