'use strict';
/* ============================== SCENARIOS (the MUIO technique) ==============================
   The base case (SC_0) holds every value. A scenario holds only the values it CHANGES (a sparse overlay per parameter).
   A run applies the base and then the chosen scenarios in order: a later scenario overrides an earlier one, as in MUIO.
   Editing: choose the scenario to edit (Scenarios button or the chip in the header): grids then show that scenario's value
   where it has one (highlighted) and the base value elsewhere; typing writes into the scenario, typing the base value back
   removes the change. Saved in the data file as comment lines (#@scenario, #@sv), ignored by GLPK. */
const SCEN = {edit: 'SC_0'};
function scenData() {
  if (!M || !M.D) return {list: [], ov: {}};
  if (!M.D.scen) M.D.scen = {list: [], ov: {}};
  return M.D.scen;
}
const scenName = id => (id === 'SC_0' ? 'Base' : (scenData().list.find(s => s.id === id) || {}).name || id);
function scenOv(id, p, create) {
  const S = scenData();
  if (!S.ov[id]) {
    if (!create) return null;
    S.ov[id] = {};
  }
  if (!S.ov[id][p]) {
    if (!create) return null;
    S.ov[id][p] = {};
  }
  return S.ov[id][p];
}
function scenRecs(p) {
  if (SCEN.edit === 'SC_0') return [];
  const o = scenOv(SCEN.edit, p);
  return o ? Object.keys(o).map(k => ({idx: k.split('|'), v: o[k], p})) : [];
}
function scenHas(p, idx) {
  if (SCEN.edit === 'SC_0') return false;
  const o = scenOv(SCEN.edit, p);
  return !!o && Object.prototype.hasOwnProperty.call(o, idx.join('|'));
}
function scenCount(id) {
  const o = scenData().ov[id] || {};
  return Object.values(o).reduce((s, m) => s + Object.keys(m).length, 0);
}
/* parameters with the scenarios applied in order (only the changed parameters are copied) */
function applyScenarios(ids) {
  const out = Object.assign({}, M.D.params),
    S = scenData();
  for (const id of ids || []) {
    const o = S.ov[id];
    if (!o) continue;
    for (const [p, m] of Object.entries(o)) {
      if (!out[p] || out[p] === M.D.params[p]) {
        const B = M.D.params[p] || {name: p, def: ((SCHEMA && SCHEMA.params.get(p)) || {}).def, recs: []};
        out[p] = {...B, recs: B.recs.map(r => ({idx: r.idx, v: r.v})), _map: null};
      }
      const P = out[p],
        idx = new Map(P.recs.map((r, i) => [r.idx.join('|'), i]));
      for (const [k, v] of Object.entries(m)) {
        if (idx.has(k)) {
          if (v === null) P.recs[idx.get(k)] = null;
          else P.recs[idx.get(k)].v = v;
        } else if (v !== null) {
          P.recs.push({idx: k.split('|'), v});
          idx.set(k, P.recs.length - 1);
        }
      }
      P.recs = P.recs.filter(Boolean);
    }
  }
  return out;
}
function scenLines() {
  const S = scenData(),
    L = [];
  for (const s of S.list) L.push(`#@scenario ${s.id} ${(s.name || s.id).replace(/\|/g, '/')}|${(s.desc || '').replace(/\n/g, ' ')}`);
  for (const s of S.list) {
    const o = S.ov[s.id] || {};
    for (const [p, m] of Object.entries(o))
      for (const [k, v] of Object.entries(m)) L.push(`#@sv ${s.id} ${p} ${k.split('|').join(' ')} ${v === null ? 'default' : v}`);
  }
  return L;
}
function parseScenLines(text) {
  const scen = {list: [], ov: {}};
  for (const m of text.matchAll(/^#@scenario\s+(\S+)\s+(.*)$/gm)) {
    const [n, d] = m[2].split('|');
    scen.list.push({id: m[1], name: (n || m[1]).trim(), desc: (d || '').trim()});
  }
  for (const m of text.matchAll(/^#@sv\s+(\S+)\s+(\S+)\s+(.*)$/gm)) {
    const t = m[3].trim().split(/\s+/),
      v = t.pop();
    const o = (scen.ov[m[1]] = scen.ov[m[1]] || {});
    (o[m[2]] = o[m[2]] || {})[t.join('|')] = v === 'default' ? null : Number(v);
  }
  return scen;
}
function scenChip() {
  if (typeof rdEnhBar === 'function') setTimeout(rdEnhBar, 0);
  const c = document.getElementById('scnchip');
  if (!c) return;
  const on = SCEN.edit !== 'SC_0';
  c.hidden = !on;
  c.innerHTML = on
    ? `Editing scenario <b>${esc(scenName(SCEN.edit))}</b> <span class="muted">· ${scenCount(SCEN.edit)} change(s)</span> <button class="btn" type="button" id="scnbase">Back to base</button>`
    : '';
  const b = document.getElementById('scnbase');
  if (b)
    b.onclick = () => {
      SCEN.edit = 'SC_0';
      scenChip();
      toast('Editing the base case');
      if (!document.getElementById('drawer').hidden && EDIT && EDIT.kind) openEntity(EDIT.kind, EDIT.code);
    };
}
function openScenarios() {
  const dr = document.getElementById('drawer');
  dr.hidden = false;
  const S = scenData();
  const row = s => {
    const n = scenCount(s.id),
      cur = SCEN.edit === s.id;
    return `<div class="ck${cur ? ' cur' : ''}"><div class="ck-h"><b>${esc(s.name)}</b> <span class="muted">${esc(s.id)}</span>${cur ? '<span class="sev info">Editing</span>' : ''}</div>
      ${s.desc ? `<div class="ck-d">${esc(s.desc)}</div>` : ''}<div class="ck-w">${n} changed value(s) in ${Object.keys(S.ov[s.id] || {}).length} parameter(s)</div>
      <div class="acts" style="margin-top:6px"><button class="btn ${cur ? '' : 'pri'}" data-a="edit" data-id="${s.id}">${cur ? 'Editing' : 'Edit this scenario'}</button><button class="btn" data-a="show" data-id="${s.id}">Show changes</button><button class="btn" data-a="ren" data-id="${s.id}">Rename</button><button class="btn" data-a="dup" data-id="${s.id}">Duplicate</button><button class="btn" data-a="clr" data-id="${s.id}">Clear changes</button><button class="btn danger" data-a="del" data-id="${s.id}">Delete</button></div>
      <div class="scshow" data-for="${s.id}"></div></div>`;
  };
  dr.innerHTML = `<div class="dh"><div style="min-width:0"><div class="code">Scenarios</div><h2>Scenarios</h2><p>As in MUIO: the base case holds every value; a scenario holds only the values it changes. A run applies the base and then the scenarios you tick, in order (a later one overrides an earlier one). Choose "Edit this scenario", then edit as usual: changed cells are highlighted, typing the base value back removes the change.</p></div><button class="btn x" type="button" id="close">Close</button></div>
  <div class="db"><div class="ck${SCEN.edit === 'SC_0' ? ' cur' : ''}"><div class="ck-h"><b>Base</b> <span class="muted">SC_0</span>${SCEN.edit === 'SC_0' ? '<span class="sev info">Editing</span>' : ''}</div><div class="ck-w">All values of the model</div>
    <div class="acts" style="margin-top:6px"><button class="btn" data-a="edit" data-id="SC_0">${SCEN.edit === 'SC_0' ? 'Editing' : 'Edit the base'}</button></div></div>
   ${S.list.map(row).join('')}
   <form id="scnew" class="frm"><fieldset><legend>New scenario</legend><div class="row2"><label>Name<input name="name" required placeholder="e.g. High gas price"></label><label>Description<input name="desc"></label></div>
     <div class="acts"><button class="btn pri" type="submit">Add scenario</button></div></fieldset></form></div>`;
  dr.querySelector('#close').onclick = () => {
    dr.hidden = true;
  };
  dr.querySelector('#scnew').onsubmit = ev => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    let k = 1;
    while (S.list.some(s => s.id === 'SC_' + k)) k++;
    S.list.push({id: 'SC_' + k, name: String(f.get('name')).trim(), desc: String(f.get('desc') || '').trim()});
    SCEN.edit = 'SC_' + k;
    afterEdit('Scenario added: you are editing it');
    scenChip();
    openScenarios();
  };
  dr.querySelectorAll('[data-a]').forEach(
    b =>
      (b.onclick = async () => {
        const id = b.dataset.id,
          s = S.list.find(x => x.id === id);
        if (b.dataset.a === 'edit') {
          SCEN.edit = id;
          scenChip();
          toast(
            id === 'SC_0' ? 'Editing the base case' : `Editing scenario ${scenName(id)}: open a technology, commodity or "All parameters"`
          );
          openScenarios();
        }
        if (b.dataset.a === 'ren') {
          const n = await uiPrompt('Name', s.name);
          if (n === null) return;
          const d = await uiPrompt('Description', s.desc || '');
          s.name = n.trim() || s.name;
          if (d !== null) s.desc = d.trim();
          afterEdit('Scenario renamed');
          openScenarios();
        }
        if (b.dataset.a === 'dup') {
          let k = 1;
          while (S.list.some(x => x.id === 'SC_' + k)) k++;
          S.list.push({id: 'SC_' + k, name: s.name + ' (copy)', desc: s.desc});
          S.ov['SC_' + k] = JSON.parse(JSON.stringify(S.ov[id] || {}));
          afterEdit('Scenario duplicated');
          openScenarios();
        }
        if (b.dataset.a === 'clr') {
          if (!await uiConfirm(`Remove the ${scenCount(id)} change(s) of ${s.name}?`)) return;
          S.ov[id] = {};
          afterEdit('Changes cleared');
          openScenarios();
        }
        if (b.dataset.a === 'del') {
          if (!await uiConfirm(`Delete the scenario ${s.name}?`)) return;
          S.list = S.list.filter(x => x.id !== id);
          delete S.ov[id];
          if (SCEN.edit === id) SCEN.edit = 'SC_0';
          afterEdit('Scenario deleted');
          scenChip();
          openScenarios();
        }
        if (b.dataset.a === 'show') {
          const box = dr.querySelector(`.scshow[data-for="${id}"]`);
          const o = S.ov[id] || {};
          const rows = [];
          for (const [p, m] of Object.entries(o))
            for (const [k, v] of Object.entries(m)) {
              const bv = cellGetBase(p, k.split('|'));
              rows.push(
                `<tr><td class="k">${esc(p)}</td><td class="k">${esc(k.split('|').join(' · '))}</td><td>${bv === undefined ? '<span class="muted">Default</span>' : bv}</td><td><b>${v === null ? 'default' : v}</b></td></tr>`
              );
            }
          box.innerHTML = rows.length
            ? `<div class="tw" style="max-height:300px"><table class="grid ptab"><thead><tr><th class="k">Parameter</th><th class="k">Index</th><th>Base</th><th>${esc(s.name)}</th></tr></thead><tbody>${rows.slice(0, 2000).join('')}</tbody></table></div>${rows.length > 2000 ? `<div class="ck-w">First 2,000 of ${rows.length}</div>` : ''}`
            : '<div class="empty">No changes yet.</div>';
        }
      })
  );
}
/* the run dialog: which scenarios to apply, in order */
function scenPicker() {
  const S = scenData();
  if (!S.list.length) return '';
  return `<fieldset><legend>Scenarios applied (in this order, after the base)</legend><div class="scpick">${S.list.map(s => `<label><input type="checkbox" name="scn" value="${s.id}" ${SCEN.edit === s.id ? 'checked' : ''}> ${esc(s.name)} <span class="muted">${scenCount(s.id)} change(s)</span></label>`).join('')}</div>
    <p class="hint">The order is the order of this list (a later scenario overrides an earlier one).</p></fieldset>`;
}
