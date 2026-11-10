'use strict';
/* ============================== RESULTS: pivot + chart engines (built-in SVG, Plotly, ECharts, Vega-Lite) ==============================
   Records of the ticked runs and variables -> filters -> pivot (rows, columns, panels; aggregation; show as) -> table or chart.
   Fields = the index sets of the variables (from each run's model file) + RUN (several runs) + VARIABLE (several variables).
   Derived results (production / use by technology, emissions by technology...) come from the server when the model does not
   output them. Chart libraries are loaded only when chosen (served by the Studio server; CDN as a fallback). */
const PAL = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
  other: {light: '#9a9993', dark: '#7c7b75'}
};
const PALETTES = {
  studio: ['Studio (validated, 8)', null],
  // one colour family made from the colour of the Studio (Colour ▾ in the top bar), dark to light
  get family() {
    return ['One colour family (the Studio colour, 8)', typeof CHST !== 'undefined' ? CHST.family(8).map(c => '#' + c.match(/\d+/g).map(x => (+x).toString(16).padStart(2, '0')).join('')) : null];
  },
  okabe: ['Okabe-Ito (colour-blind safe, 8)', ['#0072b2', '#e69f00', '#009e73', '#cc79a7', '#56b4e9', '#d55e00', '#f0e442', '#000000']],
  tableau: ['Tableau 10', ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac']],
  set2: ['ColorBrewer Set2 (8)', ['#66c2a5', '#fc8d62', '#8da0cb', '#e78ac3', '#a6d854', '#ffd92f', '#e5c494', '#b3b3b3']],
  dark2: ['ColorBrewer Dark2 (8)', ['#1b9e77', '#d95f02', '#7570b3', '#e7298a', '#66a61e', '#e6ab02', '#a6761d', '#666666']],
  paired: [
    'ColorBrewer Paired (12)',
    ['#a6cee3', '#1f78b4', '#b2df8a', '#33a02c', '#fb9a99', '#e31a1c', '#fdbf6f', '#ff7f00', '#cab2d6', '#6a3d9a', '#ffff99', '#b15928']
  ],
  tab20: [
    'Category 20',
    [
      '#1f77b4',
      '#aec7e8',
      '#ff7f0e',
      '#ffbb78',
      '#2ca02c',
      '#98df8a',
      '#d62728',
      '#ff9896',
      '#9467bd',
      '#c5b0d5',
      '#8c564b',
      '#c49c94',
      '#e377c2',
      '#f7b6d2',
      '#7f7f7f',
      '#c7c7c7',
      '#bcbd22',
      '#dbdb8d',
      '#17becf',
      '#9edae5'
    ]
  ],
  viridis: [
    'Viridis (ordered)',
    ['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725']
  ],
  cividis: [
    'Cividis (ordered, CVD safe)',
    ['#00224e', '#123570', '#3b496c', '#575d6d', '#707173', '#8a8779', '#a69d75', '#c4b56c', '#e4cf5b', '#fee838']
  ],
  plasma: [
    'Plasma (ordered)',
    ['#0d0887', '#46039f', '#7201a8', '#9c179e', '#bd3786', '#d8576b', '#ed7953', '#fb9f3a', '#fdca26', '#f0f921']
  ],
  greys: ['Greys (print)', ['#252525', '#525252', '#737373', '#969696', '#bdbdbd', '#d9d9d9']]
};
/* chart themes: typography, surface, grid and axis treatment (all on the validated Studio palette; your own font,
   palette and colours override them). Written styles in the spirit of common publication looks, not copies. */
const THEMES = {
  editorial: {
    label: 'Editorial (Studio)',
    font: '"Geist", "Segoe UI", sans-serif',
    title: '"Newsreader", Georgia, serif',
    bg: '#ffffff',
    ink: '#2f3437',
    mut: '#787774',
    grid: '#eeede9',
    axis: '#c9c7c1',
    gridOn: true
  },
  print: {
    label: 'Minimal print',
    font: 'Helvetica, Arial, sans-serif',
    title: 'Helvetica, Arial, sans-serif',
    bg: '#ffffff',
    ink: '#111111',
    mut: '#4d4d4d',
    grid: '#ececec',
    axis: '#111111',
    gridOn: true
  },
  newsprint: {
    label: 'Financial newspaper (salmon paper)',
    font: '"Geist", Arial, sans-serif',
    title: 'Georgia, "Newsreader", serif',
    bg: '#fff1e5',
    ink: '#33302e',
    mut: '#66605c',
    grid: '#e9dccf',
    axis: '#33302e',
    gridOn: true
  },
  weekly: {
    label: 'News weekly',
    font: '"Geist", "Segoe UI", sans-serif',
    title: '"Geist", "Segoe UI", sans-serif',
    bg: '#ffffff',
    ink: '#0c0c0c',
    mut: '#595959',
    grid: '#d9d9d9',
    axis: '#0c0c0c',
    gridOn: true,
    titleWeight: 700
  },
  journal: {
    label: 'Science journal',
    font: 'Arial, Helvetica, sans-serif',
    title: 'Arial, Helvetica, sans-serif',
    bg: '#ffffff',
    ink: '#000000',
    mut: '#333333',
    grid: '#ffffff',
    axis: '#000000',
    gridOn: false,
    titleWeight: 700
  },
  agency: {
    label: 'Energy agency report',
    font: '"Geist", "Segoe UI", sans-serif',
    title: '"Geist", "Segoe UI", sans-serif',
    bg: '#f7f6f3',
    ink: '#1d2b36',
    mut: '#5b6670',
    grid: '#e3e1db',
    axis: '#9aa3ab',
    gridOn: true,
    titleWeight: 600
  },
  darkpres: {
    label: 'Dark presentation',
    font: '"Geist", "Segoe UI", sans-serif',
    title: '"Newsreader", Georgia, serif',
    bg: '#191919',
    ink: '#e6e5e1',
    mut: '#9b9a97',
    grid: '#2c2c2c',
    axis: '#55544f',
    gridOn: true,
    dark: true
  }
};
const isDark = () => {
  const r = document.documentElement;
  return r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};
const RV = {runs: [], cache: {}, info: {}, def: null, saved: [], fonts: {}};
const CHART0 = () => ({
  runs: [],
  vars: [],
  rows: ['YEAR'],
  cols: ['TECHNOLOGY'],
  panels: [],
  filters: {},
  agg: 'sum',
  show: 'value',
  baseField: 'RUN',
  baseValue: '',
  view: 'chart',
  engine: 'builtin',
  type: 'stack',
  title: '',
  subtitle: '',
  note: '',
  xlabel: '',
  ylabel: '',
  unit: '',
  divide: 1,
  decimals: 1,
  topn: 8,
  barw: 60,
  sort: 'key',
  legend: 'right',
  height: 460,
  pcols: 2,
  theme: 'editorial',
  fontFamily: '"Geist", "Segoe UI", sans-serif',
  titleFont: '"Newsreader", Georgia, serif',
  fsTitle: 20,
  fsAxis: 13,
  fsTick: 12,
  fsLegend: 12,
  palette: 'studio',
  colors: {},
  bg: 'theme',
  grid: true,
  logy: false,
  ymin: '',
  ymax: '',
  lineWidth: 2,
  markers: false,
  opacity: 0.9,
  labels: false,
  heat: false,
  dpi: 192,
  flowYear: '',
  flowRegion: '',
  flowMin: 0.5,
  width: 0,
  y2: [],
  y2label: '',
  y2unit: ''
});

/* ---------- engines and chart types ---------- */
const ENGINES = {builtin: 'Built-in (SVG)', plotly: 'Plotly', echarts: 'Apache ECharts', vega: 'Vega-Lite'};
const TYPES = {
  builtin: [
    ['stack', 'Stacked columns'],
    ['group', 'Grouped columns'],
    ['line', 'Lines'],
    ['area', 'Areas (each series)']
  ],
  plotly: [
    ['bar_stack', 'Stacked bars'],
    ['bar_group', 'Grouped bars'],
    ['bar_rel', 'Bars, positive / negative stacked'],
    ['bar_100', 'Stacked bars 100 %'],
    ['barh_stack', 'Horizontal stacked bars'],
    ['line', 'Lines'],
    ['line_markers', 'Lines and markers'],
    ['area_stack', 'Stacked areas'],
    ['area_100', 'Stacked areas 100 %'],
    ['scatter', 'Scatter (points)'],
    ['bubble', 'Bubbles (size = value)'],
    ['pie', 'Pie'],
    ['donut', 'Donut'],
    ['sunburst', 'Sunburst (rows > columns)'],
    ['treemap', 'Treemap (rows > columns)'],
    ['heatmap', 'Heat map (rows x columns)'],
    ['surface', '3-D surface (rows x columns)'],
    ['box', 'Box plot (spread over rows)'],
    ['violin', 'Violin (spread over rows)'],
    ['histogram', 'Histogram of the values'],
    ['waterfall', 'Waterfall (columns)'],
    ['funnel', 'Funnel (columns)'],
    ['radar', 'Radar (rows around)'],
    ['sankey', 'Sankey (rows -> columns)'],
    ['energy_sankey', 'Energy flows (Sankey from production and use)']
  ],
  echarts: [
    ['bar_stack', 'Stacked bars'],
    ['bar_group', 'Grouped bars'],
    ['bar_100', 'Stacked bars 100 %'],
    ['barh_stack', 'Horizontal stacked bars'],
    ['line', 'Lines'],
    ['line_smooth', 'Smooth lines'],
    ['area_stack', 'Stacked areas'],
    ['scatter', 'Scatter (points)'],
    ['pie', 'Pie'],
    ['donut', 'Donut'],
    ['rose', 'Nightingale rose'],
    ['sunburst', 'Sunburst (rows > columns)'],
    ['treemap', 'Treemap (rows > columns)'],
    ['heatmap', 'Heat map (rows x columns)'],
    ['radar', 'Radar (rows around)'],
    ['parallel', 'Parallel coordinates (rows as axes)'],
    ['themeriver', 'Stream graph'],
    ['boxplot', 'Box plot (spread over rows)'],
    ['sankey', 'Sankey (rows -> columns)'],
    ['energy_sankey', 'Energy flows (Sankey from production and use)']
  ],
  vega: [
    ['bar_stack', 'Stacked bars'],
    ['bar_group', 'Grouped bars'],
    ['bar_100', 'Stacked bars 100 %'],
    ['line', 'Lines'],
    ['line_points', 'Lines and points'],
    ['area_stack', 'Stacked areas'],
    ['area_100', 'Stacked areas 100 %'],
    ['point', 'Points'],
    ['heatmap', 'Heat map (rows x columns)'],
    ['boxplot', 'Box plot (spread over rows)'],
    ['tick', 'Strip plot (ticks)']
  ]
};
const LIBS = {plotly: ['plotly.min.js'], echarts: ['echarts.min.js'], vega: ['vega.min.js', 'vega-lite.min.js', 'vega-embed.min.js']};
const CDN = {
  'plotly.min.js': 'https://cdn.jsdelivr.net/npm/plotly.js-dist-min@2.35.2/plotly.min.js',
  'echarts.min.js': 'https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js',
  'vega.min.js': 'https://cdn.jsdelivr.net/npm/vega@5.30.0/build/vega.min.js',
  'vega-lite.min.js': 'https://cdn.jsdelivr.net/npm/vega-lite@5.21.0/build/vega-lite.min.js',
  'vega-embed.min.js': 'https://cdn.jsdelivr.net/npm/vega-embed@6.26.0/build/vega-embed.min.js'
};
const LIBLOADED = {};
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error('cannot load ' + src));
    document.head.appendChild(s);
  });
}
async function needLib(engine) {
  for (const f of LIBS[engine] || []) {
    if (LIBLOADED[f]) continue;
    try {
      await loadScript(SERVER.url + '/lib/' + f);
    } catch (e) {
      await loadScript(CDN[f]);
    }
    LIBLOADED[f] = true;
  }
  if (engine === 'plotly' && typeof CHST !== 'undefined') CHST.wrap();
} // titles, legend, background of the MC / RDM / RH charts
async function libText(f) {
  try {
    const r = await fetch(SERVER.url + '/lib/' + f);
    if (r.ok) return await r.text();
  } catch (e) {}
  const r = await fetch(CDN[f]);
  return await r.text();
}

/* ---------- fonts: installed families + font files you load (kept in this browser, embedded in SVG exports) ---------- */
const FONTS2 = [
  'Barlow',
  'Inter',
  'Segoe UI',
  'Arial',
  'Helvetica',
  'Calibri',
  'Cambria',
  'Candara',
  'Georgia',
  'Times New Roman',
  'Garamond',
  'Book Antiqua',
  'Palatino Linotype',
  'Roboto',
  'Source Sans 3',
  'Source Sans Pro',
  'Lato',
  'Open Sans',
  'Montserrat',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Century Gothic',
  'Franklin Gothic Medium',
  'Courier New',
  'Consolas',
  'JetBrains Mono',
  'Amiri',
  'Noto Sans Arabic',
  'Noto Naskh Arabic',
  'Cairo',
  'Tajawal',
  'Arial Unicode MS'
];
(() => {
  try {
    const f = JSON.parse(localStorage.getItem('mst_nos_fonts') || '{}');
    for (const [n, url] of Object.entries(f)) {
      RV.fonts[n] = url;
      new FontFace(n, `url(${url})`)
        .load()
        .then(ff => document.fonts.add(ff))
        .catch(() => {});
    }
  } catch (e) {}
})();
const fontOK = n => {
  try {
    return RV.fonts[n] || document.fonts.check(`12px "${n}"`);
  } catch (e) {
    return true;
  }
};
function fontCss(family) {
  const out = [];
  for (const f of [].concat(family)) {
    const n = (f || '').split(',')[0].replace(/["']/g, '').trim();
    if (RV.fonts[n]) out.push(`@font-face{font-family:"${n}";src:url(${RV.fonts[n]})}`);
    else if (/^(Geist|Geist Mono|Newsreader)$/.test(n))
      for (const r of document.styleSheets) {
        try {
          for (const rule of r.cssRules)
            if (rule.type === 5 && rule.style.getPropertyValue('font-family').replace(/["']/g, '') === n)
              out.push(embedFontCss(rule.cssText));
        } catch (e) {}
      }
  } // embedded Studio fonts travel with the SVG
  return [...new Set(out)].join('');
}

/* ---------- data ---------- */
async function loadRuns() {
  RV.runs = (await api('/api/runs').catch(() => [])).filter(r => r.state === 'done');
  return RV.runs;
}
async function runInfo(id) {
  if (!RV.info[id]) RV.info[id] = await api('/api/run/' + id);
  return RV.info[id];
}
async function getVar(run, v) {
  const k = run + '|' + v;
  if (!RV.cache[k]) RV.cache[k] = await api(`/api/run/${run}/var/${v}`);
  return RV.cache[k];
}
function varDims(v, n, run) {
  const I = run && RV.info[run];
  let d = I && I.vardims && I.vardims[v];
  if (!d) {
    const s = SCHEMA && SCHEMA.vars && SCHEMA.vars.get(v);
    d = s ? s.dims.map(x => (x === 'FUEL' ? 'COMMODITY' : x)) : [];
  }
  return Array.from({length: n}, (_, i) => d[i] || `index ${i + 1}`).map((x, i, a) => (a.indexOf(x) < i ? x + ' 2' : x));
}
// clean names: the variable itself; a shadow price = the name of its constraint without its code
const conCode = c => (String(c).match(/^([A-Za-z]+\d*[a-z]?\d*)_/) || [])[1] || '';
const conName = c => String(c).replace(/^[A-Za-z]+\d*[a-z]?\d*_/, '');
const vlabel = v => (v === 'OBJECTIVE' ? 'Objective' : v.startsWith('DUAL.') ? conName(v.slice(5)) + ' (shadow price)' : v.startsWith('IN.') ? v.slice(3) + ' (input)' : v);
// blocks of constraints (from the prefix of their code) for the list of shadow prices
const CONBLOCK = [
  [/^EB/, 'Commodity balances'],
  [/^(CAa|CAb|CA)/, 'Capacity adequacy'],
  [/^TCC/, 'Capacity limits'],
  [/^(AAC|Acc|TAC|AAA)/, 'Activity'],
  [/^NCC/, 'New capacity limits'],
  [/^CS/, 'Storage level'],
  [/^(SI|SC)/, 'Storage investment'],
  [/^SV/, 'Salvage value'],
  [/^(CC|DC|OC|TDC|RM)/, 'Costs'],
  [/^UDC/, 'User constraints'],
  [/^(E|AE|ME)/, 'Emissions'],
  [/^(B|BU|FI|FD)/, 'Budget and finance'],
  [/^(RE|RM)/, 'Reserve margin and RE target']
];
const conBlock = c => {
  const k = conCode(c);
  for (const [rx, n] of CONBLOCK) if (rx.test(k)) return n;
  return 'Other constraints';
};
const runName = id => {
  const r = RV.runs.find(x => x.id === id);
  if (!r) return id;
  const n = r.name || r.id; // unique labels: same name -> add the date-time
  return RV.runs.filter(x => (x.name || x.id) === n).length > 1 ? `${n} (${(r.created || r.id).replace(/^\d{4}-/, '').slice(0, 11)})` : n;
};
async function loadRecords(D) {
  const recs = [],
    fieldSet = new Set();
  for (const run of D.runs)
    for (const v of D.vars) {
      const res = await getVar(run, v),
        rows = res.rows || [];
      if (!rows.length) continue;
      const dims = res.dims || varDims(v, rows[0].length - 1, run);
      dims.forEach(d => fieldSet.add(d));
      const rn = runName(run),
        rc = (RV.runs.find(x => x.id === run) || {}).case || '—';
      for (const row of rows) {
        const o = {RUN: rn, CASE: rc, VARIABLE: vlabel(v), v: row[row.length - 1]};
        for (let i = 0; i < dims.length; i++) o[dims[i]] = row[i];
        recs.push(o);
      }
    }
  const derivedF = enrichRecords(recs, fieldSet);
  const nCases = new Set(D.runs.map(r => (RV.runs.find(x => x.id === r) || {}).case || '—')).size;
  const fields = [
    ...(D.runs.length > 1 ? ['RUN'] : []),
    ...(nCases > 1 ? ['CASE'] : []),
    ...(D.vars.length > 1 ? ['VARIABLE'] : []),
    ...[...fieldSet].sort((a, b) => SETPREF.indexOf(a) - SETPREF.indexOf(b)),
    ...derivedF.filter(f => !fieldSet.has(f))
  ];
  if (D.runs.length > 1 && !fields.includes('RUN')) fields.unshift('RUN');
  return {recs, fields};
}
/* fields made from the index sets, to filter and pivot by: the season, day type and day part of a time slice
   (from Conversionls / ld / lh of the open model), the energy family of a technology (its main output) and of a
   commodity, and the decade of a year */
function enrichRecords(recs, fieldSet) {
  const out = [];
  if (fieldSet.has('TIMESLICE') && M) {
    for (const [p, f] of [
      ['Conversionls', 'SEASON'],
      ['Conversionld', 'DAYTYPE'],
      ['Conversionlh', 'DAILYTIMEBRACKET']
    ]) {
      const map = new Map();
      for (const r of P_(p).recs) if (+r.v === 1) map.set(String(r.idx[0]), String(r.idx[1]));
      if (!map.size) continue;
      out.push(f);
      const g = fieldSet.has(f) ? null : f;
      if (g) for (const r of recs) if (r.TIMESLICE !== undefined) r[g] = map.get(String(r.TIMESLICE)) ?? '—';
    }
  }
  if (fieldSet.has('TECHNOLOGY') && M) {
    const fam_ = new Map();
    for (const fl of M.flows) if (fl.dir === 'out' && !fam_.has(fl.t)) fam_.set(fl.t, FAMNAME[fam(fl.f)] || fam(fl.f));
    for (const fl of M.flows) if (!fam_.has(fl.t)) fam_.set(fl.t, FAMNAME[fam(fl.f)] || fam(fl.f));
    out.push('TECH_FAMILY');
    for (const r of recs) if (r.TECHNOLOGY !== undefined) r.TECH_FAMILY = fam_.get(String(r.TECHNOLOGY)) || 'Other';
  }
  if (fieldSet.has('TECHNOLOGY') && SYSTEMS.list.length) {
    out.push('TECH_SYSTEM');
    for (const r of recs)
      if (r.TECHNOLOGY !== undefined) r.TECH_SYSTEM = SYSTEMS.name(SYSTEMS.of(String(r.TECHNOLOGY), 'TECHNOLOGY')) || 'No system';
  }
  if (fieldSet.has('COMMODITY') && SYSTEMS.list.length) {
    out.push('COMMODITY_SYSTEM');
    for (const r of recs)
      if (r.COMMODITY !== undefined) r.COMMODITY_SYSTEM = SYSTEMS.name(SYSTEMS.of(String(r.COMMODITY), 'COMMODITY')) || 'No system';
  }
  if (fieldSet.has('TECHNOLOGY')) {
    out.push('TECH_DESC');
    for (const r of recs) if (r.TECHNOLOGY !== undefined) r.TECH_DESC = (TD[r.TECHNOLOGY] || String(r.TECHNOLOGY)).split(/[.(;]/)[0].trim();
  }
  if (fieldSet.has('COMMODITY')) {
    out.push('COMMODITY_DESC');
    for (const r of recs)
      if (r.COMMODITY !== undefined) r.COMMODITY_DESC = (FD[r.COMMODITY] || String(r.COMMODITY)).split(/[.(;]/)[0].trim();
  }
  if (fieldSet.has('COMMODITY')) {
    out.push('COMMODITY_FAMILY');
    for (const r of recs) if (r.COMMODITY !== undefined) r.COMMODITY_FAMILY = FAMNAME[fam(String(r.COMMODITY))] || 'Other';
  }
  if (fieldSet.has('YEAR')) {
    out.push('DECADE');
    for (const r of recs) if (r.YEAR !== undefined && !isNaN(+r.YEAR)) r.DECADE = Math.floor(+r.YEAR / 10) * 10 + 's';
  }
  return out;
}
const numSort = (a, b) => {
  const x = +a,
    y = +b;
  return !isNaN(x) && !isNaN(y) ? x - y : String(a).localeCompare(String(b));
};
function flabel(field, v) {
  if (v === undefined || v === null) return '—';
  const t =
    field === 'TECHNOLOGY'
      ? TD[v]
      : field === 'COMMODITY'
        ? FD[v]
        : field === 'REGION'
          ? RNAME[v] !== v
            ? RNAME[v]
            : ''
          : field === 'RUN' || field === 'VARIABLE' || field === 'YEAR'
            ? ''
            : sdesc(field, v);
  return t ? `${v} · ${t}` : String(v);
}

/* ---------- pivot ---------- */
const AGGS = {sum: 'Sum', mean: 'Mean', min: 'Minimum', max: 'Maximum', count: 'Count of values'};
const SHOWS = {
  value: 'Value',
  share_row: '% of each row (composition)',
  share_col: '% of each column',
  share_total: '% of the total',
  cumulative: 'Cumulative over rows',
  diff_base: 'Difference from a base member',
  pct_base: '% change from a base member',
  index_first: 'Index (first row = 100)',
  growth: 'Growth from the previous row (%)'
};
function pivot(D, recs) {
  const zones = [...D.panels, ...D.rows, ...D.cols];
  const keep = r => Object.entries(D.filters).every(([f, vs]) => !vs || vs.includes(String(r[f] ?? '—')));
  const F = recs.filter(keep);
  const kv = (r, fs) => fs.map(f => String(r[f] ?? '—'));
  const cells = new Map(),
    meta = new Map();
  for (const r of F) {
    const pk = kv(r, D.panels),
      rk = kv(r, D.rows),
      ck = kv(r, D.cols),
      key = [pk.join('\u0001'), rk.join('\u0001'), ck.join('\u0001')].join('\u0002');
    let a = cells.get(key);
    if (!a) {
      a = {s: 0, n: 0, mn: Infinity, mx: -Infinity};
      cells.set(key, a);
      meta.set(key, {pk, rk, ck});
    }
    a.s += r.v;
    a.n++;
    if (r.v < a.mn) a.mn = r.v;
    if (r.v > a.mx) a.mx = r.v;
  }
  const aggv = a =>
    !a ? 0 : D.agg === 'mean' ? a.s / a.n : D.agg === 'min' ? a.mn : D.agg === 'max' ? a.mx : D.agg === 'count' ? a.n : a.s;
  const raw = new Map();
  for (const [k, a] of cells) raw.set(k, aggv(a) / (D.agg === 'count' ? 1 : +D.divide || 1));
  // base comparisons: the same cell with the base field set to the base member
  const bf = D.baseField,
    bz = D.panels.includes(bf) ? 0 : D.rows.includes(bf) ? 1 : D.cols.includes(bf) ? 2 : -1;
  const baseKey = m => {
    if (bz < 0) return null;
    const parts = [m.pk.slice(), m.rk.slice(), m.ck.slice()],
      z = [D.panels, D.rows, D.cols][bz];
    parts[bz][z.indexOf(bf)] = String(D.baseValue);
    return parts.map(p => p.join('\u0001')).join('\u0002');
  };
  // structure
  const P = new Map();
  for (const [k, m] of meta) {
    const pk = m.pk.join('\u0001'),
      rk = m.rk.join('\u0001'),
      ck = m.ck.join('\u0001');
    if (!P.has(pk)) P.set(pk, {key: pk, parts: m.pk, rows: new Map(), cols: new Map(), val: new Map()});
    const p = P.get(pk);
    p.rows.set(rk, m.rk);
    p.cols.set(ck, m.ck);
    p.val.set(rk + '\u0002' + ck, raw.get(k));
  }
  const rowTotal = (p, rk) => [...p.cols.keys()].reduce((s, ck) => s + (p.val.get(rk + '\u0002' + ck) || 0), 0);
  const panels = [...P.values()]
    .sort((a, b) => numSort(a.key, b.key))
    .map(p => {
      let rows = [...p.rows.keys()],
        cols = [...p.cols.keys()];
      rows.sort((a, b) =>
        D.sort === 'total_desc' ? rowTotal(p, b) - rowTotal(p, a) : D.sort === 'total_asc' ? rowTotal(p, a) - rowTotal(p, b) : numSort(a, b)
      );
      cols.sort(numSort);
      const V = new Map(p.val);
      if (D.show !== 'value') {
        const colT = new Map(cols.map(ck => [ck, rows.reduce((s, rk) => s + (p.val.get(rk + '\u0002' + ck) || 0), 0)]));
        const rowT = new Map(rows.map(rk => [rk, rowTotal(p, rk)])),
          tot = [...rowT.values()].reduce((a, b) => a + b, 0);
        const cum = new Map();
        rows.forEach((rk, i) =>
          cols.forEach(ck => {
            const k = rk + '\u0002' + ck,
              v = p.val.get(k) || 0;
            let o = v;
            if (D.show === 'share_row') o = rowT.get(rk) ? (100 * v) / rowT.get(rk) : 0;
            else if (D.show === 'share_col') o = colT.get(ck) ? (100 * v) / colT.get(ck) : 0;
            else if (D.show === 'share_total') o = tot ? (100 * v) / tot : 0;
            else if (D.show === 'cumulative') {
              o = (cum.get(ck) || 0) + v;
              cum.set(ck, o);
            } else if (D.show === 'index_first') {
              const f = p.val.get(rows[0] + '\u0002' + ck) || 0;
              o = f ? (100 * v) / f : null;
            } else if (D.show === 'growth') {
              const pv = i ? p.val.get(rows[i - 1] + '\u0002' + ck) || 0 : null;
              o = pv ? (100 * (v - pv)) / Math.abs(pv) : null;
            } else if (D.show === 'diff_base' || D.show === 'pct_base') {
              const m = {pk: p.parts, rk: p.rows.get(rk), ck: p.cols.get(ck)},
                bk = baseKey(m);
              const b = bk ? raw.get(bk) || 0 : null;
              o = b === null ? null : D.show === 'diff_base' ? v - b : b ? (100 * (v - b)) / Math.abs(b) : null;
            }
            V.set(k, o);
          })
        );
        if (D.show === 'diff_base' || D.show === 'pct_base') {
          // the base member itself is dropped (all zero)
          if (bz === 1) rows = rows.filter(rk => p.rows.get(rk)[D.rows.indexOf(bf)] !== String(D.baseValue));
          if (bz === 2) cols = cols.filter(ck => p.cols.get(ck)[D.cols.indexOf(bf)] !== String(D.baseValue));
        }
      }
      return {
        key: p.key,
        label: p.parts.map((x, i) => flabel(D.panels[i], x)).join(' · '),
        rows,
        cols,
        rowParts: p.rows,
        colParts: p.cols,
        val: V,
        get: (rk, ck) => {
          const v = V.get(rk + '\u0002' + ck);
          return v === undefined ? 0 : v;
        },
        raw: (rk, ck) => V.get(rk + '\u0002' + ck)
      };
    });
  if ((D.show === 'diff_base' || D.show === 'pct_base') && bz === 0)
    panels.splice(0, panels.length, ...panels.filter(p => p.key.split('\u0001')[D.panels.indexOf(bf)] !== String(D.baseValue)));
  const ATTR = new Set([
    'SEASON',
    'DAYTYPE',
    'DAILYTIMEBRACKET',
    'TECH_FAMILY',
    'TECH_DESC',
    'COMMODITY_FAMILY',
    'COMMODITY_DESC',
    'DECADE',
    'CASE',
    'TECH_SYSTEM',
    'COMMODITY_SYSTEM'
  ]); // attributes of another field, never summed over by themselves
  const unused = recs.length
    ? Object.keys(recs[0]).filter(f => f !== 'v' && !zones.includes(f) && !ATTR.has(f) && new Set(F.map(r => r[f])).size > 1)
    : [];
  return {panels, n: F.length, unused, baseMissing: (D.show === 'diff_base' || D.show === 'pct_base') && bz < 0};
}
const rowLab = (D, parts) => parts.map((x, i) => (D.rows[i] === 'YEAR' ? x : flabel(D.rows[i], x))).join(' · ') || 'all';
const colLab = (D, parts) =>
  parts.length ? parts.map((x, i) => flabel(D.cols[i], x)).join(' · ') : D.vars.length === 1 ? D.vars[0] : 'value';
function colorFn(D, allCols) {
  const pals = (PALETTES[D.palette] && PALETTES[D.palette][1]) || PAL[themeC(D).dark ? 'dark' : 'light'];
  return (ck, parts) => {
    const name = parts && parts.length === 1 ? parts[0] : ck;
    if (D.colors[ck]) return D.colors[ck];
    if (ck === 'Other') return PAL.other[isDark() ? 'dark' : 'light'];
    if (D.cols.length === 1 && D.cols[0] === 'COMMODITY' && COLORS[name] && D.palette === 'studio') return COLORS[name];
    const i = allCols.indexOf(ck);
    return pals[(i < 0 ? 0 : i) % pals.length];
  };
}
/* top N columns for charts (the rest folded into "Other"), colour slots fixed by the full column list */
function chartModel(D, PV) {
  const allCols = [...new Set(PV.panels.flatMap(p => p.cols))].sort(numSort);
  const tot = new Map();
  PV.panels.forEach(p =>
    p.cols.forEach(ck => tot.set(ck, (tot.get(ck) || 0) + p.rows.reduce((s, rk) => s + Math.abs(p.get(rk, ck) || 0), 0)))
  );
  let keepC = allCols;
  const fold =
    D.other !== 'all' && allCols.length > D.topn && !['heatmap', 'surface', 'sankey', 'energy_sankey', 'parallel'].includes(D.type);
  if (fold) keepC = new Set([...allCols].sort((a, b) => tot.get(b) - tot.get(a)).slice(0, D.topn - 1));
  const color = colorFn(D, fold ? [...keepC].sort(numSort) : allCols); // colour slots: the series shown, in a fixed (name) order
  const panels = PV.panels.map(p => {
    const cols = fold
      ? [...p.cols.filter(c => keepC.has(c)), ...(D.other !== 'hide' && p.cols.some(c => !keepC.has(c)) ? ['Other'] : [])]
      : p.cols; // D.other: group (default) | hide | all
    const get = (rk, ck) =>
      ck !== 'Other' ? p.get(rk, ck) : p.cols.filter(c => !keepC.has(c)).reduce((s, c) => s + (p.get(rk, c) || 0), 0);
    const raw = (rk, ck) => {
      if (ck !== 'Other') return p.raw(rk, ck);
      const vs = p.cols
        .filter(c => !keepC.has(c))
        .map(c => p.raw(rk, c))
        .filter(v => v !== null && v !== undefined);
      return vs.length ? vs.reduce((a, b) => a + b, 0) : null;
    }; // "Other" in ECharts / Plotly / Vega too
    return {
      ...p,
      cols,
      get,
      raw,
      rlab: rk => rowLab(D, p.rowParts.get(rk) || []),
      clab: ck => (D.snames && D.snames[ck]) || (ck === 'Other' ? 'Other' : colLab(D, p.colParts.get(ck) || [])), // your own legend names
      color: ck => color(ck, p.colParts.get(ck))
    };
  });
  return {panels, allCols, unit: uOf(D), title: D.title || D.vars.map(vlabel).join(', '), D};
}

/* ---------- the view ---------- */
async function showResults(runId) {
  const R = document.getElementById('results');
  setView('res');
  if (!(await serverInfo())) {
    R.innerHTML = `<div class="empty" style="margin:24px">The solver server is not running: start the Studio app (or <code>START_SOLVER.bat</code>), then "Run".</div>`;
    return;
  }
  await loadRuns();
  if (!RV.runs.length) {
    R.innerHTML = `<div class="empty" style="margin:24px">No solved runs yet: use "Run".</div>`;
    return;
  }
  if (!RV.def) RV.def = CHART0();
  if (runId) RV.def.runs = [runId];
  if (!RV.def.runs.length || !RV.def.runs.every(r => RV.runs.some(x => x.id === r))) RV.def.runs = [RV.runs[0].id];
  RV.saved = await LIB.charts();
  renderResults();
}
function setView(v) {
  document
    .querySelectorAll('#viewseg button[data-v]')
    .forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v || (v === 'dia' && b.dataset.v === 'res-off')));
  document.getElementById('stage').hidden = v !== 'dia';
  document.getElementById('results').hidden = v !== 'res';
  const sp = document.getElementById('setup');
  if (sp) sp.hidden = v !== 'ovw';
  const mv = document.getElementById('mcview');
  if (mv) mv.hidden = v !== 'mc';
  const rv = document.getElementById('rdmview');
  if (rv) rv.hidden = v !== 'rdm';
  const hv = document.getElementById('rhview');
  if (hv) hv.hidden = v !== 'rh';
  const mo = document.getElementById('monitor');
  if (mo) mo.hidden = v !== 'mon';
  CURVIEW = v;
  renderBrowser();
  if (v === 'dia') fit();
  if (typeof WIN !== 'undefined') WIN.viewChanged(v);
}
let CURVIEW = 'dia';
let RVDRAW = null; // current drawing (for exports)
/* keep what the user sees while the view is drawn again: scroll positions, open / closed sections, search text */
function uiKeep(R) {
  const q = sel => [...R.querySelectorAll(sel)];
  return {
    scroll: ['.rcfg', '.vbox', '.rlist', '.rmain'].map(sl => q(sl).map(e => e.scrollTop)),
    self: R.scrollTop,
    win: window.scrollY,
    open: q('.rcfg details > summary').map(sm => [sm.textContent.replace(/\d+\s*\/\s*\d+|\d+/g, '').trim(), sm.parentElement.open]),
    search: (R.querySelector('.vsearch') || {}).value || ''
  };
}
function uiRestore(R, k) {
  if (!k) return;
  const q = sel => [...R.querySelectorAll(sel)];
  const op = new Map(k.open);
  q('.rcfg details > summary').forEach(sm => {
    const t = sm.textContent.replace(/\d+\s*\/\s*\d+|\d+/g, '').trim();
    if (op.has(t)) sm.parentElement.open = op.get(t);
  });
  const vs = R.querySelector('.vsearch');
  if (vs && k.search) {
    vs.value = k.search;
    vs.dispatchEvent(new Event('input'));
  }
  ['.rcfg', '.vbox', '.rlist', '.rmain'].forEach((sl, i) =>
    q(sl).forEach((e, j) => {
      if (k.scroll[i][j] != null) e.scrollTop = k.scroll[i][j];
    })
  );
  R.scrollTop = k.self;
  if (Math.abs(window.scrollY - k.win) > 2) window.scrollTo(0, k.win);
}
// the width of the settings panel, kept in this browser (a convenience: the page works without it)
function rcwLoad() {
  try {
    return +localStorage.getItem('mst_rcw') || 300;
  } catch (e) {
    return 300;
  }
}
function rcwSave() {
  try {
    localStorage.setItem('mst_rcw', String(RV.rcw));
  } catch (e) {}
}
// the short explanation under "!": meaning, unit, index sets; shadow prices: what they mean; then the document
function vExplain(v, D) {
  const I = RV.info[D.runs[0]] || {},
    ix = (I.vardims && I.vardims[v]) || [],
    d = typeof VDESC !== 'undefined' && VDESC[v],
    z = RV.vgroups && RV.vgroups.zero.has(v);
  let t;
  if (v === 'OBJECTIVE')
    t =
      'Total discounted cost of the system over the horizon (what the model minimises): the full objective, its constant part (fixed cost of the residual capacity) and the objective without that part.';
  else if (v.startsWith('DUAL.')) {
    const c = v.slice(5);
    t = `Shadow price of the constraint <b>${esc(conName(c))}</b> <span class="muted">(${esc(c)}, ${esc(conBlock(c).toLowerCase())})</span>: how much the objective changes for one more unit on its right-hand side, discounted to the first year. A commodity balance gives the marginal cost of the commodity; an emission limit, the carbon price.`;
  } else t = d ? esc(d[1]) + (d[2] ? ` <span class="muted">Unit: ${esc(d[2])}.</span>` : '') : `${esc(v)}: a variable of the model.`;
  return `<p>${t}</p>${ix.length ? `<p class="muted">Indexed by ${esc(ix.join(', '))}.</p>` : ''}${z ? '<p class="muted">All zero in this run: nothing to show.</p>' : ''}<button type="button" class="lnk vdoc">More in the document →</button>`;
}
async function renderResults() {
  const R = document.getElementById('results'),
    D = RV.def,
    tok = (RV.tok = (RV.tok || 0) + 1),
    keep = R.querySelector('.rcfg') ? uiKeep(R) : null;
  if (D.variable && !D.vars.length) {
    D.vars = [D.variable];
    delete D.variable;
  } // charts saved by v1.0 and before
  if (D.x && !D.rows.length) {
    D.rows = [D.x];
    D.cols = D.series ? [D.series] : [];
  }
  const infos = await Promise.all(D.runs.map(runInfo));
  const vars = {},
    derived = {};
  const duals = {},
    inputs = {},
    zero = new Set();
  let hasObj = false;
  infos.forEach(s => {
    Object.entries(s.variables || {}).forEach(([k, n]) => (vars[k] = Math.max(vars[k] || 0, n)));
    Object.entries(s.derived || {}).forEach(([k, n]) => {
      vars[k] = Math.max(vars[k] || 0, n);
      derived[k] = true;
    });
    Object.entries(s.duals || {}).forEach(([k, n]) => {
      vars['DUAL.' + k] = Math.max(vars['DUAL.' + k] || 0, n);
      duals['DUAL.' + k] = true;
    });
    // the inputs of the run (every parameter of its data file), to chart with the results
    Object.entries(s.inputs || {}).forEach(([k, n]) => {
      vars['IN.' + k] = Math.max(vars['IN.' + k] || 0, n);
      inputs['IN.' + k] = true;
    });
    if (s.objective != null) {
      vars.OBJECTIVE = 3;
      hasObj = true;
    }
    Object.keys(s.vardims || {}).forEach(k => zero.add(k));
  });
  for (const k of Object.keys(vars)) zero.delete(k);
  RV.vgroups = {derived, duals, zero};
  const names = Object.keys(vars).sort();
  D.vars = D.vars.filter(v => vars[v]);
  if (!D.vars.length)
    D.vars = [names.find(v => /^ProductionByTechnologyAnnual$/.test(v)) || names.find(v => /TotalCapacityAnnual/.test(v)) || names[0]];
  const {recs, fields} = await loadRecords(D);
  RV.lastRecs = recs;
  RV.lastFields = fields;
  {
    const us = new Set(
      D.vars.map(v =>
        typeof unitOfAll === 'function'
          ? unitOfAll(v === 'OBJECTIVE' ? 'Objective' : v, recs.filter(r => r.VARIABLE === vlabel(v)).slice(0, 3000))
          : ''
      )
    );
    D._unitAuto = us.size === 1 ? [...us][0] : '';
  }
  const members = {};
  for (const f of fields) members[f] = [...new Set(recs.map(r => String(r[f] ?? '—')))].sort(numSort);
  for (const z of ['rows', 'cols', 'panels']) D[z] = D[z].filter(f => fields.includes(f));
  for (const k of Object.keys(D.filters)) if (!fields.includes(k)) delete D.filters[k];
  if (!D.rows.length && !D.cols.length) {
    if (fields.includes('YEAR')) D.rows = ['YEAR'];
    const s = ['TECHNOLOGY', 'COMMODITY', 'EMISSION', 'RUN'].find(f => fields.includes(f) && !D.rows.includes(f));
    if (s) D.cols = [s];
  }
  if (D.runs.length > 1 && !['rows', 'cols', 'panels'].some(z => D[z].includes('RUN')) && !D.filters.RUN) D.rows = [...D.rows, 'RUN']; // runs side by side in each group
  if (!TYPES[D.engine].some(t => t[0] === D.type)) D.type = TYPES[D.engine][0][0];
  if (!D.baseValue && members[D.baseField]) D.baseValue = members[D.baseField][0];
  const PV = pivot(D, recs),
    CM = chartModel(D, PV);
  const used = new Set([...D.rows, ...D.cols, ...D.panels]);
  const chip = (f, zone) =>
    `<span class="chip${D.filters[f] ? ' flt-on' : ''}" draggable="true" data-f="${esc(f)}" data-z="${zone}" title="${esc((typeof SETDESC_RES !== 'undefined' && SETDESC_RES[f] ? f + ': ' + SETDESC_RES[f] + '. ' : '') + 'Drag to Rows, Columns, Panels or back to the fields; click for its menu')}">${esc(f)}${D.filters[f] ? ` <i>${D.filters[f].length}/${members[f].length}</i>` : ''}</span>`;
  const zone = (z, lab, hint) =>
    `<div class="zone" data-zone="${z}"><div class="zl">${lab}<span class="muted"> ${hint}</span></div><div class="zc">${(z === 'fields' ? fields.filter(f => !used.has(f)) : D[z]).map(f => chip(f, z)).join('') || '<span class="muted zempty">Drop fields here</span>'}</div></div>`;
  const byCase = new Map();
  for (const r of RV.runs) {
    const c = r.case || '—';
    if (!byCase.has(c)) byCase.set(c, []);
    byCase.get(c).push(r);
  }
  const caseOrder = [...byCase.keys()].sort((a, b) => (b === LIB.current) - (a === LIB.current) || a.localeCompare(b));
  const runSel = caseOrder
    .map(
      c =>
        `<div class="vgrp">${c === '—' ? 'Runs without a case' : 'Case ' + esc(c)}${c === LIB.current ? ' <span class="sev info">Open</span>' : ''}<i>${byCase.get(c).length}</i></div>` +
        byCase
          .get(c)
          .map(
            r =>
              `<label><input type="checkbox" class="rsel" value="${r.id}" ${D.runs.includes(r.id) ? 'checked' : ''}> ${esc(r.name || r.id)} <span class="muted">${esc(r.created || '')} · ${esc(r.solver)}${r.objective != null ? ' · ' + fobj(r.objective) : ''}${r.scenarios && r.scenarios.length ? ' · ' + esc(r.scenarios.join(' + ')) : ''}</span></label>`
          )
          .join('')
    )
    .join('');
  const vinfo = v =>
    (typeof VDESC !== 'undefined' && VDESC[v]) ||
    (v.startsWith('IN.') && typeof PD !== 'undefined' && PD[v.slice(3)] ? [PD[v.slice(3)][0], 'Input: ' + PD[v.slice(3)][1], ''] : null);
  // list: bold clean names; "!" opens a short explanation (and the document); every variable kept,
  // the all-zero ones greyed in their topic; each group and topic can be folded; the panel is wider by dragging its edge
  RV.vcol = RV.vcol || new Set(['grp:Shadow prices']);
  const vrow = (v, z) => {
    const lab = v.startsWith('DUAL.') ? conName(v.slice(5)) : vlabel(v),
      d = vinfo(v);
    return `<div class="vrow${z ? ' vzero' : ''}" data-v="${esc((v + ' ' + lab + ' ' + (d ? d[1] : '')).toLowerCase())}"><label title="${esc(z ? `All zero in ${D.runs.length > 1 ? 'these runs' : 'this run'}` : v)}"><input type="checkbox" class="vsel" value="${esc(v)}" ${D.vars.includes(v) ? 'checked' : ''} ${z ? 'disabled' : ''}><b class="vn">${esc(lab)}</b></label>${derived[v] ? '<span class="dtag" title="computed by the Studio from the run">Derived</span>' : ''}<span class="vc" title="number of values">${z ? '0' : (vars[v] || 0).toLocaleString()}</span><button type="button" class="vinf" data-i="${esc(v)}" aria-expanded="false" aria-label="What is ${esc(lab)}?" title="What is it?">!</button></div>`;
  };
  const sec = (key, title, rows, nOn, nZero, cls, col) => {
    const shut = RV.vcol.has(key);
    return `<div class="vsec ${cls}${shut ? ' shut' : ''}" data-key="${esc(key)}"${col ? ` style="--tc:${col}"` : ''}><button type="button" class="vtog" aria-expanded="${!shut}"><span class="car" aria-hidden="true">▾</span>${col ? `<span class="tdot" style="background:${col}"></span>` : ''}<span class="vt">${esc(title)}</span><i>${nOn}${nZero ? ` <s title="all zero">+${nZero}</s>` : ''}</i></button><div class="vin">${rows}</div></div>`;
  };
  const VORDER = typeof VDESC !== 'undefined' ? [...new Set(Object.values(VDESC).map(x => x[0]))] : [];
  const gZero = [...RV.vgroups.zero].filter(v => !/^DUAL\./.test(v)).sort();
  const modelVars = names.filter(v => v !== 'OBJECTIVE' && !duals[v] && !inputs[v] && (!derived[v] || vinfo(v)));
  const topics = new Map(VORDER.map(g => [g, {on: [], zero: []}]));
  topics.set('Other', {on: [], zero: []});
  for (const v of modelVars) topics.get(vinfo(v) ? vinfo(v)[0] : 'Other').on.push(v);
  for (const v of gZero) topics.get(vinfo(v) ? vinfo(v)[0] : 'Other').zero.push(v);
  const topicHtml = [...topics]
    .filter(([, t]) => t.on.length + t.zero.length)
    .map(([g, t]) =>
      sec(
        'top:' + g,
        g,
        t.on.map(v => vrow(v)).join('') + t.zero.map(v => vrow(v, true)).join(''),
        t.on.length,
        t.zero.length,
        'vtopic',
        rtcolor(g)
      )
    )
    .join('');
  const dualList = names.filter(v => duals[v]),
    blocks = new Map();
  for (const v of dualList) {
    const b = conBlock(v.slice(5));
    if (!blocks.has(b)) blocks.set(b, []);
    blocks.get(b).push(v);
  }
  const dualHtml = [...blocks]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([b, l]) => sec('dual:' + b, b, l.map(v => vrow(v)).join(''), l.length, 0, 'vtopic'))
    .join('');
  const notSol = infos.filter(
    s =>
      s.not_solution ||
      (s.solver_status && !/OPTIMAL|FEASIBLE|LIMIT|STOPPED/i.test(s.solver_status)) ||
      /INFEAS|UNBOUND/i.test(s.solver_status || '')
  );
  const diagHtml = s =>
    `<div class="vnote"><b>${esc(s.name || s.id)}: ${esc(s.solver_status || '')}</b>. ${s.kind === 'check' ? 'The feasibility check found that the model has no solution.' : 'These values are not a solution: the solver stopped without finding one.'} ${diagList(s.diagnosis)}</div>`;
  const badHtml = notSol.length
    ? `<div class="vgrp" style="color:var(--bad,#b42318)">No optimal solution<i>${notSol.length}</i></div>${notSol.map(diagHtml).join('')}`
    : '';
  const derOnly = names.filter(v => derived[v] && !vinfo(v));
  // inputs grouped by the topic of the parameter (Costs, Capacity, Performance...)
  const inList = names.filter(v => inputs[v]),
    inTopics = new Map();
  for (const v of inList) {
    const g = (typeof PD !== 'undefined' && PD[v.slice(3)] && PD[v.slice(3)][0]) || 'Other';
    if (!inTopics.has(g)) inTopics.set(g, []);
    inTopics.get(g).push(v);
  }
  const inHtml = [...inTopics]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([g, l]) => sec('in:' + g, g, l.map(v => vrow(v)).join(''), l.length, 0, 'vtopic'))
    .join('');
  const varSel =
    badHtml +
    (names.includes('OBJECTIVE') ? `<div class="vsec vtop1">${vrow('OBJECTIVE')}</div>` : '') +
    (modelVars.length + gZero.length
      ? sec('grp:Results', 'Results of the model', topicHtml, modelVars.length, gZero.length, 'vgroup')
      : '') +
    (derOnly.length ? sec('grp:Derived', 'Derived from the run', derOnly.map(v => vrow(v)).join(''), derOnly.length, 0, 'vgroup') : '') +
    (dualList.length ? sec('grp:Shadow prices', 'Shadow prices of the constraints', dualHtml, dualList.length, 0, 'vgroup') : '') +
    (inHtml ? sec('grp:Inputs', 'Inputs of the run (its data)', inHtml, inList.length, 0, 'vgroup') : '');
  const opt = (k, list, cur) =>
    `<select data-k="${k}">${list.map(([a, b]) => `<option value="${esc(a)}" ${String(a) === String(cur) ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>`;
  const fontOpts = [
    ['"Geist", "Segoe UI", sans-serif', 'Geist (Studio text)'],
    ['"Newsreader", Georgia, serif', 'Newsreader (Studio titles)'],
    ['Georgia, serif', 'Georgia'],
    ['Helvetica, Arial, sans-serif', 'Helvetica / Arial'],
    ...[...FONTS2, ...Object.keys(RV.fonts)]
      .filter((x, i, a) => a.indexOf(x) === i)
      .map(f => [`"${f}", sans-serif`, f + (fontOK(f) ? (RV.fonts[f] ? '  (loaded file)' : '') : '  (not installed)')])
  ];
  const engOK = D.engine === 'builtin' || D.view === 'table';
  if (tok !== RV.tok) return; // a newer drawing was asked meanwhile: that one wins
  R.innerHTML = `<div class="rv" style="--rcw:${RV.rcw || rcwLoad()}px"><aside class="rcfg">
    <details open><summary>Runs</summary><div class="rlist">${runSel}</div>${
      D.runs.length > 1
        ? `<label>Compare the runs<select id="rcmp">${[
            ['side', 'side by side, in each group (e.g. by region)'],
            ['panels', 'one chart per run'],
            ['series', 'as series (colours)'],
            ['diff', 'difference to the first run'],
            ['pct', '% change from the first run']
          ]
            .map(([k, l]) => `<option value="${k}" ${k === cmpMode(D) ? 'selected' : ''}>${l}</option>`)
            .join('')}</select></label>`
        : ''
    }<p class="hint">Tick several runs, of one case or of several cases, to compare scenarios: field RUN (and CASE). Side by side: put the field to compare by (e.g. REGION) in Rows; RUN goes next to it.</p></details>
    <details open><summary>Variables<span class="n">${D.vars.length} / ${names.length}${gZero.length ? ` <span class="muted">+${gZero.length} zero</span>` : ''}</span></summary><input type="search" class="vsearch" placeholder="Search variables (name or meaning)">
      <div class="vtools"><button type="button" class="lnk" id="vexpand">Expand all</button><button type="button" class="lnk" id="vcollapse">Collapse all</button><span class="muted">Grey = all zero · ! = what it is</span></div><div class="fbox vbox">${varSel}</div>
      <p class="hint">Tick several variables to show them together (field VARIABLE).</p></details>
    <details open><summary>Values</summary><label>Aggregation${opt('agg', Object.entries(AGGS), D.agg)}</label><label>Show as${opt('show', Object.entries(SHOWS), D.show)}</label>
      ${
        D.show === 'diff_base' || D.show === 'pct_base'
          ? `<div class="row2"><label>Base field${opt(
              'baseField',
              fields.map(f => [f, f]),
              D.baseField
            )}</label><label>Base member${opt(
              'baseValue',
              (members[D.baseField] || []).map(m => [m, flabel(D.baseField, m)]),
              D.baseValue
            )}</label></div>${PV.baseMissing ? '<p class="hint warnt">Put the base field in Rows, Columns or Panels.</p>' : ''}`
          : ''
      }
      <div class="row2"><label>Divide values by<input data-k="divide" value="${D.divide}" placeholder="1 (3.6: PJ to TWh)"></label><label>Unit<input data-k="unit" value="${esc(D.unit)}" ${D._unitAuto ? `title="from the units of the model: ${esc(D._unitAuto)}"` : ''} placeholder="${D._unitAuto ? esc(D._unitAuto) + ' (from the model)' : 'e.g. TWh'}"></label></div>
      <div class="row2"><label>Decimals<input data-k="decimals" type="number" min="0" max="6" value="${D.decimals}"></label><label>Row order${opt(
        'sort',
        [
          ['key', 'by name / year'],
          ['total_desc', 'largest total first'],
          ['total_asc', 'smallest total first']
        ],
        D.sort
      )}</label></div></details>
    <details open><summary>Chart</summary><label>Theme${opt(
      'theme',
      Object.entries(THEMES).map(([k, v]) => [k, v.label]),
      D.theme
    )}</label><label>Engine${opt('engine', Object.entries(ENGINES), D.engine)}</label><label>Type${opt('type', TYPES[D.engine], D.type)}</label>
      ${
        D.type === 'energy_sankey'
          ? `<div class="row2"><label>Year${opt(
              'flowYear',
              (members.YEAR || []).map(y => [y, y]),
              D.flowYear || (members.YEAR || []).slice(-1)[0]
            )}</label><label>Region${opt('flowRegion', [['', 'all'], ...(members.REGION || REG).map(r => [r, flabel('REGION', r)])], D.flowRegion)}</label></div><label>Hide flows below (% of the largest)<input data-k="flowMin" type="number" min="0" max="50" step="0.1" value="${D.flowMin}"></label>`
          : ''
      }
      <label>Bar width (% of the space for each bar)<input data-k="barw" type="range" min="10" max="100" step="5" value="${D.barw || 60}"></label>
      <div class="row2"><label>Max series<input data-k="topn" type="number" min="2" max="200" value="${D.topn}" ${D.other === 'all' ? 'disabled title="every series is shown"' : ''}></label><label>The other series${opt(
        'other',
        [
          ['group', 'grouped in “Other”'],
          ['hide', 'hidden (no “Other”)'],
          ['all', 'show every series']
        ],
        D.other || 'group'
      )}</label></div>
      <div class="row2"><label>Panels per row<input data-k="pcols" type="number" min="1" max="6" value="${D.pcols}"></label><span></span></div></details>
    <details><summary>Text</summary><label>Title<input data-k="title" value="${esc(D.title)}" placeholder="${esc(CM.title)}"></label><label>Subtitle<input data-k="subtitle" value="${esc(D.subtitle)}"></label>
      <div class="row2"><label>X-axis title<input data-k="xlabel" value="${esc(D.xlabel)}" placeholder="${esc(D.rows.join(' · '))}"></label><label>Y-axis title<input data-k="ylabel" value="${esc(D.ylabel)}" placeholder="Value"></label></div>
      <label>Note / source (below the chart)<input data-k="note" value="${esc(D.note)}" placeholder="e.g. Source: ${STANDARD ? 'OSeMOSYS' : 'OSeMOSYS master model'} (CREAD)"></label></details>
    <details><summary>Fonts</summary><label>Text font${opt('fontFamily', fontOpts, D.fontFamily)}</label><label>Title font${opt('titleFont', fontOpts, D.titleFont)}</label><label class="filel">Load a font file (.ttf .otf .woff .woff2)<input type="file" id="fontfile" accept=".ttf,.otf,.woff,.woff2"></label>
      <div class="row2"><label>Title size<input data-k="fsTitle" type="number" min="8" max="48" value="${D.fsTitle}"></label><label>Axis titles<input data-k="fsAxis" type="number" min="7" max="36" value="${D.fsAxis}"></label></div>
      <div class="row2"><label>Tick labels<input data-k="fsTick" type="number" min="6" max="30" value="${D.fsTick}"></label><label>Legend<input data-k="fsLegend" type="number" min="6" max="30" value="${D.fsLegend}"></label></div></details>
    <details><summary>Colours, names and marks</summary><label>Palette${opt(
      'palette',
      Object.entries(PALETTES).map(([k, v]) => [k, v[0]]),
      D.palette
    )}</label>
      ${(() => {
        const np = ((PALETTES[D.palette] && PALETTES[D.palette][1]) || PAL.light).length,
          ns = Math.max(0, ...CM.panels.map(p => p.cols.length));
        return ns > np
          ? `<p class="hint warnt">${ns} series but ${np} colours in this palette: colours repeat. Lower "Max series" to ${np} or choose a larger palette (Tableau 10, Paired, Category 20).</p>`
          : '';
      })()}<p class="hint">Background (transparent for slides): in Axes and layout.</p>
      <div class="row2"><label>Line width<input data-k="lineWidth" type="number" min="0.5" max="8" step="0.5" value="${D.lineWidth}"></label><label>Opacity<input data-k="opacity" type="number" min="0.1" max="1" step="0.05" value="${D.opacity}"></label></div>
      <label class="chk"><input type="checkbox" data-k="markers" ${D.markers ? 'checked' : ''}> markers on lines</label><label class="chk"><input type="checkbox" data-k="labels" ${D.labels ? 'checked' : ''}> value labels</label>
      <div class="fbox">${
        CM.panels.length
          ? [...new Set(CM.panels.flatMap(p => p.cols))]
              .map(ck => {
                const p = CM.panels.find(q => q.cols.includes(ck));
                // colour and name of each series
                return `<div class="crow"><input type="color" class="scol" data-s="${esc(ck)}" value="${toHex(p.color(ck))}" aria-label="Colour"><input type="text" class="snm" data-s="${esc(ck)}" value="${esc(p.clab(ck))}" title="Name in the legend (empty = the name from the data)" aria-label="Name in the legend"></div>`;
              })
              .join('')
          : ''
      }</div><div class="acts"><button class="btn" id="creset">Default colours</button><button class="btn" id="nreset">Names from the data</button></div></details>
    <details open><summary>Axes and layout</summary><div class="row2"><label>Width (px, 0 = full)<input data-k="width" type="number" min="0" max="4000" step="10" value="${D.width || 0}" title="0: the width of the page; e.g. 900 for a slide or a report column"></label><label>Height (px)<input data-k="height" type="number" min="200" max="2000" value="${D.height}"></label></div>
      <div class="row2"><label>Legend${opt(
        'legend',
        [
          ['right', 'right'],
          ['bottom', 'bottom'],
          ['top', 'top'],
          ['none', 'none']
        ],
        D.legend
      )}</label><label>Background${opt(
        'bg',
        [
          ['theme', 'from the chart theme'],
          ['auto', 'as the Studio (light / dark)'],
          ['white', 'white'],
          ['transparent', 'transparent'],
          ['dark', 'dark']
        ],
        D.bg
      )}</label></div>
      <details class="y2box" ${(D.y2 || []).length ? 'open' : ''}><summary>Second y-axis (right)${(D.y2 || []).length ? ` <span class="n">${D.y2.length}</span>` : ''}</summary>
        <p class="hint">Tick the series to plot against a right axis with its own scale and unit (e.g. a variable in PJ on the left, another in bcm on the right: put VARIABLE in Columns). They are drawn as lines.${D.engine === 'vega' ? ' <b>Not available with Vega-Lite.</b>' : ''}${CM.panels.length > 1 && D.engine === 'plotly' ? ' With Plotly: the first panel only.' : ''}</p>
        <div class="fbox">${[...new Set(CM.panels.flatMap(p => p.cols))]
          .map(ck => {
            const p = CM.panels.find(q => q.cols.includes(ck));
            return `<label class="chk"><input type="checkbox" class="y2c" value="${esc(ck)}" ${(D.y2 || []).includes(ck) ? 'checked' : ''}> ${esc(p.clab(ck))}</label>`;
          })
          .join('')}</div>
        <div class="row2"><label>Right axis title<input data-k="y2label" value="${esc(D.y2label || '')}" placeholder="e.g. Water"></label><label>Right axis unit<input data-k="y2unit" value="${esc(D.y2unit || '')}" placeholder="e.g. bcm"></label></div></details>
      <div class="row2"><label>Y min<input data-k="ymin" value="${esc(D.ymin)}" placeholder="Auto"></label><label>Y max<input data-k="ymax" value="${esc(D.ymax)}" placeholder="Auto"></label></div>
      <label class="chk"><input type="checkbox" data-k="logy" ${D.logy ? 'checked' : ''}> logarithmic Y axis (library engines)</label><label class="chk"><input type="checkbox" data-k="grid" ${D.grid ? 'checked' : ''}> grid lines</label>
      <label>Export resolution${opt(
        'dpi',
        [
          [96, '96 dpi (screen)'],
          [192, '192 dpi'],
          [300, '300 dpi (print)'],
          [600, '600 dpi']
        ],
        D.dpi
      )}</label></details>
  </aside><div class="rsz" role="separator" aria-orientation="vertical" aria-label="Width of the settings panel (drag, or arrow keys)" tabindex="0" title="Drag to change the width"></div><section class="rmain">
    <div class="pivot">${zone('fields', 'Fields', '(not used: summed)')}${zone('rows', 'Rows', '→ X axis')}${zone('cols', 'Columns', '→ series (colour)')}${zone('panels', 'Panels', '→ one chart each')}</div>
    <div class="acts rtop"><div class="seg" role="group">${[
      ['chart', 'Chart'],
      ['table', 'Table'],
      ['both', 'Both']
    ]
      .map(([k, l]) => `<button type="button" class="vbtn" data-view="${k}" aria-pressed="${D.view === k}">${l}</button>`)
      .join('')}</div>
      <label class="chk"><input type="checkbox" data-k="heat" ${D.heat ? 'checked' : ''}> heat shading</label><span class="spacer"></span>
      <button class="btn" id="xpng">PNG</button><button class="btn" id="xsvg">SVG</button>${D.engine !== 'builtin' ? '<button class="btn" id="xhtml">HTML (interactive)</button>' : ''}<button class="btn" id="xxlsx" title="Excel workbook: the table, the data behind it (long format) and what was chosen">Excel</button><button class="btn" id="xcsv">CSV</button><button class="btn" id="xcopy">Copy (Excel)</button><button class="btn pri" id="csave">Save chart</button></div>
    <div class="ck-w">${PV.n.toLocaleString()} values · ${CM.panels.length} panel(s)${PV.unused.length ? ` · summed over ${esc(PV.unused.join(', '))}` : ''}${CM.allCols.length > D.topn && CM.panels.some(p => p.cols.includes('Other')) ? ` · <b>${CM.allCols.length - D.topn + 1} of ${CM.allCols.length} series grouped in "Other" in the chart</b> (Max series = ${D.topn}) <button class="btn sm" type="button" id="showall">Show all ${CM.allCols.length}</button> <button class="btn sm" type="button" id="hideother">Hide “Other”</button>` : ''}${D.other === 'hide' && CM.allCols.length > D.topn ? ` · <b>${CM.allCols.length - D.topn + 1} smaller series hidden</b> <button class="btn sm" type="button" id="showother">Show them as “Other”</button>` : ''}</div>
    <div id="chart" class="chartbox" ${D.view === 'table' ? 'hidden' : ''}></div><div id="ctable" ${D.view === 'chart' ? 'hidden' : ''}></div>
    <details ${RV.saved.length ? 'open' : ''}><summary>Saved charts<span class="n">${RV.saved.length}</span></summary><div class="saved">${RV.saved.map((c, i) => `<div class="ck"><div class="ck-h"><b>${esc(c.title || (c.vars || [c.variable]).join(', '))}</b></div><div class="ck-w">${esc((c.vars || [c.variable]).join(', '))} · ${esc(ENGINES[c.engine || 'builtin'])} · ${esc(c.type)}</div><div class="acts"><button class="btn" data-open="${i}">Open</button><button class="btn danger" data-cdel="${i}">Delete</button></div></div>`).join('') || '<div class="empty">Charts you save here stay with this model and redraw with the runs you tick.</div>'}</div></details>
  </section></div><div id="fmenu" class="fmenu" hidden></div>`;
  // table
  if (D.view !== 'chart') R.querySelector('#ctable').innerHTML = pivotTable(D, PV);
  wireResults(R, D, fields, members, PV, CM);
  uiRestore(R, keep); // the lists work at once, at the same place, while the chart is drawn
  // chart
  const host = R.querySelector('#chart');
  if (D.view !== 'table') {
    try {
      host.innerHTML = '<div class="empty">Drawing…</div>';
      RVDRAW = await drawEngine(host, CM, D, recs);
    } catch (e) {
      console.error(e);
      host.innerHTML = `<div class="ck err"><div class="ck-d">Could not draw with ${esc(ENGINES[D.engine])}: ${esc(e.message)}</div></div>`;
    }
  }
}
const toHex = c => {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  const d = document.createElement('div');
  d.style.color = c;
  document.body.appendChild(d);
  const m = getComputedStyle(d).color.match(/\d+/g) || [0, 0, 0];
  d.remove();
  return (
    '#' +
    m
      .slice(0, 3)
      .map(x => (+x).toString(16).padStart(2, '0'))
      .join('')
  );
};
function pivotTable(D, PV) {
  const fmt = v =>
    v === null || v === undefined
      ? ''
      : fmtN(v, D.show === 'value' || D.show === 'cumulative' || D.show === 'diff_base' ? D.decimals : 1) +
        (['share_row', 'share_col', 'share_total', 'pct_base', 'growth'].includes(D.show) ? ' %' : '');
  return (
    PV.panels
      .map(p => {
        const vals = p.rows.flatMap(rk => p.cols.map(ck => p.raw(rk, ck))).filter(v => v !== null && v !== undefined);
        const mx = Math.max(...vals.map(Math.abs), 1e-12);
        const shade = v =>
          D.heat && v
            ? `style="background:color-mix(in srgb, ${v >= 0 ? 'var(--accent)' : 'var(--bad)'} ${Math.round((Math.abs(v) / mx) * 55)}%, transparent)"`
            : '';
        const totals = !['share_row', 'index_first', 'growth', 'pct_base'].includes(D.show);
        return `${PV.panels.length > 1 ? `<h4 class="ptitle">${esc(p.label)}</h4>` : ''}<div class="tw"><table class="grid ptab"><thead><tr><th class="k">${esc(D.rows.join(' · ') || '')}${D.cols.length ? ' \\ ' + esc(D.cols.join(' · ')) : ''}</th>${p.cols.map(ck => `<th>${esc(colLab(D, p.colParts.get(ck)))}</th>`).join('')}${totals ? '<th>Total</th>' : ''}</tr></thead>
    <tbody>${p.rows
      .map(
        rk =>
          `<tr><td class="k">${esc(rowLab(D, p.rowParts.get(rk)))}</td>${p.cols
            .map(ck => {
              const v = p.raw(rk, ck);
              return `<td ${shade(v)}>${fmt(v)}</td>`;
            })
            .join('')}${totals ? `<td><b>${fmt(p.cols.reduce((s, ck) => s + (p.raw(rk, ck) || 0), 0))}</b></td>` : ''}</tr>`
      )
      .join('')}
    ${totals ? `<tr class="tot"><td class="k"><b>Total</b></td>${p.cols.map(ck => `<td><b>${fmt(p.rows.reduce((s, rk) => s + (p.raw(rk, ck) || 0), 0))}</b></td>`).join('')}<td><b>${fmt(p.rows.reduce((s, rk) => s + p.cols.reduce((t, ck) => t + (p.raw(rk, ck) || 0), 0), 0))}</b></td></tr>` : ''}</tbody></table></div>`;
      })
      .join('') || '<div class="empty">No values with these filters.</div>'
  );
}
function resultsXlsx(D, PV) {
  const num = c => (c === '' || c == null ? '' : typeof c === 'number' ? c : /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(c) ? +c : c);
  const table = [];
  let bold = [];
  for (const p of PV.panels) {
    if (PV.panels.length > 1) {
      bold.push(table.length);
      table.push([p.label]);
    }
    bold.push(table.length);
    table.push([D.rows.join(' · ') || 'row', ...p.cols.map(ck => colLab(D, p.colParts.get(ck)))]);
    for (const rk of p.rows)
      table.push([
        num(rowLab(D, p.rowParts.get(rk))),
        ...p.cols.map(ck => {
          const v = p.raw(rk, ck);
          return v === null || v === undefined ? '' : v;
        })
      ]);
    table.push([]);
  }
  const keep = r => Object.entries(D.filters).every(([f, vs]) => !vs || vs.includes(String(r[f] ?? '—')));
  const recs = (RV.lastRecs || []).filter(keep),
    flds = (RV.lastFields || []).filter(f => recs.some(r => r[f] !== undefined));
  const data = [[...flds, 'Value'], ...recs.slice(0, 1000000).map(r => [...flds.map(f => num(r[f] ?? '')), r.v])];
  const runs = D.runs.map(id => RV.runs.find(x => x.id === id) || {id});
  const about = [
    [APPNAME, 'results'],
    ['Title', D.title || D.vars.map(vlabel).join(', ')],
    ['Variables', D.vars.map(vlabel).join(', ')],
    ...runs.map((r, i) => [
      i ? '' : 'Runs',
      `${r.name || r.id} · case ${r.case || '—'} · ${r.solver || ''} · objective ${r.objective ?? ''} · ${r.created || ''}`
    ]),
    ['Rows', D.rows.join(', ')],
    ['Columns', D.cols.join(', ')],
    ['Panels', D.panels.join(', ')],
    ...Object.entries(D.filters).map(([f, vs], i) => [i ? '' : 'Filters', `${f}: ${vs.join(', ')}`]),
    ['Aggregation', AGGS[D.agg] || D.agg || ''],
    ['Show as', SHOWS[D.show] || D.show || ''],
    ['Divided by', D.divide],
    ['Unit', D.unit || ''],
    ['Exported', new Date().toLocaleString()]
  ];
  return makeXlsx([
    {name: 'Table', rows: table, bold},
    {name: 'Data', rows: data},
    {name: 'About', rows: about, freeze: false, bold: [0]}
  ]);
}
function pivotTSV(D, PV) {
  const L = [];
  for (const p of PV.panels) {
    if (PV.panels.length > 1) L.push(p.label);
    L.push([D.rows.join(' · ') || 'row', ...p.cols.map(ck => colLab(D, p.colParts.get(ck)))].join('\t'));
    for (const rk of p.rows)
      L.push(
        [
          rowLab(D, p.rowParts.get(rk)),
          ...p.cols.map(ck => {
            const v = p.raw(rk, ck);
            return v === null || v === undefined ? '' : v;
          })
        ].join('\t')
      );
    L.push('');
  }
  return L.join('\n');
}

function wireResults(R, D, fields, members, PV, CM) {
  const redraw = () => renderResults();
  const rc = R.querySelector('#rcmp');
  if (rc)
    rc.onchange = () => {
      setCmp(D, rc.value);
      redraw();
    };
  const soon = () => {
    clearTimeout(RV.soon);
    RV.soon = setTimeout(redraw, 600);
  }; // several ticks in a row: one drawing, after the last one
  R.querySelectorAll('.rsel').forEach(
    c =>
      (c.onchange = () => {
        const s = [...R.querySelectorAll('.rsel:checked')].map(x => x.value);
        if (!s.length) {
          clearTimeout(RV.soon);
          return toast('Tick at least one run');
        }
        D.runs = s;
        soon();
      })
  );
  R.querySelectorAll('.vsel').forEach(
    c =>
      (c.onchange = () => {
        const s = [...R.querySelectorAll('.vsel:checked')].map(x => x.value);
        if (!s.length) {
          clearTimeout(RV.soon);
          return toast('Tick at least one variable');
        }
        D.vars = s;
        const n = R.querySelector('.rcfg details:nth-of-type(2) summary .n');
        if (n) n.textContent = n.textContent.replace(/^\d+/, s.length);
        soon();
      })
  );
  const vs = R.querySelector('.vsearch');
  vs.oninput = () => {
    const q = vs.value.toLowerCase().trim(),
      box = R.querySelector('.vbox');
    box.classList.toggle('searching', !!q);
    R.querySelectorAll('.vrow').forEach(l => (l.hidden = !!q && !q.split(/\s+/).every(w => l.dataset.v.includes(w))));
    R.querySelectorAll('.vexp').forEach(x => (x.hidden = x.hidden || (x.previousElementSibling && x.previousElementSibling.hidden)));
    R.querySelectorAll('.vsec[data-key]').forEach(sc => (sc.hidden = !!q && !sc.querySelector('.vrow:not([hidden])')));
  };
  // fold a group or a topic (kept while the list is redrawn)
  R.querySelectorAll('.vtog').forEach(
    b =>
      (b.onclick = () => {
        const sc = b.closest('.vsec'),
          k = sc.dataset.key,
          shut = !sc.classList.contains('shut');
        sc.classList.toggle('shut', shut);
        b.setAttribute('aria-expanded', !shut);
        if (shut) RV.vcol.add(k);
        else RV.vcol.delete(k);
      })
  );
  const fold = shut =>
    R.querySelectorAll('.vsec[data-key]').forEach(sc => {
      sc.classList.toggle('shut', shut);
      sc.querySelector('.vtog').setAttribute('aria-expanded', !shut);
      if (shut) RV.vcol.add(sc.dataset.key);
      else RV.vcol.delete(sc.dataset.key);
    });
  R.querySelector('#vexpand').onclick = () => fold(false);
  R.querySelector('#vcollapse').onclick = () => {
    fold(true);
    const g = R.querySelector('.vsec.vgroup');
    if (g) {
      g.classList.remove('shut');
      g.querySelector('.vtog').setAttribute('aria-expanded', true);
      RV.vcol.delete(g.dataset.key);
    }
  };
  // "!": a short explanation under the variable; "More in the document" opens the reference at its page (or the results chapter)
  R.querySelectorAll('.vinf').forEach(
    b =>
      (b.onclick = async ev => {
        ev.preventDefault();
        const row = b.closest('.vrow');
        let x = row.nextElementSibling;
        if (x && x.classList.contains('vexp')) {
          x.remove();
          b.setAttribute('aria-expanded', false);
          return;
        }
        x = document.createElement('div');
        x.className = 'vexp';
        x.innerHTML = vExplain(b.dataset.i, D);
        row.after(x);
        b.setAttribute('aria-expanded', true);
        const dl = x.querySelector('.vdoc');
        if (dl)
          dl.onclick = async () => {
            let key = 'ch:results';
            try {
              const P = await INFO.load();
              const n = b.dataset.i.replace(/^DUAL\./, '');
              if (P[n]) key = n;
            } catch (e) {}
            INFO.open(key);
          };
      })
  );
  // the settings panel: wider or narrower by dragging its edge (or the arrow keys on it)
  const rz = R.querySelector('.rsz'),
    rv = R.querySelector('.rv');
  if (rz) {
    const setW = w => {
      RV.rcw = Math.round(Math.max(220, Math.min(Math.max(320, rv.clientWidth - 360), w)));
      rv.style.setProperty('--rcw', RV.rcw + 'px');
    };
    rz.onpointerdown = e => {
      e.preventDefault();
      rz.setPointerCapture(e.pointerId);
      const x0 = e.clientX,
        w0 = R.querySelector('.rcfg').getBoundingClientRect().width;
      rz.classList.add('on');
      rz.onpointermove = m => setW(w0 + m.clientX - x0);
      rz.onpointerup = () => {
        rz.onpointermove = rz.onpointerup = null;
        rz.classList.remove('on');
        rcwSave();
      };
    };
    rz.onkeydown = e => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        setW((RV.rcw || rcwLoad()) + (e.key === 'ArrowRight' ? 30 : -30));
        rcwSave();
      }
    };
    rz.ondblclick = () => {
      setW(300);
      rcwSave();
    };
  }
  R.querySelectorAll('[data-k]').forEach(
    el =>
      (el.onchange = () => {
        const k = el.dataset.k;
        let v = el.type === 'checkbox' ? el.checked : el.value;
        if (
          [
            'decimals',
            'height',
            'width',
            'topn',
            'pcols',
            'fsTitle',
            'fsAxis',
            'fsTick',
            'fsLegend',
            'lineWidth',
            'opacity',
            'dpi',
            'flowMin'
          ].includes(k)
        )
          v = +v;
        if (k === 'divide') v = Number(v) || 1;
        D[k] = v;
        if (k === 'theme' && THEMES[v]) {
          const t = THEMES[v];
          D.fontFamily = t.font;
          D.titleFont = t.title;
          D.grid = t.gridOn;
          D.bg = 'theme';
          D.palette = 'studio';
        }
        if (k === 'engine' && !TYPES[v].some(t => t[0] === D.type))
          D.type = {builtin: 'stack', plotly: 'bar_stack', echarts: 'bar_stack', vega: 'bar_stack'}[v];
        if (k === 'baseField') D.baseValue = (members[v] || [])[0] || '';
        redraw();
      })
  );
  R.querySelectorAll('.vbtn').forEach(
    b =>
      (b.onclick = () => {
        D.view = b.dataset.view;
        redraw();
      })
  );
  R.querySelectorAll('.scol').forEach(
    c =>
      (c.onchange = () => {
        D.colors[c.dataset.s] = c.value;
        redraw();
      })
  );
  R.querySelectorAll('.y2c').forEach(
    c =>
      (c.onchange = () => {
        D.y2 = [...R.querySelectorAll('.y2c')].filter(x => x.checked).map(x => x.value);
        redraw();
      })
  );
  R.querySelector('#creset').onclick = () => {
    D.colors = {};
    redraw();
  };
  R.querySelectorAll('.snm').forEach(
    c =>
      (c.onchange = () => {
        D.snames = D.snames || {};
        const v = c.value.trim();
        if (v) D.snames[c.dataset.s] = v;
        else delete D.snames[c.dataset.s];
        redraw();
      })
  );
  const nr = R.querySelector('#nreset');
  if (nr)
    nr.onclick = () => {
      D.snames = {};
      redraw();
    };
  R.querySelector('#fontfile').onchange = async ev => {
    const f = ev.target.files[0];
    if (!f) return;
    const name = f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
    const url = await new Promise(r => {
      const rd = new FileReader();
      rd.onload = () => r(rd.result);
      rd.readAsDataURL(f);
    });
    try {
      const ff = await new FontFace(name, `url(${url})`).load();
      document.fonts.add(ff);
      RV.fonts[name] = url;
      try {
        localStorage.setItem('mst_nos_fonts', JSON.stringify(RV.fonts));
      } catch (e) {
        toast('Font loaded for this session (too large to keep in the browser)');
      }
      D.fontFamily = `"${name}", sans-serif`;
      redraw();
    } catch (e) {
      toast('Not a font file: ' + e.message);
    }
  };
  // drag and drop of fields between zones
  R.querySelectorAll('.chip').forEach(c => {
    c.ondragstart = ev => {
      ev.dataTransfer.setData('text/plain', c.dataset.f + '|' + c.dataset.z);
    };
    c.onclick = ev => fieldMenu(ev, c.dataset.f, c.dataset.z, D, members);
    // drop ON a chip = before it
    if (c.dataset.z !== 'fields') {
      c.ondragover = ev => {
        ev.preventDefault();
        c.classList.add('dropb');
      };
      c.ondragleave = () => c.classList.remove('dropb');
      c.ondrop = ev => {
        ev.preventDefault();
        ev.stopPropagation();
        c.classList.remove('dropb');
        const [f, from] = ev.dataTransfer.getData('text/plain').split('|');
        if (f === c.dataset.f) return;
        moveField(D, f, from, c.dataset.z, c.dataset.f);
        redraw();
      };
    }
  });
  R.querySelectorAll('.zone').forEach(z => {
    z.ondragover = ev => {
      ev.preventDefault();
      z.classList.add('over');
    };
    z.ondragleave = () => z.classList.remove('over');
    z.ondrop = ev => {
      ev.preventDefault();
      z.classList.remove('over');
      const [f, from] = ev.dataTransfer.getData('text/plain').split('|');
      moveField(D, f, from, z.dataset.zone);
      redraw();
    };
  });
  // exports
  const fname = (D.title || D.vars.join('_')).replace(/[^\w.-]+/g, '_').slice(0, 80);
  R.querySelector('#xxlsx').onclick = () => saveFile(fname + '.xlsx', resultsXlsx(D, PV), XLSX_MIME);
  R.querySelector('#xcsv').onclick = () =>
    saveFile(
      fname + '.csv',
      pivotTSV(D, PV)
        .split('\n')
        .map(l =>
          l
            .split('\t')
            .map(c => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c))
            .join(',')
        )
        .join('\n'),
      'text/csv'
    );
  const sa = R.querySelector('#showall');
  if (sa)
    sa.onclick = () => {
      D.other = 'all';
      renderResults();
    };
  const ho = R.querySelector('#hideother');
  if (ho)
    ho.onclick = () => {
      D.other = 'hide';
      renderResults();
    };
  const so = R.querySelector('#showother');
  if (so)
    so.onclick = () => {
      D.other = 'group';
      renderResults();
    };
  R.querySelector('#xcopy').onclick = () =>
    (navigator.clipboard ? navigator.clipboard.writeText(pivotTSV(D, PV)) : Promise.reject())
      .then(() => toast('Table copied: paste in Excel'))
      .catch(() => toast('Copy not allowed here'));
  R.querySelector('#xpng').onclick = () => (RVDRAW && RVDRAW.png ? RVDRAW.png(fname) : toast('Show the chart first'));
  R.querySelector('#xsvg').onclick = () => (RVDRAW && RVDRAW.svg ? RVDRAW.svg(fname) : toast('SVG is not available for this chart'));
  const xh = R.querySelector('#xhtml');
  if (xh) xh.onclick = () => (RVDRAW && RVDRAW.html ? RVDRAW.html(fname) : toast('Show the chart first'));
  R.querySelector('#csave').onclick = async () => {
    const c = JSON.parse(JSON.stringify(D));
    delete c.runs;
    RV.saved.push(c);
    await LIB.charts(RV.saved);
    toast('Chart saved with this model');
    redraw();
  };
  R.querySelectorAll('[data-open]').forEach(
    b =>
      (b.onclick = () => {
        RV.def = {...CHART0(), ...JSON.parse(JSON.stringify(RV.saved[+b.dataset.open])), runs: D.runs};
        redraw();
      })
  );
  R.querySelectorAll('[data-cdel]').forEach(
    b =>
      (b.onclick = async () => {
        RV.saved.splice(+b.dataset.cdel, 1);
        await LIB.charts(RV.saved);
        redraw();
      })
  );
}
function moveField(D, f, from, to, before) {
  if (from === to && !before) return;
  for (const z of ['rows', 'cols', 'panels']) D[z] = D[z].filter(x => x !== f);
  if (['rows', 'cols', 'panels'].includes(to)) {
    const i = before ? D[to].indexOf(before) : -1;
    if (i >= 0) D[to].splice(i, 0, f);
    else D[to].push(f);
  }
}
function shiftField(D, f, z, d) {
  const L = D[z],
    i = L.indexOf(f),
    j = i + d;
  if (i < 0 || j < 0 || j >= L.length) return;
  L.splice(i, 1);
  L.splice(j, 0, f);
}
function fieldMenu(ev, f, z, D, members) {
  const m = document.getElementById('fmenu'),
    list = members[f] || [],
    cur = D.filters[f],
    num = list.length > 1 && list.every(v => !isNaN(+v));
  const desc = v => {
    const l = flabel(f, v);
    return l === String(v) ? '' : l.slice(String(v).length + 3);
  };
  m.innerHTML = `<div class="fm-h"><b>${esc(f)}</b><span class="muted" id="fmn"></span><button class="btn x" id="fmx" aria-label="Close">Close</button></div>
    <div class="fm-mv">${['rows', 'cols', 'panels', 'fields']
      .filter(x => x !== z)
      .map(
        x =>
          `<button class="btn sm" data-mv="${x}">${{rows: 'To rows', cols: 'To columns', panels: 'To panels', fields: 'Remove (sum)'}[x]}</button>`
      )
      .join('')}
      ${D[z] && D[z].length > 1 ? `<button class="btn sm" data-sh="-1" ${D[z].indexOf(f) === 0 ? 'disabled' : ''} title="Earlier in ${z}: the outer level">← earlier</button><button class="btn sm" data-sh="1" ${D[z].indexOf(f) === D[z].length - 1 ? 'disabled' : ''} title="Later in ${z}: the inner level">Later →</button>` : ''}</div>
    <div class="fm-tools"><input type="search" id="fmq" placeholder="Search ${list.length} members" aria-label="Search the members">
      <button class="btn sm" id="fmall" title="Tick all shown">All</button><button class="btn sm" id="fmnone" title="Untick all shown">None</button><button class="btn sm" id="fminv" title="Invert the ticks of the shown members">Invert</button></div>
    ${num ? `<div class="fm-range"><label>From<select id="fmr0">${list.map((v, i) => `<option ${i === 0 ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label><label>to<select id="fmr1">${list.map((v, i) => `<option ${i === list.length - 1 ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label><button class="btn sm" id="fmrok">Keep this range</button></div>` : ''}
    <div class="fmlist" role="group" aria-label="Members of ${esc(f)}">${list.map(v => `<div class="fmr" data-q="${esc((v + ' ' + flabel(f, v)).toLowerCase())}"><label><input type="checkbox" value="${esc(v)}" ${!cur || cur.includes(v) ? 'checked' : ''}><b>${esc(v)}</b><span>${esc(desc(v))}</span></label><button class="fmo" type="button" data-only="${esc(v)}" title="Only this one">Only</button></div>`).join('')}</div>
    <div class="fm-f"><button class="btn" id="fmc">Cancel</button><button class="btn pri" id="fmok">Apply filter</button></div>`;
  m.hidden = false;
  placeNear(m, ev.target.getBoundingClientRect());
  const boxes = () => [...m.querySelectorAll('.fmr input')],
    shown = () => boxes().filter(c => !c.closest('.fmr').hidden);
  const count = () => {
    m.querySelector('#fmn').textContent = `${boxes().filter(c => c.checked).length} of ${list.length} kept`;
  };
  const close = () => {
    m.hidden = true;
    document.removeEventListener('mousedown', outside, true);
  };
  const outside = ev => {
    if (!m.contains(ev.target)) close();
  };
  setTimeout(() => document.addEventListener('mousedown', outside, true), 0); // a click outside closes it
  m.querySelector('#fmx').onclick = m.querySelector('#fmc').onclick = close;
  m.querySelectorAll('[data-mv]').forEach(
    b =>
      (b.onclick = () => {
        moveField(D, f, z, b.dataset.mv);
        close();
        renderResults();
      })
  );
  m.querySelectorAll('[data-sh]').forEach(
    b =>
      (b.onclick = () => {
        shiftField(D, f, z, +b.dataset.sh);
        close();
        renderResults();
      })
  );
  m.querySelector('#fmall').onclick = () => {
    shown().forEach(c => (c.checked = true));
    count();
  };
  m.querySelector('#fmnone').onclick = () => {
    shown().forEach(c => (c.checked = false));
    count();
  };
  m.querySelector('#fminv').onclick = () => {
    shown().forEach(c => (c.checked = !c.checked));
    count();
  };
  m.querySelectorAll('[data-only]').forEach(
    b =>
      (b.onclick = () => {
        boxes().forEach(c => (c.checked = c.value === b.dataset.only));
        count();
      })
  );
  m.querySelectorAll('.fmr input').forEach(c => (c.onchange = count));
  if (num)
    m.querySelector('#fmrok').onclick = () => {
      const a = +m.querySelector('#fmr0').value,
        b = +m.querySelector('#fmr1').value,
        lo = Math.min(a, b),
        hi = Math.max(a, b);
      boxes().forEach(c => (c.checked = +c.value >= lo && +c.value <= hi));
      count();
    };
  const q = m.querySelector('#fmq');
  q.oninput = () => m.querySelectorAll('.fmr').forEach(l => (l.hidden = q.value && !l.dataset.q.includes(q.value.toLowerCase())));
  q.focus();
  m.querySelector('#fmok').onclick = () => {
    const s = boxes()
      .filter(c => c.checked)
      .map(c => c.value);
    if (!s.length) return toast('Keep at least one member');
    if (s.length === list.length) delete D.filters[f];
    else D.filters[f] = s;
    close();
    renderResults();
  };
  m.onkeydown = e => {
    if (e.key === 'Escape') close();
  };
  count();
}

/* ---------- drawing ---------- */
function themeC(D) {
  if (D.bg === 'theme' && THEMES[D.theme]) {
    const t = THEMES[D.theme];
    return {dark: !!t.dark, bg: t.bg, ink: t.ink, mut: t.mut, grid: t.grid, axis: t.axis};
  }
  const dark = D.bg === 'dark' || (D.bg === 'auto' && isDark());
  return dark
    ? {dark, bg: D.bg === 'transparent' ? 'rgba(0,0,0,0)' : '#1a1a19', ink: '#f0efec', mut: '#c3c2b7', grid: '#2e2e2c', axis: '#4a4945'}
    : {
        dark,
        bg: D.bg === 'transparent' ? 'rgba(0,0,0,0)' : D.bg === 'white' ? '#ffffff' : '#fcfcfb',
        ink: '#0b0b0b',
        mut: '#52514e',
        grid: '#e9e8e4',
        axis: '#bdbcb6'
      };
}
const pctShow = D => ['share_row', 'share_col', 'share_total', 'pct_base', 'growth'].includes(D.show);
const cmpMode = D =>
  D.show === 'diff_base' && D.baseField === 'RUN'
    ? 'diff'
    : D.show === 'pct_base' && D.baseField === 'RUN'
      ? 'pct'
      : D.panels.includes('RUN')
        ? 'panels'
        : D.cols.includes('RUN')
          ? 'series'
          : 'side';
function setCmp(D, m) {
  for (const z of ['rows', 'cols', 'panels']) D[z] = D[z].filter(f => f !== 'RUN');
  if (D.show === 'diff_base' || D.show === 'pct_base') if (D.baseField === 'RUN') D.show = 'value';
  if (m === 'panels') D.panels = ['RUN', ...D.panels];
  else if (m === 'series') D.cols = ['RUN', ...D.cols];
  else D.rows = [...D.rows, 'RUN'];
  if (m === 'diff' || m === 'pct') {
    D.show = m === 'diff' ? 'diff_base' : 'pct_base';
    D.baseField = 'RUN';
    D.baseValue = runName(D.runs[0]);
  }
}
const uOf = D => D.unit || (+D.divide === 1 || !D.divide ? D._unitAuto || '' : ''); // the unit typed, else the one from the units of the model
const yTitle = D => (D.ylabel || (pctShow(D) ? '%' : '')) + (uOf(D) && !pctShow(D) ? (D.ylabel ? ' (' + uOf(D) + ')' : uOf(D)) : '');
const fontName = D => (D.fontFamily || 'Barlow, sans-serif').replace(/"/g, "'"); // CSS list: falls back if the first font is missing
async function drawEngine(host, CM, D, recs) {
  host.style.width = +D.width > 0 ? D.width + 'px' : '';
  host.style.maxWidth = +D.width > 0 ? 'none' : ''; // width of the chart (0 = the page)
  if (!CM.panels.length) {
    host.innerHTML = '<div class="empty">No values with these filters.</div>';
    return null;
  }
  if (D.engine === 'builtin') return drawBuiltin(host, CM, D);
  await needLib(D.engine);
  if (D.engine === 'plotly') return drawPlotly(host, CM, D, recs);
  if (D.engine === 'echarts') return drawECharts(host, CM, D, recs);
  return drawVega(host, CM, D);
}

/* built-in SVG engine: one SVG with every panel */
function drawBuiltin(host, CM, D) {
  const W = +D.width > 0 ? Math.max(300, +D.width) : Math.max(600, Math.floor(host.clientWidth - 14) || 1000),
    n = CM.panels.length,
    pc = Math.min(D.pcols, n),
    pw = n > 1 ? Math.floor(W / pc) : W;
  const C = themeC(D),
    head = 14 + D.fsTitle * 1.4 + (D.subtitle ? D.fsAxis * 1.5 : 0),
    noteH = D.note ? D.fsTick * 2 : 0;
  const parts = CM.panels.map((p, i) => {
    const P = {
      xs: p.rows,
      ser: p.cols,
      get: (x, s) => p.get(x, s) || 0,
      colorOf: s => p.color(s),
      label: s => p.clab(s),
      xlabel: x => p.rlab(x),
      xparts: x => (p.rowParts ? p.rowParts.get(x) || [] : [])
    };
    const Dp = {
      ...D,
      title: n > 1 ? p.label : '',
      subtitle: '',
      height: n > 1 ? Math.max(240, D.height * 0.75) : D.height - head - noteH,
      legend: n > 1 && D.legend === 'right' ? 'bottom' : D.legend,
      x: D.xlabel || D.rows.join(' · '),
      ylabel: yTitle(D),
      unit: ''
    };
    return {svg: chartSVG2(Dp, P, pw, C), x: (i % pc) * pw, y: head + Math.floor(i / pc) * Dp.height, h: Dp.height};
  });
  const H = Math.max(...parts.map(p => p.y + p.h)) + noteH + 6,
    ff = D.fontFamily.replace(/"/g, "'");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${ff}"><style>${fontCss([D.fontFamily, D.titleFont])}</style><rect width="${W}" height="${H}" fill="${C.bg}"/>
    <text x="18" y="${14 + D.fsTitle}" font-size="${D.fsTitle}" font-weight="${(THEMES[D.theme] || {}).titleWeight || 500}" font-family="${(D.titleFont || D.fontFamily).replace(/"/g, "'")}" fill="${C.ink}">${esc(CM.title)}</text>${D.subtitle ? `<text x="18" y="${14 + D.fsTitle * 1.3 + D.fsAxis}" font-size="${D.fsAxis}" fill="${C.mut}">${esc(D.subtitle)}</text>` : ''}
    ${parts.map(p => `<svg x="${p.x}" y="${p.y}" width="${pw}" height="${p.h}" viewBox="0 0 ${pw} ${p.h}">${p.svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</svg>`).join('')}
    ${D.note ? `<text x="18" y="${H - 8}" font-size="${D.fsTick}" fill="${C.mut}">${esc(D.note)}</text>` : ''}</svg>`;
  host.innerHTML = svg.replace(`width="${W}" height="${H}"`, `width="100%"`);
  wireTips(host);
  const png = async fname => {
    const sc = D.dpi / 96,
      img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await img.decode();
    const c = document.createElement('canvas');
    c.width = W * sc;
    c.height = H * sc;
    const g = c.getContext('2d');
    g.scale(sc, sc);
    g.drawImage(img, 0, 0, W, H);
    const b = await new Promise(r => c.toBlob(r, 'image/png'));
    saveFile(fname + '.png', new Blob([pngWithDpi(await b.arrayBuffer(), D.dpi)], {type: 'image/png'}), 'image/png');
  };
  return {png, svg: fname => saveFile(fname + '.svg', svg, 'image/svg+xml')};
}
function chartSVG2(D, P, W, C) {
  const H = D.height,
    xs = P.xs,
    SA = P.ser,
    y2s0 = new Set((D.y2 || []).filter(s => SA.includes(s))),
    y2s = y2s0.size < SA.length ? y2s0 : new Set(),
    S2 = SA.filter(s => y2s.has(s)),
    S = S2.length < SA.length ? SA.filter(s => !y2s.has(s)) : [],
    fT = D.fsTick,
    fL = D.fsLegend,
    fA = D.fsAxis,
    legR = D.legend === 'right' && SA.length >= 1,
    legB = (D.legend === 'bottom' || D.legend === 'top') && SA.length >= 1;
  const lab2 = s => P.label(s) + (y2s.has(s) ? ' (right axis)' : '');
  const lw = legR ? Math.min(W * 0.32, 40 + Math.max(...SA.map(s => lab2(s).length)) * fL * 0.55) : 0;
  const perRow = Math.max(1, Math.floor((W - 36) / 190)),
    legH = legB ? Math.ceil(SA.length / perRow) * fL * 1.7 + 8 : 0;
  const y2T = (D.y2label || '') + (D.y2unit ? (D.y2label ? ' (' + D.y2unit + ')' : D.y2unit) : ''),
    r2 = S2.length ? 10 + fT * 4.4 + (y2T ? fA * 1.4 : 0) : 0;
  const top = 10 + (D.title ? D.fsTitle * 0.85 * 1.6 : 0) + (D.legend === 'top' ? legH : 0) + fT,
    left = 18 + fT * 4.4 + (yTitle(D) ? fA * 1.4 : 0);
  // two or more row fields (e.g. REGION then RUN): bars grouped by the outer field(s), a gap between groups, two label lines
  const nest = D.rows.length >= 2 && P.xparts && ['stack', 'group'].includes(D.type);
  const outerOf = x =>
    nest
      ? P.xparts(x)
          .slice(0, -1)
          .map((v, k) => (D.rows[k] === 'YEAR' ? v : flabel(D.rows[k], v)))
          .join(' · ')
      : '';
  const innerOf = x => {
    if (!nest) return P.xlabel(x);
    const pp = P.xparts(x),
      k = pp.length - 1;
    return k < 0 ? P.xlabel(x) : D.rows[k] === 'YEAR' ? String(pp[k]) : flabel(D.rows[k], pp[k]);
  };
  const groups = [];
  xs.forEach((x, i) => {
    const o = outerOf(x);
    if (!groups.length || groups[groups.length - 1].o !== o) groups.push({o, i0: i, i1: i});
    else groups[groups.length - 1].i1 = i;
  });
  const grouped = nest && groups.length > 1 && groups.length < xs.length,
    gapS = grouped ? 0.7 : 0,
    gOf = [];
  groups.forEach((g, k) => {
    for (let i = g.i0; i <= g.i1; i++) gOf[i] = k;
  });
  const rot =
    xs.length > 16 || Math.max(...xs.map(x => (grouped ? innerOf(x) : P.xlabel(x)).length)) * xs.length * fT * 0.6 > W - left - lw - 30;
  const xlabH =
    (rot ? Math.min(120, 12 + Math.max(...xs.map(x => Math.min(18, (grouped ? innerOf(x) : P.xlabel(x)).length))) * fT * 0.55) : fT * 2) +
    (grouped ? fT * 1.8 : 0);
  const bottom = 12 + xlabH + fA * 1.6 + (D.legend === 'bottom' ? legH : 0),
    right = 16 + lw + r2,
    pw = W - left - right,
    ph = H - top - bottom;
  const stack = D.type === 'stack';
  let lo = 0,
    hi = 0;
  for (const x of xs) {
    if (stack) {
      let p = 0,
        n = 0;
      for (const s of S) {
        const v = P.get(x, s);
        if (v > 0) p += v;
        else n += v;
      }
      hi = Math.max(hi, p);
      lo = Math.min(lo, n);
    } else
      for (const s of S) {
        const v = P.get(x, s);
        hi = Math.max(hi, v);
        lo = Math.min(lo, v);
      }
  }
  if (D.ymin !== '' && !isNaN(+D.ymin)) lo = +D.ymin;
  if (D.ymax !== '' && !isNaN(+D.ymax)) hi = +D.ymax;
  const tk = niceTicks(lo, hi),
    y0 = tk[0],
    y1 = tk[tk.length - 1],
    Y = v => top + ph - ((Math.min(y1, Math.max(y0, v)) - y0) / (y1 - y0 || 1)) * ph;
  // the right axis (its own scale) for the series in D.y2
  let lo2 = 0,
    hi2 = 0;
  for (const x of xs)
    for (const s of S2) {
      const v = P.get(x, s);
      hi2 = Math.max(hi2, v);
      lo2 = Math.min(lo2, v);
    }
  const tk2 = S2.length ? niceTicks(lo2, hi2) : [0, 1],
    z0 = tk2[0],
    z1 = tk2[tk2.length - 1],
    Y2 = v => top + ph - ((Math.min(z1, Math.max(z0, v)) - z0) / (z1 - z0 || 1)) * ph;
  const band = pw / Math.max(1, xs.length + gapS * (groups.length - 1)),
    X = i => left + band * (i + (grouped ? gapS * gOf[i] : 0)) + band / 2,
    e = [];
  if (D.title)
    e.push(
      `<text x="18" y="${10 + D.fsTitle * 0.85}" font-size="${D.fsTitle * 0.85}" font-weight="600" fill="${C.ink}">${esc(D.title)}</text>`
    );
  for (const t of tk) {
    if (D.grid || t === 0)
      e.push(`<line x1="${left}" x2="${left + pw}" y1="${Y(t)}" y2="${Y(t)}" stroke="${t === 0 ? C.axis : C.grid}" stroke-width="1"/>`);
    e.push(`<text x="${left - 8}" y="${Y(t) + fT * 0.35}" text-anchor="end" font-size="${fT}" fill="${C.mut}">${compact(t)}</text>`);
  }
  if (yTitle(D))
    e.push(
      `<text transform="translate(${16 + fA * 0.8},${top + ph / 2}) rotate(-90)" text-anchor="middle" font-size="${fA}" fill="${C.mut}">${esc(yTitle(D))}</text>`
    );
  if (S2.length) {
    const xr = left + pw;
    e.push(`<line x1="${xr}" x2="${xr}" y1="${top}" y2="${top + ph}" stroke="${C.axis}" stroke-width="1"/>`);
    for (const t of tk2)
      e.push(`<text x="${xr + 8}" y="${Y2(t) + fT * 0.35}" text-anchor="start" font-size="${fT}" fill="${C.mut}">${compact(t)}</text>`);
    if (y2T)
      e.push(
        `<text transform="translate(${xr + 10 + fT * 4.4 + fA * 0.6},${top + ph / 2}) rotate(90)" text-anchor="middle" font-size="${fA}" fill="${C.mut}">${esc(y2T)}</text>`
      );
  }
  const every = Math.max(1, Math.ceil(xs.length / (rot ? 60 : 30)));
  if (grouped)
    groups.forEach((g, k) => {
      const xa = X(g.i0) - band / 2,
        xb = X(g.i1) + band / 2,
        ly = top + ph + xlabH - fT * 0.4;
      e.push(`<line x1="${xa + 2}" x2="${xb - 2}" y1="${ly - fT * 1.25}" y2="${ly - fT * 1.25}" stroke="${C.grid}" stroke-width="1"/>`);
      e.push(
        `<text x="${(xa + xb) / 2}" y="${ly}" text-anchor="middle" font-size="${fT}" font-weight="600" fill="${C.ink}">${esc(g.o.length > 28 ? g.o.slice(0, 27) + '…' : g.o)}</text>`
      );
    });
  xs.forEach((x, i) => {
    if (i % every) return;
    const lab = grouped ? innerOf(x) : P.xlabel(x),
      tx = lab.length > 18 ? lab.slice(0, 17) + '…' : lab;
    e.push(
      rot
        ? `<text transform="translate(${X(i) + fT * 0.3},${top + ph + 8}) rotate(-50)" text-anchor="end" font-size="${fT * 0.95}" fill="${C.mut}">${esc(tx)}</text>`
        : `<text x="${X(i)}" y="${top + ph + fT * 1.3}" text-anchor="middle" font-size="${fT}" fill="${C.mut}">${esc(tx)}</text>`
    );
  });
  e.push(
    `<text x="${left + pw / 2}" y="${top + ph + xlabH + fA * 1.1}" text-anchor="middle" font-size="${fA}" fill="${C.mut}">${esc(D.x)}</text>`
  );
  const fv = v => fmtN(v, D.decimals) + (pctShow(D) ? ' %' : uOf(D) ? ' ' + uOf(D) : '');
  const tip = (s, x, v) => `data-tip="${esc(`${P.label(s)}\n${P.xlabel(x)}\n${fv(v)}`)}"`;
  const rtop = (x, y, w, h, r) => {
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  };
  const op = D.opacity;
  if (stack || D.type === 'group') {
    const bp = Math.max(5, Math.min(100, +D.barw || 60)) / 100,
      bw = Math.min(stack ? band * bp : (band * bp) / S.length, 140); // bar width: share of the slot
    xs.forEach((x, i) => {
      if (stack) {
        let pos = 0,
          neg = 0;
        const segs = S.map(s => [s, P.get(x, s)]).filter(([, v]) => Math.abs(v) > 0),
          lastPos = [...segs].reverse().find(([, v]) => v > 0);
        for (const [s, v] of segs) {
          const a = v > 0 ? pos : neg,
            b = a + v;
          if (v > 0) pos = b;
          else neg = b;
          const yA = Y(Math.max(a, b)),
            yB = Y(Math.min(a, b)),
            h = Math.max(0, yB - yA - 2),
            bx = X(i) - bw / 2;
          e.push(
            lastPos && s === lastPos[0] && v > 0
              ? `<path d="${rtop(bx, yA, bw, h, 4)}" fill="${P.colorOf(s)}" fill-opacity="${op}" ${tip(s, x, v)}/>`
              : `<rect x="${bx}" y="${v > 0 ? yA : yA + 2}" width="${bw}" height="${h}" fill="${P.colorOf(s)}" fill-opacity="${op}" ${tip(s, x, v)}/>`
          );
        }
        if (D.labels && pos)
          e.push(
            `<text x="${X(i)}" y="${Y(pos) - 4}" text-anchor="middle" font-size="${fT * 0.85}" fill="${C.ink}">${compact(pos)}</text>`
          );
      } else
        S.forEach((s, k) => {
          const v = P.get(x, s);
          if (!v) return;
          const bx = X(i) - (S.length * bw) / 2 + k * bw,
            yA = Y(Math.max(0, v)),
            yB = Y(Math.min(0, v)),
            h = Math.max(0, yB - yA);
          e.push(
            v > 0
              ? `<path d="${rtop(bx + 1, yA, bw - 2, h, 4)}" fill="${P.colorOf(s)}" fill-opacity="${op}" ${tip(s, x, v)}/>`
              : `<rect x="${bx + 1}" y="${yA}" width="${bw - 2}" height="${h}" fill="${P.colorOf(s)}" fill-opacity="${op}" ${tip(s, x, v)}/>`
          );
          if (D.labels)
            e.push(
              `<text x="${bx + bw / 2}" y="${yA - 3}" text-anchor="middle" font-size="${fT * 0.75}" fill="${C.ink}">${compact(v)}</text>`
            );
        });
    });
  } else {
    S.forEach(s => {
      const pts = xs.map((x, i) => [X(i), Y(P.get(x, s)), x, P.get(x, s)]),
        c = P.colorOf(s);
      if (D.type === 'area')
        e.push(
          `<path d="M${pts[0][0]},${Y(Math.max(0, y0))}L${pts.map(p => p[0] + ',' + p[1]).join('L')}L${pts[pts.length - 1][0]},${Y(Math.max(0, y0))}Z" fill="${c}" fill-opacity="${0.15 * op}"/>`
        );
      e.push(
        `<path d="M${pts.map(p => p[0] + ',' + p[1]).join('L')}" fill="none" stroke="${c}" stroke-width="${D.lineWidth}" stroke-opacity="${op}" stroke-linejoin="round" stroke-linecap="round"/>`
      );
      if (D.markers)
        pts.forEach(p =>
          e.push(`<circle cx="${p[0]}" cy="${p[1]}" r="${2 + D.lineWidth}" fill="${c}" stroke="${C.bg}" stroke-width="1.5"/>`)
        );
      const L = pts[pts.length - 1];
      e.push(`<circle cx="${L[0]}" cy="${L[1]}" r="4" fill="${c}" stroke="${C.bg}" stroke-width="2"/>`);
      if (S.length <= 4)
        e.push(
          `<text x="${L[0] + 8}" y="${L[1] + fT * 0.35}" font-size="${fT * 0.9}" fill="${C.ink}">${esc(String(P.label(s)).slice(0, 16))}</text>`
        );
      if (D.labels)
        pts.forEach(p =>
          e.push(`<text x="${p[0]}" y="${p[1] - 7}" text-anchor="middle" font-size="${fT * 0.75}" fill="${C.ink}">${compact(p[3])}</text>`)
        );
      pts.forEach(p => e.push(`<circle cx="${p[0]}" cy="${p[1]}" r="9" fill="transparent" ${tip(s, p[2], p[3])}/>`));
    });
  }
  // right-axis series: lines on Y2
  const fv2 = v => fmtN(v, D.decimals) + (D.y2unit ? ' ' + D.y2unit : '');
  S2.forEach(s => {
    const pts = xs.map((x, i) => [X(i), Y2(P.get(x, s)), x, P.get(x, s)]),
      c = P.colorOf(s);
    e.push(
      `<path d="M${pts.map(p => p[0] + ',' + p[1]).join('L')}" fill="none" stroke="${c}" stroke-width="${D.lineWidth + 0.5}" stroke-opacity="${op}" stroke-linejoin="round" stroke-linecap="round"/>`
    );
    pts.forEach(p => e.push(`<circle cx="${p[0]}" cy="${p[1]}" r="${2 + D.lineWidth}" fill="${c}" stroke="${C.bg}" stroke-width="1.5"/>`));
    pts.forEach(p =>
      e.push(
        `<circle cx="${p[0]}" cy="${p[1]}" r="9" fill="transparent" data-tip="${esc(`${P.label(s)} (right axis)\n${P.xlabel(p[2])}\n${fv2(p[3])}`)}"/>`
      )
    );
  });
  if (legR || legB) {
    const sw = fL * 1.1,
      ly0 = D.legend === 'top' ? 10 + (D.title ? D.fsTitle * 0.85 * 1.6 : 0) + fL : H - legH + fL * 0.9;
    SA.forEach((s, k) => {
      const lx = legR ? W - lw + 4 : 18 + (k % perRow) * ((W - 36) / perRow),
        ly = legR ? top + k * fL * 1.7 + fL : ly0 + Math.floor(k / perRow) * fL * 1.7;
      e.push(
        `<rect x="${lx}" y="${ly - fL * 0.75}" width="${sw}" height="${fL * 0.8}" rx="2" fill="${P.colorOf(s)}"/><text x="${lx + sw + 6}" y="${ly}" font-size="${fL}" fill="${C.ink}">${esc(lab2(s).slice(0, legR ? Math.floor((lw - sw - 14) / (fL * 0.52)) : 40))}</text>`
      );
    });
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${e.join('')}</svg>`;
}

/* long table of a panel model (for the library engines) */
const longRows = CM =>
  CM.panels.flatMap(p =>
    p.rows.flatMap(rk => p.cols.map(ck => ({panel: p.label, row: p.rlab(rk), col: p.clab(ck), ck, v: p.get(rk, ck)})))
  );
function hierarchy(D, recs, levels) {
  // ids / parents / values for sunburst and treemap, from the filtered records
  const keep = r => Object.entries(D.filters).every(([f, vs]) => !vs || vs.includes(String(r[f] ?? '—')));
  const sum = new Map();
  for (const r of recs.filter(keep)) {
    let path = '';
    levels.forEach((f, i) => {
      const k = path + '/' + String(r[f] ?? '—');
      sum.set(k, (sum.get(k) || 0) + Math.abs(r.v) / (+D.divide || 1));
      path = k;
    });
  }
  const ids = [...sum.keys()];
  return {
    ids,
    labels: ids.map(k => {
      const parts = k.split('/'),
        f = levels[parts.length - 2];
      return flabel(f, parts[parts.length - 1]);
    }),
    parents: ids.map(k => k.slice(0, k.lastIndexOf('/'))),
    values: ids.map(k => sum.get(k))
  };
}
async function energyFlows(D) {
  const run = D.runs[0],
    [use, prod] = await Promise.all([getVar(run, 'UseByTechnologyAnnual'), getVar(run, 'ProductionByTechnologyAnnual')]);
  if (!(use.rows || []).length && !(prod.rows || []).length)
    throw new Error('this run has no production / use results (needs RateOfActivity and the activity ratios)');
  const years = [...new Set((prod.rows || []).map(r => r[3]))].sort(numSort),
    y = D.flowYear || years[years.length - 1];
  const L = new Map();
  const add = (a, b, v) => {
    const k = a + '\u0001' + b;
    L.set(k, (L.get(k) || 0) + v / (+D.divide || 1));
  };
  for (const [r, t, f, yy, v] of use.rows || [])
    if (String(yy) === String(y) && (!D.flowRegion || r === D.flowRegion) && v > 0) add('C:' + f, 'T:' + t, v);
  for (const [r, t, f, yy, v] of prod.rows || [])
    if (String(yy) === String(y) && (!D.flowRegion || r === D.flowRegion) && v > 0) add('T:' + t, 'C:' + f, v);
  const mx = Math.max(...L.values(), 0),
    links = [...L]
      .filter(([, v]) => v >= (mx * D.flowMin) / 100)
      .map(([k, v]) => {
        const [a, b] = k.split('\u0001');
        return {source: a, target: b, value: v};
      });
  const nodes = [...new Set(links.flatMap(l => [l.source, l.target]))];
  const ncol = n => (n.startsWith('C:') ? toHex(fcol(n.slice(2))) : '#8a8f8c');
  return {
    year: y,
    nodes,
    links,
    label: n =>
      n.slice(2) +
      (n.startsWith('C:') && FD[n.slice(2)]
        ? ' · ' + FD[n.slice(2)].split(/[.(;]/)[0].slice(0, 30)
        : n.startsWith('T:') && TD[n.slice(2)]
          ? ' · ' + shortName(n.slice(2))
          : ''),
    color: ncol
  };
}

/* Plotly */
async function drawPlotly(host, CM, D, recs) {
  const C = themeC(D),
    font = {family: D.fontFamily, size: D.fsTick, color: C.ink},
    T = D.type,
    n = CM.panels.length,
    pc = Math.min(D.pcols, n),
    pr = Math.ceil(n / pc);
  const cart = [
    'bar_stack',
    'bar_group',
    'bar_rel',
    'bar_100',
    'barh_stack',
    'line',
    'line_markers',
    'area_stack',
    'area_100',
    'scatter',
    'bubble',
    'box',
    'violin',
    'histogram',
    'waterfall',
    'funnel'
  ].includes(T);
  const traces = [],
    ann = [],
    seen = new Set();
  let Y2ON = false;
  const ax = i => (i === 0 ? '' : String(i + 1)),
    dom = i => {
      const c = i % pc,
        r = Math.floor(i / pc),
        g = 0.06;
      return {
        x: [c / pc + (c ? g / 2 : 0), (c + 1) / pc - (c < pc - 1 ? g / 2 : 0)],
        y: [1 - (r + 1) / pr + (r < pr - 1 ? g : 0), 1 - r / pr - (r ? g / 2 : 0)]
      };
    };
  if (T === 'energy_sankey' || T === 'sankey') {
    let nodes,
      links,
      lab,
      col,
      sub = '';
    if (T === 'energy_sankey') {
      const E = await energyFlows(D);
      nodes = E.nodes;
      links = E.links;
      lab = E.label;
      col = E.color;
      sub = `${E.year}${D.flowRegion ? ' · ' + flabel('REGION', D.flowRegion) : ''}`;
    } else {
      const p = CM.panels[0];
      nodes = [...p.rows.map(r => 'R:' + r), ...p.cols.map(c => 'C:' + c)];
      links = p.rows
        .flatMap(rk => p.cols.map(ck => ({source: 'R:' + rk, target: 'C:' + ck, value: Math.abs(p.get(rk, ck) || 0)})))
        .filter(l => l.value > 0);
      lab = x => (x.startsWith('R:') ? p.rlab(x.slice(2)) : p.clab(x.slice(2)));
      col = x => (x.startsWith('C:') ? p.color(x.slice(2)) : '#8a8f8c');
    }
    const ix = new Map(nodes.map((x, i) => [x, i]));
    traces.push({
      type: 'sankey',
      arrangement: 'snap',
      node: {label: nodes.map(lab), color: nodes.map(col), pad: 12, thickness: 14, line: {width: 0}},
      link: {
        source: links.map(l => ix.get(l.source)),
        target: links.map(l => ix.get(l.target)),
        value: links.map(l => l.value),
        color: links.map(l => toHex(col(l.source.startsWith('C:') ? l.source : l.target)) + '55')
      },
      valueformat: `.${D.decimals}f`,
      valuesuffix: D.unit ? ' ' + D.unit : ''
    });
    if (sub && !D.subtitle) D = {...D, subtitle: sub};
  } else if (T === 'sunburst' || T === 'treemap') {
    const h = hierarchy(D, recs, [...D.panels, ...D.rows, ...D.cols]);
    traces.push({
      type: T,
      ids: h.ids,
      labels: h.labels,
      parents: h.parents,
      values: h.values,
      branchvalues: 'total',
      maxdepth: 3,
      textinfo: 'label+percent parent',
      marker: {colorway: PALETTES[D.palette] && PALETTES[D.palette][1]}
    });
  } else
    CM.panels.forEach((p, i) => {
      const xa = 'x' + ax(i),
        ya = 'y' + ax(i),
        xs = p.rows.map(r => p.rlab(r));
      const showleg = ck => {
        if (seen.has(ck)) return false;
        seen.add(ck);
        return true;
      };
      if (T === 'pie' || T === 'donut' || (T === 'funnel' && false)) {
        const vals = p.cols.map(ck => p.rows.reduce((s, rk) => s + (p.get(rk, ck) || 0), 0));
        traces.push({
          type: 'pie',
          labels: p.cols.map(ck => p.clab(ck)),
          values: vals,
          hole: T === 'donut' ? 0.5 : 0,
          marker: {colors: p.cols.map(ck => p.color(ck))},
          domain: dom(i),
          name: p.label,
          textinfo: 'percent',
          sort: false
        });
        if (n > 1)
          ann.push({
            text: p.label,
            showarrow: false,
            x: (dom(i).x[0] + dom(i).x[1]) / 2,
            y: dom(i).y[1] + 0.02,
            xref: 'paper',
            yref: 'paper',
            font: {size: D.fsAxis}
          });
        return;
      }
      if (T === 'heatmap' || T === 'surface') {
        const z = p.rows.map(rk => p.cols.map(ck => p.raw(rk, ck) ?? null));
        traces.push(
          T === 'heatmap'
            ? {
                type: 'heatmap',
                x: p.cols.map(ck => p.clab(ck)),
                y: xs,
                z,
                xaxis: xa,
                yaxis: ya,
                colorscale: 'Viridis',
                showscale: i === 0,
                hoverongaps: false
              }
            : {type: 'surface', x: p.cols.map(ck => p.clab(ck)), y: xs, z, colorscale: 'Viridis', scene: 'scene' + ax(i)}
        );
        return;
      }
      if (T === 'radar') {
        p.cols.forEach(ck =>
          traces.push({
            type: 'scatterpolar',
            r: [...p.rows.map(rk => p.get(rk, ck)), p.get(p.rows[0], ck)],
            theta: [...xs, xs[0]],
            name: p.clab(ck),
            line: {color: p.color(ck), width: D.lineWidth},
            fill: 'toself',
            opacity: D.opacity,
            showlegend: showleg(ck),
            legendgroup: ck,
            subplot: 'polar' + ax(i)
          })
        );
        return;
      }
      if (T === 'waterfall' || T === 'funnel') {
        const vals = p.cols.map(ck => p.rows.reduce((s, rk) => s + (p.get(rk, ck) || 0), 0));
        traces.push(
          T === 'waterfall'
            ? {
                type: 'waterfall',
                x: [...p.cols.map(ck => p.clab(ck)), 'Total'],
                y: [...vals, 0],
                measure: [...vals.map(() => 'relative'), 'total'],
                xaxis: xa,
                yaxis: ya,
                name: p.label,
                connector: {line: {color: C.axis}},
                increasing: {marker: {color: PAL.light[2]}},
                decreasing: {marker: {color: PAL.light[7]}},
                totals: {marker: {color: PAL.light[0]}}
              }
            : {
                type: 'funnel',
                y: p.cols.map(ck => p.clab(ck)),
                x: vals,
                xaxis: xa,
                yaxis: ya,
                marker: {color: p.cols.map(ck => p.color(ck))}
              }
        );
        return;
      }
      const y2p = i === 0 && cart && T !== 'barh_stack' ? new Set((D.y2 || []).filter(ck => p.cols.includes(ck))) : new Set();
      if (y2p.size >= p.cols.length) y2p.clear();
      p.cols.forEach(ck => {
        const y = p.rows.map(rk => p.raw(rk, ck) ?? null),
          c = p.color(ck),
          base = {name: p.clab(ck), legendgroup: ck, showlegend: showleg(ck), xaxis: xa, yaxis: ya, opacity: D.opacity};
        if (y2p.has(ck)) {
          traces.push({
            ...base,
            name: p.clab(ck) + ' (right axis)',
            type: 'scatter',
            mode: 'lines+markers',
            x: xs,
            y,
            yaxis: 'y2',
            line: {color: c, width: D.lineWidth + 0.5}
          });
          Y2ON = true;
          return;
        } // right axis
        const mc = D.rows.length >= 2 && T.startsWith('bar') && T !== 'barh_stack',
          xm = mc
            ? [
                p.rows.map(rk =>
                  (p.rowParts.get(rk) || [])
                    .slice(0, -1)
                    .map((v, k) => (D.rows[k] === 'YEAR' ? v : flabel(D.rows[k], v)))
                    .join(' · ')
                ),
                p.rows.map(rk => {
                  const pp = p.rowParts.get(rk) || [],
                    k = pp.length - 1;
                  return D.rows[k] === 'YEAR' ? String(pp[k]) : flabel(D.rows[k], pp[k]);
                })
              ]
            : null; // grouped axis
        if (T.startsWith('bar'))
          traces.push({
            ...base,
            type: 'bar',
            x: T === 'barh_stack' ? y : mc ? xm : xs,
            y: T === 'barh_stack' ? xs : y,
            orientation: T === 'barh_stack' ? 'h' : 'v',
            marker: {color: c},
            text: D.labels ? y.map(v => (v == null ? '' : compact(v))) : undefined,
            textposition: D.labels ? 'auto' : undefined
          });
        else if (T.startsWith('line') || T.startsWith('area'))
          traces.push({
            ...base,
            type: 'scatter',
            x: xs,
            y,
            mode: T === 'line_markers' || D.markers ? 'lines+markers' : 'lines',
            line: {color: c, width: D.lineWidth},
            ...(T.startsWith('area') ? {stackgroup: 'g' + i, groupnorm: T === 'area_100' ? 'percent' : ''} : {}),
            text: D.labels ? y.map(v => (v == null ? '' : compact(v))) : undefined
          });
        else if (T === 'scatter' || T === 'bubble') {
          const mx = Math.max(...y.map(v => Math.abs(v || 0)), 1e-12);
          traces.push({
            ...base,
            type: 'scatter',
            mode: 'markers',
            x: xs,
            y,
            marker: {color: c, size: T === 'bubble' ? y.map(v => 6 + 34 * Math.sqrt(Math.abs(v || 0) / mx)) : 8}
          });
        } else if (T === 'box' || T === 'violin')
          traces.push({
            ...base,
            type: T,
            y: y.filter(v => v != null),
            name: p.clab(ck),
            marker: {color: c},
            boxpoints: 'outliers',
            ...(T === 'violin' ? {box: {visible: true}, meanline: {visible: true}} : {})
          });
        else if (T === 'histogram') traces.push({...base, type: 'histogram', x: y.filter(v => v != null), marker: {color: c}});
      });
    });
  const layout = {
    font,
    paper_bgcolor: C.bg,
    plot_bgcolor: C.bg,
    ...(+D.width > 0 ? {width: +D.width} : {}),
    height: D.height * (cart && n > 1 ? Math.max(1, pr * 0.75) : 1),
    margin: {t: 40 + D.fsTitle * 1.6 + (D.subtitle ? D.fsAxis * 1.4 : 0), l: 70, r: 30, b: 60 + (D.note ? 24 : 0)},
    title: {
      text: `${esc(CM.title)}${D.subtitle ? `<br><span style="font-size:${D.fsAxis}px;color:${C.mut};font-family:${D.fontFamily.replace(/"/g, "'")}">${esc(D.subtitle)}</span>` : ''}`,
      x: 0.01,
      xanchor: 'left',
      font: {size: D.fsTitle, family: D.titleFont || D.fontFamily, color: C.ink, weight: (THEMES[D.theme] || {}).titleWeight || 500}
    },
    showlegend: D.legend !== 'none',
    legend:
      D.legend === 'right'
        ? {font: {size: D.fsLegend}}
        : {orientation: 'h', font: {size: D.fsLegend}, y: D.legend === 'top' ? 1.08 : -0.18, x: 0},
    barmode: T === 'bar_group' ? 'group' : T === 'bar_rel' ? 'relative' : 'stack',
    bargap: 1 - Math.max(5, Math.min(100, +D.barw || 60)) / 100,
    barnorm: T === 'bar_100' ? 'percent' : '',
    colorway: (PALETTES[D.palette] && PALETTES[D.palette][1]) || PAL[C.dark ? 'dark' : 'light'],
    annotations: ann,
    hovermode: 'closest'
  };
  if (D.note)
    ann.push({
      text: esc(D.note),
      showarrow: false,
      xref: 'paper',
      yref: 'paper',
      x: 0,
      y: -0.2,
      xanchor: 'left',
      font: {size: D.fsTick, color: C.mut}
    });
  if (cart || T === 'heatmap') {
    if (n > 1) layout.grid = {rows: pr, columns: pc, pattern: 'independent'};
    CM.panels.forEach((p, i) => {
      const ya = {
        gridcolor: C.grid,
        showgrid: D.grid,
        zerolinecolor: C.axis,
        title: {text: i % pc === 0 ? yTitle(D) : '', font: {size: D.fsAxis}},
        tickfont: {size: D.fsTick},
        type: D.logy ? 'log' : 'linear'
      };
      if (D.ymin !== '' || D.ymax !== '')
        ya.range = [
          D.ymin === '' ? null : D.logy ? Math.log10(+D.ymin) : +D.ymin,
          D.ymax === '' ? null : D.logy ? Math.log10(+D.ymax) : +D.ymax
        ];
      const xa = {
        showgrid: false,
        title: {text: Math.floor(i / pc) === pr - 1 ? D.xlabel || D.rows.join(' · ') : '', font: {size: D.fsAxis}},
        tickfont: {size: D.fsTick},
        type: D.rows.length >= 2 && T.startsWith('bar') && T !== 'barh_stack' ? 'multicategory' : 'category'
      };
      if (T === 'barh_stack') {
        layout['xaxis' + ax(i)] = {...ya, type: D.logy ? 'log' : 'linear'};
        layout['yaxis' + ax(i)] = {...xa, title: {text: ''}};
      } else {
        layout['xaxis' + ax(i)] = xa;
        layout['yaxis' + ax(i)] = ya;
      }
      if (n > 1)
        ann.push({
          text: `<b>${esc(p.label)}</b>`,
          showarrow: false,
          xref: `x${ax(i)} domain`,
          yref: `y${ax(i)} domain`,
          x: 0,
          y: 1.08,
          xanchor: 'left',
          font: {size: D.fsAxis}
        });
    });
  }
  if (Y2ON) {
    const t2 = (D.y2label || '') + (D.y2unit ? (D.y2label ? ' (' + D.y2unit + ')' : D.y2unit) : '');
    layout.yaxis2 = {
      overlaying: 'y',
      side: 'right',
      showgrid: false,
      zeroline: false,
      title: {text: t2, font: {size: D.fsAxis}},
      tickfont: {size: D.fsTick},
      type: D.logy ? 'log' : 'linear'
    };
    layout.margin.r = 80;
  }
  if (T === 'radar')
    CM.panels.forEach(
      (p, i) =>
        (layout['polar' + ax(i)] = {
          domain: dom(i),
          bgcolor: C.bg,
          radialaxis: {gridcolor: C.grid, type: D.logy ? 'log' : 'linear'},
          angularaxis: {gridcolor: C.grid}
        })
    );
  if (T === 'surface') CM.panels.forEach((p, i) => (layout['scene' + ax(i)] = {domain: dom(i), zaxis: {title: yTitle(D)}}));
  host.innerHTML = '';
  const gd = document.createElement('div');
  host.appendChild(gd);
  const config = {
    responsive: true,
    displaylogo: false,
    toImageButtonOptions: {format: 'png', scale: D.dpi / 96, filename: (D.title || 'chart').replace(/\W+/g, '_')}
  };
  await Plotly.newPlot(gd, traces, layout, config);
  const img = async (fmt, fname) => {
    const url = await Plotly.toImage(gd, {
      format: fmt,
      scale: fmt === 'png' ? D.dpi / 96 : 1,
      width: gd.clientWidth,
      height: layout.height
    });
    if (fmt === 'svg') return saveFile(fname + '.svg', decodeURIComponent(url.replace(/^data:image\/svg\+xml,/, '')), 'image/svg+xml');
    const b = await (await fetch(url)).arrayBuffer();
    saveFile(fname + '.png', new Blob([pngWithDpi(b, D.dpi)], {type: 'image/png'}), 'image/png');
  };
  return {
    png: f => img('png', f),
    svg: f => img('svg', f),
    html: async f => {
      const lib = await libText('plotly.min.js');
      saveFile(
        f + '.html',
        `<!doctype html><html><head><meta charset="utf-8"><title>${esc(CM.title)}</title><script>${lib}<\/script></head><body style="margin:0;background:${C.bg}"><div id="g" style="width:100vw;height:100vh"></div><script>Plotly.newPlot('g',${JSON.stringify(traces)},${JSON.stringify({...layout, height: undefined, autosize: true})},{responsive:true,displaylogo:false});<\/script></body></html>`,
        'text/html'
      );
    }
  };
}

/* Apache ECharts: one chart per panel */
async function drawECharts(host, CM, D, recs) {
  const C = themeC(D),
    T = D.type,
    n = CM.panels.length,
    pc = Math.min(D.pcols, n);
  host.innerHTML = `<div class="egrid" style="display:grid;grid-template-columns:repeat(${pc},1fr);gap:6px;background:${C.bg}"></div>`;
  const grid = host.firstChild,
    charts = [],
    options = [];
  const title = (p, i) => ({
    text: i === 0 ? CM.title : '',
    subtext: [i === 0 ? D.subtitle : '', n > 1 ? p.label : ''].filter(Boolean).join('  ·  '),
    left: 8,
    textStyle: {
      fontFamily: D.titleFont || D.fontFamily,
      fontSize: D.fsTitle,
      color: C.ink,
      fontWeight: (THEMES[D.theme] || {}).titleWeight || 500
    },
    subtextStyle: {fontFamily: D.fontFamily, fontSize: D.fsAxis, color: C.mut}
  });
  const legend = {
    show: D.legend !== 'none',
    type: 'scroll',
    textStyle: {fontSize: D.fsLegend, color: C.ink, fontFamily: D.fontFamily},
    ...(D.legend === 'right' ? {orient: 'vertical', right: 4, top: 60} : D.legend === 'top' ? {top: 48, left: 8} : {bottom: 4, left: 8})
  };
  const gridO = {
    left: 70,
    right: D.legend === 'right' ? 190 : 24,
    top: 70 + (D.legend === 'top' ? 26 : 0) + (D.subtitle && n > 1 ? 14 : 0),
    bottom: 50 + (D.legend === 'bottom' ? 30 : 0) + (D.note ? 18 : 0),
    containLabel: true
  };
  const vfmt = v => (v == null ? '' : fmtN(v, D.decimals)) + (pctShow(D) ? ' %' : uOf(D) ? ' ' + uOf(D) : '');
  const yAx = {
    type: D.logy ? 'log' : 'value',
    name: yTitle(D),
    nameLocation: 'middle',
    nameGap: 52,
    nameTextStyle: {fontSize: D.fsAxis, color: C.mut},
    axisLabel: {fontSize: D.fsTick, color: C.mut},
    splitLine: {show: D.grid, lineStyle: {color: C.grid}},
    ...(D.ymin !== '' ? {min: +D.ymin} : {}),
    ...(D.ymax !== '' ? {max: +D.ymax} : {})
  };
  let flows = null;
  if (T === 'energy_sankey') flows = await energyFlows(D);
  for (let i = 0; i < (T === 'energy_sankey' || T === 'sankey' || T === 'sunburst' || T === 'treemap' ? 1 : n); i++) {
    const p = CM.panels[i],
      xs = p.rows.map(r => p.rlab(r)),
      xAx = {
        type: 'category',
        data: xs,
        name: D.xlabel || D.rows.join(' · '),
        nameLocation: 'middle',
        nameGap: 32,
        nameTextStyle: {fontSize: D.fsAxis, color: C.mut},
        axisLabel: {fontSize: D.fsTick, color: C.mut},
        axisLine: {lineStyle: {color: C.axis}}
      };
    let o = {
      backgroundColor: C.bg,
      textStyle: {fontFamily: D.fontFamily},
      title: title(p, i),
      legend,
      tooltip: {
        trigger: ['line', 'line_smooth', 'area_stack', 'bar_stack', 'bar_group', 'bar_100', 'barh_stack', 'themeriver'].includes(T)
          ? 'axis'
          : 'item',
        valueFormatter: vfmt
      },
      animation: false
    };
    const ser = extra =>
      p.cols.map(ck => ({
        name: p.clab(ck),
        itemStyle: {color: p.color(ck), opacity: D.opacity},
        lineStyle: {width: D.lineWidth},
        label: {show: D.labels, fontSize: D.fsTick * 0.8},
        ...extra(ck)
      }));
    if (T === 'bar_100') {
      const tot = p.rows.map(rk => p.cols.reduce((s, ck) => s + Math.abs(p.get(rk, ck) || 0), 0));
      o = {
        ...o,
        grid: gridO,
        xAxis: xAx,
        yAxis: {...yAx, max: 100, name: '%'},
        series: ser(ck => ({type: 'bar', stack: 'a', data: p.rows.map((rk, j) => (tot[j] ? (100 * (p.get(rk, ck) || 0)) / tot[j] : 0))}))
      };
    } else if (['bar_stack', 'bar_group', 'line', 'line_smooth', 'area_stack', 'scatter'].includes(T)) {
      const y2e = new Set((D.y2 || []).filter(ck => p.cols.includes(ck)));
      if (y2e.size >= p.cols.length) y2e.clear(); // right axis
      const t2 = (D.y2label || '') + (D.y2unit ? (D.y2label ? ' (' + D.y2unit + ')' : D.y2unit) : '');
      o = {
        ...o,
        grid: y2e.size ? {...gridO, right: gridO.right + 60} : gridO,
        xAxis: xAx,
        yAxis: y2e.size
          ? [
              yAx,
              {
                type: D.logy ? 'log' : 'value',
                position: 'right',
                name: t2,
                nameLocation: 'middle',
                nameGap: 52,
                nameTextStyle: {fontSize: D.fsAxis, color: C.mut},
                axisLabel: {fontSize: D.fsTick, color: C.mut},
                splitLine: {show: false}
              }
            ]
          : yAx,
        series: ser(ck =>
          y2e.has(ck)
            ? {
                type: 'line',
                yAxisIndex: 1,
                name: p.clab(ck) + ' (right axis)',
                showSymbol: true,
                symbolSize: 6,
                lineStyle: {width: D.lineWidth + 0.5},
                data: p.rows.map(rk => p.raw(rk, ck) ?? null)
              }
            : {
                type: T.startsWith('bar') ? 'bar' : T === 'scatter' ? 'scatter' : 'line',
                stack: T === 'bar_stack' || T === 'area_stack' ? 'a' : undefined,
                smooth: T === 'line_smooth',
                areaStyle: T === 'area_stack' ? {opacity: 0.85 * D.opacity} : undefined,
                showSymbol: D.markers || T === 'scatter',
                symbolSize: T === 'scatter' ? 9 : 5,
                barCategoryGap: `${100 - Math.max(5, Math.min(100, +D.barw || 60))}%`,
                barMaxWidth: 140,
                data: p.rows.map(rk => p.raw(rk, ck) ?? null)
              }
        )
      };
    } else if (T === 'barh_stack')
      o = {
        ...o,
        grid: gridO,
        yAxis: {...xAx, nameGap: 60},
        xAxis: yAx,
        series: ser(ck => ({type: 'bar', stack: 'a', data: p.rows.map(rk => p.raw(rk, ck) ?? null)}))
      };
    else if (T === 'pie' || T === 'donut' || T === 'rose')
      o = {
        ...o,
        series: [
          {
            type: 'pie',
            radius: T === 'donut' ? ['42%', '70%'] : T === 'rose' ? ['12%', '72%'] : '70%',
            roseType: T === 'rose' ? 'area' : undefined,
            center: ['45%', '55%'],
            data: p.cols.map(ck => ({
              name: p.clab(ck),
              value: p.rows.reduce((s, rk) => s + (p.get(rk, ck) || 0), 0),
              itemStyle: {color: p.color(ck)}
            })),
            label: {fontSize: D.fsTick, color: C.ink}
          }
        ]
      };
    else if (T === 'heatmap') {
      const vals = p.rows.flatMap((rk, a) => p.cols.map((ck, b) => [b, a, p.raw(rk, ck) ?? '-'])),
        nums = vals.map(v => v[2]).filter(v => v !== '-');
      o = {
        ...o,
        grid: {...gridO, right: 90},
        xAxis: {type: 'category', data: p.cols.map(ck => p.clab(ck)), axisLabel: {fontSize: D.fsTick, rotate: 40, color: C.mut}},
        yAxis: {type: 'category', data: xs, axisLabel: {fontSize: D.fsTick, color: C.mut}},
        visualMap: {
          min: Math.min(...nums),
          max: Math.max(...nums),
          calculable: true,
          orient: 'vertical',
          right: 4,
          top: 'middle',
          inRange: {color: ['#f7fbff', '#6baed6', '#08306b']},
          textStyle: {color: C.ink}
        },
        series: [{type: 'heatmap', data: vals, label: {show: D.labels, fontSize: D.fsTick * 0.8}}]
      };
    } else if (T === 'radar') {
      const mx = Math.max(...p.rows.flatMap(rk => p.cols.map(ck => p.get(rk, ck) || 0)), 1e-12);
      o = {
        ...o,
        radar: {
          indicator: xs.map(x => ({name: x, max: mx * 1.05})),
          axisName: {color: C.mut, fontSize: D.fsTick},
          splitLine: {lineStyle: {color: C.grid}}
        },
        series: [
          {
            type: 'radar',
            data: p.cols.map(ck => ({
              name: p.clab(ck),
              value: p.rows.map(rk => p.get(rk, ck) || 0),
              itemStyle: {color: p.color(ck)},
              areaStyle: {opacity: 0.15}
            }))
          }
        ]
      };
    } else if (T === 'parallel')
      o = {
        ...o,
        parallelAxis: xs.map((x, j) => ({dim: j, name: x, nameTextStyle: {color: C.mut}, axisLabel: {color: C.mut}})),
        parallel: {left: 60, right: 60, top: 90, bottom: 40},
        series: [
          {
            type: 'parallel',
            lineStyle: {width: D.lineWidth, opacity: D.opacity},
            data: p.cols.map(ck => ({value: p.rows.map(rk => p.get(rk, ck) || 0), name: p.clab(ck), lineStyle: {color: p.color(ck)}}))
          }
        ]
      };
    else if (T === 'themeriver')
      o = {
        ...o,
        singleAxis: {
          type: 'value',
          min: 0,
          max: Math.max(0, xs.length - 1),
          bottom: 50,
          top: 80,
          axisLabel: {color: C.mut, fontSize: D.fsTick, formatter: v => xs[v] ?? ''}
        },
        tooltip: {trigger: 'axis'},
        series: [
          {
            type: 'themeRiver',
            data: p.rows.flatMap((rk, j) => p.cols.map(ck => [j, Math.max(0, p.get(rk, ck) || 0), p.clab(ck)])),
            color: p.cols.map(ck => p.color(ck)),
            label: {show: false}
          }
        ]
      };
    else if (T === 'boxplot') {
      const q = a => {
        a = a.slice().sort((x, y) => x - y);
        const at = t => {
          const k = (a.length - 1) * t,
            f = Math.floor(k);
          return a[f] + (a[Math.min(a.length - 1, f + 1)] - a[f]) * (k - f);
        };
        return [a[0], at(0.25), at(0.5), at(0.75), a[a.length - 1]];
      };
      o = {
        ...o,
        grid: gridO,
        xAxis: {type: 'category', data: p.cols.map(ck => p.clab(ck)), axisLabel: {color: C.mut, rotate: 30}},
        yAxis: yAx,
        series: [
          {
            type: 'boxplot',
            data: p.cols.map(ck => ({
              value: q(p.rows.map(rk => p.get(rk, ck) || 0)),
              itemStyle: {color: toHex(p.color(ck)) + '55', borderColor: p.color(ck)}
            }))
          }
        ]
      };
    } else if (T === 'sankey' || T === 'energy_sankey') {
      let nodes, links;
      if (flows) {
        nodes = flows.nodes.map(x => ({name: flows.label(x), itemStyle: {color: flows.color(x)}}));
        const nm = new Map(flows.nodes.map(x => [x, flows.label(x)]));
        links = flows.links.map(l => ({source: nm.get(l.source), target: nm.get(l.target), value: l.value}));
        o.title.subtext = `${flows.year}${D.flowRegion ? ' · ' + flabel('REGION', D.flowRegion) : ''}`;
      } else {
        nodes = [
          ...p.rows.map(rk => ({name: '◂ ' + p.rlab(rk)})),
          ...p.cols.map(ck => ({name: p.clab(ck) + ' ▸', itemStyle: {color: p.color(ck)}}))
        ];
        links = p.rows
          .flatMap(rk => p.cols.map(ck => ({source: '◂ ' + p.rlab(rk), target: p.clab(ck) + ' ▸', value: Math.abs(p.get(rk, ck) || 0)})))
          .filter(l => l.value > 0);
      }
      o = {
        ...o,
        series: [
          {
            type: 'sankey',
            top: 80,
            bottom: 20,
            left: 10,
            right: 150,
            nodeGap: 8,
            data: nodes,
            links,
            emphasis: {focus: 'adjacency'},
            lineStyle: {color: 'gradient', curveness: 0.5, opacity: 0.4},
            label: {color: C.ink, fontSize: D.fsTick}
          }
        ]
      };
    } else if (T === 'sunburst' || T === 'treemap') {
      const h = hierarchy(D, recs, [...D.panels, ...D.rows, ...D.cols]);
      const kids = new Map();
      h.ids.forEach((id, j) => {
        const par = h.parents[j];
        if (!kids.has(par)) kids.set(par, []);
        kids.get(par).push(j);
      });
      const build = par => (kids.get(par) || []).map(j => ({name: h.labels[j], value: h.values[j], children: build(h.ids[j])}));
      o = {
        ...o,
        color: (PALETTES[D.palette] && PALETTES[D.palette][1]) || PAL[C.dark ? 'dark' : 'light'],
        series: [
          {
            type: T,
            data: build(''),
            radius: T === 'sunburst' ? ['10%', '85%'] : undefined,
            top: 70,
            label: {fontSize: D.fsTick},
            ...(T === 'treemap' ? {leafDepth: 2, roam: false} : {})
          }
        ]
      };
    }
    if (D.note && i === n - 1)
      o.graphic = [{type: 'text', left: 10, bottom: 6, style: {text: D.note, fill: C.mut, fontSize: D.fsTick, fontFamily: D.fontFamily}}];
    const div = document.createElement('div');
    div.style.height =
      (n > 1 && !['sankey', 'energy_sankey', 'sunburst', 'treemap'].includes(T) ? Math.max(260, D.height * 0.75) : D.height) + 'px';
    grid.appendChild(div);
    const ch = echarts.init(div, null, {renderer: 'canvas'});
    ch.setOption(o);
    charts.push(ch);
    options.push(o);
  }
  const ro = new ResizeObserver(() => charts.forEach(c => c.resize()));
  ro.observe(grid);
  const png = async fname => {
    const imgs = await Promise.all(
      charts.map(
        c =>
          new Promise(r => {
            const im = new Image();
            im.onload = () => r(im);
            im.src = c.getDataURL({type: 'png', pixelRatio: D.dpi / 96, backgroundColor: C.bg});
          })
      )
    );
    const cw = Math.max(...imgs.map(i => i.width)),
      chH = Math.max(...imgs.map(i => i.height)),
      cols = Math.min(pc, imgs.length),
      rows = Math.ceil(imgs.length / cols);
    const cv = document.createElement('canvas');
    cv.width = cw * cols;
    cv.height = chH * rows;
    const g = cv.getContext('2d');
    g.fillStyle = C.bg === 'rgba(0,0,0,0)' ? 'rgba(0,0,0,0)' : C.bg;
    g.fillRect(0, 0, cv.width, cv.height);
    imgs.forEach((im, k) => g.drawImage(im, (k % cols) * cw, Math.floor(k / cols) * chH));
    const b = await new Promise(r => cv.toBlob(r, 'image/png'));
    saveFile(fname + '.png', new Blob([pngWithDpi(await b.arrayBuffer(), D.dpi)], {type: 'image/png'}), 'image/png');
  };
  const svg = fname => {
    const parts = options.map((o, k) => {
      const w = charts[k].getWidth(),
        h = charts[k].getHeight();
      const c = echarts.init(null, null, {renderer: 'svg', ssr: true, width: w, height: h});
      c.setOption(o);
      const s = c.renderToSVGString();
      c.dispose();
      return {s, w, h};
    });
    const cols = Math.min(pc, parts.length),
      W = Math.max(...parts.map(x => x.w)) * cols,
      H = Math.max(...parts.map(x => x.h)) * Math.ceil(parts.length / cols);
    const out = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><style>${fontCss([D.fontFamily, D.titleFont])}</style>${parts.map((x, k) => `<g transform="translate(${(k % cols) * (W / cols)},${Math.floor(k / cols) * x.h})">${x.s.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')}</g>`).join('')}</svg>`;
    saveFile(fname + '.svg', out, 'image/svg+xml');
  };
  const html = async fname => {
    const lib = await libText('echarts.min.js');
    saveFile(
      fname + '.html',
      `<!doctype html><html><head><meta charset="utf-8"><title>${esc(CM.title)}</title><script>${lib}<\/script></head><body style="margin:0;background:${C.bg}"><div style="display:grid;grid-template-columns:repeat(${pc},1fr)">${options.map((_, k) => `<div id="c${k}" style="height:${charts[k].getHeight()}px"></div>`).join('')}</div>
<script>const O=${JSON.stringify(options)};O.forEach((o,k)=>{if(o.tooltip)delete o.tooltip.valueFormatter;const c=echarts.init(document.getElementById('c'+k));c.setOption(o);addEventListener('resize',()=>c.resize());});<\/script></body></html>`,
      'text/html'
    );
  };
  return {png, svg, html};
}

/* Vega-Lite: one spec, panels as facets */
async function drawVega(host, CM, D) {
  const C = themeC(D),
    T = D.type,
    rows = longRows(CM),
    n = CM.panels.length,
    domainC = [...new Set(rows.map(r => r.col))],
    rangeC = domainC.map(c => {
      const r = rows.find(x => x.col === c);
      const p = CM.panels.find(q => q.cols.includes(r.ck));
      return toHex(p.color(r.ck));
    });
  const xOrder = [...new Set(rows.map(r => r.row))];
  const enc = {
    x: {field: 'row', type: 'ordinal', sort: xOrder, title: D.xlabel || D.rows.join(' · ')},
    y: {
      field: 'v',
      type: 'quantitative',
      title: yTitle(D),
      scale: {
        type: D.logy ? 'log' : 'linear',
        ...(D.ymin !== '' ? {domainMin: +D.ymin} : {}),
        ...(D.ymax !== '' ? {domainMax: +D.ymax} : {})
      }
    },
    color: {
      field: 'col',
      type: 'nominal',
      title: D.cols.join(' · ') || null,
      scale: {domain: domainC, range: rangeC},
      legend: D.legend === 'none' ? null : {orient: D.legend, labelLimit: 260}
    },
    tooltip: [{field: 'panel'}, {field: 'row'}, {field: 'col'}, {field: 'v', format: `,.${D.decimals}f`}],
    opacity: {value: D.opacity}
  };
  let mark = {type: 'bar', cornerRadiusTopLeft: 3, cornerRadiusTopRight: 3},
    e = {...enc};
  if (T === 'bar_stack') e.y = {...enc.y, stack: 'zero', aggregate: 'sum'};
  else if (T === 'bar_100') e.y = {...enc.y, stack: 'normalize', aggregate: 'sum', title: '%', axis: {format: '%'}};
  else if (T === 'bar_group') {
    e.xOffset = {field: 'col', sort: domainC};
    e.y = {...enc.y, aggregate: 'sum'};
  } else if (T === 'line' || T === 'line_points') {
    mark = {type: 'line', strokeWidth: D.lineWidth, point: T === 'line_points' || D.markers};
  } else if (T === 'area_stack' || T === 'area_100') {
    mark = {type: 'area', line: true};
    e.y = {
      ...enc.y,
      stack: T === 'area_100' ? 'normalize' : 'zero',
      aggregate: 'sum',
      ...(T === 'area_100' ? {axis: {format: '%'}, title: '%'} : {})
    };
  } else if (T === 'point') mark = {type: 'point', filled: true, size: 70};
  else if (T === 'tick') {
    mark = {type: 'tick', thickness: 2};
    e = {...enc, x: {field: 'v', type: 'quantitative', title: yTitle(D)}, y: {field: 'col', type: 'nominal', sort: domainC, title: null}};
  } else if (T === 'heatmap') {
    mark = {type: 'rect'};
    e = {
      x: {field: 'col', type: 'nominal', sort: domainC, title: D.cols.join(' · ')},
      y: {field: 'row', type: 'ordinal', sort: xOrder, title: D.rows.join(' · ')},
      color: {field: 'v', type: 'quantitative', scale: {scheme: 'viridis'}, title: yTitle(D) || 'value'},
      tooltip: enc.tooltip
    };
  } else if (T === 'boxplot') {
    mark = {type: 'boxplot', extent: 1.5};
    e = {
      x: {field: 'col', type: 'nominal', sort: domainC, title: D.cols.join(' · ')},
      y: {field: 'v', type: 'quantitative', title: yTitle(D), scale: enc.y.scale},
      color: enc.color
    };
  }
  const W = Math.max(
    300,
    ((host.clientWidth || 1000) - 40) / (n > 1 ? Math.min(D.pcols, n) : 1) - (D.legend === 'right' ? 200 / Math.min(D.pcols, n) : 0) - 60
  );
  const H = n > 1 ? Math.max(200, D.height * 0.6) : D.height - 110;
  const layer =
    D.labels && /^bar|^line/.test(T)
      ? {
          layer: [
            {mark, encoding: e},
            {
              mark: {type: 'text', dy: -6, fontSize: D.fsTick * 0.8, color: C.ink},
              encoding: {...e, text: {field: 'v', type: 'quantitative', format: ',.1s'}, color: undefined}
            }
          ]
        }
      : {mark, encoding: e};
  const inner = {width: W, height: H, ...layer};
  const spec = {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    background: C.bg === 'rgba(0,0,0,0)' ? null : C.bg,
    title: {
      text: CM.title,
      subtitle: [D.subtitle, D.note].filter(Boolean),
      anchor: 'start',
      fontSize: D.fsTitle,
      fontWeight: (THEMES[D.theme] || {}).titleWeight || 500,
      subtitleFontSize: D.fsAxis,
      color: C.ink,
      subtitleColor: C.mut,
      font: (D.titleFont || D.fontFamily).replace(/"/g, "'"),
      subtitleFont: fontName(D)
    },
    data: {values: rows},
    ...(n > 1
      ? {
          facet: {
            field: 'panel',
            type: 'nominal',
            title: null,
            header: {labelFontSize: D.fsAxis, labelColor: C.ink, labelFont: fontName(D)}
          },
          columns: Math.min(D.pcols, n),
          spec: inner,
          resolve: {scale: {y: 'shared'}}
        }
      : inner),
    config: {
      font: fontName(D),
      axis: {
        labelFontSize: D.fsTick,
        titleFontSize: D.fsAxis,
        labelColor: C.mut,
        titleColor: C.mut,
        gridColor: C.grid,
        grid: D.grid,
        domainColor: C.axis,
        tickColor: C.axis,
        labelFont: fontName(D),
        titleFont: fontName(D)
      },
      legend: {
        labelFontSize: D.fsLegend,
        titleFontSize: D.fsLegend,
        labelColor: C.ink,
        titleColor: C.mut,
        labelFont: fontName(D),
        titleFont: fontName(D)
      },
      view: {stroke: null}
    }
  };
  host.innerHTML = '';
  const div = document.createElement('div');
  host.appendChild(div);
  const res = await vegaEmbed(div, spec, {actions: false, renderer: 'svg'});
  return {
    png: async fname => {
      const url = await res.view.toImageURL('png', D.dpi / 96);
      const b = await (await fetch(url)).arrayBuffer();
      saveFile(fname + '.png', new Blob([pngWithDpi(b, D.dpi)], {type: 'image/png'}), 'image/png');
    },
    svg: async fname => {
      let s = await res.view.toSVG();
      const fc = fontCss([D.fontFamily, D.titleFont]);
      if (fc) s = s.replace(/<svg([^>]*)>/, `<svg$1><style>${fc}</style>`);
      saveFile(fname + '.svg', s, 'image/svg+xml');
    },
    html: async fname => {
      const libs = await Promise.all(LIBS.vega.map(libText));
      saveFile(
        fname + '.html',
        `<!doctype html><html><head><meta charset="utf-8"><title>${esc(CM.title)}</title>${libs.map(l => `<script>${l}<\/script>`).join('')}</head><body style="margin:0;background:${C.bg}"><div id="v"></div><script>vegaEmbed('#v',${JSON.stringify(spec)},{actions:{export:true,source:false,compiled:false,editor:false}});<\/script></body></html>`,
        'text/html'
      );
    }
  };
}

// the cause of an infeasible run (engine/diagnose.py): the smallest changes of the limits that make the model feasible (exact LP),
// or, when those say nothing, the smallest set of constraints that cannot hold together (IIS)
function diagList(g) {
  g = g || {};
  const fx = v => (v == null ? 'no limit' : fmt(v));
  const ch = (g.elastic && g.elastic.changes) || [];
  if (ch.length) {
    const fam = new Map();
    for (const c of ch) {
      const k = c.name.split('[')[0];
      if (!fam.has(k)) fam.set(k, []);
      fam.get(k).push(c);
    }
    return `Smallest changes that make the model feasible (exact: every limit may move, a demand not served counts 1000 times more):<ul class="diag">${[
      ...fam
    ]
      .map(([k, L]) => {
        const c0 = L[0],
          isBal = /^EB/.test(k);
        const one = c =>
          `<code>${esc(c.name.slice(c.name.indexOf('[')))}</code> ${isBal ? `only ${fx(c.needed)} of ${fx(c.limit)} can be delivered` : c.side === 'upper' ? `${fx(c.limit)} &rarr; at least ${fx(c.needed)}` : `${fx(c.limit)} &rarr; at most ${fx(c.needed)}`}`;
        return `<li><b>${esc(k)}</b>${c0.meaning ? ' &mdash; ' + esc(c0.meaning) : ''}<br><span class="muted">change: ${esc(c0.check || '')}</span><br>${L.slice(0, 8).map(one).join('<br>')}${L.length > 8 ? `<br><span class="muted">… ${L.length - 8} more rows (${L.length} in all)</span>` : ''}</li>`;
      })
      .join('')}</ul>`;
  }
  const rows = (g.families || []).length
    ? g.families
        .slice(0, 30)
        .map(f => ({
          name: f.count > 1 ? `${f.family} (${f.count} rows, e.g. ${f.example})` : f.example,
          meaning: f.meaning,
          check: f.check
        }))
    : (g.rows || []).slice(0, 40);
  return rows.length
    ? `These constraints cannot hold together (smallest infeasible set found by HiGHS); look at the data parameters named:<ul class="diag">${rows.map(r => `<li><code>${esc(r.name)}</code>${r.meaning ? ' &mdash; ' + esc(r.meaning) : ''}${r.check ? `<br><span class="muted">check: ${esc(r.check)}</span>` : ''}</li>`).join('')}</ul>`
    : esc(g.note || 'No cause was found; see the log of the run.');
}
