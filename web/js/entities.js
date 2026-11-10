'use strict';
/* ---- entity editor: every parameter of one technology / commodity / storage / emission / UDC, or the model settings ---- */
const GROUP_OF = p =>
  (PD[p] || [
    /Storage/.test(p)
      ? 'Storage'
      : /UDC/.test(p)
        ? 'User constraints'
        : /Emission/.test(p)
          ? 'Emissions'
          : /Demand|Trade/.test(p)
            ? 'Demand and trade'
            : 'Other'
  ])[0];
function openEntity(kind, code) {
  if (code && (kind === 'tech' || kind === 'comm')) markBrowser(kind, code);
  const isNew = !code && kind !== 'glob' && kind !== 'all',
    ps = paramsFor(kind),
    regs = REG.length ? REG : ['RE1'];
  if (!EDIT || EDIT.kind !== kind || EDIT.code !== code) EDIT = {kind, code, oo: JSON.stringify(ONOFF), snap: editSnap(), changed: false};
  const dr = document.getElementById('drawer');
  dr.hidden = false;
  const dls = ['COMMODITY', 'EMISSION', 'STORAGE', 'UDC']
    .map(
      s =>
        `<datalist id="dl-${s}">${setOf(s)
          .map(m => `<option value="${esc(m)}">`)
          .join('')}</datalist>`
    )
    .join('');
  const groups = new Map();
  for (const p of ps) {
    const g = kind === 'glob' ? 'Model settings' : GROUP_OF(p);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(p);
  }
  const order = [
    'Conversion',
    'Costs',
    'Capacity',
    'Activity limits',
    'Performance',
    'Demand and trade',
    'Trade and prices',
    'Emissions',
    'Storage',
    'User constraints',
    'Vintaging',
    'Operation',
    'Water and land',
    'Finance',
    'Time',
    'Other',
    'Model settings'
  ];
  const CNT = new Map(); // records of each parameter for this entity, counted once
  const count = p => {
    if (CNT.has(p)) return CNT.get(p);
    const d = dimsOf(p),
      e = ENTSET[kind] ? d.indexOf(ENTSET[kind]) : -1;
    const n = isNew ? 0 : getRecs(p, []).filter(r => e < 0 || r.idx[e] === code).length;
    CNT.set(p, n);
    return n;
  };
  const used = p => {
    const u = pinfo(p).used || [];
    return u.length
      ? `used in ${u.length} constraint${u.length > 1 ? 's' : ''}: ${u.slice(0, 8).join(', ')}${u.length > 8 ? '…' : ''}`
      : pinfo(p).inferred
        ? 'not in the model file (kept from the data)'
        : 'not used by any constraint';
  };
  const head =
    kind === 'all'
      ? `<h2>All parameters</h2><p>Every parameter of the model file (${ps.length}), whatever it belongs to: budgets, finance, region or model-wide parameters, and those of technologies, commodities, storage, emissions and constraints. Search by name; open one to edit, paste, fill or export it.</p><input id="psearch" class="psearch" placeholder="Search a parameter…">`
      : kind === 'glob'
        ? `<h2>Model settings</h2><p>Sets and every parameter that belongs to no technology, commodity, storage, emission or constraint (time structure, discount rate…).</p>`
        : `<h2>${isNew ? 'Add ' + ENTNAME[kind] : esc(code)}</h2><p>${isNew ? 'Give the code, then fill its parameters.' : `All ${ps.length} parameters of a ${ENTNAME[kind]} declared by ${SCHEMA ? esc(SCHEMA.name) : 'the model'}; those with values are open. Grids work as in Excel: click a cell (or a row / column header) to select, type or double-click to edit, Ctrl+V pastes a block from Excel at the selected cell, Ctrl+D / Ctrl+R fill down / right, ⚠ marks a suspect value. A row can also be filled with <code>2025:900, 2050:500</code>. Empty = default.`}</p>`;
  const body = isNew
    ? `<form id="nf" class="frm"><div class="row2"><label>Code<input name="code" required pattern="[A-Za-z0-9_]+"></label><label>Description<input name="desc"></label></div>
      ${SYS_KIND(kind) ? (SYSTEMS.list.length ? `<label>System <span class="muted">(optional)</span>${sysSelect('nsys', '', false).replace('<select', '<select name="sys"')}</label>` : `<div class="hint">System (optional): none yet. You can create systems (energy, water, land use…) and assign them later. <button type="button" class="btn sm" id="nsysgo">Systems…</button></div>`) : ''}
      ${kind === 'comm' ? `<label>Colour<input type="color" name="col" value="#c98a00"></label>` : ''}${kind === 'tech' || kind === 'comm' ? `<div class="hint">Icon: chosen automatically from the code and description; change it in the form once created.</div>` : ''}<div class="acts"><button class="btn pri" type="submit">Create</button></div></form>`
    : `${kind === 'all' ? '' : kind === 'glob' ? setsEditor() : `<div class="row2 frm" style="display:grid"><label>Description<input id="edesc" value="${esc((kind === 'tech' ? TD : FD)[code] || '')}"></label>${SYS_KIND(kind) && SYSTEMS.list.length ? `<label>System${sysSelect('esys', SYSTEMS.of(code, ENTSET[kind]), false).replace('<select', '<select id="esys"')}</label>` : ''}${kind === 'comm' ? `<label>Colour<input type="color" id="ecol" value="${COLORS[code] || '#c98a00'}"></label>` : '<span></span>'}</div>${entUnitsRow(kind, code)}${kind === 'tech' && code ? onoffRow(code) : ''}${kind === 'tech' || kind === 'comm' || kind === 'stor' ? iconPicker(code, kind) : ''}`}
      ${[...groups.entries()]
        .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
        .map(
          ([g, list]) =>
            `<details class="tgrp" data-g="${esc(g)}" style="--tc:${TOPICS.color(g)}" ${list.some(p => count(p)) || kind === 'glob' || !ps.some(p => count(p)) ? 'open' : ''}><summary><span class="tdot"></span>${g}<input type="color" class="tcol" data-g="${esc(g)}" value="${TOPICS.color(g)}" title="Colour of the topic ${esc(g)} (for you only)"><span class="n">${list.filter(p => count(p)).length} / ${list.length} with values</span></summary>${list
              .sort((a, b) => (count(b) > 0) - (count(a) > 0) || a.localeCompare(b))
              .map(p => {
                const d = dimsOf(p);
                return `<details class="pblk" data-p="${p}" style="--pc:${TOPICS.pcolor(p, g)}" ${count(p) ? 'open' : ''}><summary><b>${p}</b><button type="button" class="pinfo" data-p="${p}" title="What it is, where it acts, its page in the reference" aria-label="About ${p}">ⓘ</button> <span class="muted">[${d.map(x => x.replace('MODE_OF_OPERATION', 'MODE').toLowerCase()).join(', ')}] · default ${defOf(p)}${(u => (u ? ` · <span class="punit" title="unit (from the units of this ${ENTNAME[kind] || 'model'}; Units page)">${esc(u)}</span>` : ''))(paramUnitFor(p, kind, code))}${count(p) ? ' · ' + count(p) + ' values' : ''}</span></summary>
          <div class="pdesc">${esc((PD[p] || ['', ''])[1] || pinfo(p).doc || '')} <span class="muted">${esc(used(p))}</span></div>
          <div class="ptools">${d.includes('REGION') ? `<label>Region <select class="preg">${regs.map(r => `<option ${r === (REG.includes(state.region) ? state.region : regs[0]) ? 'selected' : ''}>${r}</option>`).join('')}</select></label>` : ''}
            <label class="pcl" title="Colour of this parameter (for you only)">Colour <input type="color" class="pcol" data-p="${p}" value="${TOPICS.pcolor(p, g)}"></label><button type="button" class="btn ccsv">Copy (Excel)</button><button type="button" class="btn cpst" title="Paste a table copied from Excel (with or without its labels)">Paste</button><button type="button" class="btn cexp">Export CSV</button>${kind === 'all' && typeof batchEntity === 'function' && batchEntity(p) ? `<button type="button" class="btn cbat" title="Give values to several ${batchPl(batchEntity(p), 2)} at once (e.g. a capital cost for a list of technologies, demands for several commodities)">Set for several…</button>` : ''}${d.includes('REGION') && regs.length > 1 ? `<button type="button" class="btn creg">Copy to all regions</button>` : ''}</div><div class="ghost"></div></details>`;
              })
              .join('')}</details>`
        )
        .join('')}`;
  dr.innerHTML = `<div class="dh"><div style="min-width:0"><div class="code">build · ${ENTNAME[kind]}${code ? ' · ' + esc(code) : ''}</div>${head}</div><div class="acts">${!isNew && code && ENTSET[kind] ? '<button class="btn" type="button" id="eren" title="Change the code everywhere in the model">Rename</button><button class="btn danger" type="button" id="edel2" title="Delete it and all its data">Delete</button>' : ''}${!isNew ? '<button class="btn pri" type="button" id="esave">Apply</button><button class="btn" type="button" id="ecancel">Undo changes</button>' : ''}<button class="btn x" type="button" id="close">Close</button></div></div>
    <div class="db">${dls}${isNew ? '' : '<div class="tbar"><button type="button" class="btn sm" id="xall">Expand all</button><button type="button" class="btn sm" id="call">Collapse all</button><button type="button" class="btn sm" id="rcol" title="Back to the default colours of the topics">Reset colours</button></div>'}${body}${!isNew && kind !== 'glob' && kind !== 'all' ? `<div class="acts" style="margin-top:12px"><button class="btn danger" type="button" id="edel">Delete ${ENTNAME[kind]} ${esc(code)}</button></div>` : ''}</div>`;
  const close = () => {
    if (EDIT && EDIT.changed) afterEdit('Changes applied');
    EDIT = null;
    dr.hidden = true;
  };
  setTimeout(() => {
    if (typeof edBadges === 'function') edBadges();
  }, 0); // ⚠ n on the parameters and topics with suspect values
  // topics: expand / collapse all, colours of a topic or of one parameter (kept in this browser)
  const xa = dr.querySelector('#xall');
  if (xa) {
    xa.onclick = () => dr.querySelectorAll('details.tgrp, details.pblk').forEach(d => (d.open = true));
    dr.querySelector('#call').onclick = () => dr.querySelectorAll('details.tgrp, details.pblk').forEach(d => (d.open = false));
    dr.querySelector('#rcol').onclick = () => {
      TOPICS.reset();
      EDIT.keepScroll = true;
      openEntity(kind, code);
      toast('Default colours');
    };
  }
  dr.querySelectorAll('input.tcol').forEach(c => {
    c.onclick = ev => ev.stopPropagation();
    c.oninput = () => {
      TOPICS.t[c.dataset.g] = c.value;
      TOPICS.save();
      const gd = c.closest('details.tgrp');
      gd.style.setProperty('--tc', c.value);
      gd.querySelectorAll('details.pblk').forEach(b => {
        if (!TOPICS.p[b.dataset.p]) {
          b.style.setProperty('--pc', c.value);
          const pc = b.querySelector('input.pcol');
          if (pc) pc.value = c.value;
        }
      });
    };
  });
  dr.querySelectorAll('input.pcol').forEach(c => {
    c.oninput = () => {
      TOPICS.p[c.dataset.p] = c.value;
      TOPICS.save();
      c.closest('details.pblk').style.setProperty('--pc', c.value);
    };
  });
  dr.querySelector('#close').onclick = close;
  if (isNew) {
    const sg = dr.querySelector('#nsysgo');
    if (sg) sg.onclick = () => openSystems();
    dr.querySelector('#nf').onsubmit = ev => {
      ev.preventDefault();
      const fd = new FormData(ev.target),
        c = String(fd.get('code')).trim().toUpperCase();
      // the system is optional (it can be given later, on the item or on the Systems page)
      if (setOf(ENTSET[kind]).includes(c)) {
        toast(`${c} already exists: here it is`);
        EDIT = null;
        return openEntity(kind, c);
      }
      if (kind === 'comm') addComm(c);
      else addSet(ENTSET[kind], c);
      const ds = String(fd.get('desc') || '').trim();
      if (ds) (kind === 'tech' ? TD : FD)[c] = ds;
      if (kind === 'comm') COLORS[c] = fd.get('col');
      if (SYS_KIND(kind) && fd.get('sys')) SYSTEMS.set(ENTSET[kind], c, String(fd.get('sys')));
      EDIT = null;
      afterEdit(`${ENTNAME[kind]} ${c} created`);
      openEntity(kind, c);
    };
    return;
  }
  const ern = dr.querySelector('#eren');
  if (ern)
    ern.onclick = () => {
      saveMeta();
      renameForm(ENTSET[kind], code, nb => {
        EDIT = null;
        openEntity(kind, nb);
      });
    };
  dr.querySelector('#esave').onclick = () => {
    saveMeta();
    EDIT.changed = false;
    afterEdit('Applied');
    openEntity(kind, code);
  };
  dr.querySelector('#ecancel').onclick = () => {
    const s = EDIT.snap;
    M.D.sets = s.sets;
    M.D.params = s.params;
    if (EDIT.oo) ONOFF = JSON.parse(EDIT.oo);
    EDIT = null;
    afterEdit('Changes undone');
    if (kind === 'glob' || setOf(ENTSET[kind]).includes(code)) openEntity(kind, code);
    else dr.hidden = true;
  };
  dr.querySelectorAll('#edel, #edel2').forEach(
    de =>
      (de.onclick = async () => {
        if (!await uiConfirm(`Delete ${code} and all its data?`)) return;
        if (typeof SETUP !== 'undefined') SETUP.undo = {text: writeData(), meta: {...M.meta}, what: `${ENTNAME[kind] || kind} ${code}`};
        deleteEntity(kind, code);
        EDIT = null;
        dr.hidden = true;
        afterEdit(`${code} deleted`);
      })
  );
  function saveMeta() {
    const ds = dr.querySelector('#edesc');
    if (ds) {
      const v = ds.value.trim();
      if (v) (kind === 'tech' ? TD : FD)[code] = v;
      else delete (kind === 'tech' ? TD : FD)[code];
    }
    const c = dr.querySelector('#ecol');
    if (c) COLORS[code] = c.value;
  }
  dr.querySelectorAll('#edesc,#ecol').forEach(
    x =>
      (x.onchange = () => {
        saveMeta();
        EDIT.changed = true;
      })
  );
  {
    const es = dr.querySelector('#esys');
    if (es)
      es.onchange = () => {
        SYSTEMS.set(ENTSET[kind], code, es.value);
        EDIT.changed = true;
        toast(`${code}: system ${SYSTEMS.name(es.value) || 'none'}`);
      };
  }
  wireIconPicker(dr, () => {
    EDIT.changed = true;
    draw();
  });
  wireOnoff(dr, code, () => {
    EDIT.changed = false;
    openEntity(kind, code);
  });
  wireUnitSelects(dr, (sl, v) => {
    const k = sl.dataset.ek;
    if (kind === 'tech') UNITS.tech[code] = {cap: techCap(code), act: techAct(code), ...(UNITS.tech[code] || {}), [k]: v};
    else UNITS[kind === 'emi' ? 'emis' : kind][code] = v;
    EDIT.changed = true;
    dr.querySelectorAll('.pblk[data-p]').forEach(b => {
      const u = paramUnitFor(b.dataset.p, kind, code),
        el = b.querySelector('.punit');
      if (el) el.textContent = u;
    });
    toast(`${code}: ${k === 'cap' ? 'capacity' : k === 'act' ? 'activity' : ''} unit ${unitName(v)}`);
  });
  // grids are drawn when they are needed: the first ones at once (about 4000 cells), the others when they come into view
  // (the "All parameters" editor of a large model has ~49,000 cells: drawing them all took 4.4 s)
  let budget = 1500; // fewer cells drawn at once (the rest when they come into view): the editor opens faster
  // this declaration had been joined to the comment above: lazy was undefined and, on a large model, the editor stopped
  // before the search box (All parameters) and the remaining buttons were connected
  const lazy =
    'IntersectionObserver' in window
      ? new IntersectionObserver(
          es =>
            es.forEach(e => {
              const h = e.target.querySelector('.ghost');
              if (e.isIntersecting && e.target._render && (!h.innerHTML || h.dataset.lazy)) {
                delete h.dataset.lazy;
                e.target._render();
                lazy.unobserve(e.target);
              }
            }),
          {root: dr.querySelector('.db') || null, rootMargin: '600px'}
        )
      : null;
  dr.querySelectorAll('.pblk[data-p]').forEach(b => {
    const p = b.dataset.p,
      host = b.querySelector('.ghost'),
      rs = b.querySelector('.preg');
    const render = () => {
      const g = gridFor(p, kind, code, rs ? rs.value : null, host);
      return g ? g.rows.length * g.cols.length : 0;
    };
    b._render = render;
    if (b.open) {
      if (budget > 0 || !lazy) budget -= render();
      else {
        host.innerHTML = `<div class="muted" style="padding:6px;height:${Math.min(460, 60 + 27 * Math.ceil(count(p) / Math.max(1, M.years.length)))}px">…</div>`;
        host.dataset.lazy = '1';
        lazy.observe(b);
      }
    }
    // a <details> written open fires one 'toggle' after it is inserted: only a real change of state draws the grid
    b._st = b.open;
    b.addEventListener('toggle', () => {
      if (b.open === b._st) return;
      b._st = b.open;
      if (b.open && (!host.innerHTML || host.dataset.lazy)) {
        delete host.dataset.lazy;
        render();
      }
    });
    if (rs) rs.onchange = render;
    b.querySelector('.cpst').onclick = async () => {
      if (!host.innerHTML || host.dataset.lazy) {
        delete host.dataset.lazy;
        render();
      }
      try {
        const t = await navigator.clipboard.readText();
        const n = host.pasteTable(t, null);
        toast(`Pasted ${n} values into ${p}`);
      } catch (e) {
        toast('Clipboard not readable here: click a cell and press Ctrl+V');
      }
    };
    b.querySelector('.cexp').onclick = () => {
      if (!host.innerHTML || host.dataset.lazy) {
        delete host.dataset.lazy;
        render();
      }
      saveFile(
        `${p}${code ? '_' + code : ''}${rs ? '_' + rs.value : ''}.csv`,
        gridTSV(host)
          .split('\n')
          .map(l =>
            l
              .split('\t')
              .map(v => (/[",]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v))
              .join(',')
          )
          .join('\n'),
        'text/csv'
      );
    };
    b.querySelector('.ccsv').onclick = () => {
      if (!host.innerHTML || host.dataset.lazy) {
        delete host.dataset.lazy;
        render();
      }
      const t = gridTSV(host);
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject())
        .then(() => toast(`${p} copied: paste it in Excel`))
        .catch(() => toast('Copy not allowed here'));
    };
    {
      const cb = b.querySelector('.cbat');
      if (cb)
        cb.onclick = () => {
          b.open = true;
          batchForm(p, b, () => {
            delete host.dataset.lazy;
            render();
          });
        };
    }
    const cr = b.querySelector('.creg');
    if (cr)
      cr.onclick = () => {
        const r0 = rs.value,
          d = dimsOf(p),
          rp = d.indexOf('REGION'),
          ep = ENTSET[kind] ? d.indexOf(ENTSET[kind]) : -1;
        const src = getRecs(p, []).filter(r => r.idx[rp] === r0 && (ep < 0 || r.idx[ep] === code));
        for (const r of REG)
          if (r !== r0) {
            for (const x of getRecs(p, []).filter(x => x.idx[rp] === r && (ep < 0 || x.idx[ep] === code))) cellSet(p, x.idx, null);
            for (const x of src) {
              const i = [...x.idx];
              i[rp] = r;
              cellSet(p, i, x.v);
            }
          }
        EDIT.changed = true;
        toast(`${p} of ${r0} copied to ${REG.length - 1} other region(s)`);
      };
  });
  wireSets(dr);
  // search by name or description (several words: all must match); topics without a match are hidden, the others opened
  const ps0 = dr.querySelector('#psearch');
  if (ps0) {
    const pn = document.createElement('div');
    pn.className = 'muted psn';
    ps0.after(pn);
    const run = () => {
      const ws = ps0.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      let n = 0;
      dr.querySelectorAll('.pblk[data-p]').forEach(b => {
        const p = b.dataset.p,
          txt = (p + ' ' + ((PD[p] || ['', ''])[1] || pinfo(p).doc || '')).toLowerCase();
        const hit = !ws.length || ws.every(w => txt.includes(w));
        b.hidden = !hit;
        if (hit) n++;
      });
      dr.querySelectorAll('details.tgrp').forEach(g => {
        const any = g.querySelector('.pblk[data-p]:not([hidden])');
        g.hidden = !any;
        if (ws.length && any) g.open = true;
      });
      pn.textContent = ws.length ? `${n} parameter${n === 1 ? '' : 's'} found` : '';
    };
    ps0.oninput = run;
    ps0.onkeydown = ev => {
      if (ev.key === 'Escape') {
        ps0.value = '';
        run();
      }
    };
    setTimeout(() => ps0.focus(), 0);
  }
}
// the data when an editor opens (Undo changes, the cells changed since then): a copy of the records, ~10x faster than
// the JSON text of the whole model it replaced (a large model: an editor opened in 1-2 s)
function editSnap() {
  return {
    sets: Object.fromEntries(Object.entries(M.D.sets).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v])),
    params: Object.fromEntries(
      Object.entries(M.D.params).map(([k, v]) => [k, {name: v.name, def: v.def, recs: v.recs.map(r => ({idx: [...r.idx], v: r.v}))}])
    )
  };
}
function deleteEntity(kind, code) {
  const sn = ENTSET[kind];
  if (sn === 'COMMODITY') {
    const S = cset();
    S.splice(S.indexOf(code), 1);
  } else M.D.sets[sn] = (M.D.sets[sn] || []).filter(x => x !== code);
  if (kind === 'stor')
    for (const n of ['STORAGEINTRADAY', 'STORAGEINTRAYEAR']) if (M.D.sets[n]) M.D.sets[n] = M.D.sets[n].filter(x => x !== code);
  for (const p of Object.keys(M.D.params)) {
    const d = dimsOf(p),
      pos = d.map((x, i) => (x === sn ? i : -1)).filter(i => i >= 0);
    if (!pos.length) continue;
    const P = M.D.params[p];
    P.recs = P.recs.filter(r => !pos.some(i => r.idx[i] === code));
    P._map = null;
  }
  delete TD[code];
  delete FD[code];
  delete COLORS[code];
  delete ICONS[code];
  if (kind === 'tech') delete ONOFF[code];
  if (ENTSET[kind]) SYSTEMS.set(ENTSET[kind], code, '');
}
/* sets editor (model settings) */
function setsEditor() {
  const base = SCHEMA ? [...SCHEMA.sets, ...SCHEMA.optSets] : Object.keys(M.D.sets);
  const show = [...new Set(base.map(n => (n === 'FUEL' ? 'COMMODITY' : n)))];
  return `<details open><summary>Sets<span class="n">${show.length}</span></summary><div class="pdesc">Members separated by spaces. Removing a member deletes its data. Technologies, commodities, storage, emissions and constraints are also added with the Build buttons.</div>
    <div class="frm" id="setsf">${show.map(n => `<label>${n}${n === 'YEAR' ? ' <span class="muted">(or a range: 2025-2050)</span>' : ''}<input data-set="${n}" value="${esc(setOf(n).join(' '))}"></label>`).join('')}
    <div class="acts"><button type="button" class="btn pri" id="setsapply">Apply sets</button></div>
    <div class="row2 frm" style="display:grid;margin-top:8px"><label>Rename a member of<select id="rnset">${show
      .filter(n => setOf(n).length)
      .map(n => `<option>${n}</option>`)
      .join('')}</select></label><label>Member<select id="rnmem"></select></label></div>
    <div class="acts"><button type="button" class="btn" id="rnbtn">Rename…</button><span class="hint">Changes the code everywhere (parameters, names, units, scenarios); editing the list above would delete its data instead.</span></div></div></details>
    <details open><summary>Names of set members<span class="n">seasons, day parts, time slices, modes, regions…</span></summary>
    <div class="pdesc">Give each member a name (e.g. season 1 = Winter, day part 2 = Night, mode 2 = Discharge). Names appear in the grids and the panels and are saved in the file (comment lines #@setdesc). Region names replace the codes in the panels.</div>
    <div class="acts"><button type="button" class="btn" id="tsname">Name the time slices from their season and day part</button></div>
    ${[
      'REGION',
      'SEASON',
      'DAYTYPE',
      'DAILYTIMEBRACKET',
      'TIMESLICE',
      'MODE_OF_OPERATION',
      'STORAGE',
      'EMISSION',
      'UDC',
      ...Object.keys(M.D.sets).filter(
        n =>
          ![
            'REGION',
            'SEASON',
            'DAYTYPE',
            'DAILYTIMEBRACKET',
            'TIMESLICE',
            'MODE_OF_OPERATION',
            'STORAGE',
            'EMISSION',
            'UDC',
            'TECHNOLOGY',
            'COMMODITY',
            'FUEL',
            'YEAR'
          ].includes(n)
      )
    ]
      .filter(n => setOf(n).length && setOf(n).length <= 400)
      .map(
        n => `<details class="pblk sdblk" ${['SEASON', 'DAILYTIMEBRACKET', 'TIMESLICE'].includes(n) ? 'open' : ''}><summary><b>${n}</b> <span class="muted">${setOf(n).length} members · ${Object.values(SETDESC[n] || {}).filter(Boolean).length} named</span></summary>
        <div class="gw"><table class="grid sd"><tbody>${setOf(n)
          .map(
            m =>
              `<tr><td class="k">${esc(m)}</td><td><input class="sdi" data-set="${n}" data-m="${esc(m)}" value="${esc(sdesc(n, String(m)))}" placeholder="Name"></td></tr>`
          )
          .join('')}</tbody></table></div></details>`
      )
      .join('')}
    </details>`;
}
function wireSets(dr) {
  const rs = dr.querySelector('#rnset'),
    rm = dr.querySelector('#rnmem');
  if (rs) {
    const fill = () => {
      rm.innerHTML = setOf(rs.value)
        .map(m => `<option>${esc(m)}</option>`)
        .join('');
    };
    fill();
    rs.onchange = fill;
    dr.querySelector('#rnbtn').onclick = () => {
      if (!rm.value) return;
      renameForm(rs.value, rm.value, () => {
        EDIT = null;
        openEntity('glob');
      });
    };
  }
  dr.querySelectorAll('input.sdi').forEach(
    i =>
      (i.onchange = () => {
        const n = i.dataset.set;
        (SETDESC[n] = SETDESC[n] || {})[i.dataset.m] = i.value.trim();
        if (!i.value.trim()) delete SETDESC[n][i.dataset.m];
        if (EDIT) EDIT.changed = true;
      })
  );
  const tn = dr.querySelector('#tsname');
  if (tn)
    tn.onclick = () => {
      let n = 0;
      for (const l of setOf('TIMESLICE').map(String)) {
        const part = (pp, sn) => {
          const x = getRecs(pp, [l]).find(r => r.v);
          return x ? sdesc(sn, String(x.idx[1])) || `${sn.toLowerCase()} ${x.idx[1]}` : '';
        };
        const name = [
          part('Conversionls', 'SEASON'),
          setOf('DAYTYPE').length > 1 ? part('Conversionld', 'DAYTYPE') : '',
          part('Conversionlh', 'DAILYTIMEBRACKET')
        ]
          .filter(Boolean)
          .join(' · ');
        if (name) {
          (SETDESC.TIMESLICE = SETDESC.TIMESLICE || {})[l] = name;
          n++;
        }
      }
      if (EDIT) EDIT.changed = true;
      toast(`${n} time slices named`);
      afterEdit();
      openEntity('glob');
    };
  const b = dr.querySelector('#setsapply');
  if (!b) return;
  b.onclick = async () => {
    let removed = [];
    for (const inp of dr.querySelectorAll('#setsf input')) {
      const n = inp.dataset.set;
      let v = inp.value.trim();
      if (n === 'YEAR' && /^\d{4}\s*-\s*\d{4}$/.test(v)) {
        const [a, c] = v.split('-').map(Number);
        v = Array.from({length: c - a + 1}, (_, i) => String(a + i)).join(' ');
      }
      const nw = v.split(/[\s,]+/).filter(Boolean),
        old = setOf(n).map(String),
        gone = old.filter(x => !nw.includes(x));
      if (gone.length) removed.push(...gone.map(x => [n, x]));
      if (n === 'COMMODITY') {
        const S = cset();
        S.splice(0, S.length, ...nw);
      } else M.D.sets[n] = nw;
    }
    if (
      removed.length &&
      !await uiConfirm(
        `Remove ${removed.length} member(s) and their data (${removed
          .slice(0, 6)
          .map(x => x[1])
          .join(', ')}${removed.length > 6 ? '…' : ''})?`
      )
    ) {
      const s = EDIT.snap;
      M.D.sets = JSON.parse(JSON.stringify(s.sets));
      return openEntity('glob');
    }
    for (const [n, x] of removed)
      for (const p of Object.keys(M.D.params)) {
        const d = dimsOf(p),
          pos = d.map((s, i) => (s === n ? i : -1)).filter(i => i >= 0);
        if (!pos.length) continue;
        const P = M.D.params[p];
        P.recs = P.recs.filter(r => !pos.some(i => String(r.idx[i]) === String(x)));
        P._map = null;
      }
    EDIT.changed = true;
    afterEdit('Sets applied');
    openEntity('glob');
  };
}

/* ---- new model ---- */
/* ---- new model (seasons x day types x day parts) ----
   Time slice codes S<season>[D<day type>][B<day part>] (letters between the numbers: S1 and S10 can never be confused; the
   old S<season><day part> made season 10 of S101 read as season 1). YearSplit = share of the season's days x days of the
   day type per week / 7 x hours of the day part / 24; DaySplit = hours / 8760; DaysInDayType = days per week; with the
   master model also the order of the slices (TimesliceGroup = season x day type, TimesliceOrder = day part, hours). */
const TPRESET = {
  custom: null,
  s4: {seas: 'Winter, Spring, Summer, Autumn', days: '90, 92, 92, 91'}, // December-February, March-May, June-August, September-November
  m12jan: {seas: 'Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec', days: '31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31'},
  m12sep: {seas: 'Sep, Oct, Nov, Dec, Jan, Feb, Mar, Apr, May, Jun, Jul, Aug', days: '30, 31, 30, 31, 31, 28, 31, 30, 31, 30, 31, 31'},
  y1: {seas: 'Year', days: '365'}
};
function timeStructure(f) {
  const list = x =>
      String(x || '')
        .split(',')
        .map(t => t.trim())
        .filter(Boolean),
    nums = x => list(x).map(Number);
  const sn = list(f.seas),
    sd = nums(f.sdays),
    dn = list(f.dt),
    dw = nums(f.dtw),
    bn = list(f.dp),
    bh = nums(f.dph);
  // the hours
  // of the day parts can differ by season (f.byseas, fields h_<season>_<part>); otherwise the same hours all year
  const bhs = sn.map((_, i) => (f.byseas ? bn.map((_, k) => Number(f[`h_${i}_${k}`])) : bh));
  const err = [];
  if (!sn.length) err.push('give at least one season');
  if (sd.length !== sn.length || sd.some(v => !(v > 0))) err.push(`days per season: ${sn.length} positive numbers`);
  if (!dn.length) err.push('give at least one day type');
  if (dw.length !== dn.length || dw.some(v => !(v > 0))) err.push(`days per week: ${dn.length} positive numbers`);
  const W = dw.reduce((a, v) => a + v, 0);
  if (Math.abs(W - 7) > 1e-9) err.push(`the days per week of the day types add up to ${W}, not 7`);
  if (!bn.length) err.push('give at least one day part');
  if (!f.byseas) {
    if (bh.length !== bn.length || bh.some(v => !(v > 0))) err.push(`hours: ${bn.length} positive numbers`);
    const H = bh.reduce((a, v) => a + v, 0);
    if (Math.abs(H - 24) > 1e-9) err.push(`the hours of the day parts add up to ${H}, not 24`);
  } else
    bhs.forEach((row, i) => {
      if (row.some(v => !(v > 0))) err.push(`${sn[i]}: give the hours of every day part`);
      else {
        const H = row.reduce((a, v) => a + v, 0);
        if (Math.abs(H - 24) > 1e-6) err.push(`${sn[i]}: the hours add up to ${+H.toFixed(3)}, not 24`);
      }
    });
  if (err.length) return {err};
  const D = sd.reduce((a, v) => a + v, 0),
    ts = [];
  sn.forEach((_, i) =>
    dn.forEach((_, j) =>
      bn.forEach((_, k) =>
        ts.push({
          l: `S${i + 1}` + (dn.length > 1 ? `D${j + 1}` : '') + (bn.length > 1 ? `B${k + 1}` : ''),
          s: String(i + 1),
          d: String(j + 1),
          b: String(k + 1),
          share: ((((sd[i] / D) * dw[j]) / 7) * bhs[i][k]) / 24,
          hours: bhs[i][k],
          days: (sd[i] * dw[j]) / 7,
          group: i * dn.length + j + 1,
          order: k + 1,
          name: [sn[i], dn.length > 1 ? dn[j] : '', bn.length > 1 ? bn[k] : ''].filter(Boolean).join(' · ')
        })
      )
    )
  );
  // DaySplit (one value per day part in OSeMOSYS) = the hours of the part averaged over the days of the year
  const dsplit = bn.map((_, k) => sn.reduce((a, _, i) => a + sd[i] * bhs[i][k], 0) / D);
  return {sn, sd, dn, dw, bn, bh, bhs, ts, days: D, dsplit, byseas: !!f.byseas};
}
function openNewModel() {
  const dr = document.getElementById('drawer');
  dr.hidden = false;
  dr.innerHTML = `<div class="dh"><div><div class="code">build · model file: ${esc(SCHEMA ? SCHEMA.name : BUILTIN_NAME)}</div><h2>New model</h2><p>Sets and time structure. Then add commodities, technologies, storage, emissions and constraints with the Build bar.</p></div><div class="acts"><button class="btn x" type="button" id="close">Close</button></div></div>
  <div class="db"><form id="nm" class="frm">
   <label>Model file (the model is built inside it)<select name="mf" id="nmmf"><option value="${esc(curModelId() || '_muio54')}">${esc(SCHEMA ? SCHEMA.name : BUILTIN_NAME)}</option></select></label>
   <label>Name<input name="name" value="my_model" required></label>
   <label>Regions (codes, comma separated)<input name="reg" value="RE1" required></label>
   <div class="row2"><label>First year<input name="y0" type="number" value="2025" required></label><label>Last year<input name="y1" type="number" value="2050" required></label></div>
   <fieldset class="tsf"><legend>Time slices = seasons × day types × day parts</legend>
    <label>Start from<select name="pre" id="nmpre"><option value="s4">4 seasons</option><option value="m12jan">12 months, January first</option><option value="m12sep">12 months, September first (hydrological year)</option><option value="y1">1 season (the year)</option><option value="custom">My own</option></select></label>
    <div class="row2"><label>Seasons (names, comma separated)<input name="seas" value="Winter, Spring, Summer, Autumn"></label><label>Days of each season<input name="sdays" value="90, 92, 92, 91"></label></div>
    <div class="row2"><label>Day types (e.g. Weekday, Weekend)<input name="dt" value="All days"></label><label>Days per week of each, in the same order (Weekday, Weekend: 5, 2)<input name="dtw" value="7"></label></div>
    <p class="hint">A day type is a kind of day that repeats every week: its days per week say how much of each season it covers (5 / 7 of the days are weekdays). One day type "All days" with 7 is the usual choice.</p>
    <div class="row2"><label>Day parts (daily time brackets, e.g. Day, Night)<input name="dp" value="Day, Night"></label><label class="nmsame">Hours of each (add up to 24, e.g. 12, 12)<input name="dph" value="12, 12"></label></div>
    <label class="chk"><input type="checkbox" name="byseas" id="nmbys"> The hours of the day parts change with the season (a summer day is longer than a winter day)</label>
    <div id="nmhrs" hidden></div>
    ${SCHEMA && SCHEMA.params && SCHEMA.params.has && SCHEMA.params.has('TimesliceGroup') ? '<label class="chk"><input type="checkbox" name="ord" checked> also the order of the slices (TimesliceGroup = season × day type, TimesliceOrder = day part, TimesliceHours): needed by chronological storage and unit commitment</label>' : ''}
    <div class="nmprev" id="nmprev"></div></fieldset>
   <div class="row2"><label>Modes of operation<input name="nm" type="number" min="1" value="2" required></label><label>Discount rate<input name="dr" type="number" step="any" value="0.05" required></label></div>
   <label>Emissions (comma separated, may be empty)<input name="emi" value="CO2"></label>
   <button class="btn pri" type="submit">Create model</button></form></div>`;
  dr.querySelector('#close').onclick = () => (dr.hidden = true);
  MODELS.load()
    .then(L => {
      const s = dr.querySelector('#nmmf');
      if (!s) return;
      const cur = curModelId();
      s.innerHTML = L.map(
        m =>
          `<option value="${esc(m.id)}" ${m.id === cur ? 'selected' : ''}>${esc(m.name || m.id)}${m.description ? ' — ' + esc(m.description) : ''}</option>`
      ).join('');
    })
    .catch(() => {});
  const fm = dr.querySelector('#nm'),
    pv = dr.querySelector('#nmprev');
  const L_ = x =>
      String(x || '')
        .split(',')
        .map(t => t.trim())
        .filter(Boolean),
    hrs = dr.querySelector('#nmhrs');
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MSTART = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
  // the hours of each day part in each season
  const drawHours = () => {
    const on = fm.byseas.checked;
    hrs.hidden = !on;
    fm.dph.disabled = on;
    if (!on) return;
    const sn = L_(fm.seas.value),
      bn = L_(fm.dp.value),
      base = L_(fm.dph.value).map(Number);
    const old = {};
    hrs.querySelectorAll('input[name^="h_"]').forEach(i => (old[i.name] = i.value));
    // 4 seasons of 90, 92, 92, 91 days = December-February, March-May, June-August, September-November
    const st = fm.querySelector('#nmstart') ? fm.querySelector('#nmstart').value : fm.pre.value === 'm12sep' ? '8' : fm.pre.value === 's4' ? '11' : '0';
    const lat = fm.querySelector('#nmlat') ? fm.querySelector('#nmlat').value : ''; // no place by default: each user gives his own
    hrs.innerHTML = `<div class="tw"><table class="asktab nmh"><thead><tr><th>Season</th>${bn.map(b => `<th class="n">${esc(b)} (h)</th>`).join('')}<th class="n">Total</th></tr></thead><tbody>
      ${sn
        .map(
          (n, i) =>
            `<tr><td data-notr>${esc(n)}</td>${bn
              .map((_, k) => {
                const nm = `h_${i}_${k}`;
                return `<td class="n"><input name="${nm}" type="number" step="any" min="0" max="24" value="${esc(old[nm] ?? (base[k] > 0 ? base[k] : +(24 / bn.length).toFixed(2)))}"></td>`;
              })
              .join('')}<td class="n nmht" data-i="${i}"></td></tr>`
        )
        .join('')}</tbody></table></div>
      ${
        bn.length === 2
          ? `<div class="row2 nmlat"><label>Latitude of your region (°, north positive)<input id="nmlat" type="number" step="any" min="-90" max="90" placeholder="e.g. 36.4" value="${esc(lat)}"></label><label>The first season starts in<select id="nmstart">${MONTHS.map((m, i) => `<option value="${i}"${String(i) === st ? ' selected' : ''}>${m}</option>`).join('')}</select></label></div>
      <button type="button" class="btn" id="nmlatgo">${esc(bn[0])} and ${esc(bn[1])} hours from the latitude</button>
      <p class="hint">The length of the day in the middle of each season (sunrise to sunset), for the first day part; the second gets the rest of the 24 hours. You can change any value afterwards.</p>`
          : ''
      }`;
    const sums = () =>
      hrs.querySelectorAll('.nmht').forEach(td => {
        const i = td.dataset.i,
          t = [...hrs.querySelectorAll(`input[name^="h_${i}_"]`)].reduce((a, x) => a + (+x.value || 0), 0);
        td.textContent = +t.toFixed(2);
        td.classList.toggle('bad', Math.abs(t - 24) > 1e-6);
      });
    sums();
    hrs.oninput = () => (sums(), preview());
    const go = hrs.querySelector('#nmlatgo');
    if (go)
      go.onclick = () => {
        const lv = hrs.querySelector('#nmlat').value;
        if (lv === '' || isNaN(+lv) || Math.abs(+lv) > 90) return toast('Give the latitude of your region (from -90 to 90)');
        const phi = (+lv * Math.PI) / 180,
          start = MSTART[+hrs.querySelector('#nmstart').value],
          sd = L_(fm.sdays.value).map(Number),
          D = sd.reduce((a, v) => a + v, 0) || 365;
        let c = 0;
        sd.forEach((d, i) => {
          const n = ((start - 1 + ((c + d / 2) * 365) / D) % 365) + 1; // the middle day of the season
          c += d;
          const del = ((23.44 * Math.PI) / 180) * Math.sin((2 * Math.PI * (284 + n)) / 365);
          const w = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(del))));
          const day = +((2 * w * 180) / Math.PI / 15).toFixed(1);
          const a = hrs.querySelector(`input[name="h_${i}_0"]`),
            b = hrs.querySelector(`input[name="h_${i}_1"]`);
          if (a && b) {
            a.value = day;
            b.value = +(24 - day).toFixed(1);
          }
        });
        sums();
        preview();
      };
  };
  const preview = () => {
    const t = timeStructure(Object.fromEntries(new FormData(fm)));
    if (t.err) {
      pv.innerHTML = `<span class="sev err">⚠</span> ${esc(t.err.join('; '))}`;
      return;
    }
    const sum = t.ts.reduce((a, x) => a + x.share, 0);
    const rows = t.ts.slice(0, 48);
    pv.innerHTML = `${t.ts.length} time slices${Math.abs(t.days - 365) > 1e-9 ? ` (the ${t.days} days are scaled to the year)` : ''}:
      <div class="tw" style="max-height:240px"><table class="asktab"><thead><tr><th>Time slice</th><th class="n">Days</th><th class="n">Hours a day</th><th class="n">YearSplit</th></tr></thead><tbody>
      ${rows.map(x => `<tr><td data-notr>${esc(x.l)} · ${esc(x.name)}</td><td class="n" data-notr>${+x.days.toFixed(2)}</td><td class="n" data-notr>${+x.hours.toFixed(2)}</td><td class="n" data-notr>${x.share.toFixed(5)}</td></tr>`).join('')}
      ${t.ts.length > rows.length ? `<tr><td colspan="4">…</td></tr>` : ''}
      <tr class="asktot"><td>Total</td><td></td><td></td><td class="n" data-notr>${sum.toFixed(5)}</td></tr></tbody></table></div>
      ${t.byseas ? `<span class="nmds">DaySplit (one value for each day part in OSeMOSYS, used by storage within the day) = the hours averaged over the year: ${t.bn.map((b, k) => `${esc(b)} ${+t.dsplit[k].toFixed(2)} h`).join(', ')}.</span>${SCHEMA && SCHEMA.params && SCHEMA.params.has('TimesliceHours') ? '<span class="nmds">TimesliceHours keeps the hours of each slice.</span>' : ''}` : ''}`;
  };
  dr.querySelector('#nmpre').onchange = e => {
    const P = TPRESET[e.target.value];
    if (P) {
      fm.seas.value = P.seas;
      fm.sdays.value = P.days;
    }
    const sm = fm.querySelector('#nmstart');
    if (sm) sm.value = {s4: '11', m12sep: '8'}[e.target.value] || '0';
    drawHours();
    preview();
  };
  fm.addEventListener('input', e => {
    if (e.target && /^(seas|sdays|dp|dph|byseas|pre)$/.test(e.target.name)) drawHours();
    preview();
  });
  fm.byseas.onchange = () => (drawHours(), preview());
  drawHours();
  preview();
  fm.onsubmit = async ev => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    const T = timeStructure(f);
    if (T.err) return toast(T.err[0]);
    if (f.mf && f.mf !== curModelId()) await useModel(f.mf, true, false);
    const regs = f.reg
        .split(/[,\s]+/)
        .filter(Boolean)
        .map(x => x.toUpperCase()),
      y0 = +f.y0,
      y1 = +f.y1,
      nmd = +f.nm;
    if (y1 < y0) return toast('Last year must be after the first year');
    const years = [];
    for (let y = y0; y <= y1; y++) years.push(String(y));
    const seas = T.sn.map((_, i) => String(i + 1)),
      dts = T.dn.map((_, i) => String(i + 1)),
      brk = T.bn.map((_, i) => String(i + 1)),
      ts = T.ts.map(x => x.l);
    const D = {
      sets: {
        REGION: regs,
        TECHNOLOGY: [],
        COMMODITY: [],
        EMISSION: f.emi
          .split(/[,\s]+/)
          .filter(Boolean)
          .map(x => x.toUpperCase()),
        STORAGE: [],
        YEAR: years,
        SEASON: seas,
        DAYTYPE: dts,
        DAILYTIMEBRACKET: brk,
        TIMESLICE: ts,
        MODE_OF_OPERATION: Array.from({length: nmd}, (_, i) => String(i + 1)),
        STORAGEINTRADAY: [],
        STORAGEINTRAYEAR: [],
        UDC: []
      },
      params: {},
      cname: 'COMMODITY',
      desc: {},
      colors: {}
    };
    if (SCHEMA && SCHEMA.fromFile) for (const s of SCHEMA.sets) if (!D.sets[s]) D.sets[s] = [];
    SCEN.edit = 'SC_0';
    M = {D, meta: {name: f.name}};
    TD = {};
    FD = {};
    COLORS = {};
    ICONS = {};
    SETDESC = {};
    UNITS = parseUnitLines('');
    ONOFF = {};
    SYSTEMS.reset();
    SETDESC.SEASON = Object.fromEntries(T.sn.map((n, i) => [String(i + 1), n]));
    SETDESC.DAYTYPE = Object.fromEntries(T.dn.map((n, i) => [String(i + 1), n]));
    SETDESC.DAILYTIMEBRACKET = Object.fromEntries(T.bn.map((n, i) => [String(i + 1), n]));
    SETDESC.TIMESLICE = Object.fromEntries(T.ts.map(x => [x.l, x.name]));
    for (const x of T.ts) {
      for (const y of years) cellSet('YearSplit', [x.l, y], +x.share.toPrecision(12));
      for (const a of seas) cellSet('Conversionls', [x.l, a], x.s === a ? 1 : 0);
      for (const a of dts) cellSet('Conversionld', [x.l, a], x.d === a ? 1 : 0);
      for (const a of brk) cellSet('Conversionlh', [x.l, a], x.b === a ? 1 : 0);
      if (f.ord && SCHEMA && SCHEMA.params.has('TimesliceGroup')) {
        cellSet('TimesliceGroup', [x.l], x.group);
        cellSet('TimesliceOrder', [x.l], x.order);
        cellSet('TimesliceHours', [x.l], x.hours);
      }
    }
    T.dsplit.forEach((h, k) => {
      for (const y of years) cellSet('DaySplit', [brk[k], y], +(h / 8760).toPrecision(12));
    });
    for (const a of seas)
      T.dw.forEach((w, j) => {
        for (const y of years) cellSet('DaysInDayType', [a, dts[j], y], w);
      });
    for (const r of regs) cellSet('DiscountRate', [r], +f.dr);
    state.region = regs[0];
    build.on = true;
    setBuildUI();
    LIB.current = null;
    afterEdit(`New model created: ${ts.length} time slices`);
    openSystems();
    toast('First the systems (energy, water, land use…), then the commodities and technologies');
  };
}

/* ---- model file panel ---- */
function openModelFile() {
  const S = SCHEMA,
    dr = document.getElementById('drawer');
  dr.hidden = false;
  const ed = [...S.params.values()].filter(p => !p.computed && p.dims.length),
    comp = [...S.params.values()].filter(p => p.computed);
  const notDecl = Object.keys(M.D.params).filter(p => M.D.params[p].recs.length && !S.params.has(p));
  dr.innerHTML = `<div class="dh"><div style="min-width:0"><div class="code">build · model file</div><h2>${esc(S.name)}</h2>
    <p>The builder reads the model file: its sets, the ${ed.length} parameters you can edit (with their index sets and defaults) and its ${S.cons.length} constraints. Load your own model file (the standard OSeMOSYS model, an extension of your own) and every parameter it declares appears in the forms.</p></div><button class="btn x" type="button" id="close">Close</button></div>
  <div class="db"><div class="acts"><button class="btn pri" type="button" id="mlib">Model files (library)…</button><label class="btn" for="mfile">Load a model file…</label><input type="file" id="mfile" hidden>${S.fromFile ? '<button class="btn" type="button" id="mdef">Back to ' + esc(BUILTIN_NAME) + '</button>' : ''}</div>
   ${notDecl.length ? `<div class="ck warn"><div class="ck-h"><span class="sev warn">Warning</span><b>${notDecl.length} parameter(s) in the data are not declared by this model file</b></div><div class="ck-d">${esc(notDecl.join(', '))}</div><div class="ck-f">${S.fromFile ? 'They are not written to data.txt (GLPK would reject them).' : 'They are kept and written.'}</div></div>` : ''}
   <details open><summary>Sets<span class="n">${S.sets.length + S.optSets.length}</span></summary><div class="pdesc">${S.sets.map(esc).join(' · ')}${S.optSets.length ? ' · optional: ' + S.optSets.map(esc).join(' · ') : ''}</div></details>
   <details><summary>Parameters<span class="n">${ed.length} editable · ${comp.length} computed</span></summary><div class="tw"><table><thead><tr><th>Parameter</th><th>Index sets</th><th>Default</th><th>Constraints</th></tr></thead><tbody>${ed
     .map(
       p =>
         `<tr><td class="k" title="${esc(p.doc || '')}">${p.name}</td><td>${p.dims.join(', ')}</td><td>${p.def ?? '—'}</td><td>${p.used.length}</td></tr>`
     )
     .join(
       ''
     )}${comp.map(p => `<tr><td class="k">${p.name}</td><td colspan="3" class="muted">Computed (${PREPROC.has(p.name) ? 'by the pre-processor' : 'in the model file'})</td></tr>`).join('')}</tbody></table></div></details>
   <details><summary>Variables<span class="n">${S.vars.size}</span></summary><div class="tw"><table><thead><tr><th>Variable</th><th>Index sets</th><th>Description</th></tr></thead><tbody>${[...S.vars.values()].map(v => `<tr><td class="k">${v.name}</td><td>${v.dims.join(', ')}</td><td>${esc(S.docs[v.name] || '')}</td></tr>`).join('')}</tbody></table></div><p class="hint">Their values after a run are in Results.</p></details>
   <details><summary>Constraints and objective<span class="n">${S.cons.length}</span></summary><div class="tw"><table><thead><tr><th>Constraint</th><th>Parameters used</th></tr></thead><tbody>${S.cons
     .map(
       c =>
         `<tr><td class="k">${esc(c.name)}</td><td>${
           [...S.params.values()]
             .filter(p => p.used.includes(c.name))
             .map(p => p.name)
             .join(', ') || '—'
         }</td></tr>`
     )
     .join('')}</tbody></table></div></details></div>`;
  dr.querySelector('#close').onclick = () => (dr.hidden = true);
  dr.querySelector('#mfile').onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = async () => {
      try {
        const id = await addModelFromFile(f);
        if (!id) return;
        await useModel(id);
        openModelFile();
      } catch (er) {
        toast('Not a model file: ' + er.message);
      }
    };
    rd.readAsText(f);
  };
  const md = dr.querySelector('#mdef');
  if (md)
    md.onclick = async () => {
      await useModel('_muio54', true);
      openModelFile();
    };
  dr.querySelector('#mlib').onclick = () => openModels();
}

/* units of one technology (capacity, activity), commodity, emission or storage, in its panel */
function entUnitsRow(kind, code) {
  if (!code || !['tech', 'comm', 'emi', 'stor'].includes(kind)) return '';
  const su = sysUnits(ENTSET[kind], code); // the units of its system first
  if (kind === 'tech')
    return `<div class="row2 frm eunits" style="display:grid"><label>Unit of capacity${unitSelect('data-unit data-ek="cap"', techCap(code), su)}</label><label>Unit of activity${unitSelect('data-unit data-ek="act"', techAct(code), su)}</label></div>`;
  const cur = kind === 'comm' ? commUnit(code) : kind === 'emi' ? emisUnit(code) : storUnit(code);
  return `<div class="row2 frm eunits" style="display:grid"><label>Unit${unitSelect('data-unit data-ek="u"', cur, su)}</label><span class="hint">${su ? `First the units of ${esc(su.sys)}, then all units. ` : ''}Units are labels (as in MUIO); "New unit…" adds your own.</span></div>`;
}

/* ---- rename a member of a set (technology, commodity, storage, emission, constraint, region...) everywhere:
   the set and its subsets, every parameter, descriptions, colours, icons, names, units, scenario changes and the
   Monte Carlo design. Results of runs already solved keep the old code. ---- */
const inSet = (d, sn) =>
  d === sn || d.startsWith(sn + '_') || (sn === 'STORAGE' && /^STORAGEINTRA/.test(d)) || (sn === 'COMMODITY' && d === 'FUEL');
function renameMember(sn, a, b) {
  a = String(a);
  b = String(b).trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(b)) throw new Error('use letters, digits, _ - . only (no spaces)');
  if (setOf(sn).map(String).includes(b)) throw new Error(`${b} already exists in ${sn}`);
  let n = 0;
  const mem = new Set(setOf(sn).map(String)),
    KNOWN = [
      'REGION',
      'TECHNOLOGY',
      'COMMODITY',
      'FUEL',
      'EMISSION',
      'STORAGE',
      'YEAR',
      'TIMESLICE',
      'SEASON',
      'DAYTYPE',
      'DAILYTIMEBRACKET',
      'MODE_OF_OPERATION',
      'UDC'
    ];
  const DM = Object.fromEntries(Object.keys(M.D.params).map(p => [p, dimsOf(p)])),
    dmOf = p => DM[p] || dimsOf(p); // index sets read before the rename (some are inferred from the members)
  const guess = {}; // parameters whose index sets the model file does not name ("?"): a position whose values are all members of this set
  for (const p of Object.keys(M.D.params)) {
    const d = dmOf(p),
      R = M.D.params[p].recs;
    if (!R.length) continue;
    const n0 = R[0].idx.length;
    for (let i = 0; i < n0; i++) {
      if (d[i] && (KNOWN.some(k => inSet(d[i], k)) || setOf(d[i]).length)) continue;
      if (R.every(r => mem.has(String(r.idx[i])))) (guess[p] = guess[p] || new Set()).add(i);
    }
  }
  for (const [name, list] of Object.entries(M.D.sets))
    if (inSet(name, sn) || (sn === 'COMMODITY' && name === (M.D.cname || 'COMMODITY')))
      list.forEach((x, i) => {
        if (String(x) === a) {
          list[i] = b;
          n++;
        }
      });
  const swap = (p, idx) => {
    const d = dmOf(p),
      g = guess[p];
    let ch = false;
    const out = idx.map((x, i) => {
      if ((inSet(d[i] || '', sn) || (g && g.has(i))) && String(x) === a) {
        ch = true;
        return b;
      }
      return x;
    });
    return ch ? out : null;
  };
  for (const p of Object.keys(M.D.params)) {
    const P = M.D.params[p];
    let ch = false;
    for (const r of P.recs) {
      const nx = swap(p, r.idx);
      if (nx) {
        r.idx = nx;
        ch = true;
        n++;
      }
    }
    if (ch) P._map = null;
  }
  for (const o of [TD, FD, COLORS, ICONS])
    if (a in o) {
      o[b] = o[a];
      delete o[a];
    }
  const sd = SETDESC[sn === 'COMMODITY' ? 'COMMODITY' : sn];
  if (sd && a in sd) {
    sd[b] = sd[a];
    delete sd[a];
  }
  SYSTEMS.rename(sn, a, b);
  const uk = {TECHNOLOGY: 'tech', COMMODITY: 'comm', EMISSION: 'emis', STORAGE: 'stor'}[sn];
  if (uk && UNITS[uk][a]) {
    UNITS[uk][b] = UNITS[uk][a];
    delete UNITS[uk][a];
  }
  const S = scenData();
  for (const o of Object.values(S.ov || {}))
    for (const [p, m] of Object.entries(o))
      for (const k of Object.keys(m)) {
        const nx = swap(p, k.split('|'));
        if (nx) {
          m[nx.join('|')] = m[k];
          delete m[k];
          n++;
        }
      }
  if (typeof MCV !== 'undefined' && MCV.design)
    for (const f of MCV.design.factors || [])
      for (const [d, l] of Object.entries(f.select || {}))
        if (inSet(d, sn) && Array.isArray(l)) f.select[d] = l.map(x => (String(x) === a ? b : x));
  if (typeof mcSave === 'function' && typeof MCV !== 'undefined' && MCV.design)
    try {
      mcSave();
    } catch (e) {}
  if (sn === 'TECHNOLOGY' && ONOFF[a]) {
    const o = ONOFF[a];
    o.bak = Object.fromEntries(
      Object.entries(o.bak || {}).map(([k, v]) => [
        k
          .split('|')
          .map((x, i) => (i && x === a ? b : x))
          .join('|'),
        v
      ])
    );
    ONOFF[b] = o;
    delete ONOFF[a];
  }
  if (sn === 'REGION')
    for (const o of Object.values(ONOFF)) {
      o.regions = (o.regions || []).map(x => (x === a ? b : x));
      o.bak = Object.fromEntries(
        Object.entries(o.bak || {}).map(([k, v]) => [
          k
            .split('|')
            .map((x, i) => (i && x === a ? b : x))
            .join('|'),
          v
        ])
      );
    }
  if (typeof sel !== 'undefined' && sel && sel.t === a) sel.t = b;
  return n;
}
function renameForm(sn, a, done) {
  const ov = document.createElement('div');
  ov.className = 'unitov';
  ov.innerHTML = `<form class="frm unitform" role="dialog" aria-label="Rename"><h3>Rename ${esc(a)}</h3>
    <label>New code (${esc(sn.toLowerCase())})<input name="b" required value="${esc(a)}" pattern="[A-Za-z0-9_.\\-]+"></label>
    <p class="hint">Changed everywhere in this model: the set, every parameter, the description, colour, icon and units, the scenario changes and the Monte Carlo design. Runs already solved keep the old code (solve again to see the new one in Results). The description is not the code: change it in the Description box.</p>
    <div class="acts"><button class="btn pri" type="submit">Rename</button><button class="btn" type="button" data-x>Cancel</button></div></form>`;
  document.body.appendChild(ov);
  const f = ov.querySelector('form'),
    inp = f.querySelector('input');
  inp.focus();
  inp.select();
  const close = () => ov.remove();
  ov.querySelector('[data-x]').onclick = close;
  ov.onclick = e => {
    if (e.target === ov) close();
  };
  f.onsubmit = ev => {
    ev.preventDefault();
    const b = inp.value.trim();
    if (b === a) return close();
    try {
      const n = renameMember(sn, a, b);
      close();
      afterEdit(`${a} renamed ${b} (${n} places)`);
      done && done(b);
    } catch (e) {
      toast(e.message);
    }
  };
}
