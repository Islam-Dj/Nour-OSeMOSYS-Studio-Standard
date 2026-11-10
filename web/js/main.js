'use strict';
/* ============================== controls ============================== */
const state = {region: 'DZ', year: 2030, showoff: false, showbs: false, allYears: true}; // all years shown by default
try {
  const s = JSON.parse(localStorage.getItem('mst_rsme1') || '{}');
  Object.assign(state, s);
} catch (e) {}
function save() {
  try {
    localStorage.setItem('mst_rsme1', JSON.stringify({region: state.region, year: state.year, allYears: state.allYears}));
  } catch (e) {}
}
/* the standard edition: rolling horizon and the planned calculators belong to the master Studio */
if (STANDARD) {
  for (const sel of ['#viewseg [data-v="rh"]', '#viewseg [data-soon]']) {
    const b = document.querySelector(sel);
    if (b && b.closest('.ri')) b.closest('.ri').remove();
  }
}
function initControls() {
  const rg = document.getElementById('regions');
  rg.innerHTML = '';
  for (const r of REG.length > 1 ? [...REG, 'ALL'] : REG) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = r === 'ALL' ? 'All' : r;
    b.dataset.r = r;
    b.title = r === 'ALL' ? 'All regions together' : RNAME[r];
    b.setAttribute('aria-pressed', state.region === r);
    b.onclick = () => {
      state.region = r;
      rg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
      save();
      document.getElementById('drawer').hidden = true;
      draw();
      fit();
    };
    rg.appendChild(b);
  }
  // the year is chosen in the panel of a technology or a commodity (panels.js yearSel), where it is used
  const so = document.getElementById('showoff');
  so.checked = state.showoff;
  so.onchange = () => {
    state.showoff = so.checked;
    draw();
    fit();
  };
  const sb = document.getElementById('showbs');
  sb.checked = state.showbs;
  sb.onchange = () => {
    state.showbs = sb.checked;
    draw();
    fit();
  };
  const q = document.getElementById('q');
  q.onchange = q.onkeydown = e => {
    if (e.type === 'keydown' && e.key !== 'Enter') return;
    const v = q.value.trim().toUpperCase();
    const t = G.T.find(x => x === v) || G.T.find(x => x.includes(v) || shortName(x).toUpperCase().includes(v));
    if (t) {
      const st = document.getElementById('stage').getBoundingClientRect();
      view.k = Math.max(view.k, 0.9);
      view.x = st.width / 2 - (G.layout.x.get('T:' + t) + BW / 2) * view.k;
      view.y = st.height / 2 - (G.layout.y.get('T:' + t) + BH / 2) * view.k;
      applyView();
      openTech(t);
    } else toast('No technology matches “' + q.value + '”');
  };
  drawLegend();
}
document.getElementById('descx').onclick = () => {
  document.getElementById('menu').hidden = true;
  exportModelDescription();
};
document.getElementById('theme').onclick = () => {
  const r = document.documentElement;
  const dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  r.dataset.theme = dark ? 'light' : 'dark';
};
document.getElementById('mzip').onchange = e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) importMuio(f);
};
document.getElementById('bzip').onchange = async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  if (!(await serverInfo())) return toast('Restoring a backup runs on this computer: start the Studio app (or START_SOLVER.bat)');
  const r = await restoreCase(f);
  if (r && r.ok) openLibrary();
};
document.getElementById('file').onchange = e => {
  const f = e.target.files[0];
  if (!f) return;
  if (/\.zip$/i.test(f.name)) {
    e.target.value = '';
    return importMuio(f);
  }
  const rd = new FileReader();
  rd.onload = () => openText(rd.result, f.name);
  rd.readAsText(f);
  e.target.value = '';
};
async function openText(text, name) {
  if (/^\s*[\w ]+,/.test(text.slice(0, 200)) && !/\bset\b|\bparam\b/.test(text)) {
    loadDesc(text, name);
    return;
  }
  const o = await openDataDialog(text, name);
  if (!o) return;
  if (o.how === 'merge') {
    try {
      await openMergeDialog(text, name);
    } catch (err) {
      toast('Could not add ' + name + ': ' + err.message);
    }
    return;
  }
  try {
    await useModel(o.mid, true, false);
    load(text, {name: o.name, version: o.version, note: 'opened from your computer'});
    M.meta.description = o.description;
    toast(`Opened ${o.name}: ${REG.length} region(s), ${M.techs.size} technologies · model file ${SCHEMA.name} · kept in Cases`);
    LIB.store(o.name, text, {description: o.description, version: o.version, file: name});
  } catch (err) {
    toast('Could not read ' + name + ': ' + err.message);
  }
}
function loadDesc(text, name) {
  // CSV code,description[,name]; replaces/extends the built-in descriptions
  let n = 0;
  for (const ln of text.split(/\r?\n/)) {
    const m = ln.match(/^\s*"?([^",]+)"?\s*[,;\t]\s*"?(.*?)"?\s*$/);
    if (!m || /^(code|id|tech|technology)$/i.test(m[1])) continue;
    const c = m[1].trim(),
      d = m[2].replace(/""/g, '"');
    if (!d) continue;
    if (M && M.techs.has(c)) TD[c] = d;
    else FD[c] = d;
    n++;
  }
  toast(`${n} descriptions loaded from ${name}`);
  draw();
}
document.getElementById('dfile').onchange = e => {
  const f = e.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => loadDesc(rd.result, f.name);
  rd.readAsText(f);
  e.target.value = '';
};
document.addEventListener('dragover', e => {
  e.preventDefault();
});
document.addEventListener('drop', e => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (!f) return;
  if (/\.zip$/i.test(f.name)) return importMuio(f);
  const rd = new FileReader();
  rd.onload = () => openText(rd.result, f.name);
  rd.readAsText(f);
});
function caseLine() {
  const m = M.meta;
  document.getElementById('src').textContent =
    `${m.name}${m.version ? ' · ' + m.version : ''} · ${M.techs.size} technologies · ${(M.S.COMMODITY || []).length} commodities`;
  document.getElementById('caseb').title =
    `${m.name}${m.version ? ' · ' + m.version : ''}${m.description ? '\n' + m.description : ''}\nModel file: ${SCHEMA ? SCHEMA.name : BUILTIN_NAME}${m.note ? '\n(' + m.note + ')' : ''}\nClick to see all cases`;
}
function load(text, meta) {
  const old = M;
  try {
    buildModel(text, meta);
  } catch (e) {
    M = old;
    throw e;
  }
  TD = {};
  FD = {};
  for (const [k, v] of Object.entries(M.D.desc || {})) (M.techs.has(k) ? TD : FD)[k] = v;
  SCEN.edit = 'SC_0';
  setTimeout(scenChip, 0);
  COLORS = {...(M.D.colors || {})};
  ICONS = {...(M.D.icons || {})};
  SETDESC = JSON.parse(JSON.stringify(M.D.setdesc || {}));
  UNITS = parseUnitLines(text);
  ONOFF = parseOnoff(text);
  SYSTEMS.load(text);
  if (!REG.includes(state.region) && state.region !== 'ALL') state.region = REG[0];
  if (state.region === 'ALL' && REG.length < 2) state.region = REG[0];
  if (!M.years.includes(state.year)) state.year = M.years.includes(2030) ? 2030 : M.years[Math.floor(M.years.length / 3)];
  document.getElementById('techlist').innerHTML = [...M.techs].map(t => `<option value="${esc(t)}">`).join('');
  caseLine();
  dirty = false;
  REV = 0;
  CHECK = null;
  if (typeof viTouch === 'function') viTouch(); // checked when the Studio is idle (checks.js)
  initControls();
  document.getElementById('drawer').hidden = true;
  draw();
  fit();
}
document.getElementById('chk').onclick = () => openChecks();
// Build and edit opens the diagram with the Build bar (from any page); on the diagram it switches build on / off; Exit in the bar
document.getElementById('bld').onclick = () => {
  if (typeof CURVIEW !== 'undefined' && CURVIEW !== 'dia') {
    setView('dia');
    build.on = true;
  } else build.on = !build.on;
  setBuildUI();
};
{
  const bx = document.getElementById('b-exit');
  if (bx)
    bx.onclick = () => {
      build.on = false;
      setBuildUI();
      toast('Build mode closed: the model stays as it is');
    };
}
document.getElementById('b-new').onclick = async () => {
  if (dirty && !await uiConfirm('Discard the unsaved changes and start a new model?')) return;
  openNewModel();
};
document.getElementById('b-sys').onclick = () => openSystems();
document.getElementById('b-tech').onclick = () => openEntity('tech', null);
document.getElementById('b-comm').onclick = () => openEntity('comm', null);
document.getElementById('b-sto').onclick = () => openEntity('stor', null);
document.getElementById('b-emi').onclick = () => openEntity('emi', null);
document.getElementById('b-udc').onclick = () => openEntity('udc', null);
document.getElementById('b-set').onclick = () => openEntity('glob', null);
document.getElementById('b-all').onclick = () => openEntity('all', null);
document.getElementById('b-mod').onclick = () => openModelFile();
document.getElementById('libb').onclick = () => openLibrary();
document.getElementById('cpb').onclick = () => makeCheckpoint();
document.getElementById('runb').onclick = () => openRun();
document.getElementById('scnb').onclick = () => openScenarios();
document.getElementById('zexp').onclick = () => openDiagramExport();
{
  const zi = document.getElementById('zicons');
  zi.value = ICONSET.show + '|' + ICONSET.style;
  if (!zi.value) zi.value = 'auto|line';
  zi.onchange = () => {
    [ICONSET.show, ICONSET.style] = zi.value.split('|');
    saveIconSet();
    draw();
  };
}
document.getElementById('muiob').onclick = () => openMuio();
document.getElementById('unitb').onclick = () => openUnits();
document.querySelectorAll('#viewseg button[data-v]').forEach(b => (b.onclick = () => goView(b.dataset.v)));
function goView(v) {
  return v === 'res'
    ? showResults()
    : v === 'mc'
      ? showMC()
      : v === 'rdm'
        ? showRDM()
        : v === 'rh'
          ? showRH()
          : v === 'mon'
            ? showMonitor()
            : v === 'ovw'
              ? showSetup()
              : setView('dia');
}
document.querySelectorAll('#viewseg [data-soon]').forEach(b => (b.onclick = () => toast(b.dataset.soon + ': planned, not built yet')));
document.querySelectorAll('#viewseg .nw').forEach(b => (b.onclick = () => WIN.open(b.dataset.win)));
document.getElementById('neww').onclick = () => WIN.dialog();
document.getElementById('caseb').onclick = () => openLibrary();
document.getElementById('modb').onclick = () => openModels();
{
  const mb = document.getElementById('menub'),
    mn = document.getElementById('menu');
  const show = on => {
    mn.hidden = !on;
    mb.setAttribute('aria-expanded', on);
  };
  mb.onclick = e => {
    e.stopPropagation();
    show(mn.hidden);
  };
  document.addEventListener('click', e => {
    if (!mn.hidden && !mn.contains(e.target) && e.target !== mb) show(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !mn.hidden) {
      show(false);
      mb.focus();
    }
  });
  mn.querySelectorAll('label.mi[for], button.mi').forEach(x => x.addEventListener('click', () => setTimeout(() => show(false), 0)));
  const br = document.getElementById('showbr');
  br.onchange = () => {
    BR.show = br.checked;
    brSave();
    renderBrowser();
    fit();
  };
}
document.getElementById('b-save').onclick = () => download();
// save state chip: saved / saving / not saved, with the number of edits since the model was opened (cheap: reads two variables)
setInterval(() => {
  const el = document.getElementById('savest');
  if (!el) return;
  const st = !dirty ? 'saved' : LIB.srv || LIB.timer ? 'saving…' : 'not saved',
    t = `${st}${REV ? ' · ' + REV + ' edit' + (REV > 1 ? 's' : '') : ''}`;
  if (el._t !== t) {
    el._t = t; // compared with what was written, not with the (maybe translated) text shown
    el.textContent = t;
    el.className = 'savest ' + (!dirty ? 'ok' : 'wait');
  }
}, 700);
window.addEventListener('beforeunload', e => {
  if (dirty && !LIB.srv) {
    e.preventDefault();
    e.returnValue = '';
  }
});
window.addEventListener('resize', () => fit());
/* the start dialog.
   Continue with the last case, or choose a model (the two built-in models and the model files of the library) and start
   a new case with it or see its cases. "Do not ask" reopens the last case directly next time. */
function startChooser(last) {
  return new Promise(async res => {
    await MODELS.load().catch(() => {});
    const L = LIB.srv ? (await LIB.all()).filter(r => !r.frozen) : [];
    const n = g => L.filter(r => caseModel(r).g === g).length,
      gid = m => (m.id === '_muio54' ? BUILTIN_GROUP : m.id === '_muio57' ? STD57_GROUP : m.id);
    const d = document.createElement('div');
    d.className = 'pop modal';
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-label', 'Choose the model to start with');
    d.id = 'startdlg';
    d.innerHTML = `<h3>Start</h3><p class="muted">Choose the model file you work with. Each case belongs to one model; its cases are kept together${LIB.srv ? ' (cases/&lt;model&gt;/&lt;case&gt;)' : ''}.</p>
      <div class="stm">${last ? `<div class="ck cur"><div class="ck-h"><b>Continue: ${esc(last.name)}</b><span class="muted">${esc(caseModel(last).name)} · ${new Date(last.updated).toLocaleString()}</span></div><div class="acts" style="margin-top:5px"><button class="btn pri" data-s="last">Continue</button></div></div>` : ''}
      ${MODELS.list
        .map(
          m => `<div class="ck"><div class="ck-h"><b>${esc(m.name || m.id)}</b>${LIB.srv ? `<span class="muted">${n(gid(m))} case(s)</span>` : ''}</div><div class="ck-d">${esc(m.description || '')}</div>
        <div class="acts" style="margin-top:5px"><button class="btn${last ? '' : ' pri'}" data-s="new" data-m="${esc(m.id)}">New case with it</button>${LIB.srv && n(gid(m)) ? `<button class="btn" data-s="cases" data-m="${esc(gid(m))}">Its cases</button>` : ''}${m.id === '_muio54' && TEXT.examples.length ? `<button class="btn" data-s="ex">${STANDARD ? 'Open the example' : 'Open the example'}</button>` : ''}</div></div>`
        )
        .join('')}</div>
      <div class="acts"><label class="chk" style="margin-right:auto"><input type="checkbox" id="stno"> Do not ask at start: reopen the last case</label><button class="btn" data-s="close">Close</button></div>`;
    document.body.appendChild(d);
    d.querySelectorAll('[data-s]').forEach(
      b =>
        (b.onclick = () => {
          if (d.querySelector('#stno').checked)
            try {
              localStorage.setItem('mst_rsme_nostart', '1');
            } catch (e) {}
          d.remove();
          res({a: b.dataset.s, m: b.dataset.m});
        })
    );
  });
}
async function startAct(c, last) {
  if (!c || c.a === 'close') return;
  if (c.a === 'last' && last) {
    try {
      await LIB.openRec(last);
      toast(`Reopened ${last.name}`);
    } catch (e) {
      toast(`${last.name} could not be opened: ${e.message}`);
    }
    return;
  }
  if (c.a === 'new') {
    LIB.current = null;
    await useModel(c.m, true, false);
    openNewModel();
    return;
  }
  if (c.a === 'cases') {
    LIB.modelF = c.m;
    openLibrary();
    return;
  }
  if (c.a === 'ex') return openExample(0);
}
/* start: texts (built-in model file, example data), then the last case or the example */
(async function boot() {
  await loadTexts();
  loadFontData();
  setSchema(MODELTXT(), BUILTIN_NAME);
  if (TEXT.example) load(TEXT.example, TEXT.exampleMeta);
  else openNewModel();
  let id = null;
  try {
    id = localStorage.getItem('mst_rsme_last');
  } catch (e) {}
  if (LIB.srv) {
    await serverInfo();
    const L = await LIB.all();
    if (!L.some(r => r.id === id)) id = (L.sort((a, b) => b.updated - a.updated)[0] || {}).id;
  }
  let ask = !WIN.wantCase && !WIN.second && (!navigator.webdriver || /[?&]start=1/.test(location.search));
  try {
    if (localStorage.getItem('mst_rsme_nostart') === '1' && !/[?&]start=1/.test(location.search)) ask = false;
  } catch (e) {}
  if (ask) {
    const last = id ? await LIB.get(id) : null;
    startAct(await startChooser(last), last);
  } else if (id && !WIN.wantCase) {
    const rec = await LIB.get(id); // the last case; one that cannot be read leaves the example open
    if (rec)
      try {
        await LIB.openRec(rec);
        toast(`Reopened ${rec.name} from your cases`);
      } catch (e) {
        console.error(e);
        LIB.current = null;
        if (TEXT.example) load(TEXT.example, TEXT.exampleMeta);
        toast(`The last case (${rec.name}) could not be opened: ${e.message}`);
      }
  }
  await WIN.start();
  jobsStart();
})();
