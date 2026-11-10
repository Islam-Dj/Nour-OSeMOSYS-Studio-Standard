'use strict';
/* ============================== jobs bar and solver monitor ==============================
   Jobs bar (bottom of every window): the solves and Monte Carlo runs going on, the last one finished, the queue.
   Solver monitor (workflow "Jobs and monitor"): every job, its stages, the solver's iterations read from its log
   (HiGHS interior point and simplex, CBC / CLP simplex and barrier, GLPK simplex and interior point), a convergence
   chart, the result with the objective constant, stop, and a notice when a job ends. */
const JOBS = {runs: [], mc: [], seen: new Map(), timer: null, sel: null, logCache: new Map(), notify: false};
try {
  JOBS.notify = localStorage.getItem('mst_rsme_notify') === '1';
} catch (e) {}
const jobRunning = s => s === 'running' || s === 'queued';
const jobTag = j =>
  j.state === 'done'
    ? /OPTIMAL/i.test(j.solver_status || '') || j.kind === 'mc'
      ? ['ok', j.kind === 'mc' ? 'done' : 'Optimal']
      : ['warn', j.solver_status || 'done']
    : j.state === 'failed'
      ? ['bad', 'Failed']
      : j.state === 'stopped'
        ? ['warn', 'Stopped']
        : j.state === 'queued'
          ? ['idle', 'Queued']
          : ['run', 'Running'];
const dur = s =>
  s == null
    ? ''
    : s < 60
      ? `${(+s).toFixed(1)} s`
      : s < 3600
        ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`
        : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;

async function jobsLoad() {
  if (!LIB.srv && !SERVER.info) return false;
  try {
    const [runs, mc] = await Promise.all([api('/api/runs'), api('/api/mc').catch(() => [])]);
    JOBS.runs = runs.map(r => ({...r, kind: 'run'}));
    JOBS.mc = mc.map(r => ({...r, kind: 'mc'}));
    return true;
  } catch (e) {
    return false;
  }
}
function jobsAll() {
  return [...JOBS.runs, ...JOBS.mc].sort((a, b) => b.id.localeCompare(a.id));
}
function jobsCheckEnded() {
  for (const j of jobsAll()) {
    const before = JOBS.seen.get(j.id);
    JOBS.seen.set(j.id, j.state);
    if (before && jobRunning(before) && !jobRunning(j.state)) {
      const msg = `${j.name || j.id}: ${j.kind === 'mc' ? `Monte Carlo ${j.state} (${j.ok ?? '?'} / ${j.total ?? '?'} optimal)` : `${j.solver_status || j.state}${j.objective != null ? ', objective ' + fobj(j.objective) : ''}`}`;
      toast(msg);
      if (JOBS.notify && 'Notification' in window && Notification.permission === 'granted')
        try {
          new Notification(APPNAME, {body: msg});
        } catch (e) {}
    }
  }
}
async function jobsTick() {
  clearTimeout(JOBS.timer);
  const ok = await jobsLoad();
  if (ok) jobsCheckEnded();
  renderJobsBar(ok);
  const busy = jobsAll().some(j => jobRunning(j.state)),
    sig = JSON.stringify(jobsAll().map(j => [j.id, j.state, j.done]));
  if (!document.getElementById('monitor').hidden && (busy || sig !== JOBS.sig)) renderMonitor();
  JOBS.sig = sig;
  JOBS.timer = setTimeout(jobsTick, busy || !document.getElementById('monitor').hidden ? 2500 : 12000);
}
async function jobsStart() {
  if (!LIB.srv) await serverInfo();
  for (const j of jobsAll()) JOBS.seen.set(j.id, j.state);
  jobsTick();
}
function jobsKick() {
  setTimeout(jobsTick, 400);
}

function renderJobsBar(ok) {
  const F = document.getElementById('jobs');
  if (!F) return;
  if (!ok) {
    F.innerHTML = `<b>Jobs</b><span class="muted">${LIB.srv ? 'The solver server does not answer.' : 'Solving needs the Studio server: the desktop app or START_SOLVER.bat.'}</span>`;
    return;
  }
  const all = jobsAll(),
    run = all.filter(j => jobRunning(j.state)),
    last = all.find(j => !jobRunning(j.state));
  const item = j => {
    const [k, l] = jobTag(j);
    const info =
      j.kind === 'mc'
        ? jobRunning(j.state)
          ? `${j.done ?? 0} / ${j.total ?? '?'} samples`
          : `${j.ok ?? '?'} / ${j.total ?? '?'} optimal`
        : jobRunning(j.state)
          ? esc(j.stage || '')
          : `${j.objective != null ? fobj(j.objective) : ''}${j.elapsed != null ? ' · ' + dur(j.elapsed) : ''}`;
    const prog =
      j.kind === 'mc' && jobRunning(j.state) && j.total
        ? `<span class="jprog"><span style="width:${Math.round((100 * (j.done || 0)) / j.total)}%"></span></span>`
        : jobRunning(j.state)
          ? '<span class="jprog busy"><span></span></span>'
          : '';
    return `<button type="button" class="jit" data-job="${esc(j.id)}" title="Open in the solver monitor"><span class="jdot ${k}"></span><span class="jn">${esc(j.name || j.id)}</span><span class="jtag ${k}">${esc(l)}</span><span class="muted">${info}</span>${prog}</button>`;
  };
  const imp =
    typeof MIMPORT !== 'undefined' && MIMPORT
      ? `<button type="button" class="jit" id="jimp" title="The MUIO case import: open its panel"><span class="jdot ${MIMPORT.state === 'running' ? 'run' : MIMPORT.state === 'done' ? 'ok' : 'bad'}"></span><span class="jn">MUIO import ${esc(MIMPORT.name.replace(/\.zip$/i, ''))}</span><span class="jtag ${MIMPORT.state === 'running' ? 'run' : MIMPORT.state === 'done' ? 'ok' : 'bad'}">${MIMPORT.state === 'running' ? 'reading' : MIMPORT.state === 'done' ? 'imported' : 'failed'}</span>${MIMPORT.state === 'running' ? '<span class="jprog busy"><span></span></span>' : ''}</button>`
      : '';
  F.innerHTML = `<b>Jobs</b>${imp}${run.map(item).join('')}${last ? item(last) : ''}${!run.length && !last && !imp ? '<span class="muted">No runs yet: Solve to start one.</span>' : ''}
    <span class="muted">${run.filter(j => j.state === 'queued').length ? run.filter(j => j.state === 'queued').length + ' queued' : ''}</span>
    <button class="btn sm jmon" type="button" id="jmon">Open the solver monitor</button>`;
  F.querySelectorAll('[data-job]').forEach(
    b =>
      (b.onclick = () => {
        JOBS.sel = b.dataset.job;
        goView('mon');
      })
  );
  F.querySelector('#jmon').onclick = () => goView('mon');
  const ji = F.querySelector('#jimp');
  if (ji) ji.onclick = () => showImport();
}

/* ---------- solver log -> iterations ---------- */
function parseSolverLog(txt) {
  const L = txt.split(/\r?\n/),
    out = {it: [], size: null, presolved: null, method: null};
  const num = x => +x;
  for (const ln of L) {
    let m;
    if ((m = ln.match(/LP \S+ has (\d+) rows; (\d+) cols; (\d+) nonzeros/))) out.size = [+m[1], +m[2], +m[3]];
    else if ((m = ln.match(/Presolve reductions: rows (\d+)\([^)]*\); columns (\d+)/))) out.presolved = [+m[1], +m[2]];
    else if (
      (m = ln.match(
        /^\s*(\d+)\s+([-+]?\d\.\d+e[-+]\d+)\s+([-+]?\d\.\d+e[-+]\d+)\s+(\d\.\d+e[-+]\d+)\s+(\d\.\d+e[-+]\d+)\s+(\d\.\d+e[-+]\d+)\s+([\d.]+)\s*$/
      ))
    ) {
      out.method = 'HiGHS interior point';
      out.it.push({i: +m[1], p: num(m[2]), d: num(m[3]), pinf: num(m[4]), dinf: num(m[5]), gap: num(m[6]), t: num(m[7])});
    } else if (
      (m = ln.match(/^\s*(\d+)\s+([-+]?\d\.\d+e[-+]\d+)\s+Pr:\s*(\d+)\(([\d.e+-]+)\)(?:;?\s*Du:\s*(\d+)\(([\d.e+-]+)\))?\s+([\d.]+)s/))
    ) {
      out.method = 'HiGHS simplex';
      out.it.push({i: +m[1], p: num(m[2]), pinf: num(m[4]), dinf: m[6] ? num(m[6]) : null, t: +m[7]});
    } else if ((m = ln.match(/^(?:Clp0006I)?\s*(\d+)\s+Obj\s+([-+\d.e]+)(?:\s+Primal inf\s+([\d.e+-]+))?(?:.*Dual inf\s+([\d.e+-]+))?/))) {
      out.method = 'CLP simplex';
      out.it.push({i: +m[1], p: num(m[2]), pinf: m[3] ? num(m[3]) : 0, dinf: m[4] ? num(m[4]) : null});
    } else if ((m = ln.match(/^(?:Clp0030I)?\s*(\d+)\s+Primal\s+([-+\d.e]+)\s+Dual\s+([-+\d.e]+)\s+Complementarity\s+([\d.e+-]+)/))) {
      out.method = 'CLP barrier';
      const p = num(m[2]),
        d = num(m[3]);
      out.it.push({i: +m[1], p, d, gap: Math.abs(p - d) / Math.max(1, Math.abs(p))});
    } else if (
      (m = ln.match(/^\s*(\d+):\s+obj\s*=\s*([-+\d.e]+);\s*rpi\s*=\s*([\d.e+-]+);\s*rdi\s*=\s*([\d.e+-]+);\s*gap\s*=\s*([\d.e+-]+)/))
    ) {
      out.method = 'GLPK interior point';
      out.it.push({i: +m[1], p: num(m[2]), pinf: num(m[3]), dinf: num(m[4]), gap: num(m[5])});
    } else if ((m = ln.match(/^[ *]\s*(\d+):\s+obj\s*=\s*([-+\d.e]+)\s+inf(?:eas)?\s*=\s*([\d.e+-]+)/))) {
      out.method = 'GLPK simplex';
      out.it.push({i: +m[1], p: num(m[2]), pinf: num(m[3])});
    } else if ((m = ln.match(/^\s*(\d+) rows, (\d+) columns, (\d+) non-zeros/))) {
      if (!out.size) out.size = [+m[1], +m[2], +m[3]];
      else out.presolved = [+m[1], +m[2]];
    } else if ((m = ln.match(/^Problem \S+ has (\d+) rows, (\d+) columns/))) out.size = [+m[1], +m[2]];
    else if ((m = ln.match(/^Presolve (\d+) \([^)]*\) rows, (\d+) \([^)]*\) columns/))) out.presolved = [+m[1], +m[2]];
  }
  return out;
}
function convergenceChart(P) {
  const it = P.it;
  if (!it.length)
    return `<div class="empty">No iterations in the log yet${P.method ? '' : ' (the solver prints them while it works; GLPK building the problem prints none)'}.</div>`;
  const metric = it.some(x => x.gap > 0)
    ? ['gap', 'relative primal–dual gap', true]
    : it.some(x => x.pinf > 0)
      ? ['pinf', 'primal infeasibility', true]
      : ['p', 'objective', false];
  const step = Math.max(1, Math.ceil(it.length / 160)),
    pts = it.filter((x, k) => k % step === 0 || k === it.length - 1).filter(x => x[metric[0]] != null && (!metric[2] || x[metric[0]] > 0));
  if (!pts.length) return '<div class="empty">Nothing to draw yet.</div>';
  const v = pts.map(x => (metric[2] ? Math.log10(x[metric[0]]) : x[metric[0]])),
    lo = Math.min(...v),
    hi = Math.max(...v),
    span = hi - lo || 1;
  const lab = z => (metric[2] ? '1e' + Math.round(z) : fobj(z));
  const bars = pts
    .map(
      (x, k) =>
        `<span class="cb" style="height:${Math.max(2, Math.round(4 + (196 * (v[k] - lo)) / span))}px" title="iteration ${x.i}: ${metric[1]} ${metric[2] ? x[metric[0]].toExponential(2) : fobj(x[metric[0]])}${x.t != null ? ' · ' + x.t + ' s' : ''}"></span>`
    )
    .join('');
  return `<div class="cvh"><b>Convergence</b><span class="muted">${metric[1]} per iteration${metric[2] ? ' (log scale)' : ''} · ${esc(P.method || '')} · iterations ${it[0].i} to ${it[it.length - 1].i}${it.length < it[it.length - 1].i - it[0].i + 1 ? ` (${it.length} reported by the solver)` : ''}${step > 1 ? `, every ${step}th drawn` : ''}</span></div>
    <div class="cvw"><div class="cva"><span>${lab(hi)}</span><span>${lab(lo + span / 2)}</span><span>${lab(lo)}</span></div><div class="cvb">${bars}</div></div>
    <div class="cvx"><span>iteration ${pts[0].i}</span><span>${pts[pts.length - 1].i}</span></div>`;
}
function iterTable(P) {
  const it = P.it.slice(-8);
  if (!it.length) return '';
  const has = k => it.some(x => x[k] != null),
    e = (x, k) =>
      x == null
        ? ''
        : k === 'p' || k === 'd'
          ? Math.abs(x) < 1e12
            ? x.toLocaleString('en', {maximumFractionDigits: 2})
            : x.toExponential(4)
          : x === 0
            ? '0'
            : x.toExponential(2);
  const cols = [
    ['i', 'Iteration'],
    ['p', 'Primal objective'],
    ['d', 'Dual objective'],
    ['pinf', 'Primal inf.'],
    ['dinf', 'Dual inf.'],
    ['gap', 'Gap'],
    ['t', 'Time (s)']
  ].filter(([k]) => has(k));
  return `<div class="tblw"><table class="itab"><thead><tr>${cols.map(c => `<th scope="col">${c[1]}</th>`).join('')}</tr></thead><tbody>${it.map(x => `<tr>${cols.map(([k]) => `<td>${k === 'i' || k === 't' ? (x[k] ?? '') : e(x[k], k)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function runStages(s) {
  const glpk = s.solver === 'glpk',
    st = (s.stage || '').toLowerCase(),
    done = s.state === 'done',
    failed = s.state === 'failed';
  const steps = glpk
    ? [
        ['Queued', 'queued'],
        ['GLPK: pre-processing, build and solve', 'pre-processing'],
        ['Reading the results', 'reading'],
        ['Results and derived results', 'done']
      ]
    : [
        ['Queued', 'queued'],
        ['Pre-processing and building the problem (GLPK)', 'pre-processing'],
        [`Solving (${s.solver || 'solver'})`, 'solving'],
        ['Reading the results', 'reading'],
        ['Results and derived results', 'done']
      ];
  let cur = steps.findIndex(x => st.includes(x[1]));
  if (done) cur = steps.length;
  if (cur < 0) cur = 0;
  return `<ol class="stages">${steps
    .map(([l], k) => {
      const c = failed && k === Math.min(cur, steps.length - 1) ? 'bad' : k < cur || done ? 'ok' : k === cur ? 'run' : '';
      const t = k === 1 && s.built != null && !glpk ? dur(s.built) : k === steps.length - 1 && done ? dur(s.elapsed) : '';
      return `<li class="${c}"><span class="sbar"></span><b>${esc(l)}</b><span class="muted">${c === 'ok' ? 'done' : c === 'run' ? 'now' : c === 'bad' ? 'failed' : ''}${t ? ' · ' + t : ''}</span></li>`;
    })
    .join('')}</ol>`;
}
async function showMonitor(id) {
  if (id) JOBS.sel = id;
  setView('mon');
  await jobsLoad();
  renderMonitor();
  jobsKick();
}
async function renderMonitor() {
  const V = document.getElementById('monitor');
  if (!V || V.hidden) return;
  if (!LIB.srv && !SERVER.info) {
    V.innerHTML = `<div class="empty" style="margin:24px">The solver server is not running: start the Studio app (or START_SOLVER.bat), then Solve.</div>`;
    return;
  }
  const all = jobsAll();
  if (!JOBS.sel || !all.some(j => j.id === JOBS.sel)) JOBS.sel = (all.find(j => jobRunning(j.state)) || all[0] || {}).id;
  const j = all.find(x => x.id === JOBS.sel);
  const list = all
    .slice(0, 40)
    .map(x => {
      const [k, l] = jobTag(x);
      return `<button type="button" class="mj${x.id === JOBS.sel ? ' on' : ''}" data-job="${esc(x.id)}"><span class="mjh"><b>${esc(x.name || x.id)}</b><span class="jtag ${k}">${esc(l)}</span></span><span class="muted">${x.kind === 'mc' ? 'Monte Carlo · ' + (x.total || '?') + ' samples' : esc(x.solver || '')} · ${esc(x.created || '')}</span></button>`;
    })
    .join('');
  let detail = '<div class="empty">No jobs yet: Solve the model to start one.</div>';
  if (j && j.kind === 'run') {
    let s = j;
    try {
      s = await api('/api/run/' + j.id + '/status');
    } catch (e) {}
    let logTxt = JOBS.logCache.get(j.id);
    if (!logTxt || jobRunning(s.state) || !JOBS.logCache.has(j.id + ':final')) {
      try {
        const r = await fetch(SERVER.url + `/api/run/${j.id}/file/log.txt`);
        logTxt = r.ok ? await r.text() : '';
        JOBS.logCache.set(j.id, logTxt);
        if (!jobRunning(s.state)) JOBS.logCache.set(j.id + ':final', 1);
      } catch (e) {
        logTxt = '';
      }
    }
    const P = parseSolverLog(logTxt || ''),
      [k, l] = jobTag({...s, kind: 'run'}),
      c = s.objective_constant;
    detail = `<div class="mh"><div><div class="code">run · ${esc(j.id)}</div><h2>${esc(s.name || j.id)}</h2><p class="muted">${esc(s.model_name || '')} · ${esc(s.solver || '')}${
      s.options && Object.keys(s.options).length
        ? ' · ' +
          esc(
            Object.entries(s.options)
              .map(([a, b]) => a + ' ' + b)
              .join(', ')
          )
        : ''
    }${s.scenarios && s.scenarios.length ? ' · scenarios ' + esc(s.scenarios.join(' + ')) : ''}</p></div>
      <div class="acts"><span class="jtag ${k} big">${esc(l)}</span>${jobRunning(s.state) ? '<button class="btn danger" type="button" id="mstop">Stop</button>' : ''}${s.state === 'done' ? '<button class="btn pri" type="button" id="mres">Open results</button>' : ''}</div></div>
      ${runStages(s)}
      <div class="mgrid"><section class="mcard">${convergenceChart(P)}${iterTable(P)}</section>
      <section class="mcard"><h3>Result</h3><dl class="kv">
        <dt>Status</dt><dd>${esc(s.solver_status || s.state || '')}</dd>
        ${s.objective != null ? `<dt>Objective (full)</dt><dd>${fobj(s.objective)}</dd>` : ''}${c ? `<dt>of which constant</dt><dd>${fobj(c)}</dd><dt>As MUIO shows it</dt><dd>${fobj(s.objective - c)}</dd>` : ''}
        ${P.size ? `<dt>Problem</dt><dd>${P.size[0].toLocaleString('en')} rows × ${P.size[1].toLocaleString('en')} columns</dd>` : ''}${P.presolved ? `<dt>After presolve</dt><dd>${P.presolved[0].toLocaleString('en')} × ${P.presolved[1].toLocaleString('en')}</dd>` : ''}
        ${s.built != null ? `<dt>Building</dt><dd>${dur(s.built)}</dd>` : ''}${s.elapsed != null ? `<dt>Total time</dt><dd>${dur(s.elapsed)}</dd>` : ''}${s.error ? `<dt>Error</dt><dd>${esc(s.error)}</dd>` : ''}</dl>
        <details><summary>Log (last lines)</summary><pre class="log">${esc((s.log || []).join('\n'))}</pre></details></section></div>`;
  } else if (j) {
    let s = j;
    try {
      s = await api('/api/mc/' + j.id);
    } catch (e) {}
    const [k, l] = jobTag({...s, kind: 'mc'}),
      pc = s.total ? Math.round((100 * (s.done || 0)) / s.total) : 0;
    detail = `<div class="mh"><div><div class="code">Monte Carlo · ${esc(j.id)}</div><h2>${esc(s.name || j.id)}</h2><p class="muted">${esc(s.solver || '')} · ${s.total || '?'} samples${s.scenarios && s.scenarios.length ? ' · scenarios ' + esc(s.scenarios.join(' + ')) : ''}</p></div>
      <div class="acts"><span class="jtag ${k} big">${esc(l)}</span>${jobRunning(s.state) ? '<button class="btn danger" type="button" id="mcstop">Stop</button>' : ''}<button class="btn pri" type="button" id="mcopen">Open in Monte Carlo</button></div></div>
      <div class="mgrid"><section class="mcard"><h3>Samples</h3><div class="bigbar"><span style="width:${pc}%"></span></div>
        <dl class="kv"><dt>Solved</dt><dd>${s.done ?? 0} / ${s.total ?? '?'}</dd><dt>Optimal</dt><dd>${s.ok ?? 0}</dd><dt>Stage</dt><dd>${esc(s.stage || s.state || '')}</dd>${s.eta != null ? `<dt>Time left</dt><dd>${dur(s.eta)}</dd>` : ''}</dl></section>
      <section class="mcard"><h3>Log</h3><pre class="log">${esc((s.log || []).join('\n'))}</pre></section></div>`;
  }
  V.innerHTML = `<div class="monw"><aside class="mlist"><div class="mlh"><h2>Jobs</h2><label class="ntf"><input type="checkbox" id="mnotify" ${JOBS.notify ? 'checked' : ''}> Notify me when a job ends</label></div>${list || '<div class="empty">No jobs yet.</div>'}
      <p class="muted small">Monte Carlo runs are one job each, with their samples inside; RDM and rolling-horizon batches will appear the same way.</p></aside>
    <div class="mdet">${detail}</div></div>`;
  V.querySelectorAll('[data-job]').forEach(
    b =>
      (b.onclick = () => {
        JOBS.sel = b.dataset.job;
        renderMonitor();
      })
  );
  const nt = V.querySelector('#mnotify');
  nt.onchange = async () => {
    JOBS.notify = nt.checked;
    try {
      localStorage.setItem('mst_rsme_notify', nt.checked ? '1' : '0');
    } catch (e) {}
    if (nt.checked && 'Notification' in window && Notification.permission === 'default')
      try {
        await Notification.requestPermission();
      } catch (e) {}
  };
  const on = (sel_, fn) => {
    const b = V.querySelector(sel_);
    if (b) b.onclick = fn;
  };
  on('#mstop', async () => {
    await api(`/api/run/${j.id}/stop`, {method: 'POST'});
    jobsKick();
  });
  on('#mres', () => showResults(j.id));
  on('#mcstop', async () => {
    await api(`/api/mc/${j.id}/stop`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'});
    jobsKick();
  });
  on('#mcopen', () => showMC());
}
