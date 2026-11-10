'use strict';
/* ============================== data checks (infeasibility screen, before solving) ==============================
   Every ERROR is a proof from the data alone that the LP has no solution (a bound that cannot be met even with every
   other limit relaxed as far as the data allows). WARNINGS are likely mistakes that do not by themselves make the LP
   infeasible; INFO are notes. Upper limits that are absent or negative count as "no limit" in the bounds below. */
// the checks of the data run after an edit when the Studio is idle (they take ~1.5 s on a large model): editing never waits for them.
// Reading CHECK (Run panel, Check panel, tests) computes them at once if they are not up to date; checkPeek() never waits
// (the diagram marks use the last result until the new one is ready, then it is drawn again).
const CK = {val: null, stale: true, timer: null};
Object.defineProperty(window, 'CHECK', {
  configurable: true,
  get() {
    if (CK.stale && typeof M !== 'undefined' && M && M.D) {
      CK.stale = false;
      clearTimeout(CK.timer);
      try {
        runChecks();
      } catch (e) {
        console.error(e);
        const c = document.getElementById('chk');
        if (c) c.textContent = 'Check (failed)';
      }
    }
    return CK.val;
  },
  set(v) {
    if (v === null) {
      CK.stale = true;
      scheduleChecks();
    } else {
      CK.val = v;
      CK.stale = false;
    }
  }
});
const checkPeek = () => CK.val;
function scheduleChecks() {
  clearTimeout(CK.timer);
  const c = document.getElementById('chk');
  if (c && CK.val) c.classList.add('stale');
  CK.gen = (CK.gen || 0) + 1;
  CK.timer = setTimeout(() => {
    if (!CK.stale || typeof M === 'undefined' || !M || !M.D) return;
    runChecksIdle(() => {
      CK.stale = false;
      if (c) c.classList.remove('stale');
      if (typeof draw === 'function' && typeof CURVIEW !== 'undefined' && CURVIEW === 'dia') draw();
    });
  }, 900);
} // after 1.2 s without an edit
// the checks after an edit run in slices of
// ~12 ms between the user's clicks and keys (they took ~1.7 s in one block on a large model, the lag felt after each edit); an edit
// during the run cancels it and a new one starts. Reading CHECK (Check panel, Run, tests) still computes at once.
function runChecks() {
  CK.gen = (CK.gen || 0) + 1;
  const it = runChecksGen();
  let r;
  while (!(r = it.next()).done);
  return r.value;
}
function runChecksIdle(done) {
  const gen = (CK.gen = (CK.gen || 0) + 1),
    it = runChecksGen();
  const step = () => {
    if (gen !== CK.gen) return;
    const t0 = performance.now();
    let r;
    try {
      while (performance.now() - t0 < 12) {
        r = it.next();
        if (r.done) {
          if (done) done();
          return;
        }
      }
    } catch (e) {
      console.error(e);
      return;
    }
    setTimeout(step, 0);
  };
  setTimeout(step, 0);
}
function* runChecksGen() {
  let CKN = 0;
  const P = M.D.params,
    Y = M.years,
    TS = M.S.TIMESLICE || [],
    R = REG,
    T = [...M.techs],
    tol = a => 1e-6 * Math.max(1, Math.abs(a));
  const IX = {};
  const ix = p => {
    if (IX[p]) return IX[p];
    const m = new Map();
    for (const r of (P[p] || {recs: []}).recs) m.set(r.idx.join('|'), r.v);
    return (IX[p] = m);
  };
  const g = (p, ...k) => {
    const v = ix(p).get(k.join('|'));
    if (v !== undefined) return typeof v === 'number' ? v : Number(v);
    const d = (P[p] || {}).def;
    return d === undefined ? undefined : Number(d);
  };
  const lim = v => (v === undefined || isNaN(v) || v < 0 ? Infinity : v); // upper limit: absent or negative = no limit
  const out = [];
  const add = (sev, code, title, r, o) => out.push({sev, code, title, r, ...o});
  const ys = {};
  for (const y of Y) {
    ys[y] = 0;
    for (const l of TS) ys[y] += g('YearSplit', l, y) || 0;
  }
  // ---- capacity and activity bounds per region, technology, year
  const B = new Map(),
    RTI = new Map(); // RTI: build limits of a technology over the years (read once)
  // capacity factors by region|tech|year and YearSplit by slice|year, read once (the bounds read them for every slice)
  const CFI = new Map();
  for (const x of (P.CapacityFactor || {recs: []}).recs) {
    const k = x.idx[0] + '|' + x.idx[1] + '|' + x.idx[3];
    if (!CFI.has(k)) CFI.set(k, new Map());
    CFI.get(k).set(String(x.idx[2]), typeof x.v === 'number' ? x.v : Number(x.v));
  }
  const cfDef = () => {
    const d = (P.CapacityFactor || {}).def;
    return d === undefined ? undefined : Number(d);
  };
  const YSI = new Map();
  const ysOf = (l, y) => {
    const k = l + '|' + y;
    let v = YSI.get(k);
    if (v === undefined) {
      v = g('YearSplit', l, y) || 0;
      YSI.set(k, v);
    }
    return v;
  };
  const bounds = (r, t, y) => {
    const k = r + '|' + t + '|' + y;
    if (B.has(k)) return B.get(k);
    const life = g('OperationalLife', r, t) ?? 1,
      res = g('ResidualCapacity', r, t, y) || 0;
    let rt = RTI.get(r + '|' + t);
    if (!rt) {
      rt = {
        mx: Y.map(yy => lim(g('TotalAnnualMaxCapacityInvestment', r, t, yy))),
        mn: Y.map(yy => g('TotalAnnualMinCapacityInvestment', r, t, yy) || 0)
      };
      RTI.set(r + '|' + t, rt);
    }
    let inv = 0,
      minv = 0;
    for (let j = 0; j < Y.length; j++) {
      const yy = Y[j];
      if (y - yy >= 0 && y - yy < life) {
        inv += rt.mx[j];
        minv += rt.mn[j];
      }
    }
    const capMax = Math.min(lim(g('TotalAnnualMaxCapacity', r, t, y)), res + inv);
    const capMin = Math.max(res + minv, g('TotalAnnualMinCapacity', r, t, y) || 0);
    const cau = g('CapacityToActivityUnit', r, t) ?? 1,
      af = g('AvailabilityFactor', r, t, y) ?? 1;
    let cfys = 0;
    const cf = {},
      cfg = CFI.get(r + '|' + t + '|' + y),
      cfd = cfDef();
    for (const l of TS) {
      const v = cfg && cfg.has(l) ? cfg.get(l) : cfd;
      cf[l] = v ?? 1;
      cfys += cf[l] * ysOf(l, y);
    }
    if (!TS.length) cfys = 1;
    const actMax = Math.min(
      lim(g('TotalTechnologyAnnualActivityUpperLimit', r, t, y)),
      capMax === Infinity ? Infinity : capMax * cau * Math.min(af, cfys)
    );
    const actMin = g('TotalTechnologyAnnualActivityLowerLimit', r, t, y) || 0;
    const o = {capMax, capMin, actMax, actMin, cau, af, cfys, cf, res, life};
    B.set(k, o);
    return o;
  };
  // producers / users per region, commodity, year (from the ratios)
  const prod = new Map(),
    use = new Map(),
    key = (r, f, y) => r + '|' + f + '|' + y;
  if ((++CKN & 3) === 0) yield;
  for (const fl of M.flows) {
    const m = fl.dir === 'out' ? prod : use,
      k = key(fl.r, fl.f, fl.y);
    if (!m.has(k)) m.set(k, new Map());
    const e = m.get(k);
    e.set(fl.t, Math.max(e.get(fl.t) || 0, fl.v));
  }
  const trade = new Set();
  for (const r0 of (P.TradeRoute || {recs: []}).recs) if (r0.v) trade.add(key(r0.idx[0], r0.idx[2], +r0.idx[3]));
  const fmtv = v => (v === Infinity ? 'no limit' : fmt(v));
  const FRY = new Map(),
    FRTY = new Map(); // flows indexed by region|year and region|tech|year
  if ((++CKN & 3) === 0) yield;
  for (const x of M.flows) {
    const k1 = x.r + '|' + x.y,
      k2 = x.r + '|' + x.t + '|' + x.y;
    if (!FRY.has(k1)) FRY.set(k1, []);
    FRY.get(k1).push(x);
    if (!FRTY.has(k2)) FRTY.set(k2, []);
    FRTY.get(k2).push(x);
  }

  // ---- E: technology bounds
  if ((++CKN & 3) === 0) yield;
  for (const r of R)
    for (const t of T)
      for (const y of Y) {
        if ((++CKN & 63) === 0) yield;
        const b = bounds(r, t, y),
          tamc = g('TotalAnnualMaxCapacity', r, t, y);
        if (b.res > lim(tamc) + tol(b.res))
          add('error', 'RESMAX', 'Existing capacity above the maximum capacity', r, {
            t,
            y,
            d: `ResidualCapacity ${fmt(b.res)} > TotalAnnualMaxCapacity ${fmt(tamc)}`,
            fix: 'Raise TotalAnnualMaxCapacity or lower ResidualCapacity.'
          });
        const mn = g('TotalAnnualMinCapacity', r, t, y) || 0;
        if (mn > lim(tamc) + tol(mn))
          add('error', 'MINMAX', 'Minimum capacity above maximum capacity', r, {
            t,
            y,
            d: `TotalAnnualMinCapacity ${fmt(mn)} > TotalAnnualMaxCapacity ${fmt(tamc)}`,
            fix: 'Make the minimum ≤ the maximum.'
          });
        else if (b.capMin > b.capMax + tol(b.capMin) && !(b.res > lim(tamc) + tol(b.res)))
          add('error', 'MINCAP', 'Minimum capacity cannot be reached', r, {
            t,
            y,
            d: `needs ${fmt(b.capMin)}, at most ${fmt(b.capMax)} reachable (existing ${fmt(b.res)} + build limits over the ${fmt(b.life)}-year life)`,
            fix: 'Raise TotalAnnualMaxCapacityInvestment in earlier years or lower the minimum.'
          });
        const mi = g('TotalAnnualMinCapacityInvestment', r, t, y) || 0,
          ma = g('TotalAnnualMaxCapacityInvestment', r, t, y);
        if (mi > lim(ma) + tol(mi))
          add('error', 'MININV', 'Minimum new capacity above maximum new capacity', r, {
            t,
            y,
            d: `min ${fmt(mi)} > max ${fmt(ma)}`,
            fix: 'Make the minimum ≤ the maximum.'
          });
        const ul = g('TotalTechnologyAnnualActivityUpperLimit', r, t, y);
        if (b.actMin > lim(ul) + tol(b.actMin))
          add('error', 'ACTLU', 'Activity lower limit above activity upper limit', r, {
            t,
            y,
            d: `lower ${fmt(b.actMin)} > upper ${fmt(ul)}`,
            fix: 'Make the lower limit ≤ the upper limit.'
          });
        else if (b.actMin > b.actMax + tol(b.actMin))
          add('error', 'ACTCAP', 'Activity lower limit above what the capacity can produce', r, {
            t,
            y,
            d: `lower limit ${fmt(b.actMin)}, at most ${fmt(b.actMax)} = capacity ${fmtv(b.capMax)} × CapacityToActivityUnit ${fmt(b.cau)} × min(AvailabilityFactor ${fmt(b.af)}, Σ CapacityFactor×YearSplit ${fmt(b.cfys)})`,
            fix: 'Raise capacity (residual, build limits), capacity or availability factor, or lower the activity lower limit.'
          });
        for (const [p, nm] of [
          ['TotalAnnualMaxCapacity', 'maximum capacity'],
          ['TotalAnnualMaxCapacityInvestment', 'maximum new capacity'],
          ['TotalTechnologyAnnualActivityUpperLimit', 'activity upper limit']
        ]) {
          const v = g(p, r, t, y);
          if (v !== undefined && v < 0 && ix(p).has([r, t, y].join('|')))
            add('warn', 'NEGUL', `Negative ${nm}`, r, {
              t,
              y,
              d: `${p} = ${fmt(v)}`,
              fix: 'In the standard OSeMOSYS code a negative upper limit makes the model infeasible; it is read here as "no limit" (some versions use -1 for that).'
            });
        }
        for (const l of TS) {
          const c = b.cf[l];
          if (c < 0 || c > 1 + 1e-9) {
            add('warn', 'CF', 'Capacity factor outside 0–1', r, {
              t,
              y,
              d: `CapacityFactor ${l} = ${fmt(c)}`,
              fix: 'Capacity factors are shares.'
            });
            break;
          }
        }
        if (b.af < 0 || b.af > 1 + 1e-9)
          add('warn', 'AF', 'Availability factor outside 0–1', r, {
            t,
            y,
            d: `AvailabilityFactor = ${fmt(b.af)}`,
            fix: 'Availability factors are shares.'
          });
      }
  // model-period activity
  if ((++CKN & 3) === 0) yield;
  for (const r of R)
    for (const t of T) {
      if ((++CKN & 63) === 0) yield;
      const lo = g('TotalTechnologyModelPeriodActivityLowerLimit', r, t) || 0,
        up = lim(g('TotalTechnologyModelPeriodActivityUpperLimit', r, t));
      let smax = 0,
        smin = 0;
      for (const y of Y) {
        const b = bounds(r, t, y);
        smax += b.actMax;
        smin += b.actMin;
      }
      if (lo > up + tol(lo))
        add('error', 'MPLU', 'Model-period activity: lower limit above upper limit', r, {
          t,
          d: `lower ${fmt(lo)} > upper ${fmt(up)}`,
          fix: 'Make the lower limit ≤ the upper limit.'
        });
      else if (lo > smax + tol(lo))
        add('error', 'MPMAX', 'Model-period activity lower limit cannot be reached', r, {
          t,
          d: `needs ${fmt(lo)}, at most ${fmt(smax)} over all years`,
          fix: 'Raise capacity or lower the limit.'
        });
      if (smin > up + tol(smin))
        add('error', 'MPMIN', 'Yearly lower limits exceed the model-period upper limit', r, {
          t,
          d: `Σ yearly lower limits ${fmt(smin)} > model-period upper limit ${fmt(up)}`,
          fix: 'Lower the yearly pins or raise the model-period limit (e.g. a reserve).'
        });
    }
  // upper bound on what can be delivered of each commodity in a region-year (l = time slice, or null = whole year):
  // a technology delivers at most OAR x min(its capacity limit, what its inputs allow); inputs are bounded the same way upstream.
  // Shared inputs are counted for every user and storage discharge is not limited by inputs, so this over-states supply:
  // a demand above it is a proof of infeasibility. Commodities with a trade route are unbounded.
  const fromSto = new Set((P.TechnologyFromStorage || {recs: []}).recs.filter(x => x.v).map(x => x.idx[0] + '|' + x.idx[1]));
  const SUP = new Map();
  // the structure of a region-year is read once (technologies, their modes, inputs, outputs, largest output ratio); the bound
  // itself is then computed for the year and for each time slice, with and without the emitting technologies (EMIMIN)
  const RYS = new Map();
  const ryStruct = (r, y) => {
    const k0 = r + '|' + y;
    if (RYS.has(k0)) return RYS.get(k0);
    const fl = FRY.get(k0) || [],
      fs = [...new Set(fl.map(x => x.f))],
      techs = [...new Set(fl.map(x => x.t))];
    const st = {
      fs,
      techs: techs.map(t => {
        const mine = FRTY.get(r + '|' + t + '|' + y),
          modes = [...new Set(mine.map(x => x.m))],
          maxOut = new Map();
        for (const x of mine) if (x.dir === 'out') maxOut.set(x.f, Math.max(maxOut.has(x.f) ? maxOut.get(x.f) : -Infinity, x.v));
        return {
          t,
          sto: fromSto.has(r + '|' + t),
          maxOut,
          modes: modes.map(m => ({
            ins: mine.filter(x => x.dir === 'in' && x.m === m && x.v > 0),
            outs: mine.filter(x => x.dir === 'out' && x.m === m && x.v > 0)
          }))
        };
      })
    };
    RYS.set(k0, st);
    return st;
  };
  const supply = (r, y, l, ex) => {
    const k = r + '|' + y + '|' + l + (ex ? '|' + ex.id : '');
    if (SUP.has(k)) return SUP.get(k);
    const {fs, techs} = ryStruct(r, y),
      ys_ = l === null ? 0 : g('YearSplit', l, y) || 0;
    const rate = T0 => {
      const b = bounds(r, T0.t, y);
      if (l === null) return b.actMax;
      return b.capMax === Infinity ? Infinity : b.capMax * b.cau * b.cf[l] * ys_;
    };
    const caps = techs.map(T0 => (ex && ex.set.has(T0.t) ? null : rate(T0)));
    let sup = new Map(fs.map(f => [f, Infinity]));
    for (let it = 0; it < 60; it++) {
      const nx = new Map(fs.map(f => [f, trade.has(key(r, f, y)) ? Infinity : 0]));
      techs.forEach((T0, ti) => {
        const cap = caps[ti];
        if (cap === null) return;
        const outM = new Map();
        for (const M0 of T0.modes) {
          let a = cap;
          if (!T0.sto) for (const x of M0.ins) a = Math.min(a, sup.get(x.f) / x.v);
          for (const x of M0.outs) outM.set(x.f, (outM.get(x.f) || 0) + x.v * a);
        }
        for (const [f, v] of outM) {
          const capOut = cap * T0.maxOut.get(f);
          nx.set(f, nx.get(f) + Math.min(v, capOut));
        }
      });
      let same = true;
      for (const f of fs) {
        const a = sup.get(f),
          b = Math.min(a, nx.get(f));
        if (!(a === b || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)))) same = false;
        sup.set(f, b);
      }
      if (same) break;
    }
    SUP.set(k, sup);
    return sup;
  };
  // ---- commodities: demand cover (year and time slice), inputs of forced technologies
  if ((++CKN & 3) === 0) yield;
  for (const r of R)
    for (const f of M.S.COMMODITY || [])
      for (const y of Y) {
        if ((++CKN & 63) === 0) yield;
        const D = g('SpecifiedAnnualDemand', r, f, y) || 0,
          A = g('AccumulatedAnnualDemand', r, f, y) || 0,
          pr = prod.get(key(r, f, y)),
          tr = trade.has(key(r, f, y));
        if (D + A > 0 && !pr && !tr)
          add('error', 'DEMNOPROD', 'Demand with no producer', r, {
            f,
            y,
            d: `demand ${fmt(D + A)}; no technology outputs ${f} in ${r} in ${y} and no trade route`,
            fix: 'Add a producer (OutputActivityRatio), a trade route, or remove the demand.'
          });
        if (D + A > 0 && pr && !tr) {
          const cap = supply(r, y, null).get(f);
          if (cap !== undefined && cap !== Infinity && D + A > cap + tol(D + A))
            add('error', 'DEMCAP', 'Demand above what the supply chain can deliver', r, {
              f,
              y,
              d: `demand ${fmt(D + A)} > ${fmt(cap)} = most the producers of ${f} can deliver, following their inputs upstream, all at their limits`,
              fix: 'Raise capacity or build limits along the chain, or add a backstop or import.'
            });
          if (D > 0 && TS.length)
            for (const l of TS) {
              const dl = D * (g('SpecifiedDemandProfile', r, f, l, y) || 0);
              if (dl <= 0) continue;
              const sl = supply(r, y, l).get(f);
              if (sl !== undefined && sl !== Infinity && dl > sl + tol(dl)) {
                add('error', 'DEMSLICE', 'Demand in a time slice above what the supply chain can deliver in that slice', r, {
                  f,
                  y,
                  d: `${l}: demand ${fmt(dl)} > ${fmt(sl)} (capacity × capacity factor × YearSplit along the chain; e.g. only solar at night)`,
                  fix: 'Add supply available in that slice (storage discharge, dispatchable plant, imports) or check the capacity factors.'
                });
                break;
              }
            }
        }
        if (D > 0 && TS.length) {
          let s = 0;
          for (const l of TS) s += g('SpecifiedDemandProfile', r, f, l, y) || 0;
          if (Math.abs(s - 1) > 1e-3)
            add('warn', 'PROFILE', 'Demand profile does not sum to 1', r, {
              f,
              y,
              d: `Σ SpecifiedDemandProfile = ${fmt(s)}`,
              fix: 'The profile splits the yearly demand over time slices; it should sum to 1.'
            });
        }
      }
  if ((++CKN & 3) === 0) yield;
  for (const r of R)
    for (const t of T)
      for (const y of Y) {
        if ((++CKN & 63) === 0) yield;
        const all = FRTY.get(r + '|' + t + '|' + y) || [],
          ins = all.filter(x => x.dir === 'in');
        const missing = [...new Set(ins.filter(x => !prod.has(key(r, x.f, y)) && !trade.has(key(r, x.f, y))).map(x => x.f))];
        if (!missing.length) continue;
        // a mode that needs none of the missing inputs can still run
        const modes = new Set(all.map(x => x.m));
        const blocked = [...modes].every(m => ins.some(x => x.m === m && missing.includes(x.f)));
        if (!blocked) continue;
        if (bounds(r, t, y).actMin > 0)
          add('error', 'NOINPUT', 'Forced activity but an input is never produced', r, {
            t,
            y,
            d: `activity lower limit ${fmt(bounds(r, t, y).actMin)}; input ${missing.join(', ')} has no producer or trade route in ${r}`,
            fix: 'Add a producer of the input or remove the lower limit.'
          });
        else
          add('info', 'DEAD', 'Technology can never run (an input is never produced)', r, {
            t,
            y,
            d: `input ${missing.join(', ')} has no producer or trade route in ${r}`,
            fix: 'Harmless for feasibility; check whether it is intended.'
          });
      }
  // ---- user-defined constraints: smallest / largest possible left-hand side
  const U = M.S.UDC || [];
  if ((++CKN & 3) === 0) yield;
  if (U.length) {
    const terms = new Map(); // u|y -> [{r,t,kind,c}]
    for (const [p, kind] of [
      ['UDCMultiplierTotalCapacity', 'cap'],
      ['UDCMultiplierNewCapacity', 'new'],
      ['UDCMultiplierActivity', 'act']
    ])
      for (const x of (P[p] || {recs: []}).recs)
        if (x.v) {
          const u = x.idx.find(v => U.includes(v)),
            y = +x.idx[x.idx.length - 1],
            k = u + '|' + y;
          if (!terms.has(k)) terms.set(k, []);
          terms.get(k).push({r: x.idx[0], t: x.idx[1], kind, c: x.v});
        }
    // the storage terms [7] (capacity, new capacity, charge, discharge) are >= 0 with no upper bound here
    for (const p of [
      'UDCMultiplierStorageCapacity',
      'UDCMultiplierNewStorageCapacity',
      'UDCMultiplierStorageCharge',
      'UDCMultiplierStorageDischarge'
    ])
      for (const x of (P[p] || {recs: []}).recs)
        if (x.v) {
          const u = x.idx.find(v => U.includes(v)),
            y = +x.idx[x.idx.length - 1],
            k = u + '|' + y;
          if (!terms.has(k)) terms.set(k, []);
          terms.get(k).push({r: x.idx[0], t: x.idx[1], kind: 'sto', c: x.v});
        }
    const rng = o => {
      if (o.kind === 'sto') return o.c > 0 ? [0, Infinity] : [-Infinity, 0];
      const b = bounds(o.r, o.t, o.y);
      const [lo, hi] =
        o.kind === 'cap'
          ? [b.capMin, b.capMax]
          : o.kind === 'act'
            ? [b.actMin, b.actMax]
            : [g('TotalAnnualMinCapacityInvestment', o.r, o.t, o.y) || 0, lim(g('TotalAnnualMaxCapacityInvestment', o.r, o.t, o.y))];
      return o.c > 0 ? [o.c * lo, o.c * hi] : [o.c * hi, o.c * lo];
    };
    for (const u of U)
      for (const y of Y) {
        const tags = R.map(r => g('UDCTag', r, u));
        const regional = tags.some(v => v === 2 || v === 3);
        const groups = regional
          ? [{rs: R, eq: tags.includes(3)}]
          : R.filter((r, i) => tags[i] === 0 || tags[i] === 1).map(r => ({rs: [r], eq: g('UDCTag', r, u) === 1}));
        for (const G0 of groups) {
          let lo = 0,
            hi = 0;
          for (const o of terms.get(u + '|' + y) || [])
            if (G0.rs.includes(o.r)) {
              const [a, b] = rng({...o, y});
              lo += a;
              hi += b;
            }
          let C = 0;
          for (const r of G0.rs) C += g('UDCConstant', r, u, y) || 0;
          const where = regional ? 'all regions' : G0.rs[0];
          if (lo > C + tol(C))
            add('error', 'UDC', `User-defined constraint ${u} cannot be met`, where, {
              u,
              y,
              d: `smallest possible left-hand side ${fmt(lo)} > constant ${fmt(C)} (${G0.eq ? '=' : '≤'})`,
              fix: 'Check the multipliers, the constant, and the capacity / build limits of the technologies in it.'
            });
          else if (G0.eq && hi < C - tol(C))
            add('error', 'UDC', `User-defined constraint ${u} cannot be met`, where, {
              u,
              y,
              d: `largest possible left-hand side ${fmtv(hi)} < constant ${fmt(C)} (=)`,
              fix: 'Check the multipliers, the constant, and the limits of the technologies in it.'
            });
        }
      }
  }
  // ---- emissions: exogenous and forced emissions vs limits
  const EAR = new Map();
  for (const x of (P.EmissionActivityRatio || {recs: []}).recs) {
    const k = x.idx[0] + '|' + x.idx[2];
    if (!EAR.has(k)) EAR.set(k, []);
    EAR.get(k).push(x);
  }
  if ((++CKN & 3) === 0) yield;
  for (const e of M.S.EMISSION || [])
    for (const r of R) {
      const ear = EAR.get(r + '|' + e) || [];
      const neg = ear.some(x => x.v < 0);
      let mp = g('ModelPeriodExogenousEmission', r, e) || 0;
      for (const y of Y) {
        const L0 = lim(g('AnnualEmissionLimit', r, e, y));
        let forced = g('AnnualExogenousEmission', r, e, y) || 0;
        if (!neg) {
          const byT = new Map();
          for (const x of ear)
            if (+x.idx[x.idx.length - 1] === y) {
              const t = x.idx[1];
              byT.set(t, Math.min(byT.has(t) ? byT.get(t) : Infinity, x.v));
            }
          for (const [t, v] of byT) forced += v * bounds(r, t, y).actMin;
        }
        mp += forced;
        if (forced > L0 + tol(forced))
          add('error', 'EMI', `Emission limit on ${e} cannot be met`, r, {
            y,
            d: `exogenous + emissions of forced activity ${fmt(forced)} > AnnualEmissionLimit ${fmt(L0)}`,
            fix: 'Raise the limit or lower forced (lower-limit) activity of emitting technologies.'
          });
      }
      // a limit of 0 on an emission that technologies emit: no emission at all is allowed (often a default of 0 left by mistake)
      if (ear.some(x => x.v > 0)) {
        const z = Y.filter(y => lim(g('AnnualEmissionLimit', r, e, y)) <= 0);
        if (z.length)
          add('warn', 'EMI0', `AnnualEmissionLimit of ${e} is 0`, r, {
            y: z[0],
            d: `0 in ${z.length} year(s), while technologies emit ${e}: they cannot run at all`,
            fix: 'For no limit give a large value (e.g. 999999).'
          });
        if (SCHEMA.params.has('ModelPeriodEmissionLimit') && lim(g('ModelPeriodEmissionLimit', r, e)) <= 0)
          add('warn', 'EMI0', `ModelPeriodEmissionLimit of ${e} is 0`, r, {
            d: `technologies emit ${e} but no emission is allowed over the horizon`,
            fix: 'For no limit give a large value (e.g. 999999).'
          });
      }
      const ML = lim(g('ModelPeriodEmissionLimit', r, e));
      if (mp > ML + tol(mp))
        add('error', 'EMI', `Model-period emission limit on ${e} cannot be met`, r, {
          d: `at least ${fmt(mp)} > ModelPeriodEmissionLimit ${fmt(ML)}`,
          fix: 'Raise the limit or lower forced activity.'
        });
    }
  // free, unlimited capacity: the solver may report any capacity for it (alternative optima)
  if ((++CKN & 3) === 0) yield;
  for (const r of R)
    for (const t of T) {
      const hasFlow = (FRY.get(r + '|' + Y[0]) || []).some(x => x.t === t) || M.flows.some(x => x.r === r && x.t === t);
      if (!hasFlow) continue;
      const costly = Y.some(y => (g('CapitalCost', r, t, y) || 0) > 0 || (g('FixedCost', r, t, y) || 0) > 0),
        lim0 = Y.every(y => lim(g('TotalAnnualMaxCapacity', r, t, y)) >= 99999);
      if (!costly && lim0)
        add('info', 'FREECAP', 'Capacity is free and unlimited', r, {
          t,
          d: 'no capital or fixed cost and no maximum capacity: the solver may report any capacity (0 or very large) for this technology',
          fix: 'Harmless for activity results; set a small cost or a maximum capacity if you chart capacities.'
        });
    }
  // ---- data hygiene
  if ((++CKN & 3) === 0) yield;
  for (const y of Y)
    if (TS.length && Math.abs(ys[y] - 1) > 1e-3)
      add('warn', 'YEARSPLIT', 'YearSplit does not sum to 1', 'all', {
        y,
        d: `Σ YearSplit = ${fmt(ys[y])}`,
        fix: 'Time-slice shares of the year should sum to 1.'
      });
  // a season (day type, day part) with no time slice: its data (rain depth, profiles, ET0…) is never used, and the
  // slices meant for it went to another one (CLEWs (3): S101, S111, S121 read as season 1 by the old S<season><day part> names)
  if ((++CKN & 3) === 0) yield;
  for (const [cp, sn, nm] of [
    ['Conversionls', 'SEASON', 'season'],
    ['Conversionld', 'DAYTYPE', 'day type'],
    ['Conversionlh', 'DAILYTIMEBRACKET', 'day part']
  ]) {
    const mem = setOf(sn).map(String);
    if (mem.length < 2 || !TS.length) continue;
    const got = new Map(mem.map(m => [m, []]));
    for (const r of getRecs(cp, [])) if (Number(r.v) > 0 && got.has(String(r.idx[1]))) got.get(String(r.idx[1])).push(String(r.idx[0]));
    const empty = mem.filter(m => !got.get(m).length);
    if (!empty.length) continue;
    const big = [...got.entries()]
      .filter(([, l]) => l.length > 1 && l.length > (TS.length / mem.length) * 1.5)
      .map(([m, l]) => `${nm} ${m}: ${l.join(', ')}`);
    add('error', 'TSEMPTY', `A ${nm} has no time slice (${cp})`, 'all', {
      d: `${nm}${empty.length > 1 ? 's' : ''} ${empty.join(', ')} ha${empty.length > 1 ? 've' : 's'} no time slice: ${nm === 'season' ? (empty.length > 1 ? 'their' : 'its') + ' rain, ET0, profiles and links are never used' : (empty.length > 1 ? 'their' : 'its') + ' data is never used'}${big.length ? '; too many slices in ' + big.join('; ') : ''}`,
      fix: `Give each time slice its own ${nm} in ${cp} (Model settings, Time). New models name slices S<season>D<day type>B<day part>, so S10 is season 10.`
    });
  }
  if ((++CKN & 3) === 0) yield;
  for (const fl of M.flows)
    if (fl.v < 0) {
      add('warn', 'NEGRATIO', 'Negative activity ratio', fl.r, {
        t: fl.t,
        f: fl.f,
        y: fl.y,
        d: `${fl.dir === 'in' ? 'Input' : 'Output'}ActivityRatio ${fl.f} mode ${fl.m} = ${fmt(fl.v)}`,
        fix: 'Ratios are normally positive; check the sign.'
      });
    }
  if ((++CKN & 3) === 0) yield;
  for (const x of (P.TradeRoute || {recs: []}).recs)
    if (x.v && !g('TradeRoute', x.idx[1], x.idx[0], x.idx[2], x.idx[3]))
      add('warn', 'TRADE1', 'Trade route open in one direction only', x.idx[0], {
        f: x.idx[2],
        y: +x.idx[3],
        d: `TradeRoute ${x.idx[0]}→${x.idx[1]} = 1 but ${x.idx[1]}→${x.idx[0]} = 0: the flow leaves one balance without entering the other`,
        fix: 'Open both directions (Trade[r,rr] = −Trade[rr,r]).'
      });
  if ((++CKN & 3) === 0) yield;
  for (const s of M.stor)
    for (const r of R) {
      const charged = (P.TechnologyToStorage || {recs: []}).recs.some(x => x.v && x.idx[0] === r && x.idx[2] === s);
      if (charged && !Y.some(y => (g('CapitalCostStorage', r, s, y) || 0) > 0))
        add('info', 'STOCAP', 'Storage with no capital cost', r, {
          s,
          d: `${s} is charged but CapitalCostStorage is 0: storage size is free`,
          fix: 'Usually a missing cost.'
        });
    }
  // ---- vintaging: the cohorts of ResidualCapacityByVintage must add up to ResidualCapacity in every year (constraint CAv2 of the vintage model)
  // ---- EMIMIN: emissions that cannot be avoided. For each emission, the demand that the technologies WITHOUT that emission
  // can deliver (same supply bound as DEMCAP / DEMSLICE, run without the emitting technologies; it over-states clean supply)
  // leaves a shortfall that only emitting technologies can serve; each unit of it emits at least the smallest intensity
  // along a chain (direct EAR / OAR of an emitting producer, or through the input a clean producer then needs). The sum is
  // a lower bound of the emissions of any solution: above a limit, the model is infeasible.
  const EARm = new Map();
  for (const x of (P.EmissionActivityRatio || {recs: []}).recs) {
    const [r, t, e, m, y] = x.idx;
    const k = r + '|' + e + '|' + y;
    if (!EARm.has(k)) EARm.set(k, []);
    EARm.get(k).push({t, m, v: Number(x.v)});
  }
  // profiles and vintage factors scale the ratios: the bound uses, per technology, the smallest input / emission factors and
  // the largest output factors found in the data, so it stays a lower bound
  const facLo = new Map(),
    facHi = new Map(),
    tOf = (p, x) => String(p.startsWith('Vint') || p.startsWith('AgeDeg') ? x.idx[0] : x.idx[1]);
  if ((++CKN & 3) === 0) yield;
  for (const p of ['ProfileIAR', 'SeasonProfileIAR', 'VintFacIAR', 'AgeDegIAR', 'VintFacEAR', 'AgeDegEAR', 'VintSeasonIAR']) {
    const mn = new Map();
    for (const x of (P[p] || {recs: []}).recs) {
      const t = tOf(p, x);
      mn.set(t, Math.min(mn.has(t) ? mn.get(t) : 1, Number(x.v)));
    }
    for (const [t, v] of mn) facLo.set(t, (facLo.get(t) ?? 1) * Math.max(0, v));
  }
  if ((++CKN & 3) === 0) yield;
  for (const p of ['ProfileOAR', 'SeasonProfileOAR', 'VintFacOAR', 'AgeDegOAR', 'VintSeasonOAR']) {
    const mx = new Map();
    for (const x of (P[p] || {recs: []}).recs) {
      const t = tOf(p, x);
      mx.set(t, Math.max(mx.has(t) ? mx.get(t) : 1, Number(x.v)));
    }
    for (const [t, v] of mx) facHi.set(t, (facHi.get(t) ?? 1) * v);
  }
  const fac = t => (facLo.get(String(t)) ?? 1) / (facHi.get(String(t)) ?? 1);
  const profiled = false;
  const LBE = new Map(); // r|e|y -> {lb, why}
  if ((++CKN & 3) === 0) yield;
  for (const e of M.S.EMISSION || []) {
    if ((P.EmissionActivityRatio || {recs: []}).recs.some(x => x.idx[2] === e && Number(x.v) < 0)) continue; // a sink: no lower bound
    for (const r of R)
      for (const y of Y) {
        if ((++CKN & 7) === 0) yield;
        const em = (EARm.get(r + '|' + e + '|' + y) || []).filter(x => x.v > 0);
        if (!em.length) continue;
        const dirty = new Set(em.map(x => x.t)),
          ex = {id: 'x' + e, set: dirty};
        const fl = FRY.get(r + '|' + y) || [],
          fs = [...new Set(fl.map(x => x.f))];
        // smallest emission per unit of each commodity made beyond what the clean technologies can make
        const it = new Map(fs.map(f => [f, Infinity]));
        for (let k = 0; k < 40; k++) {
          let ch = false;
          for (const f of fs) {
            let best = trade.has(key(r, f, y)) ? 0 : Infinity;
            for (const x of fl)
              if (x.dir === 'out' && x.f === f && x.v > 0) {
                const t = x.t,
                  m = x.m,
                  dv = em.filter(z => z.t === t && z.m === m).reduce((a, z) => Math.max(a, z.v), 0);
                let c;
                if (dirty.has(t))
                  c = (dv / x.v) * fac(t); // an emitting producer: its own emission
                else {
                  c = Infinity;
                  for (const y2 of fl)
                    if (y2.t === t && y2.m === m && y2.dir === 'in' && y2.v > 0) c = Math.min(c, (y2.v / x.v) * fac(t) * it.get(y2.f));
                }
                if (fromSto.has(r + '|' + t)) c = 0; // storage: not followed
                best = Math.min(best, c);
              }
            if (best < it.get(f) - 1e-15) {
              it.set(f, best);
              ch = true;
            }
          }
          if (!ch) break;
        }
        let lb = 0,
          why = '';
        for (const f of fs) {
          const D = g('SpecifiedAnnualDemand', r, f, y) || 0,
            A = g('AccumulatedAnnualDemand', r, f, y) || 0;
          if (D + A <= 0) continue;
          const iv = it.get(f);
          if (!(iv > 0) || iv === Infinity) continue;
          let short = 0,
            wh = '';
          if (TS.length && D > 0) {
            for (const l of TS) {
              const dl = D * (g('SpecifiedDemandProfile', r, f, l, y) || 0),
                cl = supply(r, y, l, ex).get(f) ?? 0;
              if (dl > cl + tol(dl)) {
                short += dl - cl;
                if (!wh) wh = `${l}: clean supply at most ${fmt(cl)} of ${fmt(dl)}`;
              }
            }
            const ca = supply(r, y, null, ex).get(f) ?? 0;
            if (A > 0 && D + A - ca > short) {
              short = D + A - ca;
              wh = `year: clean supply at most ${fmt(ca)} of ${fmt(D + A)}`;
            }
          } else {
            const ca = supply(r, y, null, ex).get(f) ?? 0;
            if (D + A > ca + tol(D + A)) {
              short = D + A - ca;
              wh = `year: clean supply at most ${fmt(ca)} of ${fmt(D + A)}`;
            }
          }
          if (short > 0) {
            lb += short * iv;
            why += `${why ? '; ' : ''}${f} ${wh} → ${fmt(short)} from emitting technologies × at least ${fmt(iv)} ${e} per unit`;
          }
        }
        if (lb > 0) LBE.set(r + '|' + e + '|' + y, {lb, why});
      }
  }
  const sevE = profiled ? 'warn' : 'error',
    notE = profiled ? ' (profiles or vintage factors below 1 are not counted: check by hand or with "Check feasibility")' : '';
  if ((++CKN & 3) === 0) yield;
  for (const [k, o] of LBE) {
    const [r, e, y] = k.split('|'),
      L0 = lim(g('AnnualEmissionLimit', r, e, +y));
    if (o.lb > L0 + tol(o.lb))
      add(sevE, 'EMIMIN', `Demand cannot be met within the emission limit on ${e}`, r, {
        y: +y,
        d: `at least ${fmt(o.lb)} ${e} cannot be avoided > AnnualEmissionLimit ${fmt(L0)}: ${o.why}${notE}`,
        fix: 'Raise the limit, or allow more capacity of technologies without this emission (TotalAnnualMaxCapacity, build limits, capacity factors, storage), or lower the demand.'
      });
  }
  if ((++CKN & 3) === 0) yield;
  for (const e of M.S.EMISSION || []) {
    if (SCHEMA.params.has('RegionalAnnualEmissionLimit'))
      for (const y of Y) {
        const lb = R.reduce((a, r) => a + ((LBE.get(r + '|' + e + '|' + y) || {}).lb || 0), 0),
          L = R.reduce((a, r) => a + lim(g('RegionalAnnualEmissionLimit', r, e, y)), 0);
        if (lb > 0 && L > 0 && lb > L + tol(lb))
          add(sevE, 'EMIMIN', `Demand cannot be met within the regional emission limit on ${e}`, 'all', {
            y,
            d: `all regions together emit at least ${fmt(lb)} > Σ RegionalAnnualEmissionLimit ${fmt(L)}${notE}`,
            fix: 'Raise the regional cap or allow more clean capacity.'
          });
      }
    for (const r of R) {
      const lb = Y.reduce((a, y) => a + ((LBE.get(r + '|' + e + '|' + y) || {}).lb || 0), 0),
        L = lim(g('ModelPeriodEmissionLimit', r, e));
      if (lb > 0 && L > 0 && lb > L + tol(lb))
        add(sevE, 'EMIMIN', `Demand cannot be met within the model-period emission limit on ${e}`, r, {
          d: `at least ${fmt(lb)} ${e} over the horizon > ModelPeriodEmissionLimit ${fmt(L)}${notE}`,
          fix: 'Raise the budget or allow more clean capacity.'
        });
    }
  }
  // ================= catalogue of the other causes of infeasibility (error) and of doubtful data (warn / info) =================
  const has = p => SCHEMA.params.has(p),
    recs = p => (P[p] || {recs: []}).recs,
    nz = v => v !== undefined && !isNaN(v) && v !== 0;
  const modesT = new Map();
  for (const x of M.flows) {
    const k = x.r + '|' + x.t;
    if (!modesT.has(k)) modesT.set(k, new Set());
    modesT.get(k).add(x.m);
  }
  if ((++CKN & 3) === 0) yield;
  for (const r of R)
    for (const t of T) {
      if ((++CKN & 63) === 0) yield;
      const ms = [...(modesT.get(r + '|' + t) || [])];
      const life = g('OperationalLife', r, t);
      if (life !== undefined && life < 1)
        add('warn', 'LIFE', 'Operational life below 1 year', r, {
          t,
          d: `OperationalLife = ${fmt(life)}: new capacity never counts and the capital recovery factor is undefined`,
          fix: 'Give the life in whole years (≥ 1).'
        });
      const dri = g('DiscountRateIdv', r, t);
      if (dri !== undefined && dri < 0)
        add('warn', 'RATE', 'Negative technology discount rate', r, {
          t,
          d: `DiscountRateIdv = ${fmt(dri)}`,
          fix: 'Rates are normally between 0 and 0.3.'
        });
      for (const y of Y) {
        const b = bounds(r, t, y);
        // mode limits (LU1, LU2) against each other and against what the technology can do
        let loSum = 0;
        for (const m of ms) {
          const lo = g('TechnologyActivityByModeLowerLimit', r, t, m, y) || 0,
            up = g('TechnologyActivityByModeUpperLimit', r, t, m, y);
          loSum += lo;
          if (lo > 0 && nz(up) && lo > up + tol(lo))
            add('error', 'MODELU', 'Mode lower limit above the mode upper limit', r, {
              t,
              y,
              d: `mode ${m}: lower ${fmt(lo)} > upper ${fmt(up)}`,
              fix: 'Make the lower limit ≤ the upper limit (0 as upper limit = no limit).'
            });
          if (y > Y[0]) {
            const inc = g('TechnologyActivityIncreaseByModeLimit', r, t, m, y - 1),
              b0 = bounds(r, t, y - 1);
            if (nz(inc) && b0.actMax <= 0 && (lo > 0 || b.actMin > 0))
              add('error', 'MODEGROW', 'Activity must grow from zero but its growth is limited', r, {
                t,
                y,
                d: `mode ${m}: activity is 0 in ${y - 1} (no capacity) and TechnologyActivityIncreaseByModeLimit allows at most (1 + ${fmt(inc)}) × 0 in ${y}, but a lower limit asks for ${fmt(Math.max(lo, b.actMin))}`,
                fix: 'Allow some activity in the year before, remove the growth limit there, or move the lower limit.'
              });
            const dec = g('TechnologyActivityDecreaseByModeLimit', r, t, m, y - 1),
              lo0 = Math.max(g('TechnologyActivityByModeLowerLimit', r, t, m, y - 1) || 0, ms.length === 1 ? b0.actMin : 0);
            if (nz(dec) && (1 - dec) * lo0 > b.actMax + tol(lo0))
              add('error', 'MODEFALL', 'Activity cannot fall as fast as the capacity disappears', r, {
                t,
                y,
                d: `mode ${m}: at least ${fmt(lo0)} in ${y - 1}, so at least (1 − ${fmt(dec)}) × ${fmt(lo0)} = ${fmt((1 - dec) * lo0)} in ${y}, but at most ${fmtv(b.actMax)} is possible`,
                fix: 'Relax TechnologyActivityDecreaseByModeLimit or keep capacity (residual, build limits).'
              });
          }
        }
        if (loSum > b.actMax + tol(loSum))
          add('error', 'MODECAP', 'Mode lower limits above what the capacity can produce', r, {
            t,
            y,
            d: `Σ TechnologyActivityByModeLowerLimit ${fmt(loSum)} > at most ${fmtv(b.actMax)}`,
            fix: 'Raise capacity or lower the mode limits.'
          });
        // costs that make the problem unbounded (a negative cost on something with no limit)
        for (const [p, lim0, what] of [
          ['CapitalCost', b.capMax, 'new capacity'],
          ['FixedCost', b.capMax, 'capacity']
        ]) {
          const v = g(p, r, t, y);
          if (v < 0)
            add(lim0 === Infinity ? 'error' : 'warn', 'NEGCOST', `Negative ${p}`, r, {
              t,
              y,
              d: `${p} = ${fmt(v)} and ${what} ${lim0 === Infinity ? 'has no upper limit: the problem is unbounded' : 'is limited to ' + fmt(lim0)}`,
              fix: 'Costs are normally ≥ 0; a revenue is entered as SalePrice.'
            });
        }
        for (const m of ms) {
          const v = g('VariableCost', r, t, m, y);
          // a negative variable cost is allowed (a revenue per unit of activity); a warning only when nothing limits the activity
          if (v < 0)
            add(b.actMax === Infinity ? 'warn' : 'info', 'NEGCOST', 'Negative VariableCost (a revenue)', r, {
              t,
              y,
              d: `mode ${m}: VariableCost = ${fmt(v)}${b.actMax === Infinity ? '; the activity has no upper limit: if nothing else limits it the problem is unbounded' : ' (activity limited to ' + fmt(b.actMax) + ')'}`,
              fix:
                b.actMax === Infinity
                  ? 'Cap the activity or the capacity of this technology, or limit what can be sold (a demand, a user constraint).'
                  : 'Allowed: it acts as a revenue per unit of activity.'
            });
          const sp = has('SalePrice') ? g('SalePrice', r, t, m, y) : 0;
          if (sp > 0 && b.actMax === Infinity)
            add('warn', 'SALEUB', 'Technology with a sale price and no limit on its activity', r, {
              t,
              y,
              d: `mode ${m}: SalePrice ${fmt(sp)} with no activity or capacity limit: the model can produce only to be paid (unbounded if the price is above the full cost)`,
              fix: 'Cap the activity (TotalTechnologyAnnualActivityUpperLimit, TechnologyActivityByModeUpperLimit) or flag the commodity with BalanceEquality.'
            });
        }
      }
    }
  // a SalePrice on a mode in which the technology has no input, output, emission or storage link is ignored by the model
  // (the mode is not in MODEperTECHNOLOGY): the price "does not work"
  if (has('SalePrice')) {
    const seen = new Set(),
      live = new Set();
    for (const pn of ['EmissionActivityRatio', 'TechnologyToStorage', 'TechnologyFromStorage'])
      for (const x of (M.D.params[pn] || {recs: []}).recs)
        if (x.v) live.add(x.idx[0] + '|' + x.idx[1] + '|' + String(pn === 'EmissionActivityRatio' ? x.idx[3] : x.idx[3]));
    for (const x of (M.D.params.SalePrice || {recs: []}).recs) {
      if (!x.v) continue;
      const [r, t, m] = x.idx.map(String),
        k = r + '|' + t + '|' + m;
      if (seen.has(k)) continue;
      seen.add(k);
      if (!(modesT.get(r + '|' + t) || new Set()).has(m) && !live.has(k))
        add('warn', 'SALEMODE', 'SalePrice on a mode the technology does not use: ignored', r, {
          t,
          y: x.idx[3],
          d: `${t} mode ${m}: SalePrice ${fmt(x.v)}, but ${t} has no input, output, emission or storage link in mode ${m}, so the model leaves that mode (and its price) out`,
          fix: `Give the price on the mode that carries the flow (modes used: ${[...(modesT.get(r + '|' + t) || [])].join(', ') || 'none'}).`
        });
    }
  }
  // switches that must be 0 or 1 (another value silently means "off" in the model)
  for (const pn of ['StorageChronological', 'StorageInterYear'])
    for (const x of (M.D.params[pn] || {recs: []}).recs)
      if (x.v !== 0 && x.v !== 1)
        add('error', 'FLAG01', `${pn} must be 0 or 1`, x.idx[0], {
          d: `${x.idx[1]}: ${pn} = ${fmt(x.v)}; the model treats any value other than 1 as 0 (${pn === 'StorageChronological' ? 'not chronological' : 'not carried from year to year'})`,
          fix: `Set it to 1 (on) or 0 (off).`
        });
  // a "≤" user constraint whose terms all have positive multipliers and a constant of 0 or less can only hold at zero:
  // everything in it is forced to 0 (e.g. a flat constraint written with +1 on the activity instead of -1)
  {
    const tags = new Map((M.D.params.UDCTag || {recs: []}).recs.map(x => [x.idx[0] + '|' + x.idx[1], x.v])),
      terms = new Map();
    for (const pn of [
      'UDCMultiplierTotalCapacity',
      'UDCMultiplierNewCapacity',
      'UDCMultiplierActivity',
      'UDCMultiplierStorageCapacity',
      'UDCMultiplierNewStorageCapacity'
    ])
      for (const x of (M.D.params[pn] || {recs: []}).recs) {
        if (!x.v) continue;
        const k = x.idx[0] + '|' + x.idx[2] + '|' + x.idx[3];
        if (!terms.has(k)) terms.set(k, []);
        terms.get(k).push({t: x.idx[1], v: x.v, p: pn});
      }
    const done = new Set();
    for (const [k, L] of terms) {
      const [r, u, y] = k.split('|');
      if (tags.get(r + '|' + u) !== 0 || done.has(r + '|' + u)) continue;
      const c = (
        (M.D.params.UDCConstant || {recs: []}).recs.find(x => x.idx[0] === r && x.idx[1] === u && String(x.idx[2]) === String(y)) || {v: 0}
      ).v;
      if (L.every(z => z.v > 0) && c <= 0) {
        done.add(r + '|' + u);
        add('error', 'UDCZERO', 'User constraint forces everything in it to zero', r, {
          y: +y,
          d: `${u}: ${L.map(z => `${fmt(z.v)} × ${z.p.replace('UDCMultiplier', '')}(${z.t})`).join(' + ')} ≤ ${fmt(c)}: every term is ≥ 0, so all must be 0`,
          fix: 'For a flat constraint the activity multiplier is -1 (0.99999 × capacity − activity ≤ 0).'
        });
      }
    }
  }
  if ((++CKN & 3) === 0) yield;
  for (const r of R) {
    const dr = g('DiscountRate', r);
    if (dr !== undefined && (dr <= -1 || dr > 1))
      add('error', 'RATE', 'Discount rate outside (-1, 1]', r, {
        d: `DiscountRate = ${fmt(dr)}`,
        fix: 'Give the rate as a share, e.g. 0.05.'
      });
    if (has('DepreciationMethod')) {
      const dm = g('DepreciationMethod', r);
      if (dm !== undefined && dm !== 1 && dm !== 2)
        add('error', 'DEPMETH', 'DepreciationMethod must be 1 or 2', r, {
          d: `DepreciationMethod = ${fmt(dm)} (the model file refuses it)`,
          fix: '1 = sinking fund, 2 = straight line.'
        });
    }
    for (const e of M.S.EMISSION || [])
      for (const y of Y) {
        const v = g('EmissionsPenalty', r, e, y);
        if (v < 0) {
          add('warn', 'NEGPEN', 'Negative emission penalty', r, {
            y,
            d: `EmissionsPenalty ${e} = ${fmt(v)}: emitting earns money`,
            fix: 'Penalties are normally ≥ 0.'
          });
          break;
        }
      }
  }
  // demand in a slice of zero length, both demand types on one commodity
  if ((++CKN & 3) === 0) yield;
  for (const r of R)
    for (const f of M.S.COMMODITY || [])
      for (const y of Y) {
        if ((++CKN & 255) === 0) yield;
        const D = g('SpecifiedAnnualDemand', r, f, y) || 0,
          A = g('AccumulatedAnnualDemand', r, f, y) || 0;
        if (D > 0 && A > 0)
          add('warn', 'DEMBOTH', 'Commodity with both a specified and an accumulated demand', r, {
            f,
            y,
            d: `SpecifiedAnnualDemand ${fmt(D)} + AccumulatedAnnualDemand ${fmt(A)}: both must be met`,
            fix: 'Use one of the two for a commodity.'
          });
        if (D > 0)
          for (const l of TS) {
            if ((g('SpecifiedDemandProfile', r, f, l, y) || 0) > 0 && !((g('YearSplit', l, y) || 0) > 0)) {
              add('error', 'DEMYS', 'Demand in a time slice of zero length', r, {
                f,
                y,
                d: `${l}: SpecifiedDemandProfile > 0 but YearSplit = 0 (nothing can be produced in it)`,
                fix: 'Give the slice a length or move the demand.'
              });
              break;
            }
          }
      }
  // storage
  if ((++CKN & 3) === 0) yield;
  for (const s of M.stor)
    for (const r of R) {
      const ch = recs('TechnologyToStorage').some(x => x.v && x.idx[0] === r && x.idx[2] === s),
        dis = recs('TechnologyFromStorage').some(x => x.v && x.idx[0] === r && x.idx[2] === s);
      if (ch !== dis)
        add('warn', 'STOLINK', `Storage ${ch ? 'charged but never discharged' : 'discharged but never charged'}`, r, {
          s,
          d: `${s}: ${ch ? 'no TechnologyFromStorage' : 'no TechnologyToStorage'}`,
          fix: 'Link a charging and a discharging technology (mode) to the storage.'
        });
      const chr = has('StorageChronological') ? g('StorageChronological', r, s) || 0 : 0;
      const inflow = has('StorageInflow') && recs('StorageInflow').some(x => x.idx[0] === r && x.idx[1] === s && x.v > 0),
        crate =
          has('StorageMaxChargeRate') && ((g('StorageMaxChargeRate', r, s) || 0) > 0 || (g('StorageMaxDischargeRate', r, s) || 0) > 0);
      if ((inflow || crate) && chr !== 1)
        add('error', 'STOCHR', 'Inflow or C-rate on a storage that is not chronological', r, {
          s,
          d: `${inflow ? 'StorageInflow' : 'StorageMaxCharge/DischargeRate'} needs StorageChronological = 1 (the model file refuses it)`,
          fix: 'Set StorageChronological = 1 and give the order of the time slices.'
        });
      if (has('StorageInterYear') && Number(g('StorageInterYear', r, s) || 0) === 1) {
        const yy = M.years.map(Number).sort((a, b) => a - b);
        if (chr !== 1)
          add('error', 'STOYEAR', 'Storage carried between years but not chronological', r, {
            s,
            d: `${s}: StorageInterYear = 1 needs StorageChronological = 1 (the model file refuses it)`,
            fix: 'Set StorageChronological = 1 and give the order of the time slices.'
          });
        if (yy.length && yy[yy.length - 1] - yy[0] + 1 !== yy.length)
          add('error', 'STOYEAR', 'Storage carried between years with gaps between the years', r, {
            s,
            d: `${s}: the years ${yy[0]}-${yy[yy.length - 1]} are not consecutive (${yy.length} years)`,
            fix: 'Model every year, or set StorageInterYear to 0.'
          });
      }
      if (has('StorageMaxLevel')) {
        const top = (g('StorageMaxLevel', r, s) ?? 1) * (g('StorageAvailability', r, s) ?? 1);
        for (const y of Y) {
          const mn = g('MinStorageCharge', r, s, y) || 0;
          if (chr === 1 && mn > top + 1e-9) {
            add((g('ResidualStorageCapacity', r, s, y) || 0) > 0 ? 'error' : 'warn', 'STOBAND', 'Empty usable band of the storage', r, {
              s,
              y,
              d: `MinStorageCharge ${fmt(mn)} > StorageMaxLevel × StorageAvailability ${fmt(top)}: the level cannot be anywhere (infeasible as soon as the storage has capacity)`,
              fix: 'Make the bottom of the band lower than its top.'
            });
            break;
          }
        }
      }
      if (has('StorageMinDuration')) {
        const a = g('StorageMinDuration', r, s) || 0,
          b = g('StorageMaxDuration', r, s) || 0;
        if (a > 0 && b > 0 && a > b)
          add('warn', 'STODUR', 'Storage minimum duration above its maximum', r, {
            s,
            d: `StorageMinDuration ${fmt(a)} h > StorageMaxDuration ${fmt(b)} h: only zero power and energy are possible`,
            fix: 'Make the minimum ≤ the maximum.'
          });
      }
    }
  // balance levels and vintaging (checks of the model file, found here before the run)
  if ((++CKN & 3) === 0) yield;
  if (has('CommodityTimeSliced') && has('VintageMode')) {
    const vm = new Map(recs('VintageMode').map(x => [String(x.idx[0]), Number(x.v)]));
    for (const x of recs('CommodityTimeSliced'))
      if (Number(x.v) === 2) {
        const f = x.idx[0];
        const bad = [...new Set(M.flows.filter(z => z.f === f && vm.get(String(z.t)) === 1).map(z => z.t))];
        if (bad.length)
          add('error', 'CTSVINT', 'Seasonal commodity used by a technology with yearly cohorts', 'all', {
            f,
            d: `${f} is balanced by season (CommodityTimeSliced 2) and ${bad.join(', ')} has VintageMode 1 (the model file refuses it)`,
            fix: 'Use VintageMode 2 for these technologies, or balance the commodity by time slice.'
          });
      }
    const cts = new Map(recs('CommodityTimeSliced').map(x => [String(x.idx[0]), Number(x.v)])),
      ctsDef = Number((P.CommodityTimeSliced || {}).def ?? 1);
    for (const [t, v] of vm)
      if (v === 1) {
        const fac = ['VintFacIAR', 'AgeDegIAR', 'VintFacOAR', 'AgeDegOAR'].filter(p =>
          recs(p).some(x => String(x.idx[0]) === t && Number(x.v) !== 1)
        );
        const ins = [...new Set(M.flows.filter(z => String(z.t) === t).map(z => z.f))];
        if (fac.length && ins.length && ins.every(f => (cts.has(f) ? cts.get(f) : ctsDef) !== 0))
          add('info', 'VINTNOEFF', 'Efficiency factors of the cohorts have no effect', 'all', {
            t,
            d: `${t} has VintageMode 1 and ${fac.join(', ')} ≠ 1, but its commodities are balanced by time slice: in mode 1 these factors act only on commodities balanced over the year`,
            fix: 'Use VintageMode 2, or CommodityTimeSliced 0 for its fuel.'
          });
      }
  }
  // operational profile in a slice where the technology cannot run
  if ((++CKN & 3) === 0) yield;
  if (has('OperationalProfile')) {
    const op = new Map();
    for (const x of recs('OperationalProfile'))
      if (Number(x.v) > 0) {
        const k = x.idx[0] + '|' + x.idx[1] + '|' + x.idx[3];
        if (!op.has(k)) op.set(k, []);
        op.get(k).push(x.idx[2]);
      }
    for (const [k, ls] of op) {
      const [r, t, y] = k.split('|'),
        b = bounds(r, t, +y),
        z = ls.filter(l => !(b.cf[l] > 0));
      if (z.length)
        add(b.actMin > 0 ? 'error' : 'warn', 'OPCF', 'Operational profile asks for activity where the capacity factor is 0', r, {
          t,
          y: +y,
          d: `${z.join(', ')}: OperationalProfile > 0 but CapacityFactor 0, so the technology cannot run at all in the year${b.actMin > 0 ? ' although a lower limit asks for activity' : ''}`,
          fix: 'Give the profile 0 in those slices or check the capacity factors.'
        });
    }
  }
  // seasons of the slices
  if ((++CKN & 3) === 0) yield;
  if ((M.S.SEASON || []).length && has('Conversionls') && TS.length) {
    for (const l of TS) {
      const n = (M.S.SEASON || []).filter(ls => (g('Conversionls', l, ls) || 0) === 1).length;
      if (n !== 1) {
        add('warn', 'TSSEASON', n ? 'Time slice in more than one season' : 'Time slice in no season', 'all', {
          d: `${l}: in ${n} season(s); season profiles, the water cascade and seasonal balances use the mean (or 1 when none)`,
          fix: 'Map every slice to exactly one season (Conversionls).'
        });
        break;
      }
    }
  }
  // earlier budget: committed investment that the budget and external finance cannot pay
  if ((++CKN & 3) === 0) yield;
  if (
    (has('BudgetCapitalShare') && recs('BudgetCapitalShare').some(x => Number(x.v) > 0)) ||
    Number((P.BudgetCapitalShare || {}).def || 0) > 0
  )
    for (const r of R)
      for (const y of Y) {
        let need = 0;
        for (const t of T) {
          const sh = g('BudgetCapitalShare', r, t, y) || 0,
            mi = g('TotalAnnualMinCapacityInvestment', r, t, y) || 0;
          need += sh * mi * Math.max(0, g('CapitalCost', r, t, y) || 0);
        }
        if (need <= 0) continue;
        const open =
          (g('BudgetRevenueShare', r, y) || 0) > 0 || (g('FundDrawShare', r, y) || 0) > 0 || (g('AllowBudgetSavings', r) || 0) > 0;
        const avail = lim(g('BudgetBaseline', r, y)) + (g('MaxFDI', r, y) || 0) + (g('MaxBorrowing', r, y) || 0);
        if (!open && need > avail + tol(need))
          add('error', 'BUDGET', 'Committed investment above the budget and external finance', r, {
            y,
            d: `budgeted share of the minimum new capacity × CapitalCost = ${fmt(need)} > BudgetBaseline + MaxFDI + MaxBorrowing = ${fmt(avail)}`,
            fix: 'Raise the baseline or the finance ceilings, lower BudgetCapitalShare, or the committed investment.'
          });
      }
  if ((++CKN & 3) === 0) yield;
  if (has('MinFDI'))
    for (const r of R)
      for (const y of Y) {
        for (const [a, b, nm] of [
          ['MinFDI', 'MaxFDI', 'FDI'],
          ['MinBorrowing', 'MaxBorrowing', 'borrowing']
        ]) {
          const lo = g(a, r, y) || 0,
            up = g(b, r, y) || 0;
          if (lo > up + tol(lo))
            add('error', 'FINMINMAX', `Committed ${nm} above its ceiling`, r, {
              y,
              d: `${a} ${fmt(lo)} > ${b} ${fmt(up)}`,
              fix: 'Make the floor ≤ the ceiling.'
            });
        }
      }
  // finance sources [3]
  // values: not a number (NaN, Inf, text) anywhere; negative where a parameter cannot be negative; a share above 1.
  // One line per item (technology, commodity... ) and parameter, with a link to the cell (it may be hidden in a closed block
  // or a long grid). Negative costs, ratios, upper limits and penalties have their own checks (NEGCOST, NEGRATIO, NEGUL, NEGPEN).
  {
    const OWN =
      /^(CapitalCost|FixedCost|VariableCost|InputActivityRatio|OutputActivityRatio|EmissionsPenalty|TotalAnnualMaxCapacity|TotalAnnualMaxCapacityInvestment|TotalTechnologyAnnualActivityUpperLimit|TotalTechnologyModelPeriodActivityUpperLimit)$/;
    for (const [key, L] of valueIssues()) {
      const [kd, code] = key.includes(':') ? key.split(/:(.*)/s) : ['all', null],
        byP = new Map();
      for (const x of L) {
        const c = x.msg.startsWith('not a number') ? 'NONFIN' : x.msg.startsWith('negative') ? (OWN.test(x.p) ? null : 'NEGVAL') : 'SHARE1';
        if (!c) continue;
        const k = c + '|' + x.p;
        if (!byP.has(k)) byP.set(k, []);
        byP.get(k).push(x);
      }
      for (const [k, X] of byP) {
        const [c, p] = k.split('|'),
          d = dimsOf(p),
          rp = d.indexOf('REGION'),
          r = rp >= 0 ? X[0].idx[rp] : 'all';
        const ex =
          X.slice(0, 3)
            .map(
              x => `[${x.idx.join(', ')}] = ${(M.D.params[p].recs.find(rr => rr.idx.map(String).join('|') === x.idx.join('|')) || {}).v}`
            )
            .join('; ') + (X.length > 3 ? ` … (${X.length} values)` : '');
        const o = {
          d: ex,
          go: [p, X[0].idx],
          ...(kd === 'tech'
            ? {t: code}
            : kd === 'comm'
              ? {f: code}
              : kd === 'udc'
                ? {u: code}
                : kd === 'stor' || kd === 'emi'
                  ? {s: code}
                  : {})
        };
        if (c === 'NONFIN')
          add('error', 'NONFIN', `Values that are not numbers in ${p}`, r, {
            ...o,
            fix: 'NaN, Inf or text cannot be solved: type a number or clear the cell (back to the default).'
          });
        else if (c === 'NEGVAL')
          add('warn', 'NEGVAL', `Negative values in ${p}`, r, {
            ...o,
            fix: 'This parameter is normally ≥ 0. Check the sign (a paste from Excel, a formula that crossed 0).'
          });
        else
          add('warn', 'SHARE1', `Shares above 1 in ${p}`, r, {
            ...o,
            fix: 'This parameter is a share between 0 and 1 (a percentage given as 85 instead of 0.85?).'
          });
      }
    }
  }
  // data made for the master model before 0.7: its earlier budget / FDI / borrowing / fund values are no longer read
  if ((++CKN & 3) === 0) yield;
  if (SCHEMA && SCHEMA.params.has('FinanceAvailable') && !SCHEMA.params.has('BudgetBaseline')) {
    const lg = LEGACY_FIN.filter(p => M.D.params[p] && M.D.params[p].recs.length);
    if (lg.length)
      add('error', 'FINLEGACY', 'Finance data of the master model before 0.7, no longer read', null, {
        d: `${lg.join(', ')}: the earlier budget / FDI / borrowing / fund was replaced by the finance sources in 0.7; these values are not used`,
        fix: 'Cases → "Convert for the master model": the values become finance sources (same objective).'
      });
  }
  const FIN = M.S.FINANCE || [];
  if ((++CKN & 3) === 0) yield;
  if (FIN.length && has('FinanceType'))
    for (const r of R) {
      if (has('FinanceRegion') && (g('FinanceRegion', r) ?? 1) !== 1) continue;
      const typ = fs => g('FinanceType', fs) ?? 1;
      for (const fs of FIN)
        if (![1, 2, 3, 4, 5].includes(typ(fs)) && r === R[0])
          add('error', 'FINTYPE', 'Unknown type of finance source', null, {
            d: `${fs}: FinanceType ${typ(fs)} (1 budget, 2 debt, 3 equity, 4 grant, 5 regional fund)`,
            fix: 'Give a type from 1 to 5.'
          });
      for (const y of Y) {
        const sh = FIN.filter(fs => typ(fs) === 1 || typ(fs) === 5).reduce((a, fs) => a + (g('FinanceRentShare', r, fs, y) || 0), 0);
        if (sh > 1 + 1e-9)
          add('error', 'FINRENT', 'More than the whole export margin given to the budget and the funds', r, {
            y,
            d: `Σ FinanceRentShare of the budget and fund sources = ${fmt(sh)} > 1`,
            fix: 'The shares of the margin must add up to 1 at most.'
          });
      }
      for (const t of T) {
        let smin = 0;
        for (const fs of FIN) {
          if ((g('FinanceEligible', r, fs, t) ?? 1) <= 0) continue;
          const lo = g('FinanceMinShare', r, fs, t) || 0,
            hi = g('FinanceMaxShare', r, fs, t) ?? 1;
          smin += lo;
          if (lo > hi + 1e-9)
            add('error', 'FINMINSH', 'Smallest share of a project above the largest', r, {
              t,
              d: `${fs}: FinanceMinShare ${fmt(lo)} > FinanceMaxShare ${fmt(hi)}`,
              fix: 'Make the minimum ≤ the maximum.'
            });
        }
        if (smin > 1 + 1e-9)
          add('error', 'FINMINSH', 'The minimum shares of the sources add up to more than a whole project', r, {
            t,
            d: `${t}: Σ FinanceMinShare = ${fmt(smin)} > 1`,
            fix: 'Lower the minimum shares.'
          });
      }
      for (const fs of FIN)
        if (
          typ(fs) === 5 &&
          r === R[0] &&
          !R.some(rr => Y.some(y => (g('FinanceAvailable', rr, fs, y) || 0) > 0 || (g('FinanceRentShare', rr, fs, y) || 0) > 0))
        )
          add('warn', 'FINFUND', 'A regional fund nobody pays into', null, {
            d: `${fs}: FinanceAvailable and FinanceRentShare are 0 in every region: its pool is always empty`,
            fix: 'Give the regions a contribution, or remove the fund.'
          });
      for (const fs of FIN) {
        let sumMin = 0;
        for (const y of Y) {
          const mn = g('FinanceMin', r, fs, y) || 0,
            av = g('FinanceAvailable', r, fs, y) || 0;
          sumMin += mn;
          if (typ(fs) !== 1 && typ(fs) !== 5 && mn > av + tol(mn))
            add('error', 'FINMIN', 'Committed money above what the source has', r, {
              y,
              d: `${fs}: FinanceMin ${fmt(mn)} > FinanceAvailable ${fmt(av)}`,
              fix: 'Make FinanceMin ≤ FinanceAvailable.'
            });
        }
        const cm = g('FinanceCumulativeMax', r, fs) || 0;
        if (cm > 0 && sumMin > cm + tol(sumMin))
          add('error', 'FINMIN', 'Committed money above the envelope of the source', r, {
            d: `${fs}: Σ FinanceMin ${fmt(sumMin)} > FinanceCumulativeMax ${fmt(cm)}`,
            fix: 'Lower the commitments or raise the envelope.'
          });
      }
      for (const y of Y) {
        let need = 0,
          cap = 0,
          open = false;
        for (const fs of FIN) {
          if (typ(fs) === 1) {
            cap += g('FinanceAvailable', r, fs, y) || 0;
            if ((g('FinanceRentShare', r, fs, y) || 0) > 0) open = true;
          } else if (typ(fs) === 5) open = true;
          else cap += g('FinanceAvailable', r, fs, y) || 0;
        }
        if ((g('FinanceBudgetSavings', r) || 0) > 0 || (g('FinanceBudgetInitialSavings', r) || 0) > 0) open = true;
        for (const t of T) {
          const mi = g('TotalAnnualMinCapacityInvestment', r, t, y) || 0,
            cc = Math.max(0, g('CapitalCost', r, t, y) || 0);
          if (!(mi > 0 && cc > 0)) continue;
          need += mi * cc;
          const el = FIN.filter(fs => (g('FinanceEligible', r, fs, t) ?? 1) > 0);
          if (!el.length)
            add('error', 'FINELIG', 'Committed investment with no eligible finance source', r, {
              t,
              y,
              d: `${t} must build ${fmt(mi)} but no source of FINANCE may finance it (FinanceEligible = 0 for all)`,
              fix: 'Make a source eligible or remove the committed investment.'
            });
          else {
            const shr = el.reduce((a, fs) => a + Math.min(1, g('FinanceMaxShare', r, fs, t) ?? 1), 0);
            if (shr < 1 - 1e-9)
              add('error', 'FINSHARE', 'The eligible sources cannot cover a whole project', r, {
                t,
                y,
                d: `${t}: Σ FinanceMaxShare of the eligible sources = ${fmt(shr)} < 1`,
                fix: 'Raise a FinanceMaxShare or make another source eligible.'
              });
          }
        }
        if (!open && need > cap + tol(need))
          add('error', 'FINCAP', 'Committed investment above the money of the finance sources', r, {
            y,
            d: `minimum new capacity × CapitalCost = ${fmt(need)} > Σ FinanceAvailable = ${fmt(cap)}`,
            fix: 'Raise FinanceAvailable or lower the committed investment.'
          });
      }
      // a technology that no source may finance can never be built
      for (const t of T)
        if (
          Y.some(y => (g('CapitalCost', r, t, y) || 0) > 0) &&
          !FIN.some(fs => (g('FinanceEligible', r, fs, t) ?? 1) > 0) &&
          Y.some(y => bounds(r, t, y).capMax > (g('ResidualCapacity', r, t, y) || 0))
        )
          add('info', 'FINNONE', 'Technology that no finance source may pay for', r, {
            t,
            d: `${t} has a capital cost but FinanceEligible = 0 for every source: it can never be built`,
            fix: 'Harmless if intended.'
          });
    }
  // unit commitment: times longer than the representative period
  if ((++CKN & 3) === 0) yield;
  if (has('UnitCommitment') && has('TimesliceHours')) {
    const gh = new Map();
    for (const l of TS) {
      const gg = g('TimesliceGroup', l) || 0;
      gh.set(gg, (gh.get(gg) || 0) + (g('TimesliceHours', l) || 0));
    }
    for (const x of recs('UnitCommitment'))
      if (Number(x.v) === 1) {
        const [r, t] = x.idx,
          H = Math.max(0, ...[...gh].filter(([k]) => k > 0).map(([, v]) => v));
        for (const p of ['MinUpTime', 'MinDownTime']) {
          const v = g(p, r, t) || 0;
          if (H > 0 && v >= H)
            add('warn', 'UCTIME', `${p} as long as the representative period`, r, {
              t,
              d: `${p} ${fmt(v)} h ≥ ${fmt(H)} h of the group: in a cyclic day the unit can then never stop (or never restart)`,
              fix: 'Use times shorter than the representative period, or longer periods (typical weeks).'
            });
        }
      }
  }
  // E8b sums RegionalAnnualEmissionLimit over the regions: a sum of 0 forbids every emission of every region
  if ((++CKN & 3) === 0) yield;
  if (SCHEMA.params.has('RegionalAnnualEmissionLimit'))
    for (const e of M.S.EMISSION || []) {
      if (!(P.EmissionActivityRatio || {recs: []}).recs.some(x => x.idx[2] === e && x.v > 0)) continue;
      const z = Y.filter(y => R.reduce((a, r) => a + lim(g('RegionalAnnualEmissionLimit', r, e, y)), 0) <= 0);
      if (z.length)
        add('error', 'EMI0', `RegionalAnnualEmissionLimit of ${e} adds up to 0`, 'all', {
          y: z[0],
          d: `Σ over the regions = 0 in ${z.length} year(s), while technologies emit ${e}: the model is infeasible as soon as an emitting technology must run`,
          fix: 'The regional cap is the SUM over the regions: put the cap (or a large value such as 999999 for no cap) on one region. The default of this parameter must not be 0.'
        });
    }
  if ((++CKN & 3) === 0) yield;
  if (typeof VINT !== 'undefined' && VINT.on() && SCHEMA.params.has('ResidualCapacityByVintage'))
    for (const t of VINT.vtechs(null))
      for (const r of R) {
        const coh = (P.ResidualCapacityByVintage || {recs: []}).recs.filter(x => x.idx[0] === r && x.idx[1] === t && x.v);
        const life = g('OperationalLife', r, t) ?? 1;
        for (const y of Y) {
          const sv = coh.filter(x => +x.idx[2] <= y && y - +x.idx[2] < life).reduce((a, x) => a + Number(x.v), 0),
            rc = g('ResidualCapacity', r, t, y) || 0;
          if (Math.abs(sv - rc) > 1e-6 * Math.max(1, rc))
            add('error', 'VINTRES', 'Existing capacity by vintage does not add up to ResidualCapacity', r, {
              t,
              y,
              d: `cohorts alive ${fmt(sv)} ≠ ResidualCapacity ${fmt(rc)}`,
              fix: `With VintageMode 1 or 2 the model is infeasible unless Σ ResidualCapacityByVintage of the cohorts still alive (vintage ≤ year < vintage + ${fmt(life)}) = ResidualCapacity in every year. Fix one of the two, or use “Vintages from ResidualCapacity” (splits the existing capacity into cohorts: a fall in year y is a cohort built in y - life) or “ResidualCapacity from the vintages” in the ResidualCapacityByVintage grid of the technology.`
            });
        }
      }
  // ---- MASTER [1]: a seasonal profile should average 1 over the year (YearSplit-weighted), so the annual ratio keeps its meaning
  if ((++CKN & 3) === 0) yield;
  if (SCHEMA && SCHEMA.params.has('ProfileIAR')) {
    const season = {};
    for (const x of (P.Conversionls || {recs: []}).recs) if (Number(x.v) === 1) season[String(x.idx[0])] = String(x.idx[1]);
    for (const [PP, SP, RN] of [
      ['ProfileIAR', 'SeasonProfileIAR', 'InputActivityRatio'],
      ['ProfileOAR', 'SeasonProfileOAR', 'OutputActivityRatio']
    ]) {
      const keys = new Set();
      for (const x of [...(P[PP] || {recs: []}).recs, ...(P[SP] || {recs: []}).recs])
        keys.add([x.idx[0], x.idx[1], x.idx[2], x.idx[3], x.idx[5]].join('|'));
      for (const k of keys) {
        const [r, t, f, m, y] = k.split('|');
        let s = 0,
          w = 0;
        for (const l of TS) {
          const yl = g('YearSplit', l, y) || 0,
            a = g(PP, r, t, f, m, l, y),
            b = season[String(l)] !== undefined ? g(SP, r, t, f, m, season[String(l)], y) : 1;
          s += yl * (a === undefined ? 1 : a) * (b === undefined ? 1 : b);
          w += yl;
        }
        const mean = w ? s / w : 1;
        if (Math.abs(mean - 1) > 1e-3)
          add('warn', 'PROFAVG', `Seasonal ${PP.endsWith('IAR') ? 'input' : 'output'} profile does not average 1`, r, {
            t,
            f,
            y: +y,
            d: `${RN} ${f} mode ${m}: YearSplit-weighted mean of the profile = ${fmt(mean)}, so the yearly ${PP.endsWith('IAR') ? 'input' : 'output'} is ${fmt(mean)} x the annual ratio`,
            fix: `Scale the profile so it averages 1 (then the annual ratio is the yearly ratio), or keep it on purpose.`
          });
      }
    }
  }
  // ---- MASTER [4]/[5]: a chronological storage needs every time slice ordered (group, position, hours)
  if ((++CKN & 3) === 0) yield;
  if (SCHEMA && SCHEMA.params.has('StorageChronological') && (P.StorageChronological || {recs: []}).recs.some(x => Number(x.v) === 1)) {
    const miss = TS.filter(l => !(g('TimesliceGroup', l) > 0 && g('TimesliceOrder', l) > 0 && g('TimesliceHours', l) > 0));
    if (miss.length)
      add('error', 'TSORDER', 'Chronological storage without the order of the time slices', 'all', {
        d: `no group / position / hours for ${miss.slice(0, 6).join(', ')}${miss.length > 6 ? '…' : ''}`,
        fix: 'Give TimesliceGroup, TimesliceOrder and TimesliceHours for every time slice (Model settings), or set StorageChronological to 0.'
      });
  }
  // ---- MASTER [6]: unit commitment needs the order of the time slices; minimum stable load within 0-1; integer needs a unit size
  if ((++CKN & 3) === 0) yield;
  if (SCHEMA && SCHEMA.params.has('UnitCommitment') && (P.UnitCommitment || {recs: []}).recs.some(x => Number(x.v) === 1)) {
    const uc = P.UnitCommitment.recs.filter(x => Number(x.v) === 1).map(x => x.idx.map(String));
    const miss = TS.filter(l => !(g('TimesliceGroup', l) > 0 && g('TimesliceOrder', l) > 0 && g('TimesliceHours', l) > 0));
    if (miss.length)
      add('error', 'UCORDER', 'Unit commitment without the order of the time slices', 'all', {
        t: uc[0][1],
        d: `${uc.length} technolog${uc.length > 1 ? 'ies' : 'y'} with UnitCommitment = 1; no group / position / hours for ${miss.slice(0, 6).join(', ')}${miss.length > 6 ? '…' : ''}`,
        fix: 'Give TimesliceGroup, TimesliceOrder and TimesliceHours for every time slice (Model settings), or set UnitCommitment to 0.'
      });
    for (const [r, t] of uc) {
      const ms = g('MinStableLoad', r, t) || 0;
      if (ms < 0 || ms > 1)
        add('error', 'UCMIN', 'Minimum stable load outside 0-1', r, {
          t,
          d: `MinStableLoad ${fmt(ms)}`,
          fix: 'Give a share between 0 and 1.'
        });
      if (Number(g('UnitCommitmentInteger', r, t) || 0) === 1)
        for (const y of Y)
          if (!((g('CapacityOfOneTechnologyUnit', r, t, y) || 0) > 0))
            add('error', 'UCUNIT', 'Integer unit commitment without a unit size', r, {
              t,
              y: +y,
              d: 'UnitCommitmentInteger = 1 but CapacityOfOneTechnologyUnit is 0',
              fix: 'Give the size of one unit (CapacityOfOneTechnologyUnit) or set UnitCommitmentInteger to 0.'
            });
    }
  }
  // ---- MASTER [L]: linked ratios - the model refuses data that breaks these
  if ((++CKN & 3) === 0) yield;
  if (SCHEMA && SCHEMA.params.has('LinkTarget') && (P.LinkTarget || {recs: []}).recs.some(x => Number(x.v) > 0)) {
    const LT = new Map((P.LinkTarget.recs || []).filter(x => Number(x.v) > 0).map(x => [x.idx.map(String).join('|'), Number(x.v)]));
    const LF = (P.LinkFrom || {recs: []}).recs.filter(x => Number(x.v) !== 0);
    for (const [k, kind] of LT) {
      const [r, t, f, m] = k.split('|');
      const src = LF.filter(x => x.idx.slice(0, 4).map(String).join('|') === k);
      const sk = Number(g('LinkSourceKind', r, t, f, m) ?? 2),
        what = kind === 1 ? 'input' : 'output';
      if (kind !== 1 && kind !== 2) {
        add('error', 'LINK', 'Linked ratio: unknown kind', r, {
          t,
          f,
          d: `${t} ${f} mode ${m}: LinkTarget ${kind}`,
          fix: 'Use 1 (the input ratio is linked) or 2 (the output ratio).'
        });
        continue;
      }
      if (!src.length)
        add('error', 'LINK', 'Linked ratio without a source', r, {
          t,
          f,
          d: `${t} ${f} mode ${m}: its ${what} ratio is linked (LinkTarget ${kind}) but no LinkFrom is given`,
          fix: 'Give LinkFrom (factor) for the source technology, commodity and mode, or set LinkTarget to 0.'
        });
      for (const y of Y)
        if (!(g(kind === 1 ? 'InputActivityRatio' : 'OutputActivityRatio', r, t, f, m, y) || 0)) {
          add('error', 'LINK', `Linked ${what} ratio missing in the data`, r, {
            t,
            f,
            y,
            d: `${t} ${f} mode ${m}: the ${what} ratio is 0 in ${y}, so the flow does not exist in the model`,
            fix: 'Give a non-zero ratio (any value, e.g. 1: it is replaced where linked).'
          });
          break;
        }
      for (const x of src) {
        const [, , , , ts, fs, ms] = x.idx.map(String);
        if (LT.get([r, ts, fs, ms].join('|')) === sk)
          add('error', 'LINK', 'Linked ratio: the source is itself linked', r, {
            t,
            f,
            d: `${t} ${f} mode ${m} follows the ${sk === 1 ? 'input' : 'output'} ratio of ${ts} ${fs} mode ${ms}, which is itself linked`,
            fix: 'Link to the original source (one level of links).'
          });
      }
    }
  }
  // ---- MASTER [K]: construction lead time - the model refuses data that breaks these; committed capacity in the first years conflicts with CON1
  if (SCHEMA && SCHEMA.params.has('ConstructionYears')) {
    const y0 = Math.min(...Y.map(Number));
    for (const [pL, pS, pMin, kind, setName] of [
      ['ConstructionYears', 'CapitalSpendProfile', 'TotalAnnualMinCapacityInvestment', 'technology', 'TECHNOLOGY'],
      ['ConstructionYearsStorage', 'CapitalSpendProfileStorage', null, 'storage', 'STORAGE']
    ]) {
      for (const x of (P[pL] || {recs: []}).recs) {
        const L = Number(x.v);
        if (!(L > 0)) continue;
        const [r, t] = x.idx.map(String);
        if (L !== Math.round(L) || L > 20)
          add('error', 'CONSTRUCT', 'Construction time: whole number of years (1-20)', r, {
            t,
            d: `${t}: ${pL} = ${fmt(L)}`,
            fix: 'Give the number of construction years before the capacity comes online, e.g. 3 for a CCGT.'
          });
        const sh = (P[pS] || {recs: []}).recs.filter(z => String(z.idx[0]) === r && String(z.idx[1]) === t);
        if (sh.some(z => Number(z.idx[2]) > L && Number(z.v) !== 0))
          add('error', 'CONSTRUCT', 'Construction time: spending share after the last construction year', r, {
            t,
            d: `${t}: ${pS} given for a year k > ${L}`,
            fix: `k = 1 is the first construction year, k = ${L} the year before the capacity is online.`
          });
        if (sh.some(z => Number(z.v) < 0))
          add('error', 'CONSTRUCT', 'Construction time: negative spending share', r, {
            t,
            d: `${t}: ${pS} < 0`,
            fix: 'Shares are normalised to 1; give positive weights or none (equal shares).'
          });
        {
          const w = [];
          for (let k = 1; k <= L; k++) {
            const z = sh.find(q => Number(q.idx[2]) === k);
            w.push(z ? Number(z.v) : 0);
          }
          const tot = w.reduce((a, b) => a + b, 0);
          if (tot > 0 && w.every(v => v >= 0) && Math.abs(tot - 1) > 1e-9 && Math.abs(tot - 100) > 1e-9)
            add('info', 'CONSTRUCT', 'Construction time: spending weights normalised to shares', r, {
              t,
              d: `${t}: ${pS} ${w.map(v => fmt(v)).join(' / ')} (sum ${fmt(tot)}) is used as ${w.map(v => ((100 * v) / tot).toFixed(1) + ' %').join(' / ')}`,
              fix: 'Nothing to do if these are the shares you want; otherwise correct the weights.'
            });
        }
        const early = pMin ? Y.filter(y => Number(y) < y0 + L && (g(pMin, r, t, y) || 0) > 0) : [];
        if (early.length)
          add('error', 'CONSTRUCT', 'Construction time: new capacity required before it can be built', r, {
            t,
            y: early[0],
            d: `${t}: ${pMin} > 0 in ${early.join(', ')}, but with ${L} construction years nothing can come online before ${y0 + L} (CON1)`,
            fix: 'Give projects already under construction as ResidualCapacity, or move the minimum investment later.'
          });
      }
    }
    // MaxUnderConstruction: -1 (no limit) or >= 0; only used with construction years
    for (const [pM, pL] of [
      ['MaxUnderConstruction', 'ConstructionYears'],
      ['MaxUnderConstructionStorage', 'ConstructionYearsStorage']
    ]) {
      const seen = new Set();
      for (const x of (P[pM] || {recs: []}).recs) {
        const v = Number(x.v),
          [r, t, y] = x.idx.map(String),
          k = r + '|' + t;
        if (v < 0 && v !== -1)
          add('error', 'CONSTRUCT', 'Capacity under construction: negative limit', r, {
            t,
            y,
            d: `${t}: ${pM} = ${fmt(v)} in ${y}`,
            fix: 'Give the most capacity under construction at once (>= 0), or -1 for no limit.'
          });
        else if (v >= 0 && !seen.has(k) && !((g(pL, r, t) || 0) > 0)) {
          seen.add(k);
          add('warn', 'CONSTRUCT', 'Capacity under construction: limit without construction time', r, {
            t,
            y,
            d: `${t}: ${pM} is given but ${pL} is 0, so the limit is not used`,
            fix: `Give ${pL} (the construction years), or remove the limit.`
          });
        }
      }
    }
  }
  // ---- MASTER [F]: FlatActivity is a switch; a FLAT-like user constraint (activity >= ~capacity) on the same technology is a must-run on top
  if (SCHEMA && SCHEMA.params.has('FlatActivity')) {
    const on = new Set();
    for (const x of (P.FlatActivity || {recs: []}).recs) {
      const v = Number(x.v),
        [r, t] = x.idx.map(String);
      if (v !== 0 && v !== 1)
        add('error', 'FLAT', 'Flat activity: not a switch', r, {
          t,
          d: `${t}: FlatActivity = ${fmt(v)}`,
          fix: 'Give 1 (flat, the same rate in every time slice) or 0 (no rule).'
        });
      else if (v === 1) on.add(r + '|' + t);
    }
    if (on.size) {
      const act = new Map();
      for (const x of (P.UDCMultiplierActivity || {recs: []}).recs) {
        const [r, t, u] = x.idx.map(String);
        if (Number(x.v) < 0) act.set(r + '|' + t + '|' + u, 1);
      }
      const seen = new Set();
      for (const x of (P.UDCMultiplierTotalCapacity || {recs: []}).recs) {
        const [r, t, u, y] = x.idx.map(String),
          k = r + '|' + t;
        if (!on.has(k) || !(Number(x.v) > 0) || !act.has(k + '|' + u) || seen.has(k + '|' + u)) continue;
        seen.add(k + '|' + u);
        add('warn', 'FLAT', 'Flat activity and a must-run user constraint', r, {
          t,
          y,
          d: `${t}: FlatActivity = 1 and the user constraint ${u} (capacity x ${fmt(Number(x.v))} - activity <= ...) forces the use of the capacity`,
          fix: `FlatActivity already makes the profile flat: remove ${t} from ${u} (or the whole constraint) to drop the must-run, e.g. for a rolling horizon.`
        });
      }
    }
  }
  // ---- MASTER [Y]: the chosen yield method needs its Ky (otherwise F = 1 in every year)
  if (SCHEMA && SCHEMA.params.has('YieldResponse')) {
    const seen = new Set();
    for (const x of (P.YieldResponse || {recs: []}).recs) {
      const v = Number(x.v);
      if (!(v > 0)) continue;
      const [r, t] = x.idx.map(String),
        k = r + '|' + t + '|' + v;
      if (seen.has(k)) continue;
      seen.add(k);
      const ky =
        v === 2
          ? (P.YieldKy || {recs: []}).recs.filter(z => String(z.idx[0]) === r && String(z.idx[1]) === t).some(z => Number(z.v) > 0)
          : (g('YieldKySeason', r, t) || 0) > 0;
      if (!ky)
        add('warn', 'YIELD', 'Yield response without Ky', r, {
          t,
          d: `${t}: YieldResponse ${v} (${v === 2 ? 'by stage' : 'whole season'}) but ${v === 2 ? 'every YieldKy' : 'YieldKySeason'} is 0, so the yield factor is 1 in every year`,
          fix: v === 2 ? 'Give the Ky of the stages (FAO-33 placed on the 4 FAO-56 stages).' : 'Give the seasonal Ky (FAO-33).'
        });
    }
  }
  // ---- MASTER [9]: water cascade of the land uses - the model refuses data that breaks these
  if ((++CKN & 3) === 0) yield;
  if (SCHEMA && SCHEMA.params.has('CascadeRule') && (P.CascadeRule || {recs: []}).recs.some(x => Number(x.v) > 0)) {
    const land = new Map();
    for (const x of P.CascadeRule.recs) {
      const ru = Number(x.v);
      if (!(ru > 0)) continue;
      const [r, t, f, m] = x.idx.map(String);
      const k = [r, t, m].join('|');
      if (!land.has(k)) land.set(k, []);
      land.get(k).push([f, ru]);
    }
    const SEAS = [...new Set((P.Conversionls || {recs: []}).recs.filter(x => Number(x.v) === 1).map(x => String(x.idx[1])))];
    const drv = (P.WaterDriverFuel || {recs: []}).recs.filter(x => Number(x.v) === 1).map(x => String(x.idx[0]));
    for (const [k, rows] of land) {
      const [r, t, m] = k.split('|');
      if (rows.filter(([, ru]) => ru === 4).length > 1)
        add('error', 'CASCADE', 'Water cascade: more than one remainder output', r, {
          t,
          d: `${t} mode ${m}: ${rows
            .filter(([, ru]) => ru === 4)
            .map(([f]) => f)
            .join(', ')} are all rule 4`,
          fix: 'Keep one remainder (rule 4) per land use and mode; give the others a share or an amount.'
        });
      if (rows.some(([, ru]) => ru > 8))
        add('error', 'CASCADE', 'Water cascade: unknown rule', r, {
          t,
          d: `${t} mode ${m}: CascadeRule must be 0-8`,
          fix: 'Use 1 share, 2 amount, 3 Kc x ET0, 4 remainder, 5 share of the excess over ET; or the soil bucket: 6 runoff, 7 evapotranspiration (alpha x ET0), 8 drainage.'
        });
      const buck = rows.some(([, ru]) => ru >= 6);
      if (buck) {
        const n = q => rows.filter(([, ru]) => ru === q).length;
        if (n(7) !== 1 || n(8) !== 1 || n(6) > 1 || rows.some(([, ru]) => ru <= 5))
          add('error', 'BUCKET', 'Soil bucket: wrong set of outputs', r, {
            t,
            d: `${t} mode ${m}: needs exactly one rule 7 (evapotranspiration) and one rule 8 (drainage), at most one rule 6 (runoff), and no rules 1-5`,
            fix: 'Give the land use rule 6 on its runoff commodity, 7 on its evapotranspiration commodity and 8 on its recharge (or outflow) commodity.'
          });
        const smax = g('CascadeSoilMax', r, t, m) || 0,
          fd = g('CascadeSoilDrain', r, t, m) || 0,
          st = g('CascadeSoilStart', r, t, m) ?? -1;
        if (smax < 0 || fd < 0 || fd > 1)
          add('error', 'BUCKET', 'Soil bucket: store or drainage share out of range', r, {
            t,
            d: `${t} mode ${m}: CascadeSoilMax ${fmt(smax)}, CascadeSoilDrain ${fmt(fd)}`,
            fix: 'The store must be >= 0 (same unit as WaterDriverDepth) and the drainage share between 0 and 1.'
          });
        if (st > smax + 1e-12)
          add('error', 'BUCKET', 'Soil bucket: soil start above the store', r, {
            t,
            d: `${t} mode ${m}: CascadeSoilStart ${fmt(st)} > CascadeSoilMax ${fmt(smax)}`,
            fix: 'Give a start within the store, or -1 for the cyclic year.'
          });
      }
      for (const y of Y) {
        const nd = drv.filter(f => (g('InputActivityRatio', r, t, f, m, y) || 0) !== 0).length;
        if (nd !== 1)
          add('error', 'CASCADE', 'Water cascade: the land use must take exactly one precipitation commodity', r, {
            t,
            y,
            d: `${t} mode ${m}: ${nd} driver commodities with a non-zero InputActivityRatio (WaterDriverFuel = 1)`,
            fix: 'Mark the precipitation commodity with WaterDriverFuel = 1 and give the land use a non-zero InputActivityRatio for it (any value: the model replaces it).'
          });
        for (const [f] of rows)
          if (!(g('OutputActivityRatio', r, t, f, m, y) || 0))
            add('error', 'CASCADE', 'Water cascade: linked output without a ratio in the data', r, {
              t,
              f,
              y,
              d: `${t} mode ${m} -> ${f}: OutputActivityRatio is 0, so the flow does not exist in the model`,
              fix: 'Give a non-zero OutputActivityRatio (any value, e.g. 1: the model replaces it).'
            });
        for (const ls of SEAS) {
          const Pp = g('WaterDriverDepth', r, ls, y) || 0,
            E0 = g('ReferenceET', r, ls, y) || 0,
            sh = f => g('CascadeShare', r, t, f, m, ls, y) || 0;
          const et = rows.filter(([, ru]) => ru === 2 || ru === 3).reduce((a, [f, ru]) => a + Math.min(Pp, (ru === 2 ? 1 : E0) * sh(f)), 0);
          let sum = 0;
          for (const [f, ru] of rows) {
            if ((ru === 1 || ru === 5 || ru === 6) && (sh(f) < 0 || sh(f) > 1))
              add('error', 'CASCADE', 'Water cascade: share outside 0-1', r, {
                t,
                f,
                y: +y,
                d: `${t} mode ${m} -> ${f}, season ${ls}: share ${fmt(sh(f))}`,
                fix: 'Give a share between 0 and 1.'
              });
            sum +=
              ru === 1
                ? sh(f) * Pp
                : ru === 2
                  ? Math.min(Pp, sh(f))
                  : ru === 3
                    ? Math.min(Pp, sh(f) * E0)
                    : ru === 5
                      ? sh(f) * Math.max(0, Pp - et)
                      : 0;
          }
          if (!buck && sum > Pp * (1 + 1e-9) + 1e-12)
            add('error', 'CASCADE', 'Water cascade: outputs above the precipitation', r, {
              t,
              y: +y,
              s: 'season ' + ls,
              d: `${t} mode ${m}, season ${ls}: outputs ${fmt(sum)} > precipitation ${fmt(Pp)}`,
              fix: 'Lower the shares or amounts so that, with the precipitation of that season, they do not exceed it (the remainder would be negative).'
            });
        }
      }
    }
  }
  // ---- MASTER [4]: an ordered slice's YearSplit must match its hours (YearSplit = repeats of its group x hours / 8760)
  if ((++CKN & 3) === 0) yield;
  if (SCHEMA && SCHEMA.params.has('TimesliceGroup') && TS.some(l => g('TimesliceGroup', l) > 0)) {
    const grpOf = l => g('TimesliceGroup', l) || 0;
    for (const y of M.years) {
      const sum = {},
        hrs = {};
      for (const l of TS) {
        const k = grpOf(l);
        if (!(k > 0)) continue;
        sum[k] = (sum[k] || 0) + (g('YearSplit', l, y) || 0);
        hrs[k] = (hrs[k] || 0) + (g('TimesliceHours', l) || 0);
      }
      for (const l of TS) {
        const k = grpOf(l),
          h = g('TimesliceHours', l) || 0;
        if (!(k > 0) || !(h > 0) || !(hrs[k] > 0)) continue;
        const ys = g('YearSplit', l, y) || 0,
          want = (sum[k] * h) / hrs[k];
        if (Math.abs(ys - want) > 1e-3 * ys + 1e-12)
          add('error', 'TSHOURS', 'YearSplit does not match the hours of the time slice', 'all', {
            y: +y,
            s: String(l),
            d: `${l}: YearSplit ${fmt(ys)}, but ${h} h in a group of ${hrs[k]} h repeated ${fmt((sum[k] * 8760) / hrs[k])} times gives ${fmt(want)}`,
            fix: 'Set YearSplit = repeats of the group x TimesliceHours / 8760 (days of the season x share of the day type x hours / 8760), or correct TimesliceHours. The model refuses data where they differ.'
          });
      }
    }
  }
  // group findings that differ only by year
  const grp = new Map();
  if ((++CKN & 3) === 0) yield;
  for (const x of out) {
    const k = [x.sev, x.code, x.r, x.t, x.f, x.u, x.s, x.title].join('|');
    if (!grp.has(k)) grp.set(k, {...x, years: []});
    const gg = grp.get(k);
    if (x.y !== undefined) gg.years.push(x.y);
  }
  const list = [...grp.values()].sort(
    (a, b) =>
      ['error', 'warn', 'info'].indexOf(a.sev) - ['error', 'warn', 'info'].indexOf(b.sev) ||
      String(a.r).localeCompare(String(b.r)) ||
      a.code.localeCompare(b.code)
  );
  CHECK = {
    list,
    n: {
      error: list.filter(x => x.sev === 'error').length,
      warn: list.filter(x => x.sev === 'warn').length,
      info: list.filter(x => x.sev === 'info').length
    },
    bad: new Set(list.filter(x => x.sev === 'error' && x.t).map(x => x.r + '|' + x.t))
  };
  const b = document.getElementById('chk');
  b.innerHTML =
    'Check' +
    (CHECK.n.error
      ? ` <span class="badge err">${CHECK.n.error}</span>`
      : CHECK.n.warn
        ? ` <span class="badge wrn">${CHECK.n.warn}</span>`
        : ' <span class="badge okb">✓</span>');
  return CHECK;
}
const yrs = a => {
  if (!a.length) return '';
  a = [...new Set(a)].sort((x, y) => x - y);
  const s = [];
  let i = 0;
  while (i < a.length) {
    let j = i;
    while (j + 1 < a.length && M.years.indexOf(a[j + 1]) === M.years.indexOf(a[j]) + 1) j++;
    s.push(j > i ? `${a[i]}–${a[j]}` : `${a[i]}`);
    i = j + 1;
  }
  return s.join(', ');
};
const CKF = {sev: null, code: null, q: ''};
function openChecks() {
  const C = CHECK || runChecks();
  tables = [];
  const sevl = {error: 'Infeasible', warn: 'Warning', info: 'Note'};
  const item = x => `<div class="ck ${x.sev}"><div class="ck-h"><span class="sev ${x.sev}">${sevl[x.sev]}</span><b>${esc(x.title)}</b></div>
    <div class="ck-w">${esc(x.r === 'all' || x.r === 'all regions' ? 'all regions' : RNAME[x.r] === x.r ? x.r : RNAME[x.r] + ' (' + x.r + ')')}${x.t ? ` · <a href="#" data-t="${esc(x.t)}" data-r="${esc(x.r)}">${esc(x.t)}</a>` : ''}${x.f ? ` · <a href="#" data-f="${esc(x.f)}" data-r="${esc(x.r)}">${esc(x.f)}</a>` : ''}${x.u ? ' · ' + esc(x.u) : ''}${x.s ? ' · ' + esc(x.s) : ''}${x.years.length ? ' · <span class="yy">' + yrs(x.years) + '</span>' : ''}</div>
    ${x.go ? `<div class="ck-go"><a href="#" data-gp="${esc(x.go[0])}" data-gi="${esc(JSON.stringify(x.go[1]))}">→ go to the cell</a></div>` : ''}<div class="ck-d">${esc(x.d)}${x.years.length > 1 ? ' <span class="muted">(first year shown)</span>' : ''}</div><div class="ck-f">${esc(x.fix)}</div></div>`;
  // filters
  const keep = x =>
    (!CKF.sev || x.sev === CKF.sev) &&
    (!CKF.code || x.code === CKF.code) &&
    (!CKF.q || [x.title, x.d, x.fix, x.t, x.f, x.u, x.s, x.r, x.code].join(' ').toLowerCase().includes(CKF.q.toLowerCase()));
  const sec = (sev, head) => {
    const L = C.list.filter(x => x.sev === sev && keep(x));
    return L.length
      ? `<details ${sev !== 'info' || CKF.sev === 'info' || CKF.code || CKF.q ? 'open' : ''}><summary>${head}<span class="n">${L.length}</span></summary>${L.map(item).join('')}</details>`
      : '';
  };
  const ckList = () => {
    const h = sec('error', 'Infeasible: proved from the data') + sec('warn', 'Warnings') + sec('info', 'Notes');
    return h || `<div class="empty">${C.list.length ? 'No finding with these filters.' : 'Nothing found.'}</div>`;
  };
  const dr = document.getElementById('drawer');
  dr.hidden = false;
  dr.innerHTML = `<div class="dh"><div style="min-width:0"><div class="code">data checks · ${esc(M.meta.name)}</div><h2>${C.n.error ? C.n.error + ' infeasibilit' + (C.n.error > 1 ? 'ies' : 'y') + ' found' : 'No infeasibility found'}</h2>
    <p>${C.n.error ? 'Each item below is proved from the data alone: the model cannot be solved until it is fixed.' : 'No bound in the data contradicts another. This screen cannot see every infeasibility (it checks each limit against the largest values the other limits allow), so a solver can still report one; it removes the common ones before a long run.'}</p></div><button class="btn x" type="button" id="close" aria-label="Close">Close</button></div>
  <div class="db"><div class="chips ckf" role="group" aria-label="Show only">${[
    ['error', 'infeasible', 'bad'],
    ['warn', 'warnings', 'warn'],
    ['info', 'notes', '']
  ]
    .map(
      ([k, l, c]) =>
        `<button type="button" class="chip ${C.n[k] ? c : ''}" data-sev="${k}" aria-pressed="${CKF.sev === k}" title="Show only the ${l} (click again: all)">${l} <b>${C.n[k]}</b></button>`
    )
    .join('')}
    <button class="btn cp" type="button" id="ckcsv" style="padding:4px 8px">Copy CSV</button></div>
    ${(() => {
      const by = {};
      for (const x of C.list) by[x.code] = (by[x.code] || 0) + 1;
      const ks = Object.keys(by).sort();
      return ks.length > 1
        ? `<div class="chips ckc" role="group" aria-label="Type of check">${ks.map(k => `<button type="button" class="chip" data-code="${esc(k)}" aria-pressed="${CKF.code === k}" title="Only the ${esc(k)} checks (click again: all types)">${esc(k)} <b>${by[k]}</b></button>`).join('')}</div>`
        : '';
    })()}
    ${C.list.length > 6 ? `<input type="search" id="ckq" class="ckq" style="display:block;width:100%;max-width:none" placeholder="Search the findings (technology, commodity, text)" value="${esc(CKF.q)}" aria-label="Search the findings">` : ''}
    <div id="cklist">${ckList()}</div>
    <details><summary>What is checked<span class="n">${'15'}</span></summary><div class="pdesc">Capacity: existing ≤ maximum; minimum ≤ maximum; minimum reachable with the build limits over the lifetime. New capacity: minimum ≤ maximum.
    Activity: lower ≤ upper limit; lower limit ≤ capacity × CapacityToActivityUnit × min(AvailabilityFactor, Σ CapacityFactor × YearSplit); model-period limits against the sum of the yearly bounds.
    Demand: a producer or trade route exists; yearly demand ≤ what all producers can supply; demand in each time slice ≤ capacity × capacity factor of the producers in that slice (catches "only solar at night").
    Forced technologies whose input is never produced. User-defined constraints (national and regional forms): smallest / largest possible left-hand side against the constant.
    Emission limits against exogenous emissions and emissions of forced activity. Warnings: YearSplit and demand profiles that do not sum to 1, factors outside 0–1, negative ratios or upper limits, one-way trade routes. Notes: technologies that can never run, storage with no cost.
    Checks that need a bound are skipped where a technology has no upper limit (for example a backstop).</div></details></div>`;
  dr.querySelector('#close').onclick = () => {
    dr.hidden = true;
  };
  dr.querySelectorAll('[data-sev]').forEach(
    b =>
      (b.onclick = () => {
        CKF.sev = CKF.sev === b.dataset.sev ? null : b.dataset.sev;
        openChecks();
      })
  );
  dr.querySelectorAll('[data-code]').forEach(
    b =>
      (b.onclick = () => {
        CKF.code = CKF.code === b.dataset.code ? null : b.dataset.code;
        openChecks();
      })
  );
  {
    const q = dr.querySelector('#ckq');
    if (q)
      q.oninput = () => {
        CKF.q = q.value;
        dr.querySelector('#cklist').innerHTML = ckList();
        wireLinks();
      };
  }
  dr.querySelector('#ckcsv').onclick = () => {
    const rows = [
      ['severity', 'code', 'title', 'region', 'technology', 'commodity', 'constraint', 'years', 'detail', 'fix'],
      ...C.list.map(x => [x.sev, x.code, x.title, x.r, x.t || '', x.f || '', x.u || '', yrs(x.years), x.d, x.fix])
    ]
      .map(r => r.map(v => JSON.stringify(String(v))).join(','))
      .join('\n');
    (navigator.clipboard ? navigator.clipboard.writeText(rows) : Promise.reject())
      .then(() => toast('Copied ' + C.list.length + ' findings as CSV'))
      .catch(() => toast('Copy not allowed here'));
  };
  wireLinks();
  function wireLinks() {
    dr.querySelectorAll('a[data-gp]').forEach(
      a =>
        (a.onclick = ev => {
          ev.preventDefault();
          goToCell(a.dataset.gp, JSON.parse(a.dataset.gi));
        })
    );
    dr.querySelectorAll('a[data-t],a[data-f]').forEach(
      a =>
        (a.onclick = ev => {
          ev.preventDefault();
          const r = a.dataset.r;
          if (REG.includes(r) && state.region !== r) {
            state.region = r;
            document.querySelectorAll('#regions button').forEach(b => b.setAttribute('aria-pressed', (b.dataset.r || b.textContent) === r));
            draw();
            fit();
          }
          if (a.dataset.t) {
            if (!G.T.includes(a.dataset.t)) {
              state.showoff = state.showbs = true;
              document.getElementById('showoff').checked = document.getElementById('showbs').checked = true;
              draw();
              fit();
            }
            openTech(a.dataset.t);
          } else openFuel(a.dataset.f);
        })
    );
  }
}
