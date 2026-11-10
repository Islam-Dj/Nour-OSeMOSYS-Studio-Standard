'use strict';
/* ============================== MODEL DESCRIPTION TO EXCEL ==============================
   One workbook that describes the model as it is loaded: README, sets, technologies (system, description, units, modes,
   inputs and outputs with their ratios, storage, emissions, constraints, parameters with values), commodities (producers,
   users, demand), storages, emissions, user constraints, parameters (values, default, unit, group, where used), time
   structure. Read from the data in the page, nothing is solved. */
function describeModel() {
  const S = M.D.sets,
    P = M.D.params,
    Y = (S.YEAR || []).map(String),
    y0 = Y[0],
    yN = Y[Y.length - 1];
  const T = setOf('TECHNOLOGY').map(String),
    C = setOf('COMMODITY').map(String),
    ST = setOf('STORAGE').map(String),
    E = setOf('EMISSION').map(String),
    U = setOf('UDC').map(String);
  const sysN = (m, set) => {
    const c = SYSTEMS.of(m, set);
    return c ? SYSTEMS.name(c) || c : '';
  };
  const num = v => (v == null || v === '' ? '' : +(+v).toPrecision(8));
  // one pass over each parameter: index of the dimension of each set
  const pos = (p, set) => (typeof dimsOf === 'function' ? dimsOf(p) : []).indexOf(set);
  const recs = p => (P[p] || {recs: []}).recs;
  const byT = new Map(
    T.map(t => [t, {in: new Map(), out: new Map(), modes: new Set(), emis: new Map(), sto: new Set(), udc: new Set(), params: new Map()}])
  );
  const byC = new Map(C.map(f => [f, {prod: new Set(), use: new Set(), sad: {}, aad: {}, beq: false}]));
  const ratio = (p, kind) => {
    for (const r of recs(p)) {
      const [, t, f, m, y] = r.idx.map(String),
        o = byT.get(t),
        c = byC.get(f);
      if (!o || !r.v) continue;
      o.modes.add(m);
      const k = f + '|' + m,
        cur = o[kind].get(k);
      if (!cur || (y === y0 && cur.y !== y0)) o[kind].set(k, {f, m, v: r.v, y});
      if (c) c[kind === 'in' ? 'use' : 'prod'].add(t);
    }
  };
  ratio('InputActivityRatio', 'in');
  ratio('OutputActivityRatio', 'out');
  for (const r of recs('EmissionActivityRatio')) {
    const [, t, e, m] = r.idx.map(String),
      o = byT.get(t);
    if (o && r.v) {
      o.emis.set(e + '|' + m, {e, m, v: r.v});
    }
  }
  for (const p of ['TechnologyToStorage', 'TechnologyFromStorage'])
    for (const r of recs(p)) {
      const [, t, s, m] = r.idx.map(String),
        o = byT.get(t);
      if (o && r.v) o.sto.add(`${p === 'TechnologyToStorage' ? 'charges' : 'discharges'} ${s} (mode ${m})`);
    }
  for (const p of ['UDCMultiplierTotalCapacity', 'UDCMultiplierNewCapacity', 'UDCMultiplierActivity'])
    for (const r of recs(p)) {
      const [, t, u] = r.idx.map(String),
        o = byT.get(t);
      if (o && r.v) o.udc.add(u);
    }
  // parameters with values for each technology (count of values)
  for (const p of Object.keys(P)) {
    const i = pos(p, 'TECHNOLOGY');
    if (i < 0) continue;
    for (const r of recs(p)) {
      const o = byT.get(String(r.idx[i]));
      if (o) o.params.set(p, (o.params.get(p) || 0) + 1);
    }
  }
  for (const r of recs('SpecifiedAnnualDemand')) {
    const [, f, y] = r.idx.map(String),
      c = byC.get(f);
    if (c) c.sad[y] = r.v;
  }
  for (const r of recs('AccumulatedAnnualDemand')) {
    const [, f, y] = r.idx.map(String),
      c = byC.get(f);
    if (c) c.aad[y] = r.v;
  }
  for (const r of recs('BalanceEquality')) {
    const c = byC.get(String(r.idx[1]));
    if (c && r.v) c.beq = true;
  }
  const val1 = (p, pre) => {
    const r = getRecs(p, pre);
    const a = r.find(x => String(x.idx[x.idx.length - 1]) === y0) || r[0];
    return a ? a.v : '';
  };
  const fmtR = m =>
    [...m.values()]
      .map(x => `${x.f || x.e} ${num(x.v)}${S.MODE_OF_OPERATION && S.MODE_OF_OPERATION.length > 1 ? ' (mode ' + x.m + ')' : ''}`)
      .join('; ');
  const reg = (S.REGION || [])[0];
  // ---- sheets
  const readme = [
    ['Model description', M.meta.name || 'model'],
    ['Model file', SCHEMA ? SCHEMA.name : ''],
    ['Written', new Date().toISOString().slice(0, 16).replace('T', ' ')],
    ['Regions', (S.REGION || []).join(' ')],
    ['Years', `${y0} to ${yN} (${Y.length})`],
    ['Time slices', setOf('TIMESLICE').length],
    ['Modes', (S.MODE_OF_OPERATION || []).join(' ')],
    ['Technologies', T.length],
    ['Commodities', C.length],
    ['Storages', ST.length],
    ['Emissions', E.length],
    ['User constraints', U.length],
    ['Parameters with values', Object.keys(P).filter(p => recs(p).length).length],
    ['Currency', UNITS.currency],
    [],
    [
      'How to read',
      `Ratios, residual capacities and demands are shown for the first year (${y0}) and first region (${reg || ''}); the full values are in the data file.`
    ],
    ['', 'Sheets: Technologies, Commodities, Storages, Emissions, User constraints, Parameters, Sets, Time slices, Systems.']
  ];
  const tech = [
    [
      'Technology',
      'Description',
      'System',
      'Capacity unit',
      'Activity unit',
      'Modes',
      'Inputs (ratio)',
      'Outputs (ratio)',
      'Storage',
      'Emissions (ratio)',
      'In user constraints',
      `Residual capacity ${y0}`,
      'Operational life',
      `Capital cost ${y0}`,
      `Variable cost ${y0}`,
      'Capacity to activity',
      'Years on (Studio)',
      'Parameters with values (count)'
    ]
  ];
  for (const t of T) {
    const o = byT.get(t),
      on = typeof ONOFF !== 'undefined' && ONOFF[t] ? JSON.stringify(ONOFF[t]).slice(0, 60) : '';
    tech.push([
      t,
      TD[t] || '',
      sysN(t, 'TECHNOLOGY'),
      unitName(techCap(t)),
      unitName(techAct(t)),
      [...o.modes].sort().join(' '),
      fmtR(o.in),
      fmtR(o.out),
      [...o.sto].join('; '),
      fmtR(o.emis),
      [...o.udc].join(' '),
      num(val1('ResidualCapacity', [reg, t])),
      num(val1('OperationalLife', [reg, t])),
      num(val1('CapitalCost', [reg, t])),
      num(val1('VariableCost', [reg, t])),
      num(val1('CapacityToActivityUnit', [reg, t])),
      on,
      [...o.params.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([p, n]) => `${p} (${n})`)
        .join(', ')
    ]);
  }
  const comm = [
    [
      'Commodity',
      'Description',
      'System',
      'Unit',
      'Produced by',
      'Used by',
      'Demand type',
      `Demand ${y0}`,
      `Demand ${yN}`,
      'Production = use (BalanceEquality)',
      'Rain driver (WaterDriverFuel)',
      'Status'
    ]
  ];
  for (const f of C) {
    const c = byC.get(f),
      sad = Object.keys(c.sad).length,
      aad = Object.keys(c.aad).length,
      d = sad ? c.sad : c.aad;
    const wd = getRecs('WaterDriverFuel', [f]).some(r => r.v) ? 'yes' : '';
    const status =
      !c.prod.size && !c.use.size && !sad && !aad
        ? 'not linked'
        : !c.prod.size && (c.use.size || sad || aad)
          ? 'used but never produced'
          : c.prod.size && !c.use.size && !sad && !aad
            ? 'produced, no user or demand (surplus allowed)'
            : '';
    comm.push([
      f,
      FD[f] || '',
      sysN(f, 'COMMODITY'),
      unitName(commUnit(f)),
      [...c.prod].join(' '),
      [...c.use].join(' '),
      sad ? 'SpecifiedAnnualDemand (by time slice)' : aad ? 'AccumulatedAnnualDemand (year)' : '',
      num(d[y0]),
      num(d[yN]),
      c.beq ? 'yes' : '',
      wd,
      status
    ]);
  }
  const sto = [
    [
      'Storage',
      'Description',
      'System',
      'Unit',
      'Charged by',
      'Discharged by',
      'Intraday',
      'Chronological',
      'Across years',
      `Residual capacity ${y0}`,
      'Level at start',
      'Operational life',
      `Capital cost ${y0}`,
      'Self-discharge (per hour)'
    ]
  ];
  for (const s of ST) {
    const ch = [],
      dc = [];
    for (const r of recs('TechnologyToStorage')) if (String(r.idx[2]) === s && r.v) ch.push(r.idx[1]);
    for (const r of recs('TechnologyFromStorage')) if (String(r.idx[2]) === s && r.v) dc.push(r.idx[1]);
    sto.push([
      s,
      TD[s] || FD[s] || '',
      sysN(s, 'STORAGE'),
      unitName(storUnit(s)),
      [...new Set(ch)].join(' '),
      [...new Set(dc)].join(' '),
      (S.STORAGEINTRADAY || []).includes(s) ? 'yes' : '',
      getRecs('StorageChronological', [reg, s]).some(r => r.v) ? 'yes' : '',
      getRecs('StorageInterYear', [reg, s]).some(r => r.v) ? 'yes' : '',
      num(val1('ResidualStorageCapacity', [reg, s])),
      num(val1('StorageLevelStart', [reg, s])),
      num(val1('OperationalLifeStorage', [reg, s])),
      num(val1('CapitalCostStorage', [reg, s])),
      num(val1('StorageSelfDischarge', [reg, s]))
    ]);
  }
  const emi = [['Emission', 'Unit', 'Emitted by (ratio)', `Penalty ${y0}`, `Annual limit ${y0}`]];
  for (const e of E) {
    const by = [];
    for (const t of T) for (const x of byT.get(t).emis.values()) if (x.e === e) by.push(`${t} ${num(x.v)}`);
    emi.push([
      e,
      unitName(emisUnit(e)),
      by.join('; '),
      num(val1('EmissionsPenalty', [reg, e])),
      num(val1('AnnualEmissionLimit', [reg, e]))
    ]);
  }
  const TAG = {'-1': 'not created', 0: '≤ (national, UDC1)', 1: '= (national)', 2: '≤ (regional)', 3: '= (regional)'};
  const udc = [
    [
      'Constraint',
      'Tag',
      'Meaning',
      `Constant ${y0}`,
      `Constant ${yN}`,
      'Total capacity × (technology multiplier)',
      'New capacity ×',
      'Activity ×',
      'Storage capacity ×'
    ]
  ];
  for (const u of U) {
    const tg = val1('UDCTag', [reg, u]),
      mul = p => {
        const out = new Map();
        for (const r of recs(p))
          if (String(r.idx[2]) === u && r.v) {
            const k = String(r.idx[1]);
            if (!out.has(k)) out.set(k, r.v);
          }
        return [...out].map(([k, v]) => `${k} ${num(v)}`).join('; ');
      };
    const cst = getRecs('UDCConstant', [reg, u]);
    udc.push([
      u,
      tg === '' ? -1 : tg,
      TAG[String(tg === '' ? -1 : tg)] || '',
      num((cst.find(r => String(r.idx[2]) === y0) || {}).v),
      num((cst.find(r => String(r.idx[2]) === yN) || {}).v),
      mul('UDCMultiplierTotalCapacity'),
      mul('UDCMultiplierNewCapacity'),
      mul('UDCMultiplierActivity'),
      mul('UDCMultiplierStorageCapacity')
    ]);
  }
  const pn =
    SCHEMA && SCHEMA.params ? [...SCHEMA.params.values()].filter(x => !x.computed && x.dims.length).map(x => x.name) : Object.keys(P);
  const par = [['Parameter', 'Group', 'Index', 'Default', 'Values in the data', 'Used in (constraints)', 'Description']];
  for (const p of [...new Set([...pn, ...Object.keys(P)])].sort()) {
    const inf = typeof pinfo === 'function' ? pinfo(p) : {},
      n = recs(p).length;
    par.push([
      p,
      typeof GROUP_OF === 'function' ? GROUP_OF(p) : '',
      (typeof dimsOf === 'function' ? dimsOf(p) : []).join(', '),
      defOf(p),
      n,
      (inf.used || []).length || '',
      ((typeof PD !== 'undefined' && PD[p]) || ['', ''])[1] || inf.doc || ''
    ]);
  }
  par.splice(1, par.length - 1, ...par.slice(1).sort((a, b) => (b[4] > 0) - (a[4] > 0) || a[0].localeCompare(b[0])));
  const sets = [['Set', 'Members', 'List', 'Names given (#@setdesc)']];
  for (const n of Object.keys(S)) {
    const L = setOf(n) || [];
    sets.push([
      n,
      L.length,
      L.join(' ').slice(0, 32000),
      Object.entries(SETDESC[n] || {})
        .filter(([, v]) => v)
        .map(([k, v]) => `${k} = ${v}`)
        .join('; ')
        .slice(0, 32000)
    ]);
  }
  const ts = [
    ['Time slice', 'Name', 'Season', 'Day type', 'Daily time bracket', `YearSplit ${y0}`, 'Group (TimesliceGroup)', 'Order', 'Hours']
  ];
  for (const l of setOf('TIMESLICE').map(String)) {
    const one = p => {
      const r = getRecs(p, [l]).find(x => x.v);
      return r ? r.idx[1] : '';
    };
    ts.push([
      l,
      sdesc('TIMESLICE', l),
      one('Conversionls'),
      one('Conversionld'),
      one('Conversionlh'),
      num(val1('YearSplit', [l])),
      num(val1('TimesliceGroup', [l])),
      num(val1('TimesliceOrder', [l])),
      num(val1('TimesliceHours', [l]))
    ]);
  }
  const sysrows = [['System', 'Code', 'Technologies', 'Commodities', 'Storages']];
  for (const s of SYSTEMS.list)
    sysrows.push([
      s.n,
      s.c,
      T.filter(t => SYSTEMS.of(t, 'TECHNOLOGY') === s.c).length,
      C.filter(f => SYSTEMS.of(f, 'COMMODITY') === s.c).length,
      ST.filter(x => SYSTEMS.of(x, 'STORAGE') === s.c).length
    ]);
  return [
    {name: 'README', rows: readme, bold: [0], freeze: false, widths: [24, 110]},
    {name: 'Technologies', rows: tech},
    {name: 'Commodities', rows: comm},
    {name: 'Storages', rows: sto},
    {name: 'Emissions', rows: emi},
    {name: 'User constraints', rows: udc},
    {name: 'Parameters', rows: par},
    {name: 'Sets', rows: sets},
    {name: 'Time slices', rows: ts},
    {name: 'Systems', rows: sysrows}
  ];
}
function exportModelDescription() {
  if (!M || !M.D || !(M.D.sets.TECHNOLOGY || []).length) return toast('Open a model first');
  try {
    const t0 = performance.now(),
      sh = describeModel(),
      name = (M.meta.name || 'model').replace(/\.(txt|dat)$/i, '') + '_description.xlsx';
    saveFile(name, makeXlsx(sh), XLSX_MIME);
    toast(`Model description: ${sh.length} sheets (${Math.round(performance.now() - t0)} ms)`);
  } catch (e) {
    console.error(e);
    toast('Could not write the description: ' + e.message);
  }
}
