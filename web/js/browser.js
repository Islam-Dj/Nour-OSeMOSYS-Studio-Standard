'use strict';
/* ============================== model browser: always beside the diagram ==============================
   Every item of the model in lists (technologies, commodities, storage, emissions, constraints) and the model
   configuration. Clicking a row does what clicking the diagram does (the panel on the right), and centres the diagram. */
const BR = {tab: 'tech', q: '', sel: null, show: true, by: 'fam'};
try {
  const b = JSON.parse(localStorage.getItem('mst_rsme_browser') || '{}');
  if (b.tab) BR.tab = b.tab;
  if (b.show === false) BR.show = false;
  if (b.by) BR.by = b.by;
} catch (e) {}
const brSave = () => {
  try {
    localStorage.setItem('mst_rsme_browser', JSON.stringify({tab: BR.tab, show: BR.show, by: BR.by}));
  } catch (e) {}
};
const FAMNAME = {
  loose: 'Not connected yet (no input, no output)',
  land: 'Land',
  ren: 'Renewable resources',
  nuc: 'Nuclear',
  coal: 'Coal',
  oil: 'Oil',
  gas: 'Gas',
  trade: 'Cross-border links',
  elc: 'Electricity',
  h2: 'Hydrogen',
  other: 'Other'
};
const FAMORDER = ['loose', 'ren', 'land', 'nuc', 'coal', 'oil', 'gas', 'trade', 'elc', 'h2', 'other'];

function brTechMain(t) {
  // the commodity that names the technology's family: main output, else main input
  const e = G ? G.edges.filter(x => x.t === t) : [];
  const o = e.filter(x => x.dir === 'out'),
    i = e.filter(x => x.dir === 'in');
  return (o[0] || i[0] || {}).f;
}
function brItems() {
  const out = [],
    q = BR.q.trim().toUpperCase(),
    hit = (c, n) => !q || c.toUpperCase().includes(q) || (n || '').toUpperCase().includes(q);
  if (!M || !G) return out;
  if (BR.tab === 'tech') {
    const T = [...G.T, ...(state.showoff ? [] : [...G.off].filter(t => !G.T.includes(t)))];
    const groups = new Map();
    for (const t of T) {
      const f = brTechMain(t);
      const g = G.loose && G.loose.has(t) && !/^CONV/.test(t) ? 'loose' : f ? fam(f) : 'other';
      if (!groups.has(g)) groups.set(g, []);
      if (hit(t, TD[t]))
        groups
          .get(g)
          .push({
            kind: 'tech',
            code: t,
            name: shortName(t) === t ? '' : shortName(t),
            col: f ? fcol(f) : 'var(--f-other)',
            off: G.off.has(t)
          });
    }
    for (const g of FAMORDER)
      if (groups.get(g) && groups.get(g).length)
        out.push({title: FAMNAME[g], items: groups.get(g).sort((a, b) => a.code.localeCompare(b.code))});
  } else if (BR.tab === 'comm') {
    const groups = new Map();
    for (const f of G.F) {
      const g = G.looseF && G.looseF.has(f) ? 'loose' : fam(f);
      if (!groups.has(g)) groups.set(g, []);
      if (hit(f, FD[f])) groups.get(g).push({kind: 'comm', code: f, name: (FD[f] || '').split(/[.(;]/)[0].slice(0, 40), col: fcol(f)});
    }
    for (const g of FAMORDER)
      if (groups.get(g) && groups.get(g).length)
        out.push({title: FAMNAME[g], items: groups.get(g).sort((a, b) => a.code.localeCompare(b.code))});
  } else if (BR.tab === 'stor' || BR.tab === 'emi' || BR.tab === 'udc') {
    const set = {stor: 'STORAGE', emi: 'EMISSION', udc: 'UDC'}[BR.tab],
      list = (M.S[set] || []).filter(c => hit(c, FD[c]));
    if (list.length)
      out.push({
        title: {stor: 'Storage', emi: 'Emissions', udc: 'User-defined constraints'}[BR.tab],
        items: list.map(c => ({kind: BR.tab, code: c, name: (FD[c] || '').slice(0, 40), col: 'var(--muted)'}))
      });
  } else {
    const n = s => (M.S[s] || []).length,
      yrs = M.years.length ? `${M.years[0]} – ${M.years[M.years.length - 1]} (${M.years.length})` : '—';
    const dr = P_('DiscountRate').recs,
      drv = dr.length
        ? [...new Set(dr.map(r => r.v))].slice(0, 3).join(', ')
        : P_('DiscountRate').def !== undefined
          ? P_('DiscountRate').def + ' (default)'
          : '—';
    out.push({
      title: 'Model configuration',
      items: [
        {kind: 'glob', code: 'Regions', name: REG.join(' ')},
        {kind: 'glob', code: 'Years', name: yrs},
        {kind: 'glob', code: 'Time slices', name: String(n('TIMESLICE'))},
        {kind: 'glob', code: 'Seasons · day types · day parts', name: `${n('SEASON')} · ${n('DAYTYPE')} · ${n('DAILYTIMEBRACKET')}`},
        {kind: 'glob', code: 'Modes of operation', name: String(n('MODE_OF_OPERATION'))},
        {kind: 'glob', code: 'Discount rate', name: String(drv)},
        {kind: 'all', code: 'All parameters', name: `${Object.keys(M.D.params).length} with data`},
        {kind: 'model', code: 'Model file', name: SCHEMA ? SCHEMA.name : BUILTIN_NAME},
        {kind: 'scen', code: 'Scenarios', name: (scenData().list || []).length ? scenData().list.length + ' besides the base' : 'base only'}
      ]
    });
  }
  // the same items grouped by system (colour of the system; "No system" last)
  if (BR.by === 'sys' && SYSTEMS.list.length && ['tech', 'comm', 'stor', 'emi'].includes(BR.tab)) {
    const set = ENTSET[BR.tab],
      all = out.flatMap(g => g.items),
      by = new Map();
    for (const it of all) {
      const c = SYSTEMS.of(it.code, set) || '';
      if (!by.has(c)) by.set(c, []);
      by.get(c).push({...it, col: c ? SYSTEMS.color(c) : it.col});
    }
    return [...SYSTEMS.ordered().map(s => s.c), '']
      .filter(c => by.has(c))
      .map(c => ({title: c ? SYSTEMS.full(c) : 'No system', items: by.get(c).sort((a, b) => a.code.localeCompare(b.code))}));
  }
  return out;
}
const SELTAB = () => BR.tab === 'tech' || BR.tab === 'comm';
function brCounts() {
  if (!M || !G) return {};
  return {
    tech: G.T.length,
    comm: G.F.length,
    stor: (M.S.STORAGE || []).length,
    emi: (M.S.EMISSION || []).length,
    udc: (M.S.UDC || []).length
  };
}
function renderBrowser() {
  const B = document.getElementById('mbrowser');
  if (!B) return;
  B.hidden =
    !BR.show ||
    !document.getElementById('results').hidden ||
    !document.getElementById('mcview').hidden ||
    !document.getElementById('monitor').hidden;
  const cb = document.getElementById('showbr');
  if (cb) cb.checked = BR.show;
  if (B.hidden || !M) return;
  const C = brCounts(),
    regs = state.region === 'ALL' ? 'All regions' : RNAME[state.region] || state.region;
  const tabs = [
    ['tech', 'Technologies', C.tech],
    ['comm', 'Commodities', C.comm],
    ['stor', 'Storage', C.stor],
    ['emi', 'Emissions', C.emi],
    ['udc', 'Constraints', C.udc],
    ['set', 'Settings']
  ];
  const groups = brItems(),
    total = groups.reduce((s, g) => s + g.items.length, 0);
  const keepFocus = document.activeElement && document.activeElement.id === 'brq',
    caret = keepFocus ? document.activeElement.selectionStart : 0;
  B.innerHTML = `<div class="brh"><h2>Model</h2><span class="muted">${esc(regs)}</span>${SYSTEMS.list.length && BR.tab !== 'set' && BR.tab !== 'udc' ? `<select id="brby" title="Group the list by family or by system" aria-label="Group by"><option value="fam" ${BR.by !== 'sys' ? 'selected' : ''}>By family</option><option value="sys" ${BR.by === 'sys' ? 'selected' : ''}>By system</option></select>` : ''}<button class="btn sm" id="brhide" type="button" title="Hide the browser (More ▸ Show the model browser brings it back)" aria-label="Hide the model browser">«</button></div>
    <div class="brtabs" role="tablist" aria-label="Model items">${tabs.map(([k, l, n]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${BR.tab === k}">${l}${n !== undefined ? ` <i>${n}</i>` : ''}</button>`).join('')}</div>
    <input type="search" id="brq" aria-label="Filter the list" placeholder="Filter ${BR.tab === 'set' ? 'settings' : tabs.find(t => t[0] === BR.tab)[1].toLowerCase()}" value="${esc(BR.q)}">
    <div class="brl" role="list">${
      groups.length
        ? groups
            .map(
              (g, gi) =>
                `<div class="brg${SELTAB() && DVW.selMode ? ' selg' : ''}" data-gi="${gi}" ${SELTAB() && DVW.selMode ? 'title="Select or unselect the whole family"' : ''}><span>${esc(g.title)}</span><i>${g.items.length}</i></div>` +
                g.items
                  .map(
                    it =>
                      `<button type="button" role="listitem" class="bri${BR.tab === 'set' ? ' set' : ''}${BR.sel === it.kind + ':' + it.code ? ' on' : ''}${it.off ? ' off' : ''}" data-k="${it.kind}" data-c="${esc(it.code)}" title="${esc(it.code + (it.name ? ' · ' + it.name : ''))}${it.kind === 'tech' || it.kind === 'comm' ? ' (Ctrl + click: select)' : ''}">${BR.tab === 'set' ? '' : (it.kind === 'tech' || it.kind === 'comm') && DVW.selMode ? `<input type="checkbox" class="bpk" tabindex="-1" ${DVW.has(it.kind, it.code) ? 'checked' : ''} aria-label="Select ${esc(it.code)}">` : `<span class="dot" style="background:${it.col}"></span>`}<b>${esc(it.code)}</b>${(vi => (vi ? `<span class="bwarn" data-wk="${esc(it.kind + ':' + it.code)}" title="${vi.length} suspect value${vi.length > 1 ? 's' : ''} (${esc(vi[0].p)}: ${esc(vi[0].msg)}). Click: go to the cell">⚠ ${vi.length}</span>` : ''))(BR.tab !== 'set' && typeof valueIssues === 'function' ? valueIssues().get(it.kind + ':' + it.code) : null)}<span>${esc(it.name || '')}</span>${it.kind === 'tech' && typeof ONOFF !== 'undefined' && ONOFF[it.code] ? `<i class="oob" title="${esc(ooText(it.code))}">${ONOFF[it.code].off ? 'off' : 'years'}</i>` : ''}</button>`
                  )
                  .join('')
            )
            .join('')
        : `<div class="empty">${BR.q ? 'Nothing matches “' + esc(BR.q) + '”.' : 'None in this model.'}</div>`
    }</div>
    ${SELTAB() ? `<div class="brsel"><button class="btn sm${DVW.selMode ? ' pri' : ''}" type="button" id="brselm" title="Tick ${BR.tab === 'tech' ? 'technologies' : 'commodities'} (or a whole family by its header): show only them, or delete them">${DVW.selMode ? 'Done selecting' : 'Select'}</button>${DVW.selMode ? `<button class="btn sm" type="button" id="brselall" title="Select every row this list shows (use the filter above, e.g. PWR or LND)">All listed</button><button class="btn sm" type="button" id="brselnone">None</button>` : ''}${DVW.n() ? `<button class="btn sm pri" type="button" id="brshow">Show only these</button><button class="btn sm danger" type="button" id="brdel">Delete ${DVW.n()}…</button>` : ''}</div>` : ''}
    <div class="brf">${BR.tab === 'tech' ? `<span class="muted">${G.T.length} in the diagram${total > G.T.length ? ` · ${total - G.T.length} inactive (dimmed)` : ''}${DVW.view ? ' · part of the system' : ''}</span>` : ''}
      ${['stor', 'emi', 'udc'].includes(BR.tab) && typeof showSetup === 'function' ? `<button class="btn sm" type="button" id="brsetup" title="Every ${BR.tab === 'udc' ? 'constraint' : BR.tab === 'emi' ? 'emission' : 'storage'} with its whole configuration on one page (Model setup)">Overview of all</button>` : ''}<button class="btn sm" type="button" data-add="${{tech: 'tech', comm: 'comm', stor: 'stor', emi: 'emi', udc: 'udc'}[BR.tab] || 'glob'}">${BR.tab === 'set' ? 'Edit settings' : '+ Add'}</button></div>`;
  {
    const os = B.querySelector('#brsetup');
    if (os) os.onclick = () => showSetup(BR.tab);
  }
  B.querySelectorAll('.bwarn').forEach(
    w =>
      (w.onclick = ev => {
        ev.stopPropagation();
        ev.preventDefault();
        const x = (valueIssues().get(w.dataset.wk) || [])[0];
        if (x) goToCell(x.p, x.idx);
      })
  );
  B.querySelector('#brhide').onclick = () => {
    BR.show = false;
    brSave();
    renderBrowser();
    fit();
  };
  {
    const by = B.querySelector('#brby');
    if (by)
      by.onchange = () => {
        BR.by = by.value;
        brSave();
        renderBrowser();
      };
  }
  B.querySelectorAll('[data-tab]').forEach(
    b =>
      (b.onclick = () => {
        BR.tab = b.dataset.tab;
        BR.q = '';
        brSave();
        renderBrowser();
      })
  );
  const q = B.querySelector('#brq');
  q.oninput = () => {
    BR.q = q.value;
    renderBrowser();
  };
  if (keepFocus) {
    const nq = B.querySelector('#brq');
    nq.focus();
    try {
      nq.setSelectionRange(caret, caret);
    } catch (e) {}
  }
  B.querySelectorAll('.bri').forEach(
    b =>
      (b.onclick = ev => {
        if ((b.dataset.k === 'tech' || b.dataset.k === 'comm') && (DVW.selMode || ev.ctrlKey || ev.metaKey || ev.shiftKey)) {
          DVW.toggleItem(b.dataset.k, b.dataset.c);
          return renderBrowser();
        }
        brOpen(b.dataset.k, b.dataset.c);
      })
  );
  if (SELTAB()) {
    const kind = BR.tab,
      listed = groups.flatMap(g => g.items.filter(x => x.kind === kind).map(x => x.code));
    const bd = B.querySelector('#brdel');
    if (bd)
      bd.onclick = () => {
        DVW.del();
        renderBrowser();
      };
    const sm = B.querySelector('#brselm');
    if (sm)
      sm.onclick = () => {
        DVW.selMode = !DVW.selMode;
        renderBrowser();
      };
    const sa = B.querySelector('#brselall');
    if (sa)
      sa.onclick = () => {
        DVW.set(listed, true, kind);
        renderBrowser();
      };
    const sn = B.querySelector('#brselnone');
    if (sn)
      sn.onclick = () => {
        DVW.clear();
        renderBrowser();
      };
    const sh = B.querySelector('#brshow');
    if (sh)
      sh.onclick = () => {
        DVW.show(DVW.pick);
        DVW.selMode = false;
        renderBrowser();
      };
    if (DVW.selMode)
      B.querySelectorAll('.brg.selg').forEach(
        h =>
          (h.onclick = () => {
            const its = groups[+h.dataset.gi].items.map(x => x.code);
            DVW.set(its, !its.every(t => DVW.has(kind, t)), kind);
            renderBrowser();
          })
      );
  }
  B.querySelector('[data-add]').onclick = e => openEntity(e.target.dataset.add, null);
}
function brOpen(kind, code) {
  if (kind === 'tech') {
    brCenter('T:' + code);
    build.on ? openEntity('tech', code) : openTech(code);
  } else if (kind === 'comm') {
    openFuel(code);
  } else if (kind === 'stor' || kind === 'emi' || kind === 'udc') openEntity(kind, code);
  else if (kind === 'all') openEntity('all', null);
  else if (kind === 'model') openModels();
  else if (kind === 'scen') openScenarios();
  else openEntity('glob', null);
  markBrowser(kind, code);
}
function brCenter(key) {
  // bring a box into view (keeps the zoom unless it is very small)
  if (!G || !G.layout || !G.layout.x.has(key)) return;
  const st = document.getElementById('stage').getBoundingClientRect();
  if (!st.width) return;
  const x = G.layout.x.get(key) + BW / 2,
    y = G.layout.y.get(key) + BH / 2,
    sx = x * view.k + view.x,
    sy = y * view.k + view.y;
  if (sx > 40 && sx < st.width - 40 && sy > 40 && sy < st.height - 40) return;
  view.k = Math.max(view.k, 0.6);
  view.x = st.width / 2 - x * view.k;
  view.y = st.height / 2 - y * view.k;
  applyView();
}
function markBrowser(kind, code) {
  const sel = kind && code ? kind + ':' + code : null;
  const B = document.getElementById('mbrowser');
  if (!B) {
    BR.sel = sel;
    return;
  }
  if (sel === BR.sel && sel && B.querySelector('.bri.on')) return; // same item marked: no work (the scroll into view cost ~80 ms on a large model)
  BR.sel = sel;
  B.querySelectorAll('.bri').forEach(b => b.classList.toggle('on', BR.sel === b.dataset.k + ':' + b.dataset.c));
  const on = B.querySelector('.bri.on');
  if (on && on.scrollIntoViewIfNeeded) on.scrollIntoViewIfNeeded();
}
