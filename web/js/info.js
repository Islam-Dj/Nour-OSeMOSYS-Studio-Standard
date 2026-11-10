'use strict';
/* ---- the Info menu (the parameter reference in the Studio), ⓘ on every parameter, zoom of
   the whole Studio and of each panel, a wider / resizable side panel, quick find (Ctrl+K). ---- */
const INFO = {
  pages: null,
  async load() {
    if (this.pages) return this.pages;
    const inl = inlineText('param-pages');
    if (inl) {
      try {
        return (this.pages = JSON.parse(inl));
      } catch (e) {}
    }
    try {
      const r = await fetch('data/docs/param_pages.json');
      if (r.ok) return (this.pages = await r.json());
    } catch (e) {}
    return (this.pages = {});
  },
  // the server serves web/data/docs; the page opened as a file finds the PDF of the package (docs/reference)
  pdf() {
    const f = STANDARD ? 'OSEMOSYS_PARAMETERS.pdf' : 'MASTER_PARAMETERS.pdf'; // the standard edition has its own reference
    return location.protocol === 'file:' ? (STANDARD ? 'web/data/docs/' : '../docs/reference/') + f : 'data/docs/' + f;
  },
  async open(key) {
    const P = await this.load(),
      pg = key ? P[key] : null;
    window.open(this.pdf() + (pg ? '#page=' + pg : ''), '_blank', 'noopener');
  },
  download() {
    const a = document.createElement('a');
    a.href = this.pdf();
    a.download = STANDARD ? 'OSEMOSYS_PARAMETERS.pdf' : 'MASTER_PARAMETERS.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
};

/* ---- ⓘ: what a parameter is, its index, default, unit, where it acts, and its page in the reference ---- */
async function infoCard(p, anchor) {
  document.querySelectorAll('.icard').forEach(e => e.remove());
  const P = await INFO.load(),
    pi = typeof pinfo === 'function' ? pinfo(p) : {},
    used = pi.used || [],
    d = (PD[p] || ['', ''])[1] || pi.doc || '';
  const unit = typeof paramUnitFor === 'function' && EDIT ? paramUnitFor(p, EDIT.kind, EDIT.code) : '';
  const c = document.createElement('div');
  c.className = 'icard';
  c.style.setProperty('--pc', TOPICS.pcolor(p));
  c.setAttribute('role', 'dialog');
  c.setAttribute('aria-label', 'About ' + p);
  c.innerHTML = `<div class="ich"><span class="tdot" style="background:${TOPICS.pcolor(p)}"></span><b>${esc(p)}</b><span class="muted">${esc(TOPICS.of(p))}</span><button type="button" class="btn sm icx" aria-label="Close">×</button></div>
    <div class="icd">${esc(d) || '<span class="muted">No description.</span>'}</div>
    <table class="ict"><tr><th>Index</th><td>[${esc(
      dimsOf(p)
        .map(x => x.replace('MODE_OF_OPERATION', 'MODE').toLowerCase())
        .join(', ')
    )}]</td></tr>
      <tr><th>Default</th><td>${esc(String(defOf(p)))}</td></tr>${unit ? `<tr><th>Unit</th><td>${esc(unit)}</td></tr>` : ''}
      <tr><th>Acts in</th><td>${used.length ? esc(used.slice(0, 10).join(', ')) + (used.length > 10 ? ' …' : '') : '<span class="muted">No constraint</span>'}</td></tr></table>
    <div class="acts">${P[p] ? `<button type="button" class="btn pri icr">Open the reference, p. ${P[p]}</button>` : '<span class="muted">Not in the reference</span>'}</div>`;
  document.body.appendChild(c);
  const r = anchor.getBoundingClientRect(),
    w = Math.min(380, innerWidth - 20);
  c.style.width = w / popScale(c) + 'px';
  placeNear(c, r, 'right');
  c.querySelector('.icx').onclick = () => c.remove();
  const b = c.querySelector('.icr');
  if (b) b.onclick = () => INFO.open(p);
  setTimeout(
    () =>
      document.addEventListener('mousedown', function off(ev) {
        if (!c.contains(ev.target)) {
          c.remove();
          document.removeEventListener('mousedown', off);
        }
      }),
    0
  );
}
document.addEventListener(
  'click',
  ev => {
    const b = ev.target.closest && ev.target.closest('.pinfo');
    if (!b) return;
    ev.preventDefault();
    ev.stopPropagation();
    infoCard(b.dataset.p, b);
  },
  true
);
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape') document.querySelectorAll('.icard,.qfind').forEach(e => e.remove());
});

/* ---- the Info menu ---- */
function shortcutsPanel() {
  const dr = document.getElementById('drawer');
  dr.hidden = false;
  const K = [
    ['Grids', ''],
    ['Click', 'select a cell; a column header: the column; a row label: the row; the corner: every cell'],
    ['Shift + arrows / Shift + click', 'extend the selection'],
    ['Typing · double-click · F2', 'edit the cell (typing replaces the value)'],
    ['Enter · Tab · arrows', 'keep the value and move'],
    ['Esc', 'cancel the edit'],
    [
      'Ctrl+C · Ctrl+X · Ctrl+V',
      'copy · cut · paste (a block from Excel at the selected cell, or at its labels; one value fills the selection)'
    ],
    ['Ctrl+D · Ctrl+R', 'fill the selection down · right'],
    ['Ctrl+A', 'select every cell'],
    ['Delete', 'clear (back to the default)'],
    ['Ctrl+Z · Ctrl+Y', 'undo · redo (60 steps)'],
    ['Studio', ''],
    ['Ctrl+K', 'find a technology, commodity, storage, emission or parameter'],
    ['Ctrl + = · Ctrl + − · Ctrl + 0', 'zoom the whole Studio · reset'],
    ['Alt + wheel on a panel', 'zoom that panel (side panel, results, model browser)'],
    ['Esc', 'close a card or the finder'],
    ['Diagram', ''],
    ['⬚ Select (bar at the top left)', 'selection tool: click boxes or commodity lines, drag a rectangle'],
    ['Ctrl / Shift / ⌘ + click a box or a commodity line', 'select it (again: unselect)'],
    ['Shift + drag', 'select the boxes in a rectangle'],
    ['Ctrl + click a row of the model browser', 'select it there'],
    ['Esc', 'clear the selection'],
    ['Bar at the top', 'show only the selection · + suppliers · + users · delete (undo) · save a view · full system']
  ];
  dr.innerHTML = `<div class="dh"><div style="min-width:0"><div class="code">info</div><h2>Keyboard and mouse</h2></div><div class="acts"><button class="btn x" type="button" id="close">Close</button></div></div>
    <div class="db"><table class="grid kbd">${K.map(([a, b]) => (b ? `<tr><td class="k"><kbd>${esc(a)}</kbd></td><td>${esc(b)}</td></tr>` : `<tr><th colspan="2">${esc(a)}</th></tr>`)).join('')}</table></div>`;
  dr.querySelector('#close').onclick = () => (dr.hidden = true);
}
function aboutPanel() {
  const dr = document.getElementById('drawer');
  dr.hidden = false;
  const v = typeof SCHEMA !== 'undefined' && SCHEMA ? SCHEMA.name : BUILTIN_NAME;
  dr.innerHTML = `<div class="dh"><div style="min-width:0"><div class="code">info</div><h2>${APPNAME} ${STUDIO_VERSION}</h2><p>Model file: ${esc(v)}. N. E. DJEDAA, CREAD.</p></div><div class="acts"><button class="btn x" type="button" id="close">Close</button></div></div>
    <div class="db">${STANDARD ? ABOUT_STANDARD : `<ul class="about">
      <li><b>A part of the diagram</b>: select technologies (Ctrl + click, Shift + drag, Select in the browser), show only them, grow by suppliers / users, save named views with the case.</li>
      <li><b>Results by vintage</b>: production, use and emissions of each cohort of a vintaged technology (Results › Vintaging).</li>
      <li><b>Colours everywhere</b>: the topic colours follow each parameter in every view (Monte Carlo, Find, Scenarios, Units, Results...), and every section has the topic look.</li>
      <li><b>Model 0.8</b>: soil bucket in the water cascade (each land use its own: runoff, alpha x ET0 from infiltration + soil, drainage, soil store, cyclic year); storage carried from one year to the next (aquifer); linked ratios (an input or output ratio follows other technologies' ratios: land precipitation = PRC output, crop fallow = cropland ET). All off by default.</li>
      <li><b>Model 0.7</b>: one finance module (budget, debt, equity, grant, regional fund; rates by technology, private part, budget with imports, operating costs and savings); earlier finance data converted with the same objective.</li>
      <li><b>Grids the Excel way</b>: select, double-click / F2 / typing to edit, row / column / all selection, paste at the selected cell, Ctrl+D / Ctrl+R.</li>
      <li><b>Suspect values</b>: ⚠ on the cell, on the technology in the model browser, on the parameter and its topic; the Check panel leads to the cell.</li>
      <li><b>Topics in colour</b> (yours to change), bold titles, expand / collapse all.</li>
      <li><b>Results</b>: every output with its meaning, unit and named index sets.</li>
      <li><b>Info</b>: the parameter reference in the Studio, ⓘ on every parameter, zoom, quick find (Ctrl+K).</li></ul>
      `}<p class="muted">${STANDARD ? 'To cite the Studio and its documents: Info › How to cite.' : 'The full list of changes is in README.txt of the package.'}</p></div>`;
  dr.querySelector('#close').onclick = () => (dr.hidden = true);
}

/* ---- how to cite the Studio and its two documents: APA, BibTeX, RIS (EndNote, Zotero, Mendeley), one reference or the
   three at once, copied or saved. The same references as CITATION.cff (tests/studio_test.js compares them). ---- */
const CITE_AUTHOR = {family: 'DJEDAA', given: 'Nour Elislam', initials: 'N. E.'};
const CITE = [
  {key: 'djedaa_2026_nour_studio', what: 'The Studio', type: 'software', doi: '10.5281/zenodo.24117127',
   title: 'Nour OSeMOSYS Studio: a desktop studio to build, solve and analyse OSeMOSYS models'},
  {key: 'djedaa_2026_user_guide', what: 'The User Guide', type: 'manual', doi: '10.5281/zenodo.24117166',
   title: 'Nour OSeMOSYS Studio: User Guide'},
  {key: 'djedaa_2026_parameter_reference', what: 'The Parameter Reference', type: 'manual', doi: '10.5281/zenodo.24117220',
   title: 'OSeMOSYS Parameter Reference: the standard OSeMOSYS model'}
].map(c => ({...c, year: 2026, version: '0.22.1'}));
const CITE_FMT = {
  apa: {
    label: 'APA',
    ext: 'txt',
    one: c =>
      `${CITE_AUTHOR.family}, ${CITE_AUTHOR.initials} (${c.year}). ${c.title} (Version ${c.version})${c.type === 'software' ? ' [Computer software]' : ''}. Zenodo. https://doi.org/${c.doi}`,
    join: '\n\n'
  },
  bib: {
    label: 'BibTeX',
    ext: 'bib',
    one: c =>
      [
        `@${c.type}{${c.key},`,
        `  author = {${CITE_AUTHOR.family}, ${CITE_AUTHOR.given}},`,
        `  title = {{${c.title}}},`,
        `  year = {${c.year}},`,
        `  version = {${c.version}},`,
        `  publisher = {Zenodo},`,
        `  doi = {${c.doi}},`,
        `  url = {https://doi.org/${c.doi}}`,
        '}'
      ].join('\n'),
    join: '\n\n'
  },
  ris: {
    label: 'RIS (EndNote, Zotero, Mendeley)',
    ext: 'ris',
    // RIS: COMP = computer program, RPRT = report (a manual); one tag per line, each reference closed by ER
    one: c =>
      [
        `TY  - ${c.type === 'software' ? 'COMP' : 'RPRT'}`,
        `AU  - ${CITE_AUTHOR.family}, ${CITE_AUTHOR.given}`,
        `TI  - ${c.title}`,
        `PY  - ${c.year}`,
        `ET  - Version ${c.version}`,
        'PB  - Zenodo',
        `DO  - ${c.doi}`,
        `UR  - https://doi.org/${c.doi}`,
        'ER  - '
      ].join('\n'),
    join: '\n\n'
  }
};
let CITE_CUR = 'apa';
function citePanel() {
  const dr = document.getElementById('drawer');
  dr.hidden = false;
  const draw = () => {
    const F = CITE_FMT[CITE_CUR];
    dr.innerHTML = `<div class="dh"><div style="min-width:0"><div class="code">info</div><h2>How to cite</h2>
      <p>If you use the Studio in your work, please cite it, and the documents you used. Choose a format, then copy one reference or all three.</p></div>
      <div class="acts"><button class="btn x" type="button" id="close">Close</button></div></div>
      <div class="db"><div class="seg" role="tablist" id="citefmt">${Object.entries(CITE_FMT)
        .map(([k, f]) => `<button type="button" data-f="${k}" aria-pressed="${k === CITE_CUR}" data-notr>${esc(f.label)}</button>`)
        .join('')}</div>
      ${CITE.map((c, i) => `<div class="citeb"><h3>${esc(c.what)}</h3><pre class="cite" dir="ltr">${esc(F.one(c))}</pre><button class="btn sm" type="button" data-copy="${i}">Copy</button></div>`).join('')}
      <div class="acts" style="margin-top:12px"><button class="btn" type="button" id="citeall">Copy all three</button><button class="btn" type="button" id="citedl">Download all three</button></div>
      <p class="muted">The file CITATION.cff of the source code holds the same references.</p></div>`;
    const all = () => CITE.map(F.one).join(F.join) + '\n';
    const copy = t =>
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast(`${F.label}: copied`)).catch(() => toast('Copy not allowed here'));
    dr.querySelector('#close').onclick = () => (dr.hidden = true);
    dr.querySelectorAll('[data-f]').forEach(b => (b.onclick = () => ((CITE_CUR = b.dataset.f), draw())));
    dr.querySelectorAll('[data-copy]').forEach(b => (b.onclick = () => copy(F.one(CITE[+b.dataset.copy]) + '\n')));
    dr.querySelector('#citeall').onclick = () => copy(all());
    dr.querySelector('#citedl').onclick = () =>
      saveFile(`Nour_OSeMOSYS_Studio_${CITE[0].version}_citations.${F.ext}`, CITE_CUR === 'ris' ? all().replace(/\n/g, '\r\n') : all(), 'text/plain');
  };
  draw();
}
// the standard edition (Nour OSeMOSYS Studio): what it does
const ABOUT_STANDARD = `<ul class="about">
      <li><b>Build a model</b> on the diagram or with forms, or open a MUIO / OSeMOSYS data file; MUIO cases import and export.</li>
      <li><b>The standard OSeMOSYS model</b> built in, unchanged: the model file MUIO uses, so cases are built and solved as in MUIO.</li>
      <li><b>Check the data</b> before solving: shares, signs, units, links, user constraints.</li>
      <li><b>Solve</b> with HiGHS, GLPK, CBC, or Gurobi when it is installed.</li>
      <li><b>Results</b>: tables and charts of every result, with its meaning and unit; results by time slice.</li>
      <li><b>Ask the results</b> in your own words (no AI, on this computer).</li>
      <li><b>Uncertainty</b>: Monte Carlo and robust decision making.</li>
      <li><b>Units by system</b> (land, water, crops, energy, money), scenarios, cases by model, four languages.</li></ul>
      `;
function setupInfoMenu() {
  const head = document.getElementById('menub');
  if (!head || document.getElementById('infob')) return;
  const w = document.createElement('div');
  w.className = 'menuw';
  w.innerHTML = `<button class="btn" id="infob" type="button" aria-haspopup="true" aria-expanded="false" title="The parameter reference, the meaning of the results, shortcuts, zoom">Info ▾</button>
    <div class="menu" id="infom" hidden>
      <button class="mi" type="button" data-i="ref">Parameter reference (PDF)</button>
      <button class="mi" type="button" data-i="dl">Download the reference</button>
      <button class="mi" type="button" data-i="res">Meaning of every result</button>
      <button class="mi" type="button" data-i="az">Parameters A to Z</button>
      <button class="mi" type="button" data-i="ex">Example models</button>
      ${STANDARD ? '<button class="mi" type="button" data-i="guide">User Guide (PDF)</button>' : ''}
      <div class="msep"></div>
      <button class="mi" type="button" data-i="kbd">Keyboard and mouse</button>
      <button class="mi" type="button" data-i="find">Find… <span class="muted">Ctrl+K</span></button>
      <div class="mi zrow"><span>Zoom</span><button type="button" class="btn sm" data-z="-1" aria-label="Smaller">−</button><b id="zval">100%</b><button type="button" class="btn sm" data-z="1" aria-label="Larger">+</button><button type="button" class="btn sm" data-z="0">Reset</button></div>
      <div class="msep"></div>
      ${STANDARD ? '<button class="mi" type="button" data-i="cite">How to cite</button>' : ''}
      <button class="mi" type="button" data-i="about">About this version</button>
    </div>`;
  head.parentElement.parentElement.insertBefore(w, head.parentElement);
  const b = w.querySelector('#infob'),
    m = w.querySelector('#infom');
  b.onclick = ev => {
    ev.stopPropagation();
    m.hidden = !m.hidden;
    b.setAttribute('aria-expanded', String(!m.hidden));
  };
  document.addEventListener('click', ev => {
    if (!w.contains(ev.target)) {
      m.hidden = true;
      b.setAttribute('aria-expanded', 'false');
    }
  });
  m.addEventListener('click', ev => {
    const it = ev.target.closest('[data-i]'),
      z = ev.target.closest('[data-z]');
    if (z) {
      ev.stopPropagation();
      return ZOOM.step('all', +z.dataset.z);
    }
    if (!it) return;
    m.hidden = true;
    ({
      ref: () => INFO.open(),
      dl: () => INFO.download(),
      res: () => INFO.open('ch:results'),
      az: () => INFO.open('app:az'),
      ex: () => openLibrary(),
      kbd: shortcutsPanel,
      find: quickFind,
      about: aboutPanel,
      cite: citePanel,
      // the User Guide of the standard edition (web/data/docs/USER_GUIDE.pdf; the page opened as a file: docs/ of the package)
      guide: () => window.open(location.protocol === 'file:' ? 'web/data/docs/USER_GUIDE.pdf' : 'data/docs/USER_GUIDE.pdf', '_blank', 'noopener')
    })[it.dataset.i]();
  });
}

/* ---- zoom: the whole Studio (Ctrl + = / − / 0, Info menu) and each panel (Alt + wheel, the buttons of the side panel) ---- */
const ZOOM = {
  v: {all: 1, drawer: 1, results: 1, mbrowser: 1},
  width: 0,
  load() {
    try {
      Object.assign(this.v, JSON.parse(localStorage.getItem('mst_zoom') || '{}'));
      this.width = +(localStorage.getItem('mst_drawer_w') || 0);
    } catch (e) {}
  },
  save() {
    try {
      localStorage.setItem('mst_zoom', JSON.stringify(this.v));
      localStorage.setItem('mst_drawer_w', String(this.width || 0));
    } catch (e) {}
  },
  el(k) {
    return k === 'all' ? document.documentElement : document.getElementById(k);
  },
  apply() {
    for (const k of Object.keys(this.v)) {
      const e = this.el(k);
      if (e) e.style.zoom = this.v[k] === 1 ? '' : String(this.v[k]);
    }
    const zv = document.getElementById('zval');
    if (zv) zv.textContent = Math.round(this.v.all * 100) + '%';
    document.querySelectorAll('.pz b').forEach(x => (x.textContent = Math.round(this.v[x.dataset.k] * 100) + '%'));
    const dr = document.getElementById('drawer');
    if (dr) dr.style.width = this.width && innerWidth > 760 ? this.width + 'px' : '';
  },
  step(k, s) {
    const v = s === 0 ? 1 : Math.round(Math.min(2, Math.max(0.6, this.v[k] + 0.1 * s)) * 10) / 10;
    this.v[k] = v;
    this.save();
    this.apply();
    if (typeof fit === 'function' && k === 'all')
      try {
        fit();
      } catch (e) {}
  }
};
ZOOM.load();
document.addEventListener('keydown', ev => {
  const mod = ev.ctrlKey || ev.metaKey;
  if (!mod || ev.altKey) return;
  if (ev.key === '=' || ev.key === '+') {
    ev.preventDefault();
    ZOOM.step('all', 1);
  } else if (ev.key === '-') {
    ev.preventDefault();
    ZOOM.step('all', -1);
  } else if (ev.key === '0') {
    ev.preventDefault();
    ZOOM.step('all', 0);
  } else if (ev.key.toLowerCase() === 'k') {
    ev.preventDefault();
    quickFind();
  }
});
document.addEventListener(
  'wheel',
  ev => {
    if (!ev.altKey) return;
    const p = ev.target.closest && ev.target.closest('#drawer,#results,#mbrowser');
    if (!p) return;
    ev.preventDefault();
    ZOOM.step(p.id, ev.deltaY < 0 ? 1 : -1);
  },
  {passive: false}
);
// the side panel: zoom buttons, wider / narrower, and a handle to drag its width (added to every view of the panel)
function panelTools() {
  const dr = document.getElementById('drawer');
  if (!dr || dr.hidden) return;
  const dh = dr.querySelector('.dh .acts, .dh');
  if (!dh || dr.querySelector('.pz')) return;
  const z = document.createElement('span');
  z.className = 'pz';
  z.innerHTML = `<button type="button" class="btn sm" data-pz="-1" title="Smaller (Alt + wheel)" aria-label="Smaller">−</button><b data-k="drawer">${Math.round(ZOOM.v.drawer * 100)}%</b><button type="button" class="btn sm" data-pz="1" title="Larger (Alt + wheel)" aria-label="Larger">+</button><button type="button" class="btn sm" data-pw="1" title="Wider / narrower side panel (or drag its left edge)">⤢</button>`;
  dh.prepend(z);
  z.onclick = ev => {
    const b = ev.target.closest('button');
    if (!b) return;
    ev.stopPropagation();
    if (b.dataset.pz) ZOOM.step('drawer', +b.dataset.pz);
    else {
      ZOOM.width = ZOOM.width && ZOOM.width > innerWidth * 0.6 ? 0 : Math.round(innerWidth * 0.75);
      ZOOM.save();
      ZOOM.apply();
    }
  };
  if (!dr.querySelector('.drh')) {
    const h = document.createElement('div');
    h.className = 'drh';
    h.title = 'Drag to change the width';
    dr.prepend(h);
    h.onmousedown = ev => {
      ev.preventDefault();
      const x0 = ev.clientX,
        w0 = dr.getBoundingClientRect().width;
      const mv = e => {
        ZOOM.width = Math.round(Math.min(innerWidth - 200, Math.max(320, w0 + (x0 - e.clientX))));
        ZOOM.apply();
      };
      const up = () => {
        document.removeEventListener('mousemove', mv);
        document.removeEventListener('mouseup', up);
        ZOOM.save();
      };
      document.addEventListener('mousemove', mv);
      document.addEventListener('mouseup', up);
    };
  }
}

/* ---- quick find (Ctrl+K): a technology, commodity, storage, emission, constraint or parameter ---- */
function quickFind() {
  document.querySelectorAll('.qfind').forEach(e => e.remove());
  if (!M || !M.D) return;
  const items = [
    ...[...M.techs].map(c => ['tech', c, TD[c] || 'technology']),
    ...(M.S.COMMODITY || M.S.FUEL || []).map(c => ['comm', c, FD[c] || 'commodity']),
    ...(M.S.STORAGE || []).map(c => ['stor', c, 'storage']),
    ...(M.S.EMISSION || []).map(c => ['emi', c, 'emission']),
    ...(M.S.UDC || []).map(c => ['udc', c, 'user constraint']),
    ...(SCHEMA
      ? [...SCHEMA.params.values()].filter(x => !x.computed).map(x => ['par', x.name, (PD[x.name] || ['', ''])[1] || TOPICS.of(x.name)])
      : [])
  ];
  const q = document.createElement('div');
  q.className = 'qfind';
  q.setAttribute('role', 'dialog');
  q.setAttribute('aria-label', 'Find');
  q.innerHTML = `<input type="search" placeholder="Find a technology, commodity, storage, emission or parameter…" aria-label="Find"><div class="qlist" role="listbox"></div>`;
  document.body.appendChild(q);
  const inp = q.querySelector('input'),
    L = q.querySelector('.qlist');
  let hits = [],
    cur = 0;
  const KIND = {tech: 'technology', comm: 'commodity', stor: 'storage', emi: 'emission', udc: 'constraint', par: 'parameter'};
  const draw = () => {
    const s = inp.value.trim().toUpperCase();
    hits = (s ? items.filter(([, c, d]) => c.toUpperCase().includes(s) || String(d).toUpperCase().includes(s)) : items)
      .slice(0, 40)
      .sort((a, b) => b[1].toUpperCase().startsWith(s) - a[1].toUpperCase().startsWith(s));
    cur = Math.min(cur, Math.max(0, hits.length - 1));
    L.innerHTML =
      hits
        .map(
          ([k, c, d], i) =>
            `<div class="qi${i === cur ? ' on' : ''}" data-i="${i}" role="option"><b>${esc(c)}</b><span>${esc(String(d).slice(0, 70))}</span><i>${KIND[k]}</i></div>`
        )
        .join('') || '<div class="muted" style="padding:8px">Nothing found</div>';
  };
  const go = i => {
    const h = hits[i];
    if (!h) return;
    q.remove();
    if (h[0] === 'par') {
      EDIT = null;
      openEntity('all');
      const b = document.querySelector(`#drawer .pblk[data-p="${h[1]}"]`);
      if (b) {
        for (let e = b.parentElement; e && e.id !== 'drawer'; e = e.parentElement) if (e.tagName === 'DETAILS') e.open = true;
        b._st = true;
        b.open = true;
        const host = b.querySelector('.ghost');
        if (!host.innerHTML || host.dataset.lazy) {
          delete host.dataset.lazy;
          b._render();
        }
        b.scrollIntoView({block: 'start'});
        if (typeof KEEP !== 'undefined') KEEP.jump();
      }
    } else if (h[0] === 'tech' && typeof openTech === 'function' && !(typeof build !== 'undefined' && build.on)) openTech(h[1]);
    else {
      EDIT = null;
      openEntity(h[0], h[1]);
    }
  };
  inp.oninput = () => {
    cur = 0;
    draw();
  };
  draw();
  inp.focus();
  inp.onkeydown = e => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      cur = Math.min(hits.length - 1, cur + 1);
      draw();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      cur = Math.max(0, cur - 1);
      draw();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(cur);
    } else if (e.key === 'Escape') q.remove();
  };
  L.onclick = e => {
    const it = e.target.closest('.qi');
    if (it) go(+it.dataset.i);
  };
  setTimeout(
    () =>
      document.addEventListener('mousedown', function off(ev) {
        if (!q.contains(ev.target)) {
          q.remove();
          document.removeEventListener('mousedown', off);
        }
      }),
    0
  );
}

// start: the Info menu, the zoom, and the tools of the side panel each time its content changes
(function () {
  const start = () => {
    setupInfoMenu();
    ZOOM.apply();
    const dr = document.getElementById('drawer');
    if (dr) new MutationObserver(() => panelTools()).observe(dr, {childList: true, attributes: true, attributeFilter: ['hidden']});
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
