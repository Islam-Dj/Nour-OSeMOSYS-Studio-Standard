'use strict';
/* ============================== Units ==============================
   As in MUIO: every technology has a capacity unit and an activity unit, every commodity, emission and storage a unit,
   and the model a currency. Units are LABELS: they do not change the numbers (as in MUIO). They are shown with the
   parameters (e.g. CapitalCost in M$/GW, from MUIO's unit rules) and the results, and go to MUIO on export.
   The standard list is MUIO's, with a few more; you can add your own units (e.g. lux, Gcal of heat), kept in the data
   file and remembered by the Studio for your other cases.
   Saved in the data file as comment lines (read back by the Studio, ignored by GLPK):
     #@unit TECHNOLOGY <code> <capacity unit> <activity unit>   #@unit COMMODITY|EMISSION|STORAGE <code> <unit>
     #@currency <currency>                                       #@unitdef <id>|<name>|<group>|<description>|<factor>|<of unit> */
const UNIT_STD = [
  ...['TJ', 'PJ', 'EJ', 'GJ', 'ktoe', 'Mtoe', 'kWh', 'MWh', 'GWh', 'TWh', 'Gcal', 'MBtu'].map(u => ({id: u, name: u, group: 'Energy'})),
  ...['kW', 'MW', 'GW', 'TW', 'MWth', 'GWth', 'PJ/yr', 'TJ/yr', 'Ton/yr', 'kTon/yr', 'MTon/yr', 'km3/yr', 'mm3/yr', 'bm3/yr'].map(u => ({
    id: u,
    name: u.replace('km3', '10³ m³').replace('mm3', '10⁶ m³').replace('bm3', '10⁹ m³'),
    group: 'Capacity'
  })),
  ...['Ton', 'kTon', 'MTon', 'Kg', 'lbs', 'Mt', 'kt', 'MtCO2', 'MtCO2e', 'ktCO2'].map(u => ({
    id: u,
    name: u,
    group: 'Weight and emissions'
  })),
  ...[
    ['m2', 'm²'],
    ['km2', 'km²'],
    ['kkm2', '10³ km²'],
    ['kHa', '10³ ha'],
    ['Ha', 'ha']
  ].map(([u, n]) => ({id: u, name: n, group: 'Area'})),
  ...[
    ['m3', 'm³'],
    ['km3', '10³ m³'],
    ['mm3', '10⁶ m³'],
    ['bm3', '10⁹ m³'],
    ['bcm', 'bcm (gas)']
  ].map(([u, n]) => ({id: u, name: n, group: 'Volume'})),
  ...[
    ['vkm', 'vehicle-km'],
    ['vkm3', '10³ vehicle-km'],
    ['vkm6', '10⁶ vehicle-km'],
    ['vkm9', '10⁹ vehicle-km'],
    ['tkm', 'tonne-km'],
    ['tkm3', '10³ tonne-km'],
    ['tkm6', '10⁶ tonne-km'],
    ['tkm9', '10⁹ tonne-km'],
    ['pkm', 'passenger-km'],
    ['pkm3', '10³ passenger-km'],
    ['pkm6', '10⁶ passenger-km'],
    ['pkm9', '10⁹ passenger-km']
  ].map(([u, n]) => ({id: u, name: n, group: 'Transport'})),
  ...[
    ['103', '10³ (count)'],
    ['106', '10⁶ (count)'],
    ['109', '10⁹ (count)']
  ].map(([u, n]) => ({id: u, name: n, group: 'Counts'}))
];
const CURRENCIES = ['M$', 'B$', 'k$', '$', 'MUSD', 'M€', 'MEUR', 'MDZD', 'BDZD'];
const UNIT_DEF0 = {cap: 'GW', act: 'PJ', comm: 'PJ', emis: 'MTon', stor: 'PJ'};
let UNITS = {tech: {}, comm: {}, emis: {}, stor: {}, currency: 'M$', custom: [], def: {...UNIT_DEF0}};
const UNIT_KEY = 'nour.master.units.custom';
let UG_ = null;
function unitsGlobal() {
  if (UG_) return UG_;
  try {
    UG_ = JSON.parse(localStorage.getItem(UNIT_KEY) || '[]');
  } catch (e) {
    UG_ = [];
  }
  return UG_;
}
function unitsRemember() {
  try {
    const g = unitsGlobal().filter(u => !UNITS.custom.some(c => c.id === u.id));
    UG_ = null;
    localStorage.setItem(UNIT_KEY, JSON.stringify([...g, ...UNITS.custom]));
  } catch (e) {}
}
let UL_ = null,
  ULK_ = null;
function unitList() {
  const k = UNITS.custom.length + '|' + UNITS.custom.map(c => c.id + c.name).join(',') + '|' + (UG_ ? UG_.length : 'x');
  if (UL_ && ULK_ === k && UG_) return UL_;
  const seen = new Set(),
    out = [];
  for (const u of [
    ...UNIT_STD,
    ...UNITS.custom.map(c => ({...c, custom: true})),
    ...unitsGlobal().map(c => ({...c, custom: true, other: true}))
  ])
    if (!seen.has(u.id)) {
      seen.add(u.id);
      out.push(u);
    }
  UL_ = out;
  ULK_ = k;
  return out;
}
/* MUIO writes some units with HTML markup (10<sup>9</sup>m<sup>3</sup>): shown as text (10⁹m³), the unit itself is kept */
const SUPCH = {0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻', '+': '⁺'};
const SUBCH = {0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉'};
const unitText = s =>
  String(s || '')
    .replace(/<sup>([^<]*)<\/sup>/gi, (_, x) => [...x].map(c => SUPCH[c] || c).join(''))
    .replace(/<sub>([^<]*)<\/sub>/gi, (_, x) => [...x].map(c => SUBCH[c] || c).join(''))
    .replace(/<[^>]*>/g, '');
function unitName(id) {
  const u = unitList().find(x => x.id === id);
  return u ? u.name : unitText(id);
}
/* the units each kind of system uses. An item of a
   system (Land, Water, Agriculture, Energy, Emissions; matched on the name of the system or of its parent) gets the units of
   its system when none is set, and the unit lists show them first ("For <system>"), all the other units still below.
   cap = capacity of a technology, act = its activity, comm = a commodity (and a storage). */
const SYS_UNITS = [
  {re: /land|soil|forest|pasture|crop ?land|terre|sol/i, cap: 'kkm2', act: 'kkm2', comm: 'kkm2', list: ['kkm2', 'km2', 'kHa', 'Ha']},
  {
    re: /water|hydro(?!gen)|irrig|aquifer|eau/i,
    cap: 'bm3/yr',
    act: 'bm3',
    comm: 'bm3',
    list: ['bm3', 'mm3', 'km3', 'm3', 'bm3/yr', 'mm3/yr']
  },
  {
    re: /agri|crop|food|livestock|cultur|aliment/i,
    cap: 'MTon/yr',
    act: 'Mt',
    comm: 'Mt',
    list: ['Mt', 'kt', 'MTon', 'kTon', 'Ton', 'MTon/yr', 'kTon/yr', 'kkm2', 'kHa']
  },
  {re: /emission|climat|ghg|co2|carbon/i, cap: 'MTon/yr', act: 'MtCO2', comm: 'MtCO2', list: ['MtCO2', 'MtCO2e', 'ktCO2', 'MTon', 'kTon']},
  {
    re: /energ|electri|power|gas|fuel|oil|heat|transport/i,
    cap: 'GW',
    act: 'PJ',
    comm: 'PJ',
    list: ['PJ', 'TJ', 'TWh', 'GWh', 'ktoe', 'Mtoe', 'GW', 'MW', 'PJ/yr']
  }
];
function sysUnits(set, code) {
  if (typeof SYSTEMS === 'undefined' || !SYSTEMS.list.length) return null;
  const c = SYSTEMS.of(code, set);
  if (!c) return null;
  for (const n of [SYSTEMS.name(c), SYSTEMS.name(SYSTEMS.parent(c)), c])
    if (n) {
      const u = SYS_UNITS.find(x => x.re.test(n));
      if (u) return {...u, sys: SYSTEMS.full(c)};
    }
  return null;
}
const techCap = t => (UNITS.tech[t] || {}).cap || (sysUnits('TECHNOLOGY', t) || {}).cap || UNITS.def.cap,
  techAct = t => (UNITS.tech[t] || {}).act || (sysUnits('TECHNOLOGY', t) || {}).act || UNITS.def.act;
const commUnit = f => UNITS.comm[f] || (sysUnits('COMMODITY', f) || {}).comm || UNITS.def.comm,
  emisUnit = e => UNITS.emis[e] || UNITS.def.emis,
  storUnit = s => UNITS.stor[s] || (sysUnits('STORAGE', s) || {}).comm || UNITS.def.stor;

/* ---- data file lines ---- */
function unitLines() {
  const S = M.D.sets,
    cn = M.D.cname || 'COMMODITY',
    L = [];
  L.push(`#@currency ${UNITS.currency}`);
  const d = UNITS.def;
  L.push(`#@unitdefault ${d.cap} ${d.act} ${d.comm} ${d.emis} ${d.stor}`);
  for (const c of UNITS.custom)
    L.push(
      `#@unitdef ${c.id}|${(c.name || c.id).replace(/\|/g, '/')}|${(c.group || 'My units').replace(/\|/g, '/')}|${(c.desc || '').replace(/[|\n]/g, ' ')}|${c.factor ?? ''}|${c.of || ''}`
    );
  for (const t of S.TECHNOLOGY || []) if (UNITS.tech[t]) L.push(`#@unit TECHNOLOGY ${t} ${techCap(t)} ${techAct(t)}`);
  for (const f of S[cn] || []) if (UNITS.comm[f]) L.push(`#@unit COMMODITY ${f} ${UNITS.comm[f]}`);
  for (const e of S.EMISSION || []) if (UNITS.emis[e]) L.push(`#@unit EMISSION ${e} ${UNITS.emis[e]}`);
  for (const s of S.STORAGE || []) if (UNITS.stor[s]) L.push(`#@unit STORAGE ${s} ${UNITS.stor[s]}`);
  return L;
}
function parseUnitLines(text) {
  const U = {tech: {}, comm: {}, emis: {}, stor: {}, currency: 'M$', custom: [], def: {...UNIT_DEF0}};
  const m0 = /^#@currency\s+(\S+)/m.exec(text);
  if (m0) U.currency = m0[1];
  const md = /^#@unitdefault\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)/m.exec(text);
  if (md) U.def = {cap: md[1], act: md[2], comm: md[3], emis: md[4], stor: md[5]};
  for (const m of text.matchAll(/^#@unitdef\s+(.*)$/gm)) {
    const [id, name, group, desc, factor, of] = m[1].split('|').map(x => (x || '').trim());
    if (id) U.custom.push({id, name: name || id, group: group || 'My units', desc, factor: factor === '' ? null : +factor, of});
  }
  for (const m of text.matchAll(/^#@unit[ \t]+(\S+)[ \t]+(\S+)[ \t]+(\S+)(?:[ \t]+(\S+))?/gm)) {
    // [ \t] not \s (\s crossed the line end and swallowed the next #@unit line)
    if (m[1] === 'TECHNOLOGY') U.tech[m[2]] = {cap: m[3], act: m[4] || U.def.act};
    else if (m[1] === 'COMMODITY' || m[1] === 'FUEL') U.comm[m[2]] = m[3];
    else if (m[1] === 'EMISSION') U.emis[m[2]] = m[3];
    else if (m[1] === 'STORAGE') U.stor[m[2]] = m[3];
  }
  return U;
}

/* ---- units of parameters and results (MUIO's unit rules) ---- */
const UNIT_RULE = {
  DiscountRate: 'fraction',
  DiscountRateIdv: 'fraction',
  DiscountRateStorage: 'fraction',
  YearSplit: 'fraction of the year',
  DaySplit: 'fraction of the day',
  DaysInDayType: 'days',
  TotalTechnologyModelPeriodActivityUpperLimit: '{act}',
  TotalTechnologyModelPeriodActivityLowerLimit: '{act}',
  OperationalLife: 'years',
  OperationalLifeStorage: 'years',
  CapacityToActivityUnit: '{act}/({cap}·yr)',
  ModelPeriodEmissionLimit: '{emi}',
  AnnualEmissionLimit: '{emi}',
  AnnualExogenousEmission: '{emi}',
  ModelPeriodExogenousEmission: '{emi}',
  CapacityOfOneTechnologyUnit: '{cap}',
  TotalTechnologyAnnualActivityUpperLimit: '{act}',
  TotalTechnologyAnnualActivityLowerLimit: '{act}',
  TotalAnnualMinCapacityInvestment: '{cap}',
  TotalAnnualMinCapacity: '{cap}',
  TotalAnnualMaxCapacityInvestment: '{cap}',
  TotalAnnualMaxCapacity: '{cap}',
  ResidualCapacity: '{cap}',
  FixedCost: '{cur}/{cap}',
  CapitalCost: '{cur}/{cap}',
  AvailabilityFactor: 'fraction',
  CapacityFactor: 'fraction',
  OperationalProfile: 'fraction',
  TechnologyActivityIncreaseByModeLimit: 'fraction',
  TechnologyActivityDecreaseByModeLimit: 'fraction',
  TechnologyActivityByModeUpperLimit: '{act}',
  TechnologyActivityByModeLowerLimit: '{act}',
  VariableCost: '{cur}/{act}',
  InputToTotalCapacityRatio: '{comm}/{act}',
  InputToNewCapacityRatio: '{comm}/{act}',
  OutputActivityRatio: '{comm}/{act}',
  InputActivityRatio: '{comm}/{act}',
  StorageLevelStart: 'fraction',
  MinStorageCharge: 'fraction',
  ResidualStorageCapacity: '{stg}',
  CapitalCostStorage: '{cur}/{stg}',
  SpecifiedAnnualDemand: '{comm}',
  AccumulatedAnnualDemand: '{comm}',
  SpecifiedDemandProfile: 'fraction',
  EmissionsPenalty: '{cur}/{emi}',
  EmissionActivityRatio: '{emi}/{act}',
  EmissionToActivityChangeRatio: '{emi}/{act}',
  ReserveMargin: 'ratio',
  REMinProductionTarget: 'fraction',
  // results
  NewCapacity: '{cap}',
  TotalCapacityAnnual: '{cap}',
  AccumulatedNewCapacity: '{cap}',
  NumberOfNewTechnologyUnits: 'units',
  RateOfActivity: '{act}/yr',
  RateOfTotalActivity: '{act}/yr',
  TotalTechnologyAnnualActivity: '{act}',
  TotalAnnualTechnologyActivityByMode: '{act}',
  TotalTechnologyModelPeriodActivity: '{act}',
  ProductionByTechnology: '{comm}',
  ProductionByTechnologyAnnual: '{comm}',
  ProductionByTechnologyByMode: '{comm}',
  ProductionByTechnologyByModeTs: '{comm}',
  UseByTechnology: '{comm}',
  UseByTechnologyAnnual: '{comm}',
  UseByTechnologyByMode: '{comm}',
  UseByTechnologyByModeTs: '{comm}',
  RateOfProductionByTechnologyByMode: '{comm}/yr',
  RateOfUseByTechnologyByMode: '{comm}/yr',
  Demand: '{comm}',
  AnnualEmissions: '{emi}',
  AnnualTechnologyEmission: '{emi}',
  AnnualTechnologyEmissionByMode: '{emi}',
  CapitalInvestment: '{cur}',
  DiscountedCapitalInvestment: '{cur}',
  AnnualFixedOperatingCost: '{cur}',
  AnnualVariableOperatingCost: '{cur}',
  OperatingCost: '{cur}',
  DiscountedOperatingCost: '{cur}',
  TotalDiscountedCost: '{cur}',
  TotalDiscountedCostByTechnology: '{cur}',
  SalvageValue: '{cur}',
  DiscountedSalvageValue: '{cur}',
  AnnualizedInvestmentCost: '{cur}',
  AnnualTechnologyEmissionsPenalty: '{cur}',
  DiscountedTechnologyEmissionsPenalty: '{cur}',
  ModelPeriodCostByRegion: '{cur}',
  OBJECTIVE: '{cur}',
  Objective: '{cur}',
  TechnologyActivityTS: '{act}', StorageChargeTS: '{stg}', StorageDischargeTS: '{stg}', AnnualTechnologyEmissionTS: '{emi}',
  NewStorageCapacity: '{stg}',
  TotalStorageCapacity: '{stg}',
  AccumulatedNewStorageCapacity: '{stg}',
  StorageLevelYearStart: '{stg}',
  StorageLevelYearFinish: '{stg}',
  CapitalInvestmentStorage: '{cur}'
};
/* the unit of a parameter or result for one record (an object with TECHNOLOGY, COMMODITY, EMISSION, STORAGE fields), or '' */
function unitOf(name, rec) {
  const r = UNIT_RULE[name];
  if (!r) return '';
  rec = rec || {};
  const t = rec.TECHNOLOGY,
    f = rec.COMMODITY || rec.FUEL,
    e = rec.EMISSION,
    s = rec.STORAGE;
  if (/\{cap\}|\{act\}/.test(r) && !t && !/\{comm\}/.test(r))
    return r
      .replace(/\{cap\}/g, UNITS.def.cap)
      .replace(/\{act\}/g, UNITS.def.act)
      .replace(/\{cur\}/g, UNITS.currency);
  return r
    .replace(/\{cap\}/g, unitName(t ? techCap(t) : UNITS.def.cap))
    .replace(/\{act\}/g, unitName(t ? techAct(t) : UNITS.def.act))
    .replace(/\{comm\}/g, unitName(f ? commUnit(f) : UNITS.def.comm))
    .replace(/\{emi\}/g, unitName(e ? emisUnit(e) : UNITS.def.emis))
    .replace(/\{stg\}/g, unitName(s ? storUnit(s) : UNITS.def.stor))
    .replace(/\{cur\}/g, UNITS.currency);
}
/* one unit for many records, or '' when they differ */
function unitOfAll(name, recs) {
  const s = new Set();
  for (const r of recs) {
    s.add(unitOf(name, r));
    if (s.size > 1) return '';
  }
  return s.size ? [...s][0] : '';
}
/* the unit of a parameter for one entity of the panel (tech, commodity...), as text; several -> joined */
function paramUnitFor(p, kind, code) {
  if (!UNIT_RULE[p]) return '';
  const d = dimsOf(p),
    recs = getRecs(p, [])
      .filter(r => !ENTSET[kind] || d.indexOf(ENTSET[kind]) < 0 || r.idx[d.indexOf(ENTSET[kind])] === code)
      .slice(0, 400)
      .map(r => Object.fromEntries(d.map((x, i) => [x === 'FUEL' ? 'COMMODITY' : x, r.idx[i]])));
  if (!recs.length && code) recs.push({[ENTSET[kind] || 'X']: code});
  const s = [...new Set(recs.map(r => unitOf(p, r)))];
  return s.length > 3 ? s.slice(0, 3).join(', ') + '…' : s.join(', ');
}

/* ---- a <select> of units, grouped, with "New unit…" ---- */
function unitSelect(attrs, cur, su) {
  const L = unitList(),
    groups = [...new Set(L.map(u => u.group))];
  const has = L.some(u => u.id === cur),
    P = su ? su.list.map(id => L.find(u => u.id === id)).filter(Boolean) : [];
  return `<select ${attrs}>${cur === '' ? '<option value="" selected>—</option>' : ''}${!has && cur ? `<option value="${esc(cur)}" selected>${esc(unitText(cur))}</option>` : ''}${P.length ? `<optgroup label="For ${esc(su.sys)}">${P.map(u => `<option value="${esc(u.id)}" ${u.id === cur ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</optgroup>` : ''}${groups
    .map(
      g =>
        `<optgroup label="${esc(P.length ? 'All units · ' + g : g)}">${L.filter(u => u.group === g)
          .map(
            u =>
              `<option value="${esc(u.id)}" ${u.id === cur && !P.some(x => x.id === cur) ? 'selected' : ''}>${esc(u.name)}${u.custom ? ' ·' : ''}</option>`
          )
          .join('')}</optgroup>`
    )
    .join('')}<option value="__new__">＋ New unit…</option></select>`;
}
/* wire unit selects: picking "New unit…" opens the form, then selects the new unit */
function wireUnitSelects(root, onSet) {
  root.querySelectorAll('select[data-unit]').forEach(s => {
    s.dataset.prev = s.value;
    s.onchange = () => {
      if (s.value !== '__new__') {
        s.dataset.prev = s.value;
        onSet(s, s.value);
        return;
      }
      s.value = s.dataset.prev || '';
      newUnitForm(u => {
        root.querySelectorAll('select[data-unit]').forEach(x => {
          const o = document.createElement('option');
          o.value = u.id;
          o.textContent = u.name + ' ·';
          x.insertBefore(o, x.lastElementChild);
        });
        s.value = u.id;
        s.dataset.prev = u.id;
        onSet(s, u.id);
      });
    };
  });
}
function newUnitForm(done, edit) {
  const ov = document.createElement('div');
  ov.className = 'unitov';
  const groups = [...new Set(unitList().map(u => u.group))],
    c = edit || {};
  ov.innerHTML = `<form class="frm unitform" role="dialog" aria-label="${edit ? 'Edit' : 'New'} unit"><h3>${edit ? 'Edit the unit' : 'New unit'}</h3>
    <div class="row2"><label>Short id (no spaces)<input name="id" required pattern="[^\\s|]+" value="${esc(c.id || '')}" ${edit ? 'readonly' : ''} placeholder="e.g. lux, Gcal, MWth"></label><label>Name shown<input name="name" value="${esc(c.name || '')}" placeholder="e.g. lux (illuminance)"></label></div>
    <div class="row2"><label>Group<input name="group" list="unitgroups" value="${esc(c.group || 'My units')}"><datalist id="unitgroups">${groups.map(g => `<option value="${esc(g)}">`).join('')}<option value="Light"><option value="Heat"></datalist></label><label>Description<input name="desc" value="${esc(c.desc || '')}" placeholder="Optional"></label></div>
    <div class="row2"><label>1 unit equals (optional)<input name="factor" value="${c.factor ?? ''}" placeholder="e.g. 0.0041868"></label><label>of<input name="of" list="unitids" value="${esc(c.of || '')}" placeholder="e.g. TJ"><datalist id="unitids">${unitList()
      .map(u => `<option value="${esc(u.id)}">`)
      .join('')}</datalist></label></div>
    <p class="hint">A unit is a label: it does not change the numbers. The conversion is kept as information. The unit is saved in the data file and remembered for your other cases.</p>
    <div class="acts"><button class="btn pri" type="submit">${edit ? 'Save' : 'Add the unit'}</button><button class="btn" type="button" data-x>Cancel</button></div></form>`;
  document.body.appendChild(ov);
  const f = ov.querySelector('form');
  (edit ? f.name : f.id).focus();
  const close = () => ov.remove();
  ov.querySelector('[data-x]').onclick = close;
  ov.onclick = e => {
    if (e.target === ov) close();
  };
  f.onsubmit = ev => {
    ev.preventDefault();
    const fd = new FormData(f),
      id = String(fd.get('id')).trim();
    if (!edit && unitList().some(u => u.id === id)) return toast(`${id} already exists in the list`);
    const u = {
      id,
      name: String(fd.get('name') || '').trim() || id,
      group: String(fd.get('group') || '').trim() || 'My units',
      desc: String(fd.get('desc') || '').trim(),
      factor: String(fd.get('factor')).trim() === '' ? null : Number(fd.get('factor')),
      of: String(fd.get('of') || '').trim()
    };
    UNITS.custom = UNITS.custom.filter(x => x.id !== id);
    UNITS.custom.push(u);
    unitsRemember();
    close();
    afterEdit(`Unit ${u.name} ${edit ? 'saved' : 'added'}`);
    done && done(u);
  };
}

/* ---- the Units page ---- */
function openUnits() {
  const dr = document.getElementById('drawer'),
    wasOpen = !dr.hidden && dr.querySelector('.ucode, .usec'),
    sc = wasOpen ? [dr.scrollTop, ...[...dr.querySelectorAll('.db, .usec .tw')].map(e => e.scrollTop)] : null;
  dr.hidden = false;
  const S = M.D.sets,
    cn = M.D.cname || 'COMMODITY';
  setTimeout(() => {
    if (!sc) return;
    dr.scrollTop = sc[0];
    [...dr.querySelectorAll('.db, .usec .tw')].forEach((e, i) => {
      if (sc[i + 1] != null) e.scrollTop = sc[i + 1];
    });
  }, 0);
  const sec = (key, title, list, cols) =>
    list.length
      ? `<details class="usec" data-k="${key}" ${UNITS._open === key ? 'open' : ''}><summary>${title}<span class="n">${list.length}</span></summary>
    <div class="fm-tools"><input type="search" class="uq" placeholder="Search ${list.length}"><button type="button" class="btn sm" data-ua="1">All</button><button type="button" class="btn sm" data-ua="0">None</button>
      <span class="ubulk">Set the ticked: ${cols.map(([k, l]) => `<label>${l} ${unitSelect(`data-unit data-bulk="${k}"`, '')}</label>`).join('')}<button type="button" class="btn sm" data-uapply>Apply</button></span></div>
    <div class="tw" style="max-height:340px"><table class="grid utab"><thead><tr><th></th><th class="k">Code · description</th>${cols.map(([, l]) => `<th class="k">${l}</th>`).join('')}</tr></thead><tbody>
    ${list
      .map(([c, d, vals]) => {
        const su = sysUnits(ENTSET[key] || '', c);
        return `<tr data-q="${esc((c + ' ' + d).toLowerCase())}"><td><input type="checkbox" class="uc" value="${esc(c)}"></td><td class="k ucode"><b>${esc(c)}</b>${d ? `<span class="muted">${esc(d)}</span>` : ''}${su ? `<span class="muted"> · ${esc(su.sys)}</span>` : ''}</td>${cols.map(([k], i) => `<td>${unitSelect(`data-unit data-c="${esc(c)}" data-f="${k}"`, vals[i], su)}</td>`).join('')}</tr>`;
      })
      .join('')}</tbody></table></div></details>`
      : '';
  const T = (S.TECHNOLOGY || []).map(t => [t, TD[t] || '', [techCap(t), techAct(t)]]),
    F = (S[cn] || []).map(f => [f, FD[f] || '', [commUnit(f)]]);
  const E = (S.EMISSION || []).map(e => [e, (SETDESC.EMISSION || {})[e] || '', [emisUnit(e)]]),
    ST = (S.STORAGE || []).map(s => [s, (SETDESC.STORAGE || {})[s] || '', [storUnit(s)]]);
  const L = unitList(),
    groups = [...new Set(L.map(u => u.group))];
  dr.innerHTML = `<div class="dh"><div style="min-width:0"><div class="code">model · units</div><h2>Units</h2><p>As in MUIO: a capacity and an activity unit for each technology, a unit for each commodity, emission and storage, and the currency. An item of a system (land, water, agriculture, energy) that has no unit of its own takes the units of its system (e.g. 10³ km² for land, 10⁹ m³ for water, Mt for crops), and its list shows them first. Units are labels: they do not change the numbers; they appear with the parameters (e.g. CapitalCost in ${esc(UNITS.currency)}/${esc(unitName(UNITS.def.cap))}) and the results, and go to MUIO on export.</p></div><div class="acts"><button class="btn x" type="button" id="close">Close</button></div></div>
    <div class="db">
      <div class="row2 frm" style="display:grid"><label>Currency<input id="ucur" list="ucurl" value="${esc(UNITS.currency)}"><datalist id="ucurl">${CURRENCIES.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label><span></span></div>
      <fieldset><legend>Units of new items (and of items not set)</legend><div class="row5">${[
        ['cap', 'Capacity'],
        ['act', 'Activity'],
        ['comm', 'Commodity'],
        ['emis', 'Emission'],
        ['stor', 'Storage']
      ]
        .map(([k, l]) => `<label>${l}${unitSelect(`data-unit data-def="${k}"`, UNITS.def[k])}</label>`)
        .join('')}</div></fieldset>
      ${sec('tech', 'Technologies', T, [
        ['cap', 'capacity'],
        ['act', 'activity']
      ])}${sec('comm', 'Commodities', F, [['u', 'unit']])}${sec('emis', 'Emissions', E, [['u', 'unit']])}${sec('stor', 'Storage', ST, [['u', 'unit']])}
      <details class="usec" ${UNITS._open === 'list' ? 'open' : ''} data-k="list"><summary>The list of units<span class="n">${L.length}</span></summary>
        <div class="acts"><button class="btn pri" type="button" id="unew">＋ New unit</button></div>
        ${groups
          .map(
            g =>
              `<div class="vgrp">${esc(g)}<i>${L.filter(u => u.group === g).length}</i></div><div class="ulist">${L.filter(
                u => u.group === g
              )
                .map(
                  u =>
                    `<span class="uchip${u.custom ? ' cu' : ''}" title="${esc([u.desc, u.factor != null && u.of ? `1 ${u.name} = ${u.factor} ${u.of}` : ''].filter(Boolean).join(' · '))}">${esc(u.name)}${u.custom ? ` <button type="button" class="lnk" data-ue="${esc(u.id)}">Edit</button><button type="button" class="lnk" data-ud="${esc(u.id)}">Remove</button>` : ''}</span>`
                )
                .join('')}</div>`
          )
          .join('')}
        <p class="hint">Standard units come from MUIO, with a few more (TWh, Gcal, MWth, MtCO2…). Yours are marked "·": kept in this data file and remembered by the Studio for your other cases.</p></details>
    </div>`;
  dr.querySelector('#close').onclick = () => {
    dr.hidden = true;
  };
  dr.querySelectorAll('.usec').forEach(
    d =>
      (d.ontoggle = () => {
        if (d.open) UNITS._open = d.dataset.k;
      })
  );
  dr.querySelector('#ucur').onchange = e => {
    UNITS.currency = e.target.value.trim() || 'M$';
    afterEdit('Currency set');
  };
  const setOne = (key, c, k, v) => {
    if (key === 'tech') UNITS.tech[c] = {cap: techCap(c), act: techAct(c), ...(UNITS.tech[c] || {}), [k]: v};
    else UNITS[key][c] = v;
  };
  wireUnitSelects(dr, (s, v) => {
    if (s.dataset.def) {
      UNITS.def[s.dataset.def] = v;
      afterEdit('Default unit set');
      return;
    }
    if (s.dataset.bulk) return;
    setOne(s.closest('.usec').dataset.k, s.dataset.c, s.dataset.f, v);
    afterEdit(`${s.dataset.c}: ${unitName(v)}`);
  });
  dr.querySelectorAll('.usec[data-k]').forEach(sd => {
    if (sd.dataset.k === 'list') return;
    const q = sd.querySelector('.uq');
    q.oninput = () => sd.querySelectorAll('tbody tr').forEach(r => (r.hidden = q.value && !r.dataset.q.includes(q.value.toLowerCase())));
    sd.querySelectorAll('[data-ua]').forEach(
      b =>
        (b.onclick = () =>
          sd.querySelectorAll('tbody tr').forEach(r => {
            if (!r.hidden) r.querySelector('.uc').checked = b.dataset.ua === '1';
          }))
    );
    sd.querySelector('[data-uapply]').onclick = () => {
      const cs = [...sd.querySelectorAll('.uc:checked')].map(c => c.value);
      if (!cs.length) return toast('Tick the rows first');
      let n = 0;
      sd.querySelectorAll('select[data-bulk]').forEach(b => {
        if (!b.value || b.value === '__new__') return;
        for (const c of cs) {
          setOne(sd.dataset.k, c, b.dataset.bulk, b.value);
          n++;
        }
      });
      if (!n) return toast('Choose a unit to apply');
      afterEdit(`Units set for ${cs.length} item(s)`);
      openUnits();
    };
  });
  dr.querySelector('#unew').onclick = () => newUnitForm(() => openUnits());
  dr.querySelectorAll('[data-ue]').forEach(
    b =>
      (b.onclick = () =>
        newUnitForm(
          () => openUnits(),
          unitList().find(u => u.id === b.dataset.ue)
        ))
  );
  dr.querySelectorAll('[data-ud]').forEach(
    b =>
      (b.onclick = async () => {
        const id = b.dataset.ud,
          used = [
            ...Object.values(UNITS.tech).flatMap(x => [x.cap, x.act]),
            ...Object.values(UNITS.comm),
            ...Object.values(UNITS.emis),
            ...Object.values(UNITS.stor),
            ...Object.values(UNITS.def)
          ].includes(id);
        if (used && !await uiConfirm(`${id} is used in this model. Remove it from the list anyway? (the items keep the label)`)) return;
        UNITS.custom = UNITS.custom.filter(u => u.id !== id);
        try {
          UG_ = null;
          localStorage.setItem(UNIT_KEY, JSON.stringify(unitsGlobal().filter(u => u.id !== id)));
        } catch (e) {}
        afterEdit(`Unit ${id} removed`);
        openUnits();
      })
  );
}
