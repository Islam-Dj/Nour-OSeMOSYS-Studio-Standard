'use strict';
/* ---- model library: every opened or built model kept in this browser (IndexedDB), reopened at start ---- */
/* Model library. Served by the Studio server (desktop app or START_SOLVER): each model is a CASE FOLDER on this computer
   (cases/<id>/data.txt, model.txt, case.json, runs/), like MUIO's DataStorage. Page opened as a file: the browser's store. */
const SRVLIB = location.protocol.startsWith('http') && !!location.port;
const jpost = (path, obj) => api(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(obj)});
const LIB = {
  db: null,
  current: null,
  timer: null,
  srv: SRVLIB,
  async open() {
    if (this.srv) return true;
    if (this.db !== null) return this.db;
    this.db = await new Promise(res => {
      try {
        const q = indexedDB.open('mst_rsme', 1);
        q.onupgradeneeded = () => q.result.createObjectStore('models', {keyPath: 'id'});
        q.onsuccess = () => res(q.result);
        q.onerror = () => res(false);
      } catch (e) {
        res(false);
      }
    });
    return this.db;
  },
  async tx(mode, fn) {
    const db = await this.open();
    if (!db) return null;
    return new Promise((res, rej) => {
      const t = db.transaction('models', mode),
        s = t.objectStore('models'),
        r = fn(s);
      t.oncomplete = () => res(r && r.result);
      t.onerror = () => rej(t.error);
    });
  },
  async all() {
    if (this.srv) {
      try {
        return await api('/api/cases');
      } catch (e) {
        toast('Cases folder not reachable: ' + e.message);
        return [];
      }
    }
    try {
      return (await this.tx('readonly', s => s.getAll())) || [];
    } catch (e) {
      return [];
    }
  },
  async put(rec) {
    if (this.srv) {
      try {
        const r = await jpost('/api/case/' + rec.id, rec);
        if (!r.ok) throw new Error(r.error || 'not saved');
        return true;
      } catch (e) {
        toast('Could not save the case: ' + e.message);
        return false;
      }
    }
    try {
      await this.tx('readwrite', s => s.put(rec));
      return true;
    } catch (e) {
      toast('Could not save in the browser library: ' + e.message);
      return false;
    }
  },
  async del(id) {
    if (this.srv) {
      try {
        await jpost('/api/case/' + id + '/delete', {});
      } catch (e) {}
      return;
    }
    try {
      await this.tx('readwrite', s => s.delete(id));
    } catch (e) {}
  },
  async get(id) {
    if (this.srv) {
      try {
        return await api('/api/case/' + id);
      } catch (e) {
        return null;
      }
    }
    try {
      return await this.tx('readonly', s => s.get(id));
    } catch (e) {
      return null;
    }
  },
  setLast(id) {
    try {
      localStorage.setItem('mst_rsme_last', id);
    } catch (e) {}
  },
  openF: new Set(),
  modelF: (() => {
    try {
      return localStorage.getItem('mst_rsme_modelF') || '';
    } catch (e) {
      return '';
    }
  })(),
  async folders() {
    if (this.srv) {
      try {
        const r = await api('/api/folders');
        return Array.isArray(r) ? r : [];
      } catch (e) {
        return [];
      }
    }
    try {
      return JSON.parse(localStorage.getItem('mst_rsme_folders') || '[]');
    } catch (e) {
      return [];
    }
  },
  async setFolders(list) {
    const L = list.map(f => ({id: String(f.id), name: String(f.name), desc: String(f.desc || '')}));
    if (this.srv) {
      try {
        const r = await jpost('/api/folders', L);
        if (!r.ok) throw new Error(r.error || 'not saved');
        return true;
      } catch (e) {
        toast('Folders not saved: ' + e.message);
        return false;
      }
    }
    try {
      localStorage.setItem('mst_rsme_folders', JSON.stringify(L));
      return true;
    } catch (e) {
      toast('Folders not saved in this browser');
      return false;
    }
  },
  async store(name, text, extra) {
    let id =
      name
        .replace(/\.(txt|dat)$/i, '')
        .replace(/\W+/g, '_')
        .slice(0, 40) || 'model'; // 40 characters: Windows paths
    if (this.srv) {
      const have = new Set((await this.all()).map(r => r.id));
      if (have.has(id)) {
        let k = 2;
        while (have.has(id + '_' + k)) k++;
        id += '_' + k;
      }
    } // readable folder names
    else id += '_' + Date.now();
    this.current = id;
    const ok = await this.put({
      id,
      name,
      data: text,
      model: SCHEMA && SCHEMA.fromFile ? SCHEMA.text : null,
      modelName: SCHEMA ? SCHEMA.name : null,
      modelId: SCHEMA ? SCHEMA.modelId || null : null,
      updated: Date.now(),
      size: text.length,
      ...(extra || {})
    });
    if (ok) this.setLast(id);
    return ok;
  },
  // a pending autosave is written at once before another case is opened (it used to fire later, on the new case)
  async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      if (dirty) await this.saveNow();
    }
  },
  autosave() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.saveNow(), 1500);
  },
  async saveNow() {
    if (!M || !M.D) return;
    const txt = writeData();
    if (!this.current) {
      if (await this.store(M.meta.name || 'model', txt)) dirty = false;
      this.timer = null;
      return;
    }
    const old = (await this.get(this.current)) || {};
    await this.put({
      ...old,
      id: this.current,
      name: M.meta.name || old.name,
      data: txt,
      model: SCHEMA && SCHEMA.fromFile ? SCHEMA.text : null,
      modelName: SCHEMA ? SCHEMA.name : null,
      modelId: SCHEMA ? SCHEMA.modelId || null : null,
      updated: Date.now(),
      size: txt.length
    });
    this.setLast(this.current);
    dirty = false;
    this.timer = null;
  },
  async views(list) {
    const id = this.current; // saved parts of the diagram (diagview.js), kept with the case
    if (list === undefined) {
      if (id) {
        const r = await this.get(id);
        if (r && r.views) return r.views;
      }
      try {
        return JSON.parse(localStorage.getItem('mst_rsme_views') || '[]');
      } catch (e) {
        return [];
      }
    }
    if (id) {
      const r = await this.get(id);
      if (r) {
        r.views = list;
        await this.put(r);
        return list;
      }
    }
    try {
      localStorage.setItem('mst_rsme_views', JSON.stringify(list));
    } catch (e) {}
    return list;
  },
  async charts(list) {
    const id = this.current;
    if (list === undefined) {
      if (id) {
        const r = await this.get(id);
        if (r && r.charts) return r.charts;
      }
      try {
        return JSON.parse(localStorage.getItem('mst_rsme_charts') || '[]');
      } catch (e) {
        return [];
      }
    }
    if (id) {
      const r = await this.get(id);
      if (r) {
        r.charts = list;
        await this.put(r);
        return list;
      }
    }
    try {
      localStorage.setItem('mst_rsme_charts', JSON.stringify(list));
    } catch (e) {}
    return list;
  },
  async openRec(rec) {
    await this.flush();
    if (rec.model) setSchema(rec.model, rec.modelName);
    else setSchema(MODELTXT(), BUILTIN_NAME);
    SCHEMA.modelId = rec.modelId || (rec.model ? null : '_muio54');
    if (rec.frozen) {
      // a checkpoint is never changed: opening it starts a NEW case from it
      const name = `${rec.name} · from checkpoint ${rec.checkpointNo}${rec.checkpointLabel ? ' (' + rec.checkpointLabel + ')' : ''}`;
      load(rec.data, {name, version: rec.version, description: rec.description, note: 'new case from a checkpoint'});
      this.current = null;
      const keep = {charts: rec.charts, views: rec.views, branchOf: rec.id};
      for (const k of Object.keys(rec))
        if (
          ![
            'id',
            'name',
            'data',
            'model',
            'modelName',
            'modelId',
            'updated',
            'size',
            'runs',
            'frozen',
            'checkpointOf',
            'checkpointNo',
            'checkpointLabel',
            'created',
            'charts'
          ].includes(k)
        )
          keep[k] = rec[k];
      await this.store(name, writeData(), keep);
      caseLine();
      toast(`New case "${name}": checkpoint ${rec.checkpointNo} itself stays as it was.`);
      return;
    }
    load(rec.data, {
      name: rec.name,
      version: rec.version,
      description: rec.description,
      note: this.srv ? 'case folder' : 'from your library'
    });
    this.current = rec.id;
    this.setLast(rec.id);
  },
  // CHECKPOINT: a frozen copy of the open case as it is now (data, model file, names, colours, charts, scenarios); you keep
  // working on the case. Go back: Cases -> its checkpoints -> "Continue from it" opens a new case from the copy.
  async checkpoint(label) {
    if (!M || !M.D) return null;
    clearTimeout(this.timer);
    const txt = writeData();
    if (!this.current) {
      if (!(await this.store(M.meta.name || 'model', txt))) return null;
    }
    const old = (await this.get(this.current)) || {};
    const cur = {
      ...old,
      id: this.current,
      name: M.meta.name || old.name,
      data: txt,
      model: SCHEMA && SCHEMA.fromFile ? SCHEMA.text : null,
      modelName: SCHEMA ? SCHEMA.name : null,
      modelId: SCHEMA ? SCHEMA.modelId || null : null,
      updated: Date.now(),
      size: txt.length
    };
    if (!(await this.put(cur))) return null;
    dirty = false;
    const all = await this.all(),
      mine = all.filter(r => r.checkpointOf === this.current);
    const no = mine.reduce((a, r) => Math.max(a, r.checkpointNo || 0), 0) + 1;
    let id = `${this.current}__cp${no}`;
    const have = new Set(all.map(r => r.id));
    while (have.has(id)) id += '_';
    const rec = {...cur, id, checkpointOf: this.current, checkpointNo: no, checkpointLabel: label || '', frozen: true, updated: Date.now()};
    delete rec.runs;
    delete rec.created;
    return (await this.put(rec)) ? rec : null;
  }
};
async function makeCheckpoint() {
  if (!M || !M.D) return;
  const n = await uiPrompt(
    'Checkpoint: a copy of the model as it is now, kept unchanged. You go on working on it; to go back, open Cases and "Continue from" the checkpoint.\n\nName of this stage (optional):',
    ''
  );
  if (n === null) return;
  const r = await LIB.checkpoint(n.trim());
  if (r)
    toast(`Checkpoint ${r.checkpointNo} saved${r.checkpointLabel ? ': ' + r.checkpointLabel : ''}. You keep working on ${M.meta.name}.`);
  else toast('The checkpoint could not be saved.');
}
/* the folder of the built-in model; in the standard edition the built-in model is the OSeMOSYS standard model (cases/OSeMOSYS),
   which also holds the cases imported from MUIO 5.7 */
const BUILTIN_GROUP = STANDARD ? 'OSeMOSYS' : 'OSeMOSYS_master';
const STD57_GROUP = STANDARD ? BUILTIN_GROUP : 'MUIO_5.7';
const STD57_NAME_RE = /^(MUIO 5\.7|OSeMOSYS standard model)/;
/* the model file of a case (the cases are grouped by model: cases/<model>/<case> on the server) */
function caseModel(r) {
  const g =
    r.group ||
    (r.modelId === '_muio57' || (!r.modelId && STD57_NAME_RE.test(r.modelName || ''))
      ? STD57_GROUP
      : (!r.modelId && !r.model) || r.modelId === '_muio54' || SAME_BUILTIN(r.modelName)
        ? BUILTIN_GROUP
        : r.modelId || 'Other_models');
  const m = (MODELS.list || []).find(x => x.id === g);
  const name =
    g === BUILTIN_GROUP
      ? BUILTIN_NAME
      : g === 'MUIO_5.7'
        ? MUIO57_NAME
        : g === 'Other_models'
          ? 'Other model files'
          : (m && m.name) || r.modelName || g;
  return {g, name};
}
async function openLibrary() {
  const dr = document.getElementById('drawer');
  dr.hidden = false;
  await MODELS.load().catch(() => {});
  const ALL0 = (await LIB.all()).sort((a, b) => b.updated - a.updated),
    L0 = ALL0.filter(r => !r.frozen);
  // the cases of one model at a time
  const MG = new Map([[BUILTIN_GROUP, {g: BUILTIN_GROUP, name: BUILTIN_NAME, n: 0}]]);
  if (!MG.has(STD57_GROUP)) MG.set(STD57_GROUP, {g: STD57_GROUP, name: MUIO57_NAME, n: 0});
  for (const m of (MODELS.list || []).filter(m => !m.builtin)) MG.set(m.id, {g: m.id, name: m.name || m.id, n: 0});
  for (const r of L0) {
    const c = caseModel(r);
    if (!MG.has(c.g)) MG.set(c.g, {...c, n: 0});
    MG.get(c.g).n++;
  }
  if (LIB.modelF && !MG.has(LIB.modelF)) LIB.modelF = '';
  const inM = r => !LIB.modelF || caseModel(r).g === LIB.modelF;
  const ALL = ALL0.filter(r => inM(r.frozen ? ALL0.find(x => x.id === r.checkpointOf) || r : r)),
    L = ALL.filter(r => !r.frozen);
  // the model is chosen in a list (with the number of cases of each), not a row of buttons
  const mbar = `<div class="mfbar"><label>Model <select id="cmodel" aria-label="Show the cases of which model"><option value="" ${!LIB.modelF ? 'selected' : ''}>All models (${L0.length} cases)</option>${[...MG.values()].map(x => `<option value="${esc(x.g)}" ${LIB.modelF === x.g ? 'selected' : ''}>${esc(x.name)} (${x.n})</option>`).join('')}</select></label>${LIB.modelF ? `<span class="muted">${L.length} case${L.length === 1 ? '' : 's'} of this model</span>` : ''}</div>`;
  const CP = {};
  for (const r of ALL.filter(r => r.frozen)) (CP[r.checkpointOf] = CP[r.checkpointOf] || []).push(r);
  for (const k in CP) CP[k].sort((a, b) => (b.checkpointNo || 0) - (a.checkpointNo || 0));
  const orphans = ALL.filter(r => r.frozen && !L.some(x => x.id === r.checkpointOf));
  const cpRow =
    c => `<div class="cpr"><b>Checkpoint ${c.checkpointNo}</b>${c.checkpointLabel ? ' · ' + esc(c.checkpointLabel) : ''} <span class="muted">${new Date(c.updated).toLocaleString()} · ${(c.size / 1e6).toFixed(2)} MB</span>
     <span class="acts"><button class="btn" data-a="open" data-id="${c.id}" title="Opens a NEW case from this checkpoint; the checkpoint stays unchanged">Continue from it</button><button class="btn" data-a="save" data-id="${c.id}">Save as file</button><button class="btn danger" data-a="del" data-id="${c.id}">Delete</button></span></div>`;
  const cpBox = list =>
    list && list.length
      ? `<details class="cps"><summary>Checkpoints <span class="n">${list.length}</span></summary>${list.map(cpRow).join('')}</details>`
      : '';
  const avail = await LIB.open();
  // folders (themes) with a name and a description; a case belongs to
  // one folder (case.json "folder"); the folders are listed like the Example models, the cases without one at the end
  const FOLD = await LIB.folders(),
    FID = new Set(FOLD.map(f => f.id));
  const folderSel = r =>
    FOLD.length
      ? `<label class="cfl">Folder <select class="cfsel" data-id="${r.id}"><option value="">(none)</option>${FOLD.map(f => `<option value="${esc(f.id)}" ${r.folder === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>`
      : '';
  const caseRow =
    r => `<div class="ck${r.id === LIB.current ? ' cur' : ''}"><div class="ck-h"><input type="checkbox" class="csel" data-id="${r.id}" aria-label="Tick ${esc(r.name)}"><b>${esc(r.name)}</b>${r.id === LIB.current ? '<span class="sev info">Open</span>' : ''}</div>${r.description ? `<div class="ck-d">${esc(r.description)}</div>` : ''}<div class="ck-w">${r.version ? esc(r.version) + ' · ' : ''}${new Date(r.updated).toLocaleString()} · ${(r.size / 1e6).toFixed(2)} MB · model: ${esc(caseModel(r).name)}${LIB.srv ? ` · ${r.runs || 0} run(s) · folder ${esc(r.id)}` : ''}</div>
     <div class="acts" style="margin-top:6px"><button class="btn" data-a="open" data-id="${r.id}">Open</button><button class="btn" data-a="save" data-id="${r.id}">Save as file</button><button class="btn" data-a="dup" data-id="${r.id}">Duplicate</button><button class="btn" data-a="ren" data-id="${r.id}">Name and description</button>${LIB.srv ? `<button class="btn" data-a="dir" data-id="${r.id}">Show folder</button><button class="btn" data-a="bak" data-id="${r.id}" title="Everything of this case in one zip: data, model file, scenarios, runs and results, Monte Carlo and robust-decision set-ups and runs, checkpoints">Back up (zip)</button>` : ''}<button class="btn danger" data-a="del" data-id="${r.id}">Delete</button>${folderSel(r)}${r.id === LIB.current ? '<button class="btn" data-a="cp" data-id="' + r.id + '">Save a checkpoint</button>' : ''}${!STANDARD && ((r.modelName && !SAME_BUILTIN(r.modelName)) || legacyFin(r.data)) ? '<button class="btn pri" data-a="conv" data-id="' + r.id + '" title="Converts the data of this case (made for ' + esc(r.modelName) + ') into a new case for the master model; this case stays as it is">Convert for the master model</button>' : ''}</div>${cpBox(CP[r.id])}</div>`;
  const caseGroups = list => {
    const inF = f => list.filter(r => r.folder === f.id),
      none = list.filter(r => !r.folder || !FID.has(r.folder));
    return (
      FOLD.map(
        f => `<details class="exs cfold" data-f="${esc(f.id)}" ${LIB.openF.has(f.id) || !LIB.openF.size ? 'open' : ''}><summary><span class="cfi">▤</span>${esc(f.name)} <span class="n">${inF(f).length}</span></summary>
        ${f.desc ? `<div class="ck-d">${esc(f.desc)}</div>` : ''}<div class="acts cfacts"><button class="btn sm" data-fa="ren" data-f="${esc(f.id)}">Name and description</button><button class="btn sm" data-fa="dup" data-f="${esc(f.id)}" title="A new folder with a copy of every case in it (data, model file, names, charts; not the runs)">Duplicate the folder</button><button class="btn sm" data-fa="del" data-f="${esc(f.id)}" title="The folder only: its cases stay, without a folder">Delete the folder</button><button class="btn sm danger" data-fa="delall" data-f="${esc(f.id)}" title="The folder and every case in it">Delete with its cases…</button></div>
        ${inF(f).map(caseRow).join('') || '<div class="empty">No case in this folder yet: choose this folder on a case, or tick cases and use “Move the ticked cases”.</div>'}</details>`
      ).join('') +
      (FOLD.length
        ? `<details class="exs cfold" data-f="" open><summary><span class="cfi">▤</span>Not in a folder <span class="n">${none.length}</span></summary>${none.map(caseRow).join('') || '<div class="empty">Every case is in a folder.</div>'}</details>`
        : none.map(caseRow).join(''))
    );
  };
  const ftools = `<div class="cftools"><button class="btn" id="cfnew">+ New folder</button>${FOLD.length ? `<span class="muted">Ticked cases:</span><select id="cfmove" aria-label="Move the ticked cases to"><option value="">Move the ticked cases to…</option><option value="__none">(no folder)</option>${FOLD.map(f => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('')}</select>` : '<span class="muted">Folders group the cases by theme (a country, a paper, a test series).</span>'}</div>`;
  dr.innerHTML = `<div class="dh"><div style="min-width:0"><div class="code">library</div><h2>${LIB.srv ? 'Cases' : 'Your models'}</h2><p>${LIB.srv ? `Every model you open or build is a case: a folder on this computer (${esc((SERVER.info && SERVER.info.cases_folder) || 'cases')}) with its data file, its model file and its runs, saved automatically as you work, like MUIO's DataStorage. The last one reopens when you start.` : 'Every model you open or build is kept here, in this browser, with its changes (saved automatically) and its model file; the last one reopens when you start the page. For a permanent copy use "Save data.txt".'}</p></div><div class="acts">${LIB.srv ? '<button class="btn" type="button" id="crest" title="Bring back a case from a backup zip (as a new case: nothing is overwritten)">Restore from a backup…</button><input type="file" id="crestf" accept=".zip" hidden>' : ''}<button class="btn" type="button" id="cstart" title="Choose the model to work with (the dialog shown at start)">Start dialog…</button><button class="btn x" type="button" id="close">Close</button></div></div>
  <div class="db">${avail ? '' : '<div class="ck warn"><div class="ck-h"><span class="sev warn">Warning</span><b>The browser library is not available here</b></div><div class="ck-d">Open Nour_OSeMOSYS_Studio.html as a file in Chrome, Edge or Firefox to keep your models; use "Save data.txt" meanwhile.</div></div>'}
   ${L0.length ? mbar : ''}${L.length ? ftools : ''}
   ${
     L.length
       ? caseGroups(L) +
         (orphans.length
           ? `<div class="ck"><div class="ck-h"><b>Checkpoints of deleted cases</b></div>${orphans.map(cpRow).join('')}</div>`
           : '')
       : `<div class="empty">${L0.length ? 'No case of this model yet: open a data file or build a new model with it.' : 'No models yet: open a data file or build a new model.'}</div>`
   }
   <details class="exs" style="margin-top:12px" open><summary>Example models <span class="n">${TEXT.examples.length}</span></summary>
     <div class="ck-d">Small complete models on the example system T1 of the parameter reference: one per topic, to check the model and the Studio. Each says what to check.</div>
     ${TEXT.examples
       .map(
         (
           x,
           i
         ) => `<div class="ck"><div class="ck-h"><b>${esc(x.name)}</b>${x.objective_glpk != null ? `<span class="muted">Objective (GLPK) ${fobj(x.objective_glpk)}</span>` : '<span class="sev warn">Infeasible on purpose</span>'}</div>
       <div class="ck-d">${esc(x.description)}</div><details><summary>What to check</summary><ul>${(x.check || []).map(c => `<li>${esc(c)}</li>`).join('')}</ul></details>
       <div class="acts" style="margin-top:5px"><button class="btn" data-ex="${i}">Open${LIB.srv ? ' as a new case' : ''}</button></div></div>`
       )
       .join('')}</details></div>`;
  dr.querySelector('#close').onclick = () => (dr.hidden = true);
  dr.querySelector('#cstart').onclick = async () => {
    try {
      localStorage.removeItem('mst_rsme_nostart');
    } catch (e) {}
    dr.hidden = true;
    const last = LIB.current ? await LIB.get(LIB.current) : null;
    startAct(await startChooser(last), last);
  };
  const cm = dr.querySelector('#cmodel');
  if (cm)
    cm.onchange = () => {
      LIB.modelF = cm.value;
      try {
        localStorage.setItem('mst_rsme_modelF', LIB.modelF);
      } catch (e) {}
      openLibrary();
    };
  const rb = dr.querySelector('#crest'),
    rf = dr.querySelector('#crestf');
  if (rb) {
    rb.onclick = () => rf.click();
    rf.onchange = async () => {
      const f = rf.files[0];
      if (!f) return;
      rf.value = '';
      const r = await restoreCase(f);
      if (r && r.ok) openLibrary();
    };
  }
  dr.querySelectorAll('details.cfold').forEach(
    d =>
      (d.ontoggle = () => {
        if (d.open) LIB.openF.add(d.dataset.f);
        else LIB.openF.delete(d.dataset.f);
      })
  );
  const fnew = dr.querySelector('#cfnew');
  if (fnew)
    fnew.onclick = async () => {
      const n = (await uiPrompt('Name of the new folder (e.g. a country, a paper, Tests):', '') || '').trim();
      if (!n) return;
      const ds = await uiPrompt('Description (optional):', '') || '';
      let id = n.replace(/\W+/g, '_').slice(0, 40) || 'folder';
      while (FOLD.some(f => f.id === id)) id += '_';
      FOLD.push({id, name: n, desc: ds.trim()});
      await LIB.setFolders(FOLD);
      LIB.openF.add(id);
      toast(`Folder "${n}" created`);
      openLibrary();
    };
  dr.querySelectorAll('.cfsel').forEach(
    sel =>
      (sel.onchange = async () => {
        const rec = await LIB.get(sel.dataset.id);
        if (!rec) return;
        await LIB.put({...rec, folder: sel.value || ''});
        toast(`${rec.name} → ${sel.value ? FOLD.find(f => f.id === sel.value).name : 'no folder'}`);
        if (sel.value) LIB.openF.add(sel.value);
        openLibrary();
      })
  );
  const mv = dr.querySelector('#cfmove');
  if (mv)
    mv.onchange = async () => {
      const ids = [...dr.querySelectorAll('.csel:checked')].map(c => c.dataset.id);
      const to = mv.value === '__none' ? '' : mv.value;
      if (!ids.length) {
        toast('Tick the cases to move first');
        mv.value = '';
        return;
      }
      for (const id of ids) {
        const rec = await LIB.get(id);
        if (rec) await LIB.put({...rec, folder: to});
      }
      toast(`${ids.length} case${ids.length > 1 ? 's' : ''} → ${to ? FOLD.find(f => f.id === to).name : 'no folder'}`);
      if (to) LIB.openF.add(to);
      openLibrary();
    };
  dr.querySelectorAll('[data-fa]').forEach(
    b =>
      (b.onclick = async ev => {
        ev.preventDefault();
        const f = FOLD.find(x => x.id === b.dataset.f);
        if (!f) return;
        const mine = L.filter(r => r.folder === f.id);
        if (b.dataset.fa === 'ren') {
          const n = await uiPrompt('Folder name', f.name);
          if (n === null) return;
          const ds = await uiPrompt('Description', f.desc || '');
          if (ds === null) return;
          f.name = n.trim() || f.name;
          f.desc = ds.trim();
          await LIB.setFolders(FOLD);
          toast(`Folder "${f.name}" saved`);
          return openLibrary();
        }
        if (b.dataset.fa === 'dup') {
          let id = f.id + '_copy';
          while (FOLD.some(x => x.id === id)) id += '_';
          const nf = {id, name: f.name + ' (copy)', desc: f.desc || ''};
          FOLD.push(nf);
          await LIB.setFolders(FOLD);
          for (const r of mine) {
            const rec = await LIB.get(r.id);
            if (!rec) continue;
            const c = {...rec, id: rec.id + '_copy' + Date.now(), name: rec.name + ' (copy)', folder: id, updated: Date.now()};
            delete c.frozen;
            delete c.checkpointOf;
            delete c.runs;
            await LIB.put(c);
          }
          LIB.openF.add(id);
          toast(`Folder copied with its ${mine.length} case${mine.length === 1 ? '' : 's'} (without the runs)`);
          return openLibrary();
        }
        if (b.dataset.fa === 'del') {
          if (!await uiConfirm(`Delete the folder "${f.name}"? Its ${mine.length} case${mine.length === 1 ? '' : 's'} stay, without a folder.`))
            return;
          for (const r of mine) {
            const rec = await LIB.get(r.id);
            if (rec) await LIB.put({...rec, folder: ''});
          }
          await LIB.setFolders(FOLD.filter(x => x.id !== f.id));
          toast(`Folder "${f.name}" deleted; its cases kept`);
          return openLibrary();
        }
        if (b.dataset.fa === 'delall') {
          if (
            !await uiConfirm(
              `Delete the folder "${f.name}" AND its ${mine.length} case${mine.length === 1 ? '' : 's'} (their folders and runs)?\n\n${mine.map(r => '· ' + r.name).join('\n')}`
            )
          )
            return;
          if (mine.length && !await uiConfirm('This cannot be undone. Delete them?')) return;
          for (const r of mine) {
            await LIB.del(r.id);
            if (r.id === LIB.current) LIB.current = null;
          }
          await LIB.setFolders(FOLD.filter(x => x.id !== f.id));
          toast(`Folder "${f.name}" and ${mine.length} case${mine.length === 1 ? '' : 's'} deleted`);
          return openLibrary();
        }
      })
  );
  dr.querySelectorAll('[data-ex]').forEach(
    b =>
      (b.onclick = () =>
        openExample(+b.dataset.ex).then(() => {
          dr.hidden = true;
        }))
  );
  dr.querySelectorAll('[data-a]').forEach(
    b =>
      (b.onclick = async () => {
        if (b.dataset.a === 'dir') {
          const r = await jpost('/api/case/' + b.dataset.id + '/reveal', {}).catch(e => ({error: e.message}));
          if (!r.ok) toast('Folder: ' + (r.path || '') + (r.error ? ' (' + r.error + ')' : ''));
          return;
        }
        if (b.dataset.a === 'bak') return backupMenu(b.dataset.id, b);
        if (b.dataset.a === 'cp') {
          dr.hidden = true;
          await makeCheckpoint();
          openLibrary();
          return;
        }
        const rec = await LIB.get(b.dataset.id);
        if (!rec) return;
        if (b.dataset.a === 'open') {
          if (dirty && !await uiConfirm('The current model has changes not yet in the library. Open anyway?')) return;
          LIB.openRec(rec);
          dr.hidden = true;
        }
        if (b.dataset.a === 'save') saveFile(rec.name.replace(/\.(txt|dat)$/i, '') + '.txt', rec.data, 'text/plain');
        if (b.dataset.a === 'conv') return convertCase(rec);
        if (b.dataset.a === 'dup') {
          {
            const c = {...rec, id: rec.id + '_copy' + Date.now(), name: rec.name + ' (copy)', updated: Date.now()};
            delete c.frozen;
            delete c.checkpointOf;
            delete c.runs;
            await LIB.put(c);
          }
          openLibrary();
        }
        if (b.dataset.a === 'ren') {
          const n = await uiPrompt('Name', rec.name);
          if (n === null) return;
          const ds = await uiPrompt('Description', rec.description || '');
          if (ds === null) return;
          const v = await uiPrompt('Version / scenario', rec.version || '');
          await LIB.put({...rec, name: n || rec.name, description: ds, version: v || ''});
          if (rec.id === LIB.current) {
            M.meta.name = n || rec.name;
            M.meta.description = ds;
            caseLine();
          }
          openLibrary();
        }
        if (b.dataset.a === 'del') {
          if (
            !await uiConfirm(
              rec.frozen
                ? `Delete checkpoint ${rec.checkpointNo} of ${rec.name}?`
                : LIB.srv
                  ? `Delete the case ${rec.name}, its folder and its runs? (Its checkpoints are kept.)`
                  : `Delete ${rec.name} from the library? (Its checkpoints are kept.)`
            )
          )
            return;
          await LIB.del(rec.id);
          if (rec.id === LIB.current) LIB.current = null;
          openLibrary();
        }
      })
  );
}
const build = {on: false};
function setBuildUI() {
  document.getElementById('buildbar').hidden = !build.on;
  document.getElementById('bld').setAttribute('aria-pressed', build.on);
}

/* ---- a case made for another model file -> a new case for the master model (the original stays) ---- */
async function convertCase(rec) {
  if (!rec.model && !legacyFin(rec.data) && !/^OSeMOSYS master 0\.[0-6]\b/.test(rec.modelName || '')) {
    toast('This case has no model file of its own to convert from.');
    return;
  }
  const dr = document.getElementById('drawer');
  dr.hidden = false;
  dr.innerHTML = '<div class="db"><p class="muted">Converting…</p></div>';
  let r;
  try {
    r = await jpost('/api/convert', {data: rec.data, model: rec.model || null, master: MODELTXT()});
  } catch (e) {
    r = {ok: false, error: e.message};
  }
  if (!r.ok) {
    dr.innerHTML = `<div class="db"><div class="ck error"><div class="ck-d">Not converted: ${esc(r.error || '')}</div></div></div>`;
    return;
  }
  const name = rec.name.replace(/\.(txt|dat)$/i, '') + ' · master';
  setSchema(MODELTXT(), BUILTIN_NAME);
  load(r.data, {name, version: rec.version, description: rec.description, note: 'converted for the master model'});
  LIB.current = null;
  await LIB.store(name, writeData(), {convertedFrom: rec.id, conversion: r.report, charts: rec.charts, views: rec.views});
  caseLine();
  showConversion(r.report, rec.modelName, name);
}
function showConversion(R, from, name) {
  const dr = document.getElementById('drawer');
  dr.hidden = false;
  const lst = (t, a) =>
    a && a.length ? `<h4>${esc(t)} <span class="muted">${a.length}</span></h4><ul>${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  const lv = R.balance_levels || {};
  dr.innerHTML = `<div class="dh"><div style="min-width:0"><div class="code">conversion · ${esc(R.source)}</div><h2>${esc(name)}</h2><p>A new case for the master model, made from the data of ${esc(from || 'another model file')}. The original case is unchanged.</p></div><button class="btn x" type="button" id="close">Close</button></div>
    <div class="db">${R.warnings && R.warnings.length ? `<div class="ck warn"><div class="ck-h"><span class="sev warn">Check</span><b>${R.warnings.length} item(s) to look at</b></div><div class="ck-d"><ul>${R.warnings.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div></div>` : '<div class="ck"><div class="ck-d">Everything in the data has its place in the master model.</div></div>'}
      ${lst('Copied as they are', R.copied)}${lst('Ratios by time slice', R.profiles)}
      ${lv.yearly || lv['by season'] ? `<h4>Balance levels</h4><ul>${lv.yearly && lv.yearly.length ? `<li>Balanced by year (CommodityTimeSliced 0): ${esc(lv.yearly.join(', '))}</li>` : ''}${lv['by season'] && lv['by season'].length ? `<li>balanced by season (CommodityTimeSliced 2): ${esc(lv['by season'].join(', '))}</li>` : ''}</ul>` : ''}
      ${R.depreciation ? `<h4>Salvage value</h4><ul><li>${esc(R.depreciation)}</li></ul>` : ''}
      ${lst('Finance (the earlier budget / FDI / borrowing / fund -> finance sources)', R.finance)}${lst('Switched off (the modules the source did not have)', R.neutral)}${lst('Default of the source model file', R.source_default)}${lst('Not written (the master model computes them, or has no place for them)', R.dropped)}</div>`;
  dr.querySelector('#close').onclick = () => (dr.hidden = true);
}

// open an example model: with the server it becomes a new case (the example itself never changes)
async function openExample(i) {
  const x = TEXT.examples[i];
  if (!x) return;
  if (dirty && !await uiConfirm('The current model has changes not yet saved. Open the example anyway?')) return;
  if (LIB.srv && x.backup && (await openExampleCase(x))) return;
  LIB.current = null;
  setSchema(MODELTXT(), BUILTIN_NAME);
  load(x.text, {name: x.name, note: 'example'});
  if (LIB.srv) {
    try {
      await LIB.store(x.id + ' ' + x.name.replace(/^E\w+\s+/, ''), writeData(), {description: x.description, example: x.id});
      dirty = false;
    } catch (e) {
      console.error(e);
    }
  }
  toast(`${x.name}: what to check is in Cases → Example models`);
}
/* the example as a case with its runs: a case backup shipped with the Studio (data/examples), with a solved run, a Monte
   Carlo run and a robust-decision run. Restored the first time, then the same case is opened (the user's changes stay;
   deleting the case brings the example back as shipped). Without the server: the example data only (above). */
async function openExampleCase(x) {
  try {
    let rec = (await LIB.all()).find(r => r.exampleBackup === x.backup);
    if (!rec) {
      const res = await fetch('data/examples/' + x.backup);
      if (!res.ok) return false;
      const r = await restoreCase(new File([await res.blob()], x.backup, {type: 'application/zip'}));
      if (!r || !r.ok) return false;
      rec = {id: r.id};
    }
    rec = await LIB.get(rec.id);
    if (!rec) return false;
    await LIB.openRec(rec);
    toast(`${x.name}: its runs are in Results, Monte Carlo and Robust decisions`);
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

/* back up / restore a case as ONE zip: server/backup.py */
function backupMenu(id, btn) {
  document.querySelectorAll('.bakpop').forEach(x => x.remove());
  const m = document.createElement('div');
  m.className = 'bakpop';
  m.setAttribute('role', 'dialog');
  m.innerHTML = `<b>Back up this case as one zip</b><p class="muted small">Data, model file, scenarios, systems, charts, every run and its results, Monte Carlo and robust-decision set-ups and runs, checkpoints.</p>
    <button class="btn pri" data-k="full">Full backup<span>Everything, nothing to solve again</span></button><button class="btn" data-k="light">Light backup<span>without the solved Monte Carlo / RDM futures (they can be solved again)</span></button><button class="btn" data-k="x">Cancel</button>`;
  document.body.appendChild(m);
  placeNear(m, btn.getBoundingClientRect(), 'left');
  m.querySelectorAll('[data-k]').forEach(
    b =>
      (b.onclick = () => {
        m.remove();
        if (b.dataset.k !== 'x') backupCase(id, b.dataset.k === 'light');
      })
  );
  setTimeout(
    () =>
      document.addEventListener('click', function off(e) {
        if (!m.contains(e.target)) {
          m.remove();
          document.removeEventListener('click', off);
        }
      }),
    0
  );
}
async function backupCase(id, light) {
  await LIB.flush(); // the last edits are in the case before it is zipped
  toast('Preparing the backup…');
  const api = window.pywebview && window.pywebview.api;
  if (api && api.save_url) {
    try {
      const r = await api.save_url(SERVER.url + `/api/case/${encodeURIComponent(id)}/backup?light=${light ? 1 : 0}`, id + '_backup.zip'); // straight to the file (desktop app)
      if (!r) return toast('Backup cancelled');
      if (r.error) throw new Error(r.error);
      return toast(`Backup saved: ${r.path} (${(r.bytes / 1e6).toFixed(1)} MB)`);
    } catch (e) {
      return toast('Backup failed: ' + (e.message || e));
    }
  }
  try {
    const r = await fetch(SERVER.url + `/api/case/${encodeURIComponent(id)}/backup?light=${light ? 1 : 0}`);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
    const name = r.headers.get('X-File-Name') || id + '_backup.zip';
    const blob = await r.blob();
    await saveFile(name, blob, 'application/zip');
    toast(`Backup ${name}: ${(blob.size / 1e6).toFixed(1)} MB`);
  } catch (e) {
    toast('Backup failed: ' + e.message);
  }
}
async function restoreCase(file) {
  toast('Restoring ' + file.name + '…');
  let r;
  try {
    r = await api('/api/case/restore', {method: 'POST', headers: {'Content-Type': 'application/zip'}, body: await file.arrayBuffer()});
  } catch (e) {
    r = {ok: false, error: e.message};
  }
  if (!r.ok) {
    toast('Not restored: ' + (r.error || ''));
    return r;
  }
  const c = r.contents || {},
    parts = [`${c.runs || 0} run(s)`, `${c.monte_carlo || 0} Monte Carlo`, `${c.rdm || 0} robust-decision run(s)`].concat(
      c.rolling_horizon ? [`${c.rolling_horizon} rolling-horizon run(s)`] : []
    );
  toast(
    `Restored "${r.name}" (${parts.join(', ')}${r.checkpoints && r.checkpoints.length ? ', ' + r.checkpoints.length + ' checkpoint(s)' : ''}${r.light ? '; light backup: solved futures not included' : ''})`
  );
  return r;
}
