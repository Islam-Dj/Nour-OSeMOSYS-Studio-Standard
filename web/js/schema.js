'use strict';
/* ============================== BUILD: model schema, editors, writer, library ============================== */
/* The builder is driven by a MODEL FILE (GMPL): every parameter it declares, with its index sets and default, becomes
   editable; constraints are listed with the parameters they use. Default model: MUIO 5.4 (embedded, Apache-2.0). */
const STD = [
  ['TradeRoute', 0],
  ['Conversionls', 0],
  ['Conversionld', 0],
  ['Conversionlh', 0],
  ['UDCTag', -1],
  ['DiscountRate', 0.05],
  ['DiscountRateIdv', 0.05],
  ['CapacityToActivityUnit', 1],
  ['OperationalLife', 1],
  ['TotalTechnologyModelPeriodActivityLowerLimit', 0],
  ['TotalTechnologyModelPeriodActivityUpperLimit', 999999],
  ['ModelPeriodEmissionLimit', 999999],
  ['ModelPeriodExogenousEmission', 0],
  ['UDCConstant', 0],
  ['UDCMultiplierTotalCapacity', 0],
  ['UDCMultiplierNewCapacity', 0],
  ['UDCMultiplierActivity', 0],
  ['YearSplit', 1],
  ['DaySplit', 1],
  ['DaysInDayType', 1],
  ['AvailabilityFactor', 1],
  ['CapitalCost', 0],
  ['FixedCost', 0],
  ['ResidualCapacity', 0],
  ['TotalAnnualMaxCapacity', 999999],
  ['TotalAnnualMaxCapacityInvestment', 999999],
  ['TotalAnnualMinCapacity', 0],
  ['TotalAnnualMinCapacityInvestment', 0],
  ['TotalTechnologyAnnualActivityLowerLimit', 0],
  ['TotalTechnologyAnnualActivityUpperLimit', 999999],
  ['CapacityOfOneTechnologyUnit', 0],
  ['VariableCost', 0.0001],
  ['TechnologyActivityByModeLowerLimit', 0],
  ['TechnologyActivityByModeUpperLimit', 99999],
  ['TechnologyActivityDecreaseByModeLimit', 0],
  ['TechnologyActivityIncreaseByModeLimit', 0],
  ['InputToNewCapacityRatio', 0],
  ['InputToTotalCapacityRatio', 0],
  ['InputActivityRatio', 0],
  ['OutputActivityRatio', 0],
  ['OperationalLifeStorage', 1],
  ['StorageLevelStart', 1],
  ['CapitalCostStorage', 0],
  ['ResidualStorageCapacity', 0],
  ['MinStorageCharge', 0],
  ['TechnologyToStorage', 0],
  ['TechnologyFromStorage', 0],
  ['CapacityFactor', 1],
  ['AccumulatedAnnualDemand', 0],
  ['SpecifiedAnnualDemand', 0],
  ['SpecifiedDemandProfile', 0],
  ['AnnualEmissionLimit', 999999],
  ['EmissionsPenalty', 0],
  ['EmissionActivityRatio', 0],
  ['EmissionToActivityChangeRatio', 0],
  // extension modules (model file without defaults): neutral values = module off, no cap (RegionalAnnualEmissionLimit: 999999, not 0 = no emission allowed)
  ['RegionalAnnualEmissionLimit', 999999],
  ['BudgetBaseline', 999999],
  ['BudgetRevenueShare', 0],
  ['BudgetCapitalShare', 0],
  ['MaxFDI', 0],
  ['MaxBorrowing', 0],
  ['MinFDI', 0],
  ['MinBorrowing', 0],
  ['FundContributionShare', 0],
  ['FundDrawShare', 0],
  ['SalePrice', 0],
  ['FDIReturnRate', 0],
  ['FDIReturnRateStorage', 0],
  ['BorrowingRate', 0],
  ['BalanceEquality', 0]
];
const STDDEF = Object.fromEntries(STD);
const PREPROC = new Set(['CapitalRecoveryFactor', 'PvAnnuity']); // computed by the MUIO pre-processor, never written
const ENTSET = {tech: 'TECHNOLOGY', comm: 'COMMODITY', stor: 'STORAGE', emi: 'EMISSION', udc: 'UDC'};
const ENTNAME = {
  tech: 'technology',
  comm: 'commodity',
  stor: 'storage',
  emi: 'emission',
  udc: 'user-defined constraint',
  glob: 'model settings',
  all: 'all parameters'
};
const SPARSE = new Set(['COMMODITY', 'FUEL', 'EMISSION', 'STORAGE', 'UDC', 'REGION', 'TECHNOLOGY']);
const BUILTIN_NAME = STANDARD ? 'OSeMOSYS standard model (built in)' : 'OSeMOSYS master 0.12 (built in)'; // standard edition: data/builtin_model.txt holds model.v.5.7.txt
const MUIO57_NAME = 'OSeMOSYS standard model (built in)'; // the standard OSeMOSYS model file (model.v.5.7.txt, the file MUIO uses, Apache-2.0), the second built-in model
// cases saved with the built-in master 0.7 or later need no conversion (the new options are off by default); 0.6 and earlier: Convert
const SAME_BUILTIN = n => n === BUILTIN_NAME || /^OSeMOSYS master 0\.(7|8|9|1\d) \(built in\)$/.test(n || ''); // Studio: the built-in model file is the master model (read strictly, as a model file)
let SCHEMA = null,
  dirty = false,
  COLORS = {},
  REV = 0;

/* ---- model file reader ---- */
function splitStatements(src) {
  const out = [];
  let cur = '',
    q = null;
  for (const ch of src) {
    if (q) {
      cur += ch;
      if (ch === q) q = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      q = ch;
      cur += ch;
      continue;
    }
    if (ch === ';') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
function domainSets(dom) {
  // "{r in REGION, t in TECHNOLOGY: cond}" -> ['REGION','TECHNOLOGY']
  let d = dom.slice(1, -1),
    depth = 0,
    cut = d.length;
  for (let i = 0; i < d.length; i++) {
    const c = d[i];
    if ('{(['.includes(c)) depth++;
    else if ('})]'.includes(c)) depth--;
    else if (c === ':' && depth === 0 && d[i + 1] !== '=') {
      cut = i;
      break;
    }
  }
  d = d.slice(0, cut);
  const items = [];
  depth = 0;
  let cur = '';
  for (const c of d) {
    if ('{(['.includes(c)) depth++;
    if ('})]'.includes(c)) depth--;
    if (c === ',' && depth === 0) {
      items.push(cur);
      cur = '';
    } else cur += c;
  }
  items.push(cur);
  return items.map(x => {
    const m = x.match(/\bin\s+([A-Za-z_]\w*)/);
    return m ? m[1] : x.trim();
  });
}
function parseModelFile(txt, name) {
  const src = txt.replace(/#[^\n]*/g, ''),
    sets = [],
    optSets = [],
    params = new Map(),
    cons = [],
    vars = new Map(),
    within = new Set(),
    docs = {};
  // documentation: the comment on the declaration line, or the comment lines just above it
  const L = txt.split(/\r?\n/);
  L.forEach((ln, i) => {
    const m = ln.match(/^\s*(param|set|var)\s+([A-Za-z_]\w*)/);
    if (!m) return;
    let d = (ln.match(/#\s*(.+)$/) || [])[1];
    if (!d) {
      const dn = [];
      for (let k = i + 1; k < L.length && k <= i + 4 && /^\s+#/.test(L[k]); k++) {
        const t = L[k].replace(/^\s*#+\s*/, '').trim();
        if (/^[-=#*_ ]*$/.test(t)) break;
        dn.push(t);
      }
      d = dn.join(' ');
    } // indented comment lines just below the declaration (they describe it)
    if (!d) {
      const up = [];
      for (let k = i - 1; k >= 0 && k >= i - 4 && /^#/.test(L[k]); k--) {
        const t = L[k].replace(/^\s*#+\s*/, '').trim();
        if (/^[-=#*_ ]*$/.test(t)) break;
        up.unshift(t);
      }
      d = up.join(' ');
    }
    if (d && d.length > 3) docs[m[2]] = d.replace(/\s+/g, ' ').slice(0, 300);
  });
  for (const raw of splitStatements(src)) {
    const st = raw.trim().replace(/\s+/g, ' ');
    let m;
    if ((m = st.match(/^var ([A-Za-z_]\w*)\s*(\{[^}]*\})?/))) {
      vars.set(m[1], {name: m[1], dims: m[2] ? domainSets(m[2]) : []});
      continue;
    }
    if ((m = st.match(/^set ([A-Za-z_]\w*)\s*(\{)?(.*)$/))) {
      if (m[2] || /:=/.test(m[3]) || /^(MODEper|MODEx|INPUTx)/.test(m[1])) continue;
      if (/\bwithin\b/.test(m[3])) within.add(m[1]);
      (/\bdefault\b/.test(m[3]) ? optSets : sets).push(m[1]);
      continue;
    }
    if ((m = st.match(/^param ([A-Za-z_]\w*)\s*(\{.*?\})?(.*)$/))) {
      let dom = '',
        rest = m[3];
      if (m[2]) {
        let d = 0,
          k = st.indexOf('{');
        for (let i = k; i < st.length; i++) {
          if (st[i] === '{') d++;
          if (st[i] === '}') {
            d--;
            if (!d) {
              dom = st.slice(k, i + 1);
              rest = st.slice(i + 1);
              break;
            }
          }
        }
      }
      const dm = rest.match(/\bdefault\s+(-?[\d.eE+]+)/),
        computed = /:=/.test(rest);
      params.set(m[1], {
        name: m[1],
        dims: dom ? domainSets(dom) : [],
        def: dm ? Number(dm[1]) : undefined,
        computed: computed || PREPROC.has(m[1]) || (typeof VINT_AUTO !== 'undefined' && VINT_AUTO.has(m[1])),
        symbolic: /\bsymbolic\b/.test(rest),
        used: [],
        doc: docs[m[1]]
      });
      continue;
    }
    if ((m = st.match(/^(?:s\.t\.|subject to) ([A-Za-z_]\w*)(.*)$/))) cons.push({name: m[1], body: m[2]});
    else if ((m = st.match(/^(minimize|maximize) ([A-Za-z_]\w*)(.*)$/))) cons.push({name: m[2] + ' (objective)', body: m[3]});
  }
  for (const c of cons)
    for (const id of new Set(c.body.match(/[A-Za-z_]\w*(?=\s*\[)/g) || [])) if (params.has(id)) params.get(id).used.push(c.name);
  return {name, sets, optSets, params, cons, vars, within, docs, text: txt, fromFile: name !== 'MUIO 5.4 (built in)'};
}
const INDEXSETS = new Set([
  'REGION',
  'YEAR',
  'TIMESLICE',
  'SEASON',
  'DAYTYPE',
  'DAILYTIMEBRACKET',
  'MODE_OF_OPERATION',
  'FUEL',
  'COMMODITY',
  'TECHNOLOGY',
  'STORAGE',
  'EMISSION',
  'UDC'
]);
function setSchema(txt, name) {
  SCHEMA = parseModelFile(txt, name);
  // every other set the model declares (not a subset, not an index set) becomes an item type with its own form and "+" button
  for (const k of Object.keys(ENTSET))
    if (k.startsWith('x_')) {
      delete ENTSET[k];
      delete ENTNAME[k];
    }
  for (const n of [...SCHEMA.sets, ...(SCHEMA.optSets || [])])
    if (
      !INDEXSETS.has(n) &&
      n !== 'VINTAGE' &&
      n !== 'AGE' &&
      !SCHEMA.within.has(n) &&
      [...SCHEMA.params.values()].some(p => p.dims.includes(n))
    ) {
      ENTSET['x_' + n] = n;
      ENTNAME['x_' + n] = n.toLowerCase().replace(/_/g, ' ');
    }
  renderBuildExtra();
}
function renderBuildExtra() {
  const b = document.getElementById('b-extra');
  if (!b) return;
  b.innerHTML = Object.keys(ENTSET)
    .filter(k => k.startsWith('x_'))
    .map(k => `<button class="btn" type="button" data-kind="${k}">+ ${esc(ENTNAME[k])}</button>`)
    .join('');
  b.querySelectorAll('[data-kind]').forEach(x => (x.onclick = () => openEntity(x.dataset.kind, null)));
}
/* dims of a parameter: from the model file, else inferred from the data (each position -> the set holding all its values) */
const SETPREF = [
  'REGION',
  'TECHNOLOGY',
  'COMMODITY',
  'FUEL',
  'STORAGE',
  'EMISSION',
  'UDC',
  'MODE_OF_OPERATION',
  'TIMESLICE',
  'YEAR',
  'SEASON',
  'DAYTYPE',
  'DAILYTIMEBRACKET'
];
function pinfo(p) {
  const s = SCHEMA && SCHEMA.params.get(p);
  if (s) return s;
  const P = M.D.params[p];
  if (!P || !P.recs.length) return {name: p, dims: [], def: P && P.def, used: [], inferred: true};
  const n = P.recs[0].idx.length,
    dims = [];
  for (let k = 0; k < n; k++) {
    const vals = new Set(P.recs.map(r => String(r.idx[k])));
    dims.push(
      SETPREF.concat(Object.keys(M.D.sets)).find(sn => M.D.sets[sn] && [...vals].every(v => M.D.sets[sn].map(String).includes(v))) || '?'
    );
  }
  return {name: p, dims: dims.map(d => (d === 'FUEL' ? 'COMMODITY' : d)), def: P.def, used: [], inferred: true};
}
const dimsOf = p => pinfo(p).dims.map(d => (d === 'FUEL' ? 'COMMODITY' : d));
function allParams() {
  const names = new Set(
    SCHEMA ? [...SCHEMA.params.keys()].filter(p => !SCHEMA.params.get(p).computed && SCHEMA.params.get(p).dims.length) : []
  );
  if (!SCHEMA || !SCHEMA.fromFile) {
    STD.forEach(x => names.add(x[0]));
    Object.keys(M.D.params).forEach(p => {
      if (!PREPROC.has(p)) names.add(p);
    });
  }
  return [...names];
}
function paramsFor(kind) {
  if (kind === 'all') return allParams();
  const S = ENTSET[kind];
  return allParams().filter(p => {
    const d = dimsOf(p);
    if (kind === 'glob') return !d.some(x => Object.values(ENTSET).includes(x));
    return d.includes(S);
  });
} // every parameter that involves the item (e.g. a commodity's input/output ratios, with the technologies as rows)
function defOf(p) {
  const P = M.D.params[p];
  if (P && P.def !== undefined) return Number(P.def);
  const s = SCHEMA && SCHEMA.params.get(p);
  if (s && s.def !== undefined) return s.def;
  return STDDEF[p] ?? 0;
}

// data made for the master model before 0.7: its earlier budget / FDI / borrowing / fund parameters, which 0.7 no longer reads
const LEGACY_FIN = [
  'BudgetBaseline',
  'BudgetRevenueShare',
  'MaxFDI',
  'MaxBorrowing',
  'MinFDI',
  'MinBorrowing',
  'BudgetCapitalShare',
  'BudgetCapitalShareStorage',
  'FundContributionShare',
  'FundDrawShare',
  'FDIReturnRate',
  'FDIReturnRateStorage',
  'BorrowingRate',
  'BudgetImportShare',
  'BudgetOpexShare',
  'LoanTenor',
  'DebtServiceInBudget',
  'AllowConcessionalFinance',
  'AllowBudgetSavings',
  'SavingsReturnRate',
  'InitialBudgetSavings',
  'BudgetCapexMode'
];
const LEGACY_RX = new RegExp('^param (' + LEGACY_FIN.join('|') + ')\\b', 'm');
const legacyFin = txt => !!txt && LEGACY_RX.test(txt) && !/^\s*param\s+BudgetBaseline\b/m.test(MODELTXT());
