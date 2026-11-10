'use strict';
/* ============================== MathProg data parser ============================== */
/* Generic MathProg (GMPL) data reader: sets; param in simple, slice [r,*,*] and table (: cols :=) forms, with (tr);
   long one-record-per-line form (otoole) uses the OSeMOSYS index dimensions below, or one record per line if unknown. */
const DIMS = {
  YearSplit: 2,
  DiscountRate: 1,
  DiscountRateIdv: 2,
  DiscountRateStorage: 2,
  DaySplit: 2,
  Conversionls: 2,
  Conversionld: 2,
  Conversionlh: 2,
  DaysInDayType: 3,
  TradeRoute: 4,
  DepreciationMethod: 1,
  SpecifiedAnnualDemand: 3,
  SpecifiedDemandProfile: 4,
  AccumulatedAnnualDemand: 3,
  CapacityToActivityUnit: 2,
  CapacityFactor: 4,
  AvailabilityFactor: 3,
  OperationalLife: 2,
  ResidualCapacity: 3,
  InputActivityRatio: 5,
  OutputActivityRatio: 5,
  CapitalCost: 3,
  VariableCost: 4,
  FixedCost: 3,
  TechnologyToStorage: 4,
  TechnologyFromStorage: 4,
  StorageLevelStart: 2,
  StorageMaxChargeRate: 2,
  StorageMaxDischargeRate: 2,
  MinStorageCharge: 3,
  OperationalLifeStorage: 2,
  CapitalCostStorage: 3,
  ResidualStorageCapacity: 3,
  CapacityOfOneTechnologyUnit: 3,
  TotalAnnualMaxCapacity: 3,
  TotalAnnualMinCapacity: 3,
  TotalAnnualMaxCapacityInvestment: 3,
  TotalAnnualMinCapacityInvestment: 3,
  TotalTechnologyAnnualActivityUpperLimit: 3,
  TotalTechnologyAnnualActivityLowerLimit: 3,
  TotalTechnologyModelPeriodActivityUpperLimit: 2,
  TotalTechnologyModelPeriodActivityLowerLimit: 2,
  ReserveMarginTagTechnology: 3,
  ReserveMarginTagFuel: 3,
  ReserveMargin: 2,
  RETagTechnology: 3,
  RETagFuel: 3,
  REMinProductionTarget: 2,
  EmissionActivityRatio: 5,
  EmissionsPenalty: 3,
  AnnualExogenousEmission: 3,
  AnnualEmissionLimit: 3,
  ModelPeriodExogenousEmission: 2,
  ModelPeriodEmissionLimit: 2,
  TechnologyActivityByModeUpperLimit: 4,
  TechnologyActivityByModeLowerLimit: 4,
  TechnologyActivityIncreaseByModeLimit: 4,
  TechnologyActivityDecreaseByModeLimit: 4,
  UDCMultiplierTotalCapacity: 4,
  UDCMultiplierNewCapacity: 4,
  UDCMultiplierActivity: 4,
  UDCConstant: 3,
  UDCTag: 2
};
function parseData(text) {
  const sets = {},
    params = {},
    desc = {};
  for (const m of text.matchAll(/^#@desc\s+(\S+)\s+(.*)$/gm)) desc[m[1]] = m[2].trim();
  const colors = {};
  for (const m of text.matchAll(/^#@color\s+(\S+)\s+(#[0-9a-fA-F]{6})/gm)) colors[m[1]] = m[2]; // descriptions saved by the builder (comments for GLPK)
  // tokens with line numbers; comments (#...) removed
  const T = [];
  const re = /:=|\[[^\]]*\]|\(tr\)|[:;,]|'[^']*'|"[^"]*"|[^\s:;,\[\]]+/g;
  text.split(/\r?\n/).forEach((ln, n) => {
    const h = ln.indexOf('#');
    if (h >= 0) ln = ln.slice(0, h);
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(ln))) T.push({s: m[0].replace(/^['"]|['"]$/g, ''), n});
  });
  const num = x => {
    const v = Number(x);
    return x !== '' && !isNaN(v) ? v : x;
  };
  let i = 0;
  const stmt = () => {
    const a = [];
    while (i < T.length && T[i].s !== ';') a.push(T[i++]);
    i++;
    return a;
  };
  while (i < T.length) {
    const k = T[i].s;
    if (k === 'set') {
      i++;
      const a = stmt();
      const name = a[0].s;
      let b = a.slice(1);
      if (b[0] && b[0].s[0] === '[' && /^(MODEper|MODEx|INPUTx)/.test(name)) continue; // derived sets written by pre-processors
      if (b[0] && b[0].s[0] === '[') b = b.slice(1);
      b = b.filter(x => x.s !== ':=' && x.s !== ',' && x.s !== ':');
      sets[name] = (sets[name] || []).concat(b.map(x => x.s));
      continue;
    }
    if (k === 'param') {
      i++;
      const a = stmt();
      if (!a.length) continue;
      if (a[0].s === ':') {
        // tabbing form: param : A B := keys... vA vB
        let q = 1;
        const names = [];
        while (q < a.length && a[q].s !== ':=') names.push(a[q++].s);
        q++;
        for (const nm of names) params[nm] = params[nm] || {name: nm, def: undefined, recs: []};
        const lines = new Map();
        for (; q < a.length; q++) {
          if (a[q].s === ',') continue;
          if (!lines.has(a[q].n)) lines.set(a[q].n, []);
          lines.get(a[q].n).push(a[q].s);
        }
        for (const t of lines.values()) {
          const key = t.slice(0, t.length - names.length);
          names.forEach((nm, c) => {
            const v = t[key.length + c];
            if (v !== '.') params[nm].recs.push({idx: key, v: num(v)});
          });
        }
        continue;
      }
      const name = a[0].s;
      let q = 1,
        def;
      if (a[q] && a[q].s === 'default') {
        def = num(a[q + 1].s);
        q += 2;
      }
      const P = (params[name] = params[name] || {name, def, recs: []});
      if (def !== undefined) P.def = def;
      let slice = null,
        cols = null,
        tr = false;
      const put = (key, v) => {
        if (v === '.' || v === undefined) return;
        P.recs.push({idx: key, v: num(v)});
      };
      const fill = keys => {
        if (!slice) return keys;
        const out = [];
        let k2 = 0;
        for (const x of slice) out.push(x === '*' ? keys[k2++] : x);
        return out;
      };
      while (q < a.length) {
        const t = a[q].s;
        if (t === ':=' || t === ',') {
          q++;
          continue;
        }
        if (t[0] === '[') {
          slice = t
            .slice(1, -1)
            .split(',')
            .map(x => x.trim());
          cols = null;
          tr = false;
          q++;
          continue;
        }
        if (t === '(tr)') {
          tr = true;
          q++;
          continue;
        }
        if (t === ':') {
          q++;
          cols = [];
          while (q < a.length && a[q].s !== ':=') cols.push(a[q++].s);
          q++;
          continue;
        }
        if (cols) {
          // table rows: row v1 .. vn
          const row = t;
          q++;
          for (let c = 0; c < cols.length && q < a.length; c++, q++) put(fill(tr ? [cols[c], row] : [row, cols[c]]), a[q].s);
          continue;
        }
        const free = slice
          ? slice.filter(x => x === '*').length
          : (DIMS[name] ?? (SCHEMA && SCHEMA.params.get(name) ? SCHEMA.params.get(name).dims.length : undefined));
        if (free !== undefined) {
          const key = [];
          for (let c = 0; c < free && q < a.length; c++) key.push(a[q++].s);
          if (q < a.length) put(fill(key), a[q++].s);
          continue;
        }
        // unknown dimension: one record per line
        const n = a[q].n,
          t2 = [];
        while (q < a.length && a[q].n === n && a[q].s[0] !== '[' && a[q].s !== ':') {
          if (a[q].s !== ',' && a[q].s !== ':=') t2.push(a[q].s);
          q++;
        }
        if (t2.length >= 2) put(fill(t2.slice(0, -1)), t2[t2.length - 1]);
      }
      continue;
    }
    i++;
  }
  const setdesc = {};
  for (const m of text.matchAll(/^#@setdesc\s+(\S+)\s+(\S+)\s+(.*)$/gm)) {
    (setdesc[m[1]] = setdesc[m[1]] || {})[m[2]] = m[3].trim();
  }
  const icons = {};
  for (const m of text.matchAll(/^#@icon\s+(\S+)\s+(\S+)/gm)) icons[m[1]] = m[2];
  return {sets, params, desc, colors, setdesc, icons, scen: parseScenLines(text)};
}
