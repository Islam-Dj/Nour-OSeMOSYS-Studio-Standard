'use strict';
/* ============================== RUN: local solver server (server/, started by run_studio.py) ============================== */
const SERVER = {url: location.protocol.startsWith('http') && location.port ? location.origin : 'http://127.0.0.1:8775', info: null};
async function api(path, opts) {
  const r = await fetch(SERVER.url + path, opts);
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}
async function serverInfo() {
  try {
    const c = new AbortController();
    setTimeout(() => c.abort(), 1500);
    const r = await fetch(SERVER.url + '/api/solvers', {signal: c.signal});
    SERVER.info = await r.json();
  } catch (e) {
    SERVER.info = null;
  }
  return SERVER.info;
}
const SOLVER_OPTS = {
  highs: [
    [
      'algorithm',
      'Algorithm',
      ['ipm', 'simplex', 'choose', 'hipo', 'pdlp'],
      'ipm',
      'interior point is often fastest on very large models; dual simplex is often faster on badly scaled ones (CLEWs: 57 s against 614 s for the interior point on a national model). An interior point that stops "Unknown" is finished by the dual simplex at once. hipo = the new parallel interior point (HiGHS 1.15, needs highspy-extras): for very large, well-scaled models; an infeasibility it reports is checked with the dual simplex'
    ],
    ['crossover', 'Crossover', ['off', 'on'], 'off', 'on = exact vertex solution, slower'],
    ['threads', 'Threads', null, '', '0 or empty = all cores'],
    ['time_limit', 'Time limit (s)', null, '', 'empty = none'],
    ['tolerance', 'Feasibility tolerance', null, '1e-6', ''],
    ['mip_gap', 'MIP gap', null, '', 'only for integer models']
  ],
  cbc: [
    ['cbc_method', 'Method', ['simplex', 'barrier'], 'simplex', ''],
    ['threads', 'Threads', null, '', ''],
    ['time_limit', 'Time limit (s)', null, '', ''],
    ['mip_gap', 'MIP gap', null, '', '']
  ],
  glpk: [
    ['glpk_method', 'Method', ['simplex', 'interior'], 'simplex', 'GLPK is slow on large models'],
    ['time_limit', 'Time limit (s)', null, '', '']
  ],
  gurobi: [
    [
      'algorithm',
      'Algorithm',
      ['choose', 'simplex', 'barrier', 'pdlp'],
      'choose',
      'choose = Gurobi decides (concurrent); barrier is often fastest on very large LPs; pdlp = first-order (PDHG, Gurobi 12+, GPU)'
    ],
    ['crossover', 'Crossover', ['on', 'off'], 'on', 'off = faster barrier, no vertex solution'],
    ['threads', 'Threads', null, '', '0 or empty = all cores'],
    ['time_limit', 'Time limit (s)', null, '', 'empty = none'],
    ['tolerance', 'Feasibility tolerance', null, '', 'empty = Gurobi default (1e-6)'],
    ['mip_gap', 'MIP gap', null, '', 'only for integer models']
  ]
};
let RUNPOLL = null;
const fobj = v => (v == null ? '' : Number(v).toLocaleString('en-US', {maximumFractionDigits: 2}));
async function openRun() {
  const dr = document.getElementById('drawer');
  dr.hidden = false;
  dr.innerHTML = '<div class="db"><div class="empty">Looking for the solver server…</div></div>';
  const I = await serverInfo();
  const runs = I ? await api('/api/runs').catch(() => []) : [];
  const off = !I
    ? `<div class="ck warn"><div class="ck-h"><span class="sev warn">Not connected</span><b>The solver server is not running</b></div>
     <div class="ck-d">Double-click <code>START_SOLVER.bat</code> in the Studio folder (or run <code>python run_studio.py</code>), or use the desktop app. It opens this page from <code>${SERVER.url}</code> with the solvers found on your computer (HiGHS, CBC, GLPK, Gurobi). Needs Python with <code>pip install swiglpk highspy</code>.</div>
     <div class="acts" style="margin-top:6px"><button class="btn" id="rretry">Try again</button></div></div>`
    : '';
  const nob =
    I && !I.glpk_builder
      ? `<div class="ck error"><div class="ck-h"><span class="sev error">Missing</span><b>The GLPK model builder (Python package swiglpk) is not installed</b></div><div class="ck-d">The server runs with Python ${esc(I.python || '')}${I.executable ? ' (' + esc(I.executable) + ')' : ''}. Every solver needs it to build the problem from the model file and the data.</div><div class="ck-f">Close the Studio and run START_SOLVER.bat again (it installs it), or in a command window: <code>${esc(I.executable || 'python')} -m pip install swiglpk highspy</code>. The desktop app has everything inside.</div></div>`
      : '';
  const sv = I ? I.solvers : [];
  const optsHtml = id =>
    (SOLVER_OPTS[id] || [])
      .map(
        ([k, l, ch, dv, h]) =>
          `<label>${l}${ch ? `<select name="o_${k}">${ch.map(c => `<option ${c === dv ? 'selected' : ''}>${c}</option>`).join('')}</select>` : `<input name="o_${k}" value="${dv}" placeholder="${h}">`}${ch && h ? `<span class="hint">${h}</span>` : ''}</label>`
      )
      .join('');
  dr.innerHTML = `<div class="dh"><div style="min-width:0"><div class="code">run · ${I ? 'server ' + esc(SERVER.url) : 'not connected'}</div><h2>Solve the model</h2>
    <p>The current model (data as in "Save data.txt") and its model file (${esc(SCHEMA ? SCHEMA.name : 'MUIO 5.4')}) are sent to the solver server on this computer: GLPK builds the problem, the chosen solver solves it, and the results come back to the Results view.</p></div><button class="btn x" type="button" id="close">Close</button></div>
  <div class="db">${off}${nob}
   ${
     I
       ? `<form id="rf" class="frm"><label>Run name<input name="name" value="${esc((M.meta.name || 'model').replace(/\.(txt|dat)$/i, ''))}"></label>
     ${scenPicker()}
     <fieldset><legend>Solver</legend><div class="regs">${sv.map((s, i) => `<label><input type="radio" name="solver" value="${s.id}" ${i === 0 ? 'checked' : ''}> ${esc(s.name)}</label>`).join('') || '<span class="muted">No solver found</span>'}</div>
       <div id="sopts" class="row2"></div></fieldset>
     ${CHECK && CHECK.n.error ? `<div class="ck error"><div class="ck-h"><span class="sev error">Check</span><b>${CHECK.n.error} infeasibilit${CHECK.n.error > 1 ? 'ies' : 'y'} found in the data</b></div><div class="ck-f">The solver will probably report the model infeasible. See "Check".</div></div>` : ''}
     <div class="acts"><button class="btn pri" type="submit" ${sv.length ? '' : 'disabled'}>Solve</button><button class="btn" type="button" id="rcheck" title="Builds the problem and tests it without costs: if it has no solution, gives the smallest changes of the limits (emission caps, capacity and activity limits, targets, demands) that make it feasible" ${I.glpk_builder && sv.some(s => s.id === 'highs') ? '' : 'disabled'}>Check feasibility (exact)</button></div></form>
     <div id="rlive"></div>
     <details open><summary>Runs on this computer<span class="n">${runs.length}</span></summary>${
       runs
         .slice(0, 40)
         .map(
           r => `<div class="ck ${r.state === 'failed' ? 'warn' : ''}"><div class="ck-h"><b>${esc(r.name || r.id)}</b><span class="sev ${r.state === 'done' ? 'info' : 'warn'}">${esc(r.state === 'done' ? r.solver_status || 'done' : r.state)}</span></div>
        <div class="ck-w">${esc(r.created || '')} · ${esc(r.solver)} · ${r.objective != null ? 'objective ' + fobj(r.objective) + (r.objective_constant ? ` (incl. constant ${fobj(r.objective_constant)}; MUIO shows ${fobj(r.objective - r.objective_constant)})` : '') : ''} ${r.elapsed != null ? '· ' + r.elapsed + ' s' : ''} · ${esc(r.model_name || '')}</div>
        <div class="acts" style="margin-top:5px">${r.state === 'done' ? `<button class="btn" data-res="${r.id}">Results</button>` : ''}<button class="btn" data-log="${r.id}">Log</button><button class="btn danger" data-del="${r.id}">Delete</button></div></div>`
         )
         .join('') || '<div class="empty">No runs yet.</div>'
     }</details>`
       : ''
   }</div>`;
  dr.querySelector('#close').onclick = () => {
    dr.hidden = true;
  };
  const rt = dr.querySelector('#rretry');
  if (rt) rt.onclick = openRun;
  if (!I) return;
  const so = dr.querySelector('#sopts'),
    setOpts = () => {
      const s = dr.querySelector('[name=solver]:checked');
      so.innerHTML = s ? optsHtml(s.value) : '';
    };
  dr.querySelectorAll('[name=solver]').forEach(x => (x.onchange = setOpts));
  setOpts();
  dr.querySelectorAll('[data-res]').forEach(
    b =>
      (b.onclick = () => {
        showResults(b.dataset.res);
        dr.hidden = true;
      })
  );
  dr.querySelectorAll('[data-log]').forEach(b => (b.onclick = () => watchRun(b.dataset.log, true)));
  dr.querySelectorAll('[data-del]').forEach(
    b =>
      (b.onclick = async () => {
        if (!await uiConfirm('Delete this run and its results?')) return;
        await api(`/api/run/${b.dataset.del}/delete`, {method: 'POST'});
        openRun();
      })
  );
  dr.querySelector('#rcheck').onclick = () => {
    const f = dr.querySelector('#rf');
    f.dataset.check = '1';
    f.requestSubmit();
  };
  dr.querySelector('#rf').onsubmit = async ev => {
    ev.preventDefault();
    const fd = new FormData(ev.target),
      check = ev.target.dataset.check === '1',
      solver = check ? 'check' : fd.get('solver'),
      options = {};
    delete ev.target.dataset.check;
    for (const [k, v] of fd.entries()) if (k.startsWith('o_') && String(v).trim() !== '') options[k.slice(2)] = String(v).trim();
    const scn = fd.getAll('scn');
    const body = {
      name: (check ? 'check ' : '') + fd.get('name') + (scn.length ? ' + ' + scn.map(scenName).join(' + ') : ''),
      solver,
      options,
      scenarios: scn.map(scenName),
      data: writeData({apply: scn}),
      model: SCHEMA && SCHEMA.fromFile ? SCHEMA.text : MODELTXT(),
      model_name: SCHEMA ? SCHEMA.name : 'MUIO 5.4'
    };
    if (LIB.srv && LIB.current) {
      await LIB.put({
        id: LIB.current,
        name: M.meta.name,
        data: writeData(),
        model: SCHEMA && SCHEMA.fromFile ? SCHEMA.text : null,
        modelName: SCHEMA ? SCHEMA.name : null,
        updated: Date.now()
      });
      body.case = LIB.current;
    }
    try {
      const r = await api('/api/run', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
      toast('Run started: ' + r.id);
      watchRun(r.id);
      jobsKick();
    } catch (e) {
      toast('Could not start the run: ' + e.message);
    }
  };
}
function watchRun(id, once) {
  clearInterval(RUNPOLL);
  const box = document.getElementById('rlive');
  if (!box) return;
  const tick = async () => {
    let s;
    try {
      s = await api('/api/run/' + id);
    } catch (e) {
      box.innerHTML = `<div class="ck warn">${esc(e.message)}</div>`;
      clearInterval(RUNPOLL);
      return;
    }
    const fin = s.state === 'done' || s.state === 'failed';
    box.innerHTML = `<div class="ck ${s.state === 'failed' ? 'error' : s.state === 'done' ? 'cur' : ''}"><div class="ck-h"><b>${esc(s.name || id)}</b><span class="sev ${s.state === 'failed' ? 'error' : 'info'}">${esc(s.state)}</span></div>
      <div class="ck-w">${esc(s.stage || '')}${s.solver_status ? ' · ' + esc(s.solver_status) : ''}${s.objective != null ? ' · objective ' + fobj(s.objective) + (s.objective_constant ? ` (incl. constant ${fobj(s.objective_constant)}; MUIO shows ${fobj(s.objective - s.objective_constant)})` : '') : ''}${s.elapsed != null ? ' · ' + s.elapsed + ' s' : ''}${s.error ? ' · ' + esc(s.error) : ''}${s.kind === 'check' && !s.not_solution ? ' · <b style="color:#067647">Feasible: the model has a solution</b>' : ''}${s.not_solution ? ` · <b style="color:#b42318">No solution</b><div class="vnote">${diagList(s.diagnosis)}</div>` : ''}</div>
      <pre class="log">${esc((s.log || []).join('\n'))}</pre>
      <div class="acts">${fin ? '' : `<button class="btn danger" id="rstop">Stop</button>`}${s.state === 'done' && s.kind !== 'check' ? `<button class="btn pri" id="ropen">Open results</button>` : ''}</div></div>`;
    const st = box.querySelector('#rstop');
    if (st) st.onclick = () => api(`/api/run/${id}/stop`, {method: 'POST'});
    const op = box.querySelector('#ropen');
    if (op)
      op.onclick = () => {
        showResults(id);
        document.getElementById('drawer').hidden = true;
      };
    const lg = box.querySelector('.log');
    lg.scrollTop = lg.scrollHeight;
    if (fin || once) {
      clearInterval(RUNPOLL);
      if (fin && !once && s.state === 'done')
        toast(s.kind === 'check' ? `Feasibility check: ${s.solver_status}` : `Solved: ${s.solver_status}, objective ${fobj(s.objective)}`);
    }
  };
  tick();
  if (!once) RUNPOLL = setInterval(tick, 1200);
}
