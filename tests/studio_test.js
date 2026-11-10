// Nour OSeMOSYS Studio: checks of the whole Studio in a real browser (Playwright).
//   node tests/studio_test.js <url>      (the server running: python run_studio.py --no-browser)
// The page loads in each language without errors; the built-in model is the standard OSeMOSYS model; the example opens,
// is solved, its results are read, Ask the results answers questions about it (share of solar in each year's
// electricity), Monte Carlo and robust decisions open; New model makes a time structure with seasonal day hours.
const {chromium} = require('playwright');
const fs = require('fs'),
  path = require('path');
const URL = process.argv[2] || 'http://127.0.0.1:8775';
let fails = 0;
const out = (ok, name, info) => {
  if (!ok) fails++;
  console.log((ok ? 'ok ' : 'FAIL ') + name + (info !== undefined ? `   (${info})` : ''));
};
const W = path.join(__dirname, '..', 'web', 'data');
async function solve(data, name) {
  const body = {name, case: 'tests', solver: 'highs', options: {}, data, model: fs.readFileSync(path.join(W, 'builtin_model.txt'), 'utf8'), model_name: 'model.v.5.7.txt', scenarios: []};
  const r = await (await fetch(URL + '/api/run', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})).json();
  for (let i = 0; i < 300; i++) {
    const s = await (await fetch(`${URL}/api/run/${r.id}/status`)).json();
    if (s.state === 'done' || s.state === 'failed') return {id: r.id, s};
    await new Promise(z => setTimeout(z, 1000));
  }
  return {id: r.id, s: {}};
}
(async () => {
  // the example, solved with its solar programme (the values of scenario SC_2 written into the data)
  let ex = fs.readFileSync(path.join(W, 'examples', 'gas_solar.txt'), 'utf8');
  const sc2 = [...ex.matchAll(/^#@sv SC_2 TotalAnnualMinCapacityInvestment RE1 PWRSOL (\d+) (\S+)$/gm)];
  const ex2 = ex.replace(/param TotalAnnualMinCapacityInvestment default 0 := \n;/, 'param TotalAnnualMinCapacityInvestment default 0 := \n' + sc2.map(m => `RE1 PWRSOL ${m[1]} ${m[2]}\n`).join('') + ';');
  const base = await solve(ex, 'test_base'),
    solar = await solve(ex2, 'test_solar');
  out(base.s.state === 'done' && /OPTIMAL/i.test(base.s.solver_status || ''), 'the example is solved with the standard OSeMOSYS model', `${base.s.solver_status} ${base.s.objective}`);
  out(solar.s.state === 'done', 'the example with the solar programme is solved', solar.s.objective);
  const b = await chromium.launch();
  for (const lang of ['en', 'fr', 'es', 'ar']) {
    const ctx = await b.newContext({viewport: {width: 1440, height: 900}});
    await ctx.addInitScript(l => localStorage.setItem('mst_lang', l), lang);
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(URL + '/');
    await p.waitForTimeout(3500);
    await p.evaluate(() => MODELS.load());
    const r = await p.evaluate(() => ({
      ed: EDITION,
      name: APPNAME,
      builtin: BUILTIN_NAME,
      models: MODELS.list.map(m => m.name),
      rh: !!document.querySelector('#viewseg [data-v="rh"]'),
      dir: document.documentElement.dir,
      text: document.body.innerText
    }));
    if (lang === 'en') {
      out(r.ed === 'standard' && r.name === 'Nour OSeMOSYS Studio', 'standard edition, its name', r.name);
      out(/^OSeMOSYS standard model/.test(r.builtin) && r.models.length >= 1 && !r.models.some(n => /master/i.test(n)), 'one built-in model: the OSeMOSYS standard model', r.models.join(' | '));
      out(!r.rh, 'no rolling horizon');
      out(!/master/i.test(r.text), 'the word "master" is nowhere on the page');
      // the example and Model setup
      const s = await p.evaluate(async () => {
        await openExample(0);
        const rec = LIB.current ? await LIB.get(LIB.current) : null;
        await new Promise(z => setTimeout(z, 800));
        setView('ovw');
        renderSetup();
        await new Promise(z => setTimeout(z, 400));
        return {
          techs: [...M.techs].join(','),
          sections: [...document.querySelectorAll('#setup [data-t]')].map(x => x.dataset.t),
          backup: rec && rec.exampleBackup,
          mc: rec && rec.mc && rec.mc.factors ? rec.mc.factors.length : 0,
          rdm: rec && rec.rdm && rec.rdm.strategies ? rec.rdm.strategies.length : 0
        };
      });
      out(s.techs.includes('PWRSOL') && s.techs.includes('PWRGAS'), 'the example opens', s.techs);
      out(s.backup === 'gas_solar_mc_rdm.zip' && s.mc === 4 && s.rdm === 3, 'the example opens as a case with its Monte Carlo and robust-decision runs', `${s.backup} ${s.mc} factors ${s.rdm} strategies`);
      out(!s.sections.some(k => ['vint', 'fin', 'uc', 'casc', 'yield', 'link', 'constr'].includes(k)), 'Model setup: standard sections only', s.sections.join(','));
      // Ask the results: the share of solar in the electricity of each year
      const A = await p.evaluate(async id => {
        await loadRuns();
        ASK.run = id;
        ASK.pick = {};
        const A = await askAnswer('Share of the electricity produced by the solar power plant in the total electricity each year');
        const g = A.groups[0];
        const rows = (await getVar(id, 'ProductionByTechnologyAnnual')).rows.filter(r => r[2] === 'ELC' && r[3] === '2035');
        const tot = rows.reduce((s, r) => s + r[4], 0),
          sol = rows.filter(r => r[1] === 'PWRSOL').reduce((s, r) => s + r[4], 0);
        return {tech: (A.found.TECHNOLOGY || {codes: []}).codes.join(), pct: g.pct && g.pct.get('2035'), want: (100 * sol) / tot};
      }, solar.id);
      out(A.tech === 'PWRSOL' && Math.abs(A.pct - A.want) < 1e-6, 'Ask the results: share of solar in the 2035 electricity', `${A.pct && A.pct.toFixed(2)} % (expected ${A.want.toFixed(2)} %)`);
      // typing in the question box
      await p.click('#askb');
      await p.waitForSelector('#askq');
      await p.click('#askq');
      await p.keyboard.type('Emissions in 2030');
      await p.keyboard.press('Enter');
      await p.waitForSelector('.aska', {timeout: 15000});
      out(await p.$eval('#askq', e => e.value === 'Emissions in 2030'), 'the question box takes typing and Enter');
      // Monte Carlo and robust decisions open
      for (const v of ['mc', 'rdm']) {
        await p.evaluate(v => document.querySelector(`#viewseg [data-v="${v}"]`).click(), v);
        await p.waitForTimeout(1200);
        out(await p.evaluate(v => !document.getElementById(v === 'mc' ? 'mcview' : 'rdmview').hidden, v), `${v === 'mc' ? 'Monte Carlo' : 'Robust decisions'} opens`);
      }
      // How to cite: the Studio and its two documents in each format, the same references as CITATION.cff
      const cff = fs.readFileSync(path.join(__dirname, '..', 'CITATION.cff'), 'utf8');
      const dois = [...cff.matchAll(/doi: "([^"]+)"/g)].map(m => m[1]);
      const titles = [...cff.matchAll(/title: "([^"]+)"/g)].map(m => m[1]).filter(t => !/MUIO/.test(t));
      const C = await p.evaluate(() => {
        citePanel();
        const t = {};
        for (const f of ['apa', 'bib', 'ris']) {
          document.querySelector(`#citefmt [data-f="${f}"]`).click();
          t[f] = [...document.querySelectorAll('#drawer pre.cite')].map(x => x.textContent).join('\n');
        }
        document.getElementById('drawer').hidden = true;
        return t;
      });
      out(
        dois.length === 3 && titles.length === 3 && ['apa', 'bib', 'ris'].every(f => dois.every(d => C[f].includes(d)) && titles.every(t => C[f].includes(t))) &&
          /^@software\{/m.test(C.bib) && /^TY {2}- COMP/m.test(C.ris) && C.apa.includes('(Version 0.22.1)'),
        'How to cite: the Studio and its two documents in APA, BibTeX and RIS, as in CITATION.cff',
        dois.join(' ')
      );
      // New model with seasonal day hours
      const T = await p.evaluate(async () => {
        LIB.autosave = () => {};
        openNewModel();
        await new Promise(z => setTimeout(z, 300));
        const f = document.getElementById('nm');
        f.byseas.checked = true;
        f.byseas.onchange();
        document.getElementById('nmlat').value = '40';
        document.getElementById('nmlatgo').click();
        f.requestSubmit();
        await new Promise(z => setTimeout(z, 800));
        const ys = M.D.params.YearSplit.recs.filter(r => r.idx[1] === '2025');
        return {sum: ys.reduce((a, r) => a + +r.v, 0), n: ys.length, w: +ys[0].v, s: +ys[4].v};
      });
      out(Math.abs(T.sum - 1) < 1e-9 && T.n === 8 && T.w < T.s, 'New model: seasonal day hours, YearSplit adds up to 1', `${T.n} slices, winter day ${T.w.toFixed(4)} < summer day ${T.s.toFixed(4)}`);
    } else out(lang !== 'ar' || r.dir === 'rtl', `${lang}: the page in this language`, r.dir || 'ltr');
    out(!errs.length, `${lang}: no page errors`, errs.slice(0, 3).join(' | '));
    await ctx.close();
  }
  await b.close();
  for (const id of [base.id, solar.id]) await fetch(`${URL}/api/run/${id}/delete`, {method: 'POST'}).catch(() => {});
  console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
  process.exit(fails ? 1 : 0);
})();
