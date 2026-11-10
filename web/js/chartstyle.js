'use strict';
/* ============================== CHART STYLE for the Monte Carlo, robust-decision and rolling-horizon charts ==============================
   Every Plotly chart of these pages (not the Results view, which has its own settings) gets a "Chart style" button in its
   toolbar that opens the editor of THIS chart:
     - the kind of chart: as drawn, lines, points, bars, stacked bars, areas;
     - the title and the axis titles; each axis: from / to (empty = automatic), log scale, grid lines;
     - colours: as drawn, or one colour family (the colour of the Studio, dark to light);
     - the height, the size of the text, the legend (automatic, top, bottom, right, left, inside, hidden), the background;
     - "Reset this chart" puts everything back as drawn (and the zoom); "Apply to all charts" copies the style to the others.
   Settings are kept in this browser, for each chart (by its place and title), and come back when the chart is drawn again.
   Zoom: drag on the chart; "Reset axes" in the toolbar goes back to the drawn axes (it does nothing before a zoom). */
const CHST = (() => {
  const KEY = 'nour.master.chartstyle';
  let S = {bg: 'theme', legend: 'auto', titles: {}, charts: {}};
  try {
    S = {...S, ...JSON.parse(localStorage.getItem(KEY) || '{}')};
    S.charts = S.charts || {};
    S.titles = S.titles || {};
  } catch (e) {}
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(S));
    } catch (e) {}
  };
  const LEG = {
    top: {orientation: 'h', x: 0, xanchor: 'left', y: 1.02, yanchor: 'bottom'},
    bottom: {orientation: 'h', x: 0, xanchor: 'left', y: -0.2, yanchor: 'top'},
    right: {orientation: 'v', x: 1.02, xanchor: 'left', y: 1, yanchor: 'top'},
    left: {orientation: 'v', x: -0.02, xanchor: 'right', y: 1, yanchor: 'top'},
    inside: {orientation: 'v', x: 0.01, xanchor: 'left', y: 0.99, yanchor: 'top', bgcolor: 'rgba(255,255,255,0.65)', bordercolor: 'rgba(0,0,0,0.15)', borderwidth: 1}
  };
  const el = gd => (typeof gd === 'string' ? document.getElementById(gd) : gd);
  const skip = g => !g || !g.closest || !!g.closest('#results'); // the Results view has its own chart settings
  const plain = t => String((t && typeof t === 'object' ? t.text : t) || '').replace(/<[^>]*>/g, '');
  // a chart is known by its place (id of the element or of its parent) and its original title
  const ckey = g => (g.id || (g.parentElement && g.parentElement.id) || '') + '|' + String(g._chstOrig || '').slice(0, 80);
  const own = g => S.charts[ckey(g)] || {};

  /* one colour family from the colour of the Studio: n tints, dark to light */
  function family(n) {
    const c = (typeof THEME !== 'undefined' ? THEME.get() : '#6f8fb3').replace('#', ''),
      v = parseInt(c, 16),
      rgb = [(v >> 16) & 255, (v >> 8) & 255, v & 255],
      out = [];
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1),
        k = 0.55 + 0.85 * t; // 0.55 (darker) ... 1.4 (lighter)
      const f = x => Math.round(k <= 1 ? x * k : x + (255 - x) * (k - 1) * 1.1);
      out.push(`rgb(${rgb.map(x => Math.max(0, Math.min(255, f(x)))).join(',')})`);
    }
    return out;
  }

  function axis(A, o) {
    A = {...(A || {})};
    if (!o) return A;
    if (o.title != null && o.title !== '') A.title = {...(typeof A.title === 'object' ? A.title : {}), text: o.title};
    if (o.log) A.type = 'log';
    const lo = o.min === '' || o.min == null ? null : +o.min,
      hi = o.max === '' || o.max == null ? null : +o.max;
    if (lo != null || hi != null) {
      A.autorange = false;
      const r = A.range || [];
      A.range = [lo != null ? (o.log ? Math.log10(lo) : lo) : r[0], hi != null ? (o.log ? Math.log10(hi) : hi) : r[1]];
      if (A.range.some(x => x == null || isNaN(x))) {
        delete A.range;
        A.autorange = true;
      }
    }
    if (o.grid === 'off') A.showgrid = false;
    if (o.grid === 'on') A.showgrid = true;
    return A;
  }

  function layout(g, L) {
    L = {...(L || {})};
    const t = plain(L.title);
    g._chstOrig = t || '';
    const k = (g.id || (g.parentElement && g.parentElement.id) || '') + '|' + String(t || '').slice(0, 80);
    if (t && S.titles[k] != null) L.title = {...(typeof L.title === 'object' ? L.title : {}), text: S.titles[k]};
    const o = own(g);
    if (o.title) L.title = {...(typeof L.title === 'object' ? L.title : {}), text: o.title};
    const bg = o.bg || S.bg;
    if (bg === 'white') {
      L.paper_bgcolor = '#ffffff';
      L.plot_bgcolor = '#ffffff';
      L.font = {...(L.font || {}), color: '#2f3437'};
    } else if (bg === 'transparent') {
      L.paper_bgcolor = 'rgba(0,0,0,0)';
      L.plot_bgcolor = 'rgba(0,0,0,0)';
    }
    const leg = o.legend || S.legend;
    if (leg === 'hidden') L.showlegend = false;
    else if (leg !== 'auto') {
      L.showlegend = true;
      L.legend = {...(L.legend || {}), ...LEG[leg]};
      const m = {...(L.margin || {})};
      if (leg === 'right') m.r = Math.max(m.r || 0, 150);
      if (leg === 'left') m.l = Math.max(m.l || 0, 170);
      if (leg === 'bottom') m.b = Math.max(m.b || 0, 90);
      if (leg === 'top') m.t = Math.max(m.t || 0, 70);
      L.margin = m;
    }
    if (o.x) L.xaxis = axis(L.xaxis, o.x);
    if (o.y) L.yaxis = axis(L.yaxis, o.y);
    if (o.height) L.height = +o.height;
    if (o.font) L.font = {...(L.font || {}), size: +o.font};
    if (o.kind === 'stack') L.barmode = 'stack';
    else if (o.kind === 'bar') L.barmode = 'group';
    return L;
  }

  /* the traces as chosen for this chart: kind of chart and colours */
  function traces(g, data) {
    const o = own(g);
    if (!o.kind && o.colors !== 'family') return data;
    const cartesian = d => !d.type || /^(scatter|scattergl|bar)$/.test(d.type);
    const n = data.filter(cartesian).length,
      pal = family(Math.max(n, 1));
    let i = 0;
    return data.map(d0 => {
      if (!cartesian(d0)) return d0;
      const d = {...d0};
      if (o.kind === 'lines') Object.assign(d, {type: 'scatter', mode: 'lines', fill: undefined, stackgroup: undefined});
      else if (o.kind === 'points') Object.assign(d, {type: 'scatter', mode: 'markers', fill: undefined, stackgroup: undefined});
      else if (o.kind === 'bar' || o.kind === 'stack') Object.assign(d, {type: 'bar', mode: undefined, fill: undefined, stackgroup: undefined});
      else if (o.kind === 'area') Object.assign(d, {type: 'scatter', mode: 'lines', stackgroup: 'one', fill: 'tonexty'});
      if (o.colors === 'family') {
        const c = pal[i % pal.length];
        d.line = {...(d.line || {}), color: c};
        d.marker = {...(d.marker || {}), color: c};
        if (d.fillcolor) d.fillcolor = c.replace('rgb', 'rgba').replace(')', ',0.35)');
      }
      i++;
      return d;
    });
  }

  const ICON = {
    style: {
      width: 1000,
      height: 1000,
      path: 'M500 150a350 350 0 1 0 0.1 0zM500 260a90 90 0 1 1 0 180a90 90 0 1 1 0-180zM300 560a70 70 0 1 1 0 140a70 70 0 1 1 0-140zM700 560a70 70 0 1 1 0 140a70 70 0 1 1 0-140z'
    },
    svg: {width: 1000, height: 1000, path: 'M150 850h700v-80H150zM500 700L250 450h170V150h160v300h170z'}
  };
  function config(c) {
    c = {...(c || {})};
    const add = [...(c.modeBarButtonsToAdd || [])];
    if (!add.some(b => b && b.name === 'Chart style')) add.push({name: 'Chart style', icon: ICON.style, click: g => panel(g)});
    if (!add.some(b => b && /SVG/.test(b.name || '')))
      add.push({name: 'Download as SVG (vector)', icon: ICON.svg, click: g => Plotly.downloadImage(g, {format: 'svg', filename: 'chart'})});
    return {
      displaylogo: false,
      ...c,
      modeBarButtonsToAdd: add,
      // titles are changed in the Chart style editor (editing in place showed "Click to enter ..." on every chart)
      edits: {legendPosition: true, ...(c.edits || {})},
      toImageButtonOptions: {format: 'png', scale: 3, filename: 'chart', ...(c.toImageButtonOptions || {})}
    };
  }
  function wrap() {
    if (!window.Plotly || Plotly._chst) return;
    Plotly._chst = 1;
    for (const fn of ['react', 'newPlot']) {
      const orig = Plotly[fn];
      Plotly[fn] = function (gd, data, L, c) {
        const g = el(gd);
        if (skip(g)) return orig.call(Plotly, gd, data, L, c);
        if (Array.isArray(data)) g._chstData = data; // the traces as drawn (the editor changes a copy)
        const L2 = layout(g, L);
        g._chstLayout = L; // the layout as drawn
        return orig.call(Plotly, gd, Array.isArray(data) ? traces(g, data) : data, L2, config(c));
      };
    }
  }
  /* draw one chart again from what was drawn, with its style */
  function redraw(g) {
    if (!g || !g.data) return;
    try {
      Plotly.react(g, g._chstData || g.data, g._chstLayout || g.layout, g._context ? {...g._context} : {});
    } catch (e) {}
  }
  function redrawAll() {
    document.querySelectorAll('.js-plotly-plot').forEach(g => {
      if (!skip(g)) redraw(g);
    });
  }

  /* the editor of one chart */
  function panel(g) {
    document.querySelectorAll('.chst-pop').forEach(x => x.remove());
    const p = document.createElement('div');
    p.className = 'chst-pop';
    p.setAttribute('role', 'dialog');
    p.setAttribute('aria-label', 'Chart style');
    const o = {...own(g)},
      L = g._chstLayout || g.layout || {},
      ax = (k, A) => ({...(o[k] || {}), _t: plain(A && A.title)});
    const X = ax('x', L.xaxis),
      Y = ax('y', L.yaxis);
    const sel = (k, cur, opts) => `<select data-k="${k}">${opts.map(([v, l]) => `<option value="${v}" ${String(cur || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    const axisRow = (k, A, name) => `<fieldset><legend>${name}</legend>
      <label>Title<input data-k="${k}.title" value="${esc(A.title != null ? A.title : A._t)}"></label>
      <div class="row2"><label>From<input data-k="${k}.min" type="number" step="any" value="${A.min ?? ''}" placeholder="Automatic"></label><label>To<input data-k="${k}.max" type="number" step="any" value="${A.max ?? ''}" placeholder="Automatic"></label></div>
      <div class="row2"><label class="chk"><input type="checkbox" data-k="${k}.log" ${A.log ? 'checked' : ''}> Log scale</label>${sel(k + '.grid', A.grid, [['', 'Grid as drawn'], ['on', 'Grid lines'], ['off', 'No grid lines']])}</div></fieldset>`;
    p.innerHTML = `<div class="chst-h"><b>Chart style</b><span class="muted">this chart</span><button type="button" class="btn sm" data-a="close" aria-label="Close">✕</button></div>
      <form class="frm" onsubmit="return false">
      <label>Title<input data-k="title" value="${esc(o.title != null ? o.title : g._chstOrig || '')}"></label>
      <div class="row2"><label>Kind of chart${sel('kind', o.kind, [['', 'As drawn'], ['lines', 'Lines'], ['points', 'Points'], ['bar', 'Bars'], ['stack', 'Stacked bars'], ['area', 'Areas (stacked)']])}</label>
      <label>Colours${sel('colors', o.colors, [['', 'As drawn'], ['family', 'One colour family (the Studio colour)']])}</label></div>
      ${axisRow('x', X, 'Horizontal axis')}${axisRow('y', Y, 'Vertical axis')}
      <div class="row2"><label>Height (px)<input data-k="height" type="number" min="150" step="10" value="${o.height || ''}" placeholder="${L.height || 'Automatic'}"></label>
      <label>Text size<input data-k="font" type="number" min="7" max="24" value="${o.font || ''}" placeholder="${(L.font && L.font.size) || 11}"></label></div>
      <div class="row2"><label>Legend${sel('legend', o.legend || S.legend, [['auto', 'Automatic'], ['top', 'Top'], ['bottom', 'Bottom'], ['right', 'Right'], ['left', 'Left'], ['inside', 'Inside the plot'], ['hidden', 'Hidden']])}</label>
      <label>Background${sel('bg', o.bg || S.bg, [['theme', 'As the theme'], ['white', 'White'], ['transparent', 'Transparent']])}</label></div>
      <p class="hint">Zoom: drag on the chart; "Reset axes" in its toolbar goes back. PNG (3×) and SVG in the toolbar.</p>
      <div class="acts"><button type="button" class="btn" data-a="reset">Reset this chart</button><button type="button" class="btn" data-a="all" title="Background, legend, colours and text size for every chart of these pages">Apply to all charts</button><button type="button" class="btn pri" data-a="close">Done</button></div></form>`;
    document.body.appendChild(p);
    const r = g.getBoundingClientRect ? g.getBoundingClientRect() : {top: 80, right: 400};
    p.style.top = Math.max(8, Math.min(window.innerHeight - p.offsetHeight - 8, r.top)) + 'px';
    p.style.left = Math.max(8, Math.min(window.innerWidth - p.offsetWidth - 8, r.right + 8 > window.innerWidth - p.offsetWidth ? r.left - p.offsetWidth - 8 : r.right + 8)) + 'px';
    const store = () => {
      const k = ckey(g);
      S.charts[k] = o;
      save();
      redraw(g);
    };
    p.querySelectorAll('[data-k]').forEach(i => {
      const set = () => {
        const [a, b] = i.dataset.k.split('.'),
          v = i.type === 'checkbox' ? i.checked : i.value;
        if (b) o[a] = {...(o[a] || {}), [b]: v};
        else o[a] = v;
        if (a === 'title' && v === g._chstOrig) delete o.title;
        store();
      };
      i.onchange = set;
      if (i.tagName === 'INPUT' && i.type !== 'checkbox') i.oninput = () => {
        clearTimeout(i._t);
        i._t = setTimeout(set, 400);
      };
    });
    p.querySelector('[data-a="reset"]').onclick = () => {
      delete S.charts[ckey(g)];
      save();
      redraw(g);
      try {
        Plotly.relayout(g, {'xaxis.autorange': true, 'yaxis.autorange': true});
      } catch (e) {}
      p.remove();
      toast('This chart is back as drawn');
    };
    p.querySelector('[data-a="all"]').onclick = () => {
      if (o.bg) S.bg = o.bg;
      if (o.legend) S.legend = o.legend;
      document.querySelectorAll('.js-plotly-plot').forEach(h => {
        if (skip(h) || h === g) return;
        const k = ckey(h);
        S.charts[k] = {...(S.charts[k] || {}), ...(o.colors ? {colors: o.colors} : {}), ...(o.font ? {font: o.font} : {}), ...(o.bg ? {bg: o.bg} : {}), ...(o.legend ? {legend: o.legend} : {})};
      });
      save();
      redrawAll();
      toast('Background, legend, colours and text size applied to every chart of these pages');
    };
    p.querySelectorAll('[data-a="close"]').forEach(b => (b.onclick = () => p.remove()));
  }
  return {
    wrap,
    layout,
    config,
    panel,
    redrawAll,
    family,
    get state() {
      return S;
    },
    set(k, v) {
      S[k] = v;
      save();
      redrawAll();
    }
  };
})();
