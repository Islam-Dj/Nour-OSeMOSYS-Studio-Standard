'use strict';
/* ============================== model files: a library, chosen for each case ==============================
   Every model file you upload is kept with a name and a description (server: models/<id>/, next to the cases;
   page opened as a file: this browser). Opening a data file asks which model file reads it (the one whose parameters
   and index sets match the data best is proposed); a new model is built inside the model file you choose. The case
   keeps its own copy of the model file (runs stay reproducible) and remembers which library model it came from. */
const MODELS = {
  list: [],
  cache: new Map(),
  loaded: false,
  BUILTIN: {
    id: '_muio54',
    name: BUILTIN_NAME,
    description: STANDARD
      ? 'The standard OSeMOSYS model (model.v.5.7.txt, unchanged, Apache-2.0). It is the model file MUIO uses: cases are built and solved as MUIO builds and solves them, and can be exchanged with MUIO.'
      : 'The OSeMOSYS master model (OSeMOSYS code model.v.5.3.4-R + seasonal ratios, export margin, storage in user constraints, results in the model), shipped with the Studio.',
    builtin: true
  },
  BUILTIN57: {
    id: '_muio57',
    name: MUIO57_NAME,
    description:
      'The standard OSeMOSYS model (model.v.5.7.txt, unchanged, Apache-2.0). It is the model file MUIO uses: for cases made with MUIO, solved as MUIO solves them.',
    builtin: true
  },
  async load() {
    let L = [];
    if (LIB.srv) {
      try {
        L = await api('/api/models');
      } catch (e) {
        L = [];
      }
    } else {
      try {
        L = JSON.parse(localStorage.getItem('mst_rsme_models') || '[]').map(({text, ...r}) => r);
      } catch (e) {
        L = [];
      }
    }
    this.list = [this.BUILTIN, ...(STANDARD ? [] : [this.BUILTIN57]), ...L.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))];
    this.loaded = true;
    return this.list;
  },
  async text(id) {
    if (!id || id === '_muio54') return MODELTXT();
    if (id === '_muio57') {
      if (!TEXT.muio57)
        TEXT.muio57 =
          inlineText('muio57-model') ||
          (await fetch('data/builtin_model.txt')
            .then(r => (r.ok ? r.text() : null))
            .catch(() => null));
      return TEXT.muio57;
    }
    if (this.cache.has(id)) return this.cache.get(id);
    let t = null;
    if (LIB.srv) {
      try {
        t = (await api('/api/model/' + id)).text;
      } catch (e) {}
    } else {
      try {
        t = (JSON.parse(localStorage.getItem('mst_rsme_models') || '[]').find(r => r.id === id) || {}).text;
      } catch (e) {}
    }
    if (t) this.cache.set(id, t);
    return t;
  },
  async save(id, rec) {
    if (rec.text) this.cache.set(id, rec.text);
    if (LIB.srv) {
      const r = await jpost('/api/model/' + id, rec);
      if (!r.ok) throw new Error(r.error || 'not saved');
    } else {
      const all = JSON.parse(localStorage.getItem('mst_rsme_models') || '[]');
      const i = all.findIndex(r => r.id === id),
        old = i >= 0 ? all[i] : {added: new Date().toISOString().slice(0, 19).replace('T', ' ')};
      const nr = {...old, ...rec, id, updated: new Date().toISOString().slice(0, 19).replace('T', ' ')};
      if (rec.text) Object.assign(nr, modelSummary(rec.text));
      if (i >= 0) all[i] = nr;
      else all.push(nr);
      localStorage.setItem('mst_rsme_models', JSON.stringify(all));
    }
    await this.load();
  },
  async del(id) {
    this.cache.delete(id);
    if (LIB.srv) await jpost('/api/model/' + id + '/delete', {});
    else {
      const all = JSON.parse(localStorage.getItem('mst_rsme_models') || '[]').filter(r => r.id !== id);
      localStorage.setItem('mst_rsme_models', JSON.stringify(all));
    }
    await this.load();
  },
  async newId(name) {
    await this.load();
    let id =
      (name || 'model')
        .replace(/\.(txt|mod)$/i, '')
        .replace(/\W+/g, '_')
        .slice(0, 60) || 'model';
    const have = new Set(this.list.map(m => m.id));
    if (have.has(id)) {
      let k = 2;
      while (have.has(id + '_' + k)) k++;
      id += '_' + k;
    }
    return id;
  }
};
function modelSummary(text) {
  const s = text.replace(/#[^\n]*/g, '');
  return {
    params: (s.match(/^\s*param\s+\w+/gm) || []).length,
    sets: (s.match(/^\s*set\s+\w+/gm) || []).length,
    constraints: (s.match(/^\s*s\.t\.\s+\w+/gm) || []).length,
    size: text.length
  };
}
const curModelId = () => (SCHEMA ? SCHEMA.modelId || (SCHEMA.name === BUILTIN_NAME || !SCHEMA.fromFile ? '_muio54' : null) : '_muio54'); // '_muio54' = the built-in model (the master model here)
async function useModel(id, quiet, save = true) {
  // the model file of the current case
  const t = await MODELS.text(id);
  if (!t) return toast('Model file not found in the library');
  const m = MODELS.list.find(x => x.id === id) || {};
  setSchema(t, id === '_muio54' ? BUILTIN_NAME : id === '_muio57' ? MUIO57_NAME : m.name || id);
  SCHEMA.modelId = id;
  if (M && save) LIB.autosave();
  if (!quiet) toast(`This case now uses the model file ${m.name || id}`);
}

/* how well a model file reads a data file: each parameter of the data declared by the model with the same index sets */
function modelFit(D, S) {
  const ps = Object.values(D.params).filter(p => p.recs.length),
    out = {ok: 0, total: ps.length, missing: [], dims: []};
  for (const p of ps) {
    const mp = S.params.get(p.name);
    if (!mp) {
      out.missing.push(p.name);
      continue;
    }
    const n = p.recs[0].idx.length;
    if (mp.dims.length && mp.dims.length !== n) {
      out.dims.push(`${p.name} (data ${n} indices, model ${mp.dims.length})`);
      continue;
    }
    out.ok++;
  }
  const sets = Object.keys(D.sets || {}).filter(s => D.sets[s] && D.sets[s].length),
    msets = new Set([...S.sets, ...S.optSets]);
  out.setsMissing = sets.filter(s => !msets.has(s) && !(s === 'FUEL' && msets.has('COMMODITY')));
  out.score = out.total ? out.ok / out.total : 0;
  return out;
}

/* dialog: name, version and description of a model file (on upload) -> {name, version, description} or null */
function askModelInfo(fileName, S) {
  return new Promise(res => {
    const d = document.createElement('div');
    d.className = 'pop modal';
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-label', 'Describe the model file');
    d.innerHTML = `<h3>Add the model file ${esc(fileName)}</h3><p class="muted">${S.params.size} parameters · ${S.cons.length} constraints · ${S.sets.length} sets. Give it a name and say what it is for: you will choose it by this name when you open data or build a model.</p>
      <form class="frm" id="mi"><div class="row2"><label>Name<input name="name" required value="${esc(fileName.replace(/\.(txt|mod|gmpl)$/i, ''))}"></label><label>Version<input name="ver" placeholder="e.g. 5.3-ts"></label></div>
      <label>Description<textarea name="desc" rows="3" placeholder="What this model file adds or changes, and which data it is for"></textarea></label>
      <div class="acts"><button class="btn" type="button" id="mic">Cancel</button><button class="btn pri" type="submit">Add to Model files</button></div></form>`;
    document.body.appendChild(d);
    const f = d.querySelector('#mi');
    f.name.select();
    d.querySelector('#mic').onclick = () => {
      d.remove();
      res(null);
    };
    f.onsubmit = ev => {
      ev.preventDefault();
      const fd = new FormData(f);
      d.remove();
      res({
        name: String(fd.get('name')).trim(),
        version: String(fd.get('ver') || '').trim(),
        description: String(fd.get('desc') || '').trim()
      });
    };
  });
}
/* read a model file chosen on the computer, describe it, add it to the library -> id or null */
async function addModelFromFile(file) {
  const text = await file.text();
  let S;
  try {
    S = parseModelFile(text, file.name);
    if (!S.params.size) throw new Error('no "param" declarations found');
  } catch (e) {
    toast('Not a model file: ' + e.message);
    return null;
  }
  await MODELS.load();
  for (const m of MODELS.list)
    if (!m.builtin && (await MODELS.text(m.id)) === text) {
      toast(`This model file is already in the library as ${m.name}`);
      return m.id;
    }
  const info = await askModelInfo(file.name, S);
  if (!info) return null;
  const id = await MODELS.newId(info.name);
  await MODELS.save(id, {...info, file: file.name, text});
  toast(`Model file ${info.name} added: ${S.params.size} parameters, ${S.cons.length} constraints`);
  return id;
}

/* dialog when a data file is opened: its name and description, and the model file that reads it (best match ticked) */
async function openDataDialog(text, fileName) {
  await MODELS.load();
  let D = null;
  try {
    D = parseData(text);
  } catch (e) {}
  const score = async () => {
    const rows = [];
    for (const m of MODELS.list) {
      const t = await MODELS.text(m.id);
      if (!t) continue;
      let S;
      try {
        S = parseModelFile(t, m.name);
      } catch (e) {
        continue;
      }
      rows.push({m, f: D ? modelFit(D, S) : {ok: 0, total: 0, missing: [], dims: [], setsMissing: [], score: 0}});
    }
    return rows.sort((a, b) => b.f.score - a.f.score || a.f.setsMissing.length - b.f.setsMissing.length);
  };
  let rows = await score(),
    picked = null;
  const base = fileName.replace(/\.(txt|dat)$/i, '');
  return new Promise(res => {
    const d = document.createElement('div');
    d.className = 'pop modal';
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-label', 'Open a data file');
    const list = () =>
      rows
        .map((r, i) => {
          const f = r.f,
            pc = Math.round(100 * f.score),
            on = picked ? r.m.id === picked : i === 0;
          return `<label class="pmode"><input type="radio" name="mch" value="${esc(r.m.id)}" ${on ? 'checked' : ''}><span><b>${esc(r.m.name || r.m.id)}</b>${r.m.version ? ` <span class="sev">${esc(r.m.version)}</span>` : ''}${i === 0 && f.total ? ' <span class="jtag ok">Best match</span>' : ''}<br>
        <span class="muted">${esc(r.m.description || 'No description.')}</span><br>
        ${f.total ? `<span>${f.ok} / ${f.total} parameters of the data match (${pc} %)</span>` : ''}${f.dims.length ? `<br><span class="bad">Different index sets: ${esc(f.dims.slice(0, 4).join('; '))}${f.dims.length > 4 ? '…' : ''}</span>` : ''}${f.missing.length ? `<br><span class="warn">Not declared: ${esc(f.missing.slice(0, 6).join(', '))}${f.missing.length > 6 ? '…' : ''}</span>` : ''}${f.setsMissing.length ? `<br><span class="warn">Sets not declared: ${esc(f.setsMissing.join(', '))}</span>` : ''}</span></label>`;
        })
        .join('');
    d.innerHTML = `<h3>Open ${esc(fileName)}</h3>
      <form class="frm" id="od">
        <div class="row2"><label>Name of the case<input name="name" required value="${esc(base)}"></label><label>Version / scenario (optional)<input name="ver" placeholder="e.g. v1, baseline"></label></div>
        <label>Description<textarea name="desc" rows="2" placeholder="What this model is, its source, its scenario"></textarea></label>
        ${
          typeof M !== 'undefined' && M && M.D
            ? `<fieldset class="howset"><legend>Open it as</legend><div class="howopts">
          <label class="howopt"><input type="radio" name="how" value="new" checked><span><b>A new case</b><span class="muted">The data opens on its own, as a separate case. The open case is not touched.</span></span></label>
          <label class="howopt"><input type="radio" name="how" value="merge"><span><b>Added to the open case</b><span class="muted">Its technologies, commodities, storages and values join ${esc(M.meta.name || 'the open case')}, which keeps its years and time slices.</span></span></label></div></fieldset>`
            : ''
        }
        <fieldset><legend>Model file that reads this data</legend><p class="muted" style="margin:0 0 6px">It sets the parameters of the forms, how the data is written and the problem the solver gets. The best match is ticked.</p>
          <div class="mfit" id="odl">${list()}</div>
          <label class="btn" style="align-self:flex-start;margin-top:6px">Add another model file…<input type="file" id="odm" accept=".txt,.mod,.gmpl" hidden></label></fieldset>
        <div class="acts"><button class="btn" type="button" id="odc">Cancel</button><button class="btn pri" type="submit">Open</button></div></form>`;
    document.body.appendChild(d);
    const f = d.querySelector('#od');
    f.name.select();
    d.querySelector('#odc').onclick = () => {
      d.remove();
      res(null);
    };
    d.querySelector('#odm').onchange = async e => {
      const fl = e.target.files[0];
      e.target.value = '';
      if (!fl) return;
      const id = await addModelFromFile(fl);
      if (!id) return;
      picked = id;
      rows = await score();
      d.querySelector('#odl').innerHTML = list();
    };
    f.onsubmit = ev => {
      ev.preventDefault();
      const fd = new FormData(f);
      d.remove();
      res({
        how: String(fd.get('how') || 'new'),
        mid: String(fd.get('mch') || '_muio54'),
        name: String(fd.get('name')).trim() || base,
        version: String(fd.get('ver') || '').trim(),
        description: String(fd.get('desc') || '').trim()
      });
    };
  });
}

async function openModels() {
  const dr = document.getElementById('drawer');
  dr.hidden = false;
  await MODELS.load();
  await MODELS.text('_muio57');
  const cur = curModelId(),
    stats = m =>
      m.builtin
        ? (() => {
            const s = modelSummary(m.id === '_muio57' ? TEXT.muio57 || '' : MODELTXT());
            return `${s.params} parameters · ${s.constraints} constraints`;
          })()
        : `${m.params ?? '?'} parameters · ${m.constraints ?? '?'} constraints${m.md5 ? ' · ' + m.md5 : ''}`;
  dr.innerHTML = `<div class="dh"><div style="min-width:0"><div class="code">model files</div><h2>Model files</h2>
    <p>The model files you work with, each with a name and a description. A case uses one of them: its forms, its data file and the problem built for the solver follow that model file. ${LIB.srv ? `Kept in the folder <code>Models</code> next to your cases.` : 'Kept in this browser.'}</p></div><button class="btn x" type="button" id="close" aria-label="Close">Close</button></div>
  <div class="db">
    <form id="mup" class="frm"><fieldset><legend>Add a model file</legend>
      <label>Model file (.txt, .mod)<input type="file" name="f" accept=".txt,.mod,.gmpl" required></label>
      <div class="row2"><label>Name<input name="name" placeholder="e.g. OSeMOSYS 5.3 seasonal (time-slice IAR / OAR)"></label><label>Version<input name="ver" placeholder="e.g. 5.3-ts"></label></div>
      <label>Description<textarea name="desc" rows="3" placeholder="What this model file adds or changes, and which data it is for"></textarea></label>
      <label class="chk"><input type="checkbox" name="use"> Use it for the open case${M ? ` (${esc(M.meta.name || '')})` : ''}</label>
      <div class="acts"><button class="btn pri" type="submit">Add to the library</button></div></fieldset></form>
    ${MODELS.list
      .map(
        m => `<div class="ck${m.id === cur ? ' cur' : ''}"><div class="ck-h"><b>${esc(m.name || m.id)}</b>${m.version ? `<span class="sev">${esc(m.version)}</span>` : ''}${m.id === cur ? '<span class="sev info">Used by this case</span>' : ''}</div>
      <div class="ck-d">${esc(m.description || 'No description yet.')}</div>
      <div class="ck-w">${stats(m)}${m.cases && m.cases.length ? ` · cases: ${esc(m.cases.join(', '))}` : ''}${m.updated ? ` · ${esc(m.updated)}` : ''}</div>
      <div class="acts" style="margin-top:6px">${m.id === cur ? '<button class="btn" data-a="see" data-id="' + m.id + '">Sets, parameters, constraints</button>' : `<button class="btn pri" data-a="use" data-id="${m.id}">Use for this case</button>`}
        ${m.builtin ? '' : `<button class="btn" data-a="edit" data-id="${m.id}">Name and description</button><button class="btn" data-a="save" data-id="${m.id}">Save as file</button><button class="btn danger" data-a="del" data-id="${m.id}">Remove</button>`}</div></div>`
      )
      .join('')}
    ${SCHEMA && SCHEMA.fromFile && !SCHEMA.modelId ? `<div class="ck warn"><div class="ck-h"><span class="sev warn">Not in the library</span><b>${esc(SCHEMA.name)}</b></div><div class="ck-d">The open case uses a model file that is not in the library yet.</div><div class="acts" style="margin-top:6px"><button class="btn" id="madd">Add it to the library</button></div></div>` : ''}
  </div>`;
  dr.querySelector('#close').onclick = () => (dr.hidden = true);
  dr.querySelector('#mup').onsubmit = async ev => {
    ev.preventDefault();
    const fd = new FormData(ev.target),
      f = fd.get('f');
    if (!f || !f.name) return;
    const text = await f.text();
    let S;
    try {
      S = parseModelFile(text, f.name);
      if (!S.params.size) throw new Error('no "param" declarations found');
    } catch (e) {
      return toast('Not a model file: ' + e.message);
    }
    const name = String(fd.get('name') || '').trim() || f.name.replace(/\.(txt|mod|gmpl)$/i, ''),
      id = await MODELS.newId(name);
    try {
      await MODELS.save(id, {
        name,
        description: String(fd.get('desc') || '').trim(),
        version: String(fd.get('ver') || '').trim(),
        file: f.name,
        text
      });
    } catch (e) {
      return toast('Could not save: ' + e.message);
    }
    toast(`Model file ${name} added: ${S.params.size} parameters, ${S.cons.length} constraints`);
    if (fd.get('use') && M) await useModel(id, true);
    openModels();
  };
  const add = dr.querySelector('#madd');
  if (add)
    add.onclick = async () => {
      const name = await uiPrompt('Name of this model file', SCHEMA.name.replace(/\.(txt|mod)$/i, ''));
      if (!name) return;
      const desc = await uiPrompt('Description (what it adds, which data it is for)', '') || '';
      const id = await MODELS.newId(name);
      await MODELS.save(id, {name, description: desc, text: SCHEMA.text, file: SCHEMA.name});
      SCHEMA.modelId = id;
      LIB.autosave();
      openModels();
    };
  dr.querySelectorAll('[data-a]').forEach(
    b =>
      (b.onclick = async () => {
        const id = b.dataset.id,
          m = MODELS.list.find(x => x.id === id);
        if (b.dataset.a === 'see') return openModelFile();
        if (b.dataset.a === 'use') {
          if (!M) return toast('Open or build a model first');
          if (!await uiConfirm(`Use the model file ${m.name} for this case? The forms and the data written for the solver will follow it.`)) return;
          await useModel(id);
          openModels();
        }
        if (b.dataset.a === 'edit') {
          const name = await uiPrompt('Name', m.name || id);
          if (name === null) return;
          const desc = await uiPrompt('Description', m.description || '');
          if (desc === null) return;
          const ver = await uiPrompt('Version', m.version || '');
          await MODELS.save(id, {name, description: desc, version: ver || ''});
          if (SCHEMA && SCHEMA.modelId === id) SCHEMA.name = name;
          openModels();
        }
        if (b.dataset.a === 'save')
          saveFile((m.file || m.name || id).replace(/\.(txt|mod)$/i, '') + '.txt', await MODELS.text(id), 'text/plain');
        if (b.dataset.a === 'del') {
          if (!await uiConfirm(`Remove ${m.name} from the library? Cases keep their own copy of it.`)) return;
          await MODELS.del(id);
          openModels();
        }
      })
  );
}
