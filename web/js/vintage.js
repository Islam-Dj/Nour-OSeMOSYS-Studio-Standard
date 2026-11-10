'use strict';
/* ============================== Vintage and age axis ==============================
   Models with vintaging (model.v.5.3 with set VINTAGE / set AGE / AgeIndex, or the variant that computes AGE inside the model
   as setof{(r,t,v,y) in RTVY} (y-v)) need the vintage and age axes in the data. The Studio builds them, so the user never types
   them and they always match the years and the operational lives:
     VINTAGE  = first year - longest life + 1 ... last year (pre-horizon cohorts included), plus any vintage already in the data
     AGE      = 0 ... longest life - 1, plus any age already in the data          (written only when the model reads AGE from the data)
     AgeIndex[v,y] = y - v                                                        (written only when the model declares it)
     MaxAge   = longest life - 1                                                  (written only when the model declares it)
   "Longest life" = largest OperationalLife of the technologies with VintageMode 1 or 2 (of every technology while none is on).
   Per technology, the input grids show its own ages (0 ... life - 1) and vintages (first year - life + 1 ... last year).
   Values outside the domain the model will see are not written (GLPK would stop with "out of domain"); the data file says how many. */
const VINT_AUTO = new Set(['AgeIndex', 'MaxAge']); // written by the Studio, never edited
const VINT = {
  on() {
    return !!(
      SCHEMA &&
      SCHEMA.fromFile &&
      (SCHEMA.sets.includes('VINTAGE') ||
        (SCHEMA.optSets || []).includes('VINTAGE') ||
        [...SCHEMA.params.values()].some(p => p.dims.includes('VINTAGE')))
    );
  },
  ageInData() {
    return !!(SCHEMA && SCHEMA.sets.includes('AGE'));
  }, // false: AGE is computed by the model (or absent)
  recs(P, p) {
    return ((P || M.D.params)[p] || {recs: []}).recs;
  },
  life(P, t) {
    let L = 0;
    const R = this.recs(P, 'OperationalLife').filter(r => String(r.idx[1]) === String(t));
    for (const r of R) L = Math.max(L, Number(r.v) || 0);
    if (!R.length) L = Number(defOf('OperationalLife')) || 0;
    for (const r of this.recs(P, 'LifeExtension')) if (String(r.idx[1]) === String(t)) L = Math.max(L, Number(r.v) || 0); // master [2c]: refurbished cohorts
    return Math.round(L);
  },
  ext(P, r, t) {
    const x = this.recs(P, 'LifeExtension').find(z => String(z.idx[0]) === String(r) && String(z.idx[1]) === String(t));
    return x ? Number(x.v) || 0 : 0;
  },
  modes(P) {
    const m = new Map();
    for (const r of this.recs(P, 'VintageMode')) m.set(String(r.idx[0]), Number(r.v));
    return m;
  },
  vtechs(P) {
    const m = this.modes(P);
    return (M.D.sets.TECHNOLOGY || []).map(String).filter(t => m.get(t) === 1 || m.get(t) === 2);
  },
  years() {
    return (M.D.sets.YEAR || [])
      .map(Number)
      .filter(y => !isNaN(y))
      .sort((a, b) => a - b);
  },
  maxLife(P) {
    const vt = this.vtechs(P),
      T = vt.length ? vt : (M.D.sets.TECHNOLOGY || []).map(String);
    let L = 1;
    for (const t of T) L = Math.max(L, this.life(P, t));
    return L;
  },
  used(P, setName) {
    const S = new Set(); // members already used by the data (kept in the axis)
    for (const p of Object.keys(P || M.D.params)) {
      const d = SCHEMA && SCHEMA.params.get(p) ? SCHEMA.params.get(p).dims : null;
      if (!d || !d.includes(setName) || VINT_AUTO.has(p)) continue;
      const k = d.indexOf(setName);
      for (const r of this.recs(P, p)) S.add(Number(r.idx[k]));
    }
    return S;
  },
  axis(P) {
    const Y = this.years();
    if (!Y.length) return {VINTAGE: [], AGE: [], maxLife: 0};
    const L = this.maxLife(P),
      v = new Set(),
      a = new Set();
    for (let x = Y[0] - L + 1; x <= Y[Y.length - 1]; x++) v.add(x);
    for (let x = 0; x < L; x++) a.add(x);
    for (const x of this.used(P, 'VINTAGE')) if (!isNaN(x)) v.add(x);
    for (const x of (M.D.sets.VINTAGE || []).map(Number)) if (!isNaN(x)) v.add(x);
    if (this.ageInData()) {
      for (const x of this.used(P, 'AGE')) if (!isNaN(x)) a.add(x);
      for (const x of (M.D.sets.AGE || []).map(Number)) if (!isNaN(x)) a.add(x);
    }
    const s = z => [...z].sort((p, q) => p - q).map(String);
    return {VINTAGE: s(v), AGE: s(a), maxLife: L};
  },
  /* the ages the model itself will have in AGE when it computes it: y - v over (r,t,v,y) with VintageMode 1/2, v <= y, y - v < OperationalLife[r,t] */
  modelAges(P, vint) {
    const A = new Set(),
      Y = this.years(),
      V = vint.map(Number),
      vt = new Set(this.vtechs(P)),
      lf = new Map();
    for (const r of this.recs(P, 'OperationalLife')) if (vt.has(String(r.idx[1]))) lf.set(r.idx[0] + '|' + r.idx[1], Number(r.v));
    const regs = (M.D.sets.REGION || []).map(String),
      d = Number(defOf('OperationalLife')) || 0;
    for (const reg of regs)
      for (const t of vt) {
        const L = lf.has(reg + '|' + t) ? lf.get(reg + '|' + t) : d;
        const E = this.ext(P, reg, t),
          YS = new Set(Y);
        for (const v of V) for (const y of Y) if (v <= y && (y - v < L || (E > 0 && y - v < E && YS.has(v)))) A.add(String(y - v));
      }
    return A;
  },
  /* members shown in a technology's grid */
  rowsFor(setName, t) {
    const Y = this.years();
    if (!Y.length) return [];
    const L = Math.max(1, this.life(null, t)),
      out = new Set();
    if (setName === 'AGE') for (let x = 0; x < L; x++) out.add(String(x));
    else for (let x = Y[0] - L + 1; x <= Y[Y.length - 1]; x++) out.add(String(x));
    const all = this.axis(null)[setName] || [];
    return all.filter(x => out.has(x));
  },
  /* lines for the data file */
  writeSets(P) {
    const a = this.axis(P);
    return {VINTAGE: a.VINTAGE, AGE: this.ageInData() ? a.AGE : null};
  },
  writeExtra(P) {
    const out = [],
      a = this.axis(P),
      Y = this.years();
    if (SCHEMA.params.has('AgeIndex')) {
      out.push('param AgeIndex : ', Y.join(' ') + ' :=', ...a.VINTAGE.map(v => v + ' ' + Y.map(y => y - Number(v)).join(' ')), ';');
    }
    if (SCHEMA.params.has('MaxAge')) out.push(`param MaxAge := ${a.maxLife - 1} ;`);
    return out;
  },
  /* filter of the records of a parameter indexed by VINTAGE or AGE: keep what is in the domain the model will see */
  domain(P) {
    const a = this.axis(P);
    return {VINTAGE: new Set(a.VINTAGE), AGE: this.ageInData() ? new Set(a.AGE) : this.modelAges(P, a.VINTAGE)};
  },
  summary() {
    if (!this.on()) return '';
    const a = this.axis(null),
      vt = this.vtechs(null);
    return (
      `Vintage axis (automatic): vintages ${a.VINTAGE[0]}–${a.VINTAGE[a.VINTAGE.length - 1]}, ages 0–${a.maxLife - 1}` +
      `${this.ageInData() ? '' : ' (AGE is computed by the model)'} · ${vt.length ? vt.length + ' technolog' + (vt.length > 1 ? 'ies' : 'y') + ' with VintageMode 1 or 2' : 'no technology has VintageMode 1 or 2 yet'}`
    );
  }
};
/* ResidualCapacity of a technology made from its cohorts (the model needs both to agree in every year) */
function vintResidual(t) {
  const Y = VINT.years();
  let n = 0;
  for (const r of REG) {
    const life = VINT.recs(null, 'OperationalLife').find(x => x.idx[0] === r && x.idx[1] === t),
      L = life ? Number(life.v) : Number(defOf('OperationalLife')) || 1;
    const coh = VINT.recs(null, 'ResidualCapacityByVintage').filter(x => x.idx[0] === r && x.idx[1] === t);
    if (!coh.length) continue;
    for (const y of Y) {
      const s = coh.filter(x => +x.idx[2] <= y && y - +x.idx[2] < L).reduce((a, x) => a + Number(x.v), 0);
      cellSet('ResidualCapacity', [r, t, String(y)], +s.toPrecision(12));
      n++;
    }
  }
  afterEdit(n ? `${t}: ResidualCapacity set from the vintages (${n} values)` : `${t}: no ResidualCapacityByVintage values`);
  if (EDIT && EDIT.code === t) openEntity('tech', t);
}

// Vintages from ResidualCapacity: split the existing capacity into cohorts so that the cohorts still
// alive add up to ResidualCapacity in every year. A fall of ResidualCapacity in year y is a cohort that reached the end of
// its life: built in y - life. A rise is existing capacity commissioned in y (cohort y). What is still there in the last
// year belongs to the cohort that ends just after the horizon. Cohorts already known (rises) are taken out of later falls.
function vintFromResidualCalc(R, Y, L) {
  const coh = new Map(),
    exp = new Map(),
    add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
  for (let i = 1; i < Y.length; i++) {
    const y = Y[i],
      d = R(Y[i - 1]) - R(y) - (exp.get(y) || 0);
    if (d > 1e-12) add(coh, y - L, d);
    else if (d < -1e-12) {
      add(coh, y, -d);
      add(exp, y + L, -d);
    }
  }
  const alive = y => [...coh].reduce((a, [v, c]) => a + (v <= y && y - v < L ? c : 0), 0),
    yl = Y[Y.length - 1];
  const rem = R(yl) - alive(yl);
  if (rem > 1e-12) add(coh, yl - L + 1, rem);
  const bad = Y.filter(y => Math.abs(alive(y) - R(y)) > 1e-6 * Math.max(1, R(y)));
  return {coh, bad, alive};
}
function vintFromResidual(t) {
  const Y = VINT.years();
  let n = 0;
  const warn = [];
  for (const r of REG) {
    const life = VINT.recs(null, 'OperationalLife').find(x => x.idx[0] === r && x.idx[1] === t),
      L = life ? Number(life.v) : Number(defOf('OperationalLife')) || 1;
    const rc = new Map(
        VINT.recs(null, 'ResidualCapacity')
          .filter(x => x.idx[0] === r && x.idx[1] === t)
          .map(x => [+x.idx[2], Number(x.v)])
      ),
      d0 = Number(defOf('ResidualCapacity')) || 0;
    const R = y => (rc.has(y) ? rc.get(y) : d0);
    if (!Y.some(y => R(y) > 0)) continue;
    const {coh, bad} = vintFromResidualCalc(R, Y, L);
    for (const x of VINT.recs(null, 'ResidualCapacityByVintage').filter(x => x.idx[0] === r && x.idx[1] === t))
      cellSet('ResidualCapacityByVintage', [r, t, String(x.idx[2])], null);
    for (const [v, c] of [...coh].sort((a, b) => a[0] - b[0])) {
      cellSet('ResidualCapacityByVintage', [r, t, String(v)], +c.toPrecision(12));
      n++;
      if (v > Y[0]) warn.push(`${r}: cohort ${v} is after the first year (existing capacity lives longer than ${L} years?)`);
    }
    if (bad.length) warn.push(`${r}: cohorts cannot match ResidualCapacity in ${bad.slice(0, 5).join(', ')}${bad.length > 5 ? ' …' : ''}`);
  }
  afterEdit(
    n
      ? `${t}: ResidualCapacityByVintage set from ResidualCapacity (${n} cohorts)${warn.length ? ' · ' + warn.join(' · ') : ''}`
      : `${t}: no ResidualCapacity to split`
  );
  if (EDIT && EDIT.code === t) openEntity('tech', t);
}
