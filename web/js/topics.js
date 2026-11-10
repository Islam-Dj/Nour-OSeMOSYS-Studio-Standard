'use strict';
/* ---- topics of the parameters: colours ----
   Muted colours in two families, never in spectral order: blues and slates for the
   standard OSeMOSYS topics, earth tones for the master extensions. Each user may change the colour of a topic or of one
   parameter (kept in this browser only; the model file is not touched). */
// vintaging parameters get their own topic (they were filed under performance and capacity)
const VINT_RX =
  /^(Vint\w*|AgeDeg\w*|VintageMode|ResidualCapacityByVintage|EarlyRetirement|RetirementCost|LifeExtension|RefurbishmentCost|RefurbishmentResetsAge|EmissionDecoupled|DepreciationMethod)$/;
for (const k of Object.keys(PD)) if (VINT_RX.test(k)) PD[k] = ['Vintaging', PD[k][1]];
if (!GROUPS.includes('Vintaging')) GROUPS.splice(GROUPS.indexOf('Operation'), 0, 'Vintaging');
const TOPIC_COLORS = {
  // standard OSeMOSYS topics: navy, steel, slate, grey-blue
  Conversion: '#2e5480',
  Performance: '#4a6a8a',
  Capacity: '#3b5670',
  'Activity limits': '#5a7590',
  Costs: '#2f3f52',
  Emissions: '#66788a',
  'Demand and trade': '#456178',
  'Trade and prices': '#456178',
  Storage: '#50697f',
  'User constraints': '#728294',
  Time: '#5c6878',
  'Model settings': '#5c6878',
  // master extensions: earth tones (sand, olive, terracotta, brown, stone)
  Vintaging: '#8a6a3e',
  Operation: '#7a5c3a',
  'Water and land': '#6a7340',
  Finance: '#9a5a3a',
  Other: '#857d70'
};
const TOPICS = {
  load() {
    try {
      this.t = JSON.parse(localStorage.getItem('mst_topic_colors') || '{}');
      this.p = JSON.parse(localStorage.getItem('mst_param_colors') || '{}');
    } catch (e) {
      this.t = {};
      this.p = {};
    }
  },
  save() {
    try {
      localStorage.setItem('mst_topic_colors', JSON.stringify(this.t));
      localStorage.setItem('mst_param_colors', JSON.stringify(this.p));
    } catch (e) {}
    if (typeof PAINT !== 'undefined') {
      clearTimeout(this._rp);
      this._rp = setTimeout(() => PAINT.repaint(), 150);
    }
  },
  of(p) {
    return (PD[p] || ['Other'])[0];
  },
  color(g) {
    return (this.t && this.t[g]) || TOPIC_COLORS[g] || TOPIC_COLORS.Other;
  },
  pcolor(p, g) {
    return (this.p && this.p[p]) || this.color(g || this.of(p));
  },
  reset() {
    this.t = {};
    this.p = {};
    this.save();
  },
  t: {},
  p: {}
};
TOPICS.load();

/* ---- the same colours everywhere ----
   PAINT colours what other views show, without changing how they are built: a parameter name (in Monte Carlo, Scenarios,
   Units, Find, Parameters A to Z, the commodity panel...) takes the colour of its topic and its row a bar of that colour;
   every other section (details) takes the topic look - a bar, a tinted bold title and a dot - in the colour of what it
   holds; result topics take the colour of the matching parameter topic. Status colours (infeasible / warning) stay
   for status only. Runs again whenever a view changes (MutationObserver), and only on what is not painted yet. */
const RES_TOPIC = {
  Capacity: 'Capacity',
  Activity: 'Activity limits',
  'Production and use': 'Conversion',
  'Trade and valuation': 'Trade and prices',
  Costs: 'Costs',
  Emissions: 'Emissions',
  Storage: 'Storage',
  Vintaging: 'Vintaging',
  'Unit commitment': 'Operation',
  Finance: 'Finance'
};
const rtcolor = g => TOPICS.color(RES_TOPIC[g] || 'Other');
const SECTION_TOPIC = [
  [/^(technolog|land|supply|power|conversion|inputs|outputs)/i, 'Conversion'],
  [/^(commodit|fuel|demand|produced|used)/i, 'Demand and trade'],
  [/^(emission)/i, 'Emissions'],
  [/^(storage)/i, 'Storage'],
  [/^(constraint|user constraint|udc)/i, 'User constraints'],
  [/^(cost|capital|price)/i, 'Costs'],
  [/^(capacity)/i, 'Capacity'],
  [/^(activity|limit)/i, 'Activity limits'],
  [/^(time|season|year|slice|settings|units|model|currency|configuration)/i, 'Time'],
  [/^(finance|budget|source)/i, 'Finance'],
  [/^(water|cascade|precip|soil)/i, 'Water and land'],
  [/^(vintag|cohort|age)/i, 'Vintaging'],
  [/^(unit commitment|start|operation)/i, 'Operation'],
  [/^(availability|capacity factor|efficien|performance)/i, 'Performance'],
  [/^(carbon|emission)/i, 'Emissions'],
  [/^(structure|scenario)/i, 'Model settings']
];
const STATUS_SEC = [
  [/^infeasible/i, 'var(--bad,#b42318)'],
  [/^warning/i, 'var(--warn,#b54708)']
];
const PAINT = {
  names: null,
  timer: 0,
  isParam(t) {
    const sch = typeof SCHEMA !== 'undefined' ? SCHEMA : null;
    if (!this.names || this._sch !== sch) {
      this._sch = sch;
      this.names = new Set(Object.keys(PD));
      try {
        if (typeof SCHEMA !== 'undefined' && SCHEMA) for (const k of SCHEMA.params.keys()) this.names.add(k);
      } catch (e) {}
    }
    return this.names.has(t);
  },
  topicOfText(t) {
    for (const [rx, g] of SECTION_TOPIC) if (rx.test(t)) return g;
    return null;
  },
  first(el) {
    for (const n of el.childNodes) {
      const t = (
        n.nodeType === 3 ? n.textContent : n.nodeType === 1 && !/^(SPAN|I|SMALL|BUTTON|INPUT)$/.test(n.tagName) ? n.textContent : ''
      ).trim();
      if (t) return t.split(/[\s·(]/)[0];
    }
    return '';
  },
  skip: el => !!el.closest('#setup, #rdmview, #rhview, .pblk, .tgrp, svg, .grid tbody, table.ict, #diagram, .plotly, .js-plotly-plot'),
  run(root) {
    root = root || document.body;
    if (root !== document.body && root.parentElement) root = root.parentElement;
    // parameter names: their topic colour, and a bar on their row
    root.querySelectorAll('b, strong, code, summary, .mcp b, .qi b, td.k, th.k').forEach(el => {
      if (el.dataset.pt || this.skip(el)) return;
      const t = this.first(el);
      if (!t || !this.isParam(t)) return;
      el.dataset.pt = '1';
      const c = TOPICS.pcolor(t);
      el.classList.add('ptxt');
      el.style.setProperty('--pc', c);
      const row = el.tagName === 'SUMMARY' ? el.parentElement : el.closest('.mcp, .mcf, .qi, tr, .ck, label, li');
      if (row && !row.dataset.pt) {
        row.dataset.pt = '1';
        row.classList.add(row.tagName === 'DETAILS' ? 'pauto' : 'prow');
        row.style.setProperty('--pc', c);
      }
    });
    // sections: the topic look in the colour of what they hold (status colours for check results)
    root.querySelectorAll('details').forEach(d => {
      if (d.dataset.pt || d.classList.contains('tgrp') || d.classList.contains('pblk') || this.skip(d.parentElement || d)) return;
      const s = d.querySelector(':scope > summary');
      if (!s) return;
      const t = s.textContent.trim();
      d.dataset.pt = '1';
      const st = STATUS_SEC.find(([rx]) => rx.test(t));
      const g = st ? null : this.topicOfText(t);
      d.classList.add('tauto');
      d.style.setProperty('--tc', st ? st[1] : TOPICS.color(g || 'Model settings'));
      if (!s.querySelector('.tdot')) s.insertAdjacentHTML('afterbegin', '<span class="tdot"></span>');
    });
    // other headings that name a group (Monte Carlo kinds of uncertainty, model browser families)
    root.querySelectorAll('.mccat h4, .brg').forEach(h => {
      if (h.dataset.pt) return;
      h.dataset.pt = '1';
      const t = h.textContent.trim();
      const dot = h.nextElementSibling && h.nextElementSibling.querySelector && h.nextElementSibling.querySelector('.dot');
      const c = h.classList.contains('brg') && dot ? dot.style.background : TOPICS.color(this.topicOfText(t) || 'Model settings');
      h.classList.add('thead');
      h.style.setProperty('--tc', c);
    });
  },
  pending: new Set(),
  watch() {
    const obs = new MutationObserver(ms => {
      for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) this.pending.add(n.parentElement || n);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        const roots = [...this.pending].filter(e => e.isConnected);
        this.pending.clear();
        try {
          for (const r of roots) if (!roots.some(o => o !== r && o.contains(r))) this.run(r);
        } catch (e) {}
      }, 60);
    });
    const go = () => {
      obs.observe(document.body, {childList: true, subtree: true});
      this.run();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
    else go();
  },
  repaint() {
    document.querySelectorAll('[data-pt]').forEach(e => {
      delete e.dataset.pt;
    });
    this.run();
  }
};
PAINT.watch();
