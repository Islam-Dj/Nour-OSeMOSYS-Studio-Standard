'use strict';
/* ============================== EXPORT TO MUIO (muio_bridge.py, MUIO's own code) ============================== */
const curModelText = () => (SCHEMA && SCHEMA.fromFile ? SCHEMA.text : MODELTXT());
async function openMuio() {
  const dr = document.getElementById('drawer');
  dr.hidden = false;
  dr.innerHTML = '<div class="db"><div class="empty">Looking for the Studio server…</div></div>';
  const I = await serverInfo();
  const head = `<div class="dh"><div style="min-width:0"><div class="code">export · MUIO</div><h2>Export to MUIO</h2>
    <p>Creates a case in your MUIO installation with MUIO's own code (the case appears in MUIO's case list, like a case made in MUIO). Your Studio model is not changed.</p></div><button class="btn x" type="button" id="close">Close</button></div>`;
  if (!I) {
    dr.innerHTML =
      head +
      `<div class="db"><div class="ck warn"><div class="ck-h"><span class="sev warn">Not connected</span><b>The Studio server is not running</b></div>
     <div class="ck-d">Export to MUIO runs on this computer: double-click <code>START_SOLVER.bat</code>, then open this window again.</div><div class="acts" style="margin-top:6px"><button class="btn" id="mretry">Try again</button></div></div></div>`;
    dr.querySelector('#close').onclick = () => {
      dr.hidden = true;
    };
    dr.querySelector('#mretry').onclick = openMuio;
    return;
  }
  const [MI, runs] = await Promise.all([api('/api/muio').catch(e => ({error: e.message})), api('/api/runs').catch(() => [])]);
  const done = runs.filter(r => r.state === 'done');
  const cname = (M.meta.name || 'model').replace(/\.(txt|dat)$/i, '').replace(/[^\w-]+/g, '_');
  dr.innerHTML =
    head +
    `<div class="db">
    <div class="ck warn"><div class="ck-h"><span class="sev warn">Before you export</span><b>What MUIO can hold</b></div>
      <div class="ck-d">A MUIO case has <b>One region</b> and only the parameters and sets of standard OSeMOSYS (MUIO 5.x).
      <b>Full model</b> is possible only for such a standard model: MUIO then has the whole model and can solve it again.
      Otherwise only <b>Results</b> can go to MUIO: an empty case (technologies, commodities, years, time slices, no data) with the results of one solved run, to view with MUIO's charts and tables.
      Options that are not possible for this model are greyed out with the reason.</div></div>
    <fieldset><legend>MUIO on this computer</legend>
      <label>MUIO DataStorage folder<input id="mst" value="${esc(MI.storage || '')}" placeholder="…\\MUIO\\WebAPP\\DataStorage  (the folder that holds Parameters.json)"></label>
      ${(MI.candidates || []).length ? `<div class="hint">Found: ${MI.candidates.map(c => `<a href="#" class="mcand" data-p="${esc(c)}">${esc(c)}</a>`).join(' · ')}</div>` : ''}
      <div class="acts"><button class="btn" id="mset" type="button">Use this folder</button></div>
      <div id="mstat" class="ck-w">${MI.valid ? `✓ MUIO DataStorage found · ${MI.cases.length} case(s)` : 'Not set: give the folder of your MUIO installation (MUIO\\WebAPP\\DataStorage).'}${MI.pandas_ok === false ? `<br><span class="sev warn">Python</span> ${esc(MI.needs)}` : ''}</div>
    </fieldset>
    <form id="mf" class="frm">
      <label>Source<select name="run"><option value="">This model, as it is now (no results)</option>${done.map((r, i) => `<option value="${esc(r.id)}" ${i === 0 ? 'selected' : ''}>Run: ${esc(r.name || r.id)} · ${esc(r.created || '')} · ${esc(r.solver_status || '')}${r.objective != null ? ' · ' + fobj(r.objective) : ''}</option>`).join('')}</select>
        <span class="hint">A run is exported with its own model and data files, so the case and the results match.</span></label>
      <fieldset><legend>What to export</legend><div id="mopts"><div class="empty">Checking…</div></div></fieldset>
      <label>MUIO case name<input name="case" value="${esc(cname)}" required></label>
      <label>Name of the run in MUIO<input name="runname" value="studio_run"></label>
      <div class="acts"><button class="btn pri" type="submit" id="mgo" disabled>Export</button></div>
    </form><div id="mout"></div></div>`;
  dr.querySelector('#close').onclick = () => {
    dr.hidden = true;
  };
  const f = dr.querySelector('#mf'),
    opts = dr.querySelector('#mopts'),
    go = dr.querySelector('#mgo');
  dr.querySelectorAll('.mcand').forEach(
    a =>
      (a.onclick = ev => {
        ev.preventDefault();
        dr.querySelector('#mst').value = a.dataset.p;
      })
  );
  dr.querySelector('#mset').onclick = async () => {
    const r = await api('/api/muio/config', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({storage: dr.querySelector('#mst').value})
    });
    if (r.error) toast(r.error);
    else {
      toast('MUIO folder saved');
      openMuio();
    }
  };
  const assess = async () => {
    opts.innerHTML = '<div class="empty">Checking…</div>';
    go.disabled = true;
    const run = f.run.value,
      body = run ? {run} : {data: writeData(), model: curModelText()};
    let A;
    try {
      A = await api('/api/muio/assess', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    } catch (e) {
      opts.innerHTML = `<div class="ck error">${esc(e.message)}</div>`;
      return;
    }
    const noMuio = !(A.muio && A.muio.valid),
      why = noMuio ? ['set the MUIO DataStorage folder above'] : [];
    const fullWhy = noMuio ? why : A.full ? [] : A.reasons.filter(x => !/results-only/.test(x));
    const resWhy = noMuio ? why : A.results ? [] : ['choose a solved run as the source'];
    const opt = (v, ok, title, txt, w) =>
      `<label class="mopt ${ok ? '' : 'off'}"><input type="radio" name="mode" value="${v}" ${ok ? '' : 'disabled'}> <b>${title}</b> — ${txt}${ok ? '' : `<br><span class="sev warn">Not possible</span> ${w.map(esc).join('; ')}`}</label>`;
    opts.innerHTML =
      opt(
        'full',
        A.full && !noMuio,
        'Full model' + (run ? ' + results' : ''),
        run ? 'the case with all its data, and the run results' : 'the case with all its data (solve it in MUIO)',
        fullWhy
      ) +
      opt(
        'results',
        A.results && !noMuio,
        'Results only',
        'an empty case (sets and names) + the results of the run' +
          ((A.regions || []).length > 1 ? `; MUIO shows the results of one region: ${esc(A.regions[0])}` : ''),
        resWhy
      );
    const first = opts.querySelector('[name=mode]:not([disabled])');
    if (first) {
      first.checked = true;
      go.disabled = false;
    }
  };
  f.run.onchange = assess;
  assess();
  f.onsubmit = async ev => {
    ev.preventDefault();
    const mode = (f.querySelector('[name=mode]:checked') || {}).value;
    if (!mode) return;
    if (
      !await uiConfirm(
        mode === 'full'
          ? `Create the MUIO case "${f.case.value}" with the full model${f.run.value ? ' and the run results' : ''}?`
          : `Create the MUIO case "${f.case.value}" with an EMPTY model and the results only?\nMUIO will show the results, but it cannot solve this case again.`
      )
    )
      return;
    const out = dr.querySelector('#mout');
    out.innerHTML = '<div class="ck"><div class="ck-w">Exporting with MUIO\'s code…</div></div>';
    go.disabled = true;
    const body = {mode, case: f.case.value, runname: f.runname.value, run: f.run.value || undefined};
    if (!f.run.value) {
      body.data = writeData();
      body.model = curModelText();
    }
    let r;
    try {
      r = await api('/api/muio/export', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    } catch (e) {
      r = {ok: false, error: e.message};
    }
    go.disabled = false;
    out.innerHTML = r.ok
      ? `<div class="ck cur"><div class="ck-h"><span class="sev info">Done</span><b>MUIO case ${esc(r.case)} created</b></div><div class="ck-d">${(r.log || []).map(esc).join('<br>')}<br>Folder: <code>${esc(r.path)}</code><br>Open (or refresh) MUIO: the case is in its case list${f.run.value ? '; the results are under the run "' + esc(f.runname.value) + '"' : ''}.</div></div>`
      : `<div class="ck error"><div class="ck-h"><span class="sev error">Not exported</span><b>${esc(r.error || 'error')}</b></div>${r.trace ? `<pre class="log">${esc(r.trace)}</pre>` : ''}</div>`;
    if (r.ok) toast('MUIO case created: ' + r.case);
  };
}

/* ---- from MUIO to the Studio: a MUIO case backup (zip) -> a case with its data, scenarios, units, descriptions and runs.
   The import goes on when you open other panels; the jobs bar shows it and brings its panel back ---- */
let MIMPORT = null; // {name, size, state: 'running' | 'done' | 'failed', r, t0}
async function importMuio(file) {
  if (!(await serverInfo())) return toast('Importing a MUIO case runs on this computer: start the Studio app (or START_SOLVER.bat)');
  if (MIMPORT && MIMPORT.state === 'running') return showImport();
  MIMPORT = {name: file.name, size: file.size, state: 'running', t0: Date.now()};
  showImport();
  jobsTick && jobsTick();
  let r;
  try {
    r = await api('/api/muio/import?name=' + encodeURIComponent(file.name), {
      method: 'POST',
      headers: {'Content-Type': 'application/zip'},
      body: await file.arrayBuffer()
    });
  } catch (e) {
    r = {ok: false, error: e.message};
  }
  if (r && r.ok && r.studio_backup) {
    // a Studio case backup given here: it was restored
    MIMPORT = null;
    toast(`Studio backup restored as the case "${r.name}"`);
    try {
      jobsTick();
    } catch (e) {}
    openLibrary();
    return;
  }
  MIMPORT.r = r;
  MIMPORT.state = r && r.ok ? 'done' : 'failed';
  MIMPORT.t1 = Date.now();
  const dr = document.getElementById('drawer');
  if (!dr.hidden && dr.querySelector('#mimpanel')) showImport();
  else toast(r && r.ok ? `MUIO case ${r.case} imported: see the jobs bar to open it` : 'The MUIO import failed: see the jobs bar');
  try {
    jobsTick();
  } catch (e) {}
}
function showImport() {
  const M_ = MIMPORT;
  if (!M_) return;
  const dr = document.getElementById('drawer');
  dr.hidden = false;
  const r = M_.r || {};
  const body =
    M_.state === 'running'
      ? `<div class="ck info"><div class="ck-d">Reading the case with MUIO's own code: the base, each scenario, the runs and their results… (a large case takes a minute). You can open other panels meanwhile: the jobs bar at the bottom brings this one back.</div></div>`
      : M_.state === 'failed'
        ? `<div class="ck error"><div class="ck-h"><b>Could not import</b></div><div class="ck-d">${esc(r.error || 'failed')}</div>${r.trace ? `<details><summary>Details</summary><pre class="small">${esc(r.trace)}</pre></details>` : ''}</div>`
        : `<div class="ck ok"><div class="ck-h"><b>${esc(r.case)}</b> imported as a case</div><div class="ck-d">${esc(r.description || '')} · MUIO ${esc(r.version || '')} · ${r.technologies} technologies, ${r.commodities} commodities · currency ${esc(r.currency || '')}</div></div>
    <h3>Scenarios</h3>${(r.scenarios || []).length ? `<ul>${r.scenarios.map(s => `<li><b>${esc(s.name)}</b> ${esc(s.desc)}</li>`).join('')}</ul>` : '<p class="muted">Base only</p>'}
    <h3>Runs, with their results</h3>${(r.runs || []).length ? `<ul>${r.runs.map(x => `<li><b>${esc(x.name)}</b>: objective ${x.objective != null ? (+x.objective).toLocaleString('en-US', {maximumFractionDigits: 2}) : '—'} · base${x.scenarios.length ? ' + ' + x.scenarios.map(esc).join(' + ') : ''} · ${x.variables} results</li>`).join('')}</ul>` : '<p class="muted">No run kept in the backup</p>'}
    <details><summary>What was read</summary><ul class="small">${(r.log || []).map(l => `<li>${esc(l)}</li>`).join('')}</ul></details>
    <p class="hint">The data were written by MUIO's own code (as MUIO solves them), with the MUIO 5.7 model file. Scenarios keep only the values they change; descriptions, time-slice names, units and currency are kept. Imported runs are listed in Results ("MUIO …"); solve again to compare with the Studio. The case is also in Cases.</p>
    <div class="acts"><button class="btn pri" type="button" id="mopen">Open the case</button><button class="btn" type="button" id="mres">See the results</button></div>`;
  dr.innerHTML = `<div class="dh"><div style="min-width:0"><div class="code" id="mimpanel">import · MUIO</div><h2>Import a MUIO case</h2><p>${esc(M_.name)} · ${(M_.size / 1048576).toFixed(1)} MB${M_.state !== 'running' ? ` · ${Math.round(((M_.t1 || Date.now()) - M_.t0) / 1000)} s` : ''}</p></div><div class="acts"><button class="btn x" type="button" id="close">Close</button></div></div><div class="db">${body}</div>`;
  dr.querySelector('#close').onclick = () => {
    dr.hidden = true;
  };
  if (M_.state !== 'done') return;
  const open = async () => {
    const rec = await LIB.get(r.id);
    if (rec) await LIB.openRec(rec);
  };
  dr.querySelector('#mopen').onclick = async () => {
    await open();
    dr.hidden = true;
  };
  dr.querySelector('#mres').onclick = async () => {
    await open();
    dr.hidden = true;
    if (typeof showResults === 'function') showResults(r.run_ids[r.run_ids.length - 1]);
  };
}
