'use strict';
/* ============================== model index ============================== */
let M = null;
function buildModel(text, meta) {
  const D = parseData(text);
  if (!D.sets.TECHNOLOGY) throw new Error('no "set TECHNOLOGY" found - is this an OSeMOSYS data file?');
  if (!D.sets.TECHNOLOGY.length || (!D.params.InputActivityRatio && !D.params.OutputActivityRatio))
    throw new Error('no technologies or no InputActivityRatio / OutputActivityRatio found');
  D.cname = D.sets.COMMODITY ? 'COMMODITY' : D.sets.FUEL ? 'FUEL' : 'COMMODITY';
  indexModel(D, meta);
}
function indexModel(D, meta) {
  const S = D.sets;
  if (!S[D.cname || 'COMMODITY']) S[D.cname || 'COMMODITY'] = [];
  if (D.cname === 'FUEL') S.COMMODITY = S.FUEL;
  const years = (S.YEAR || [])
      .map(Number)
      .filter(y => !isNaN(y))
      .sort((a, b) => a - b),
    techs = new Set(S.TECHNOLOGY),
    stor = new Set(S.STORAGE || []);
  const byTech = new Map(),
    byStor = new Map(),
    byFuel = new Map();
  const add = (map, k, r) => {
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  };
  for (const P of Object.values(D.params))
    for (const r of P.recs) {
      r.p = P.name;
      const t = NONTECH.has(P.name) ? null : techs.has(r.idx[1]) ? r.idx[1] : r.idx.find(x => techs.has(x));
      if (t) add(byTech, t, r);
      const s = r.idx.find(x => stor.has(x));
      if (s) add(byStor, s, r);
    }
  // flows: region -> list {t,f,m,y,v,dir}
  const flows = [];
  for (const [pn, dir] of [
    ['InputActivityRatio', 'in'],
    ['OutputActivityRatio', 'out']
  ]) {
    const P = D.params[pn];
    if (!P) continue;
    for (const r of P.recs)
      if (r.v && typeof r.v === 'number')
        flows.push({r: r.idx[0], t: r.idx[1], f: r.idx[2], m: String(r.idx[3]), y: +r.idx[r.idx.length - 1], v: r.v, dir}); // year = last index (also for timeslice-indexed ratios)
  }
  for (const fl of flows) add(byFuel, fl.f, fl);
  if (!years.length) years.push(...[...new Set(flows.map(f => f.y))].sort((a, b) => a - b));
  M = {D, S, years, techs, stor, byTech, byStor, byFuel, flows, meta};
  REG = S.REGION && S.REGION.length ? S.REGION.slice() : [...new Set(flows.map(f => f.r))];
  const y0 = years[0],
    y1 = years[years.length - 1];
  KEYY = years.filter(y => y === y0 || y === y1 || y % 5 === 0 || (y0 <= 2025 && y <= 2025 && y >= y0 && years.length > 40 && y >= 2022));
}
const P_ = n => M.D.params[n] || {recs: [], def: undefined};
function val(param, idx) {
  const P = M.D.params[param];
  if (!P) return undefined;
  for (const r of P.recs) if (r.idx.length === idx.length && r.idx.every((x, k) => x === idx[k])) return r.v;
  return undefined;
}
function techVals(t, param, region) {
  return (M.byTech.get(t) || []).filter(r => r.p === param && (!region || r.idx[0] === region));
}
