'use strict';
/* ============================== families and colours ============================== */
function fam(f) {
  const u = String(f).toUpperCase();
  if (/^H2|HYDROGEN|^HDG/.test(u)) return 'h2';
  if (/^(GASROY|GAS[A-Z]{4}$)/.test(u) && REG.some(r => u.includes(r))) return 'trade';
  if (/^ELC[A-Z]{4}$/.test(u) && !/^ELC00/.test(u) && REG.some(r => u.includes(r))) return 'trade';
  if (u === 'EXPELC') return 'trade';
  if (/^(NG|LNG|NGS|HE$)|GAS/.test(u)) return 'gas';
  if (/OIL|CRU|DSL|DIES|GSL|PETR|HFO|LPG|KER|JET|OILPRD/.test(u)) return 'oil';
  if (/^ELC|ELEC|^EL\d|^ELE/.test(u)) return 'elc';
  if (/COA|COAL|LIG/.test(u)) return 'coal';
  if (/NUC|URN|URA/.test(u)) return 'nuc';
  if (/LND|LAND|CRP|CROP|AGR|FOR|PAS|LIV|FER|IRR|RAIN|PRC|EVT/.test(u)) return 'land';
  if (/SOL|WND|WIN|HYD|BIO|WST|WTR|WAT|GEO|TID|GWT|SWT/.test(u)) return 'ren';
  return 'other';
}
const FAMLAB = {
  gas: 'Gas',
  oil: 'Oil',
  elc: 'Electricity',
  ren: 'Renewable resource / water',
  h2: 'Hydrogen',
  trade: 'Cross-border link',
  nuc: 'Nuclear',
  coal: 'Coal',
  land: 'Land / crops',
  other: 'Other'
};
const fcol = f => (typeof COLORS !== 'undefined' && COLORS[f]) || `var(--f-${fam(f)})`;
const fmark = f => (typeof COLORS !== 'undefined' && COLORS[f] ? 'ar-c-' + String(f).replace(/\W/g, '_') : 'ar-' + fam(f));

/* ============================== RES graph for a region ============================== */
function techActive(t, regs) {
  for (const r of regs) {
    const res = techVals(t, 'ResidualCapacity', r).some(x => x.v > 0);
    const mx = techVals(t, 'TotalAnnualMaxCapacity', r),
      ul = techVals(t, 'TotalTechnologyAnnualActivityUpperLimit', r);
    const capOk = !mx.length || mx.some(x => x.v > 0);
    const actOk = !ul.length || ul.some(x => x.v > 0);
    if ((res || capOk) && actOk) return true;
  }
  return false;
}
function buildGraph(regs, opts) {
  const set = new Set(regs);
  const E = new Map(); // key t|f|dir -> {t,f,dir,modes:Set}
  for (const fl of M.flows) {
    if (!set.has(fl.r)) continue;
    const k = fl.t + '|' + fl.f + '|' + fl.dir;
    if (!E.has(k)) E.set(k, {t: fl.t, f: fl.f, dir: fl.dir, modes: new Set(), vmax: 0});
    const e = E.get(k);
    e.modes.add(fl.m);
    e.vmax = Math.max(e.vmax, Math.abs(fl.v));
  }
  // own-use inputs (ratio < 0.2, e.g. electricity used by gas fields and pipelines) are drawn but do not set the layout
  let edges = [...E.values()];
  const tset = new Set(edges.map(e => e.t));
  const off = new Set([...tset].filter(t => !techActive(t, regs)));
  const keep = t => (opts.showbs || !/^BACKSTOP/.test(t)) && (opts.showoff || !off.has(t)) && (!opts.only || opts.only.has(t)); // only: a part of the system (diagview.js)
  edges = edges.filter(e => keep(e.t));
  const T = [...new Set(edges.map(e => e.t))],
    F = [...new Set(edges.map(e => e.f))];
  // capacity-only technologies (no flows) tied by a user-defined constraint to the capacity of another technology:
  // drawn as part of the system, beside that technology (see the layering below)
  const capUdc = t =>
    new Set((M.byTech.get(t) || []).filter(r => /^UDCMultiplier(TotalCapacity|NewCapacity)$/.test(r.p) && r.v && set.has(r.idx[0])).map(r => r.idx[2]));
  for (const t of M.techs) {
    if (T.includes(t)) continue;
    const has = (M.byTech.get(t) || []).some(
      r => (set.has(r.idx[0]) && r.p === 'ResidualCapacity') || (set.has(r.idx[0]) && r.p === 'CapitalCost' && r.v > 0.01)
    );
    if (has && capUdc(t).size && keep(t)) T.push(t);
  }
  // technologies and commodities not connected yet (no input, no output in any region): drawn too, so nothing is lost
  const flowT = new Set(M.flows.map(x => x.t)),
    flowF = new Set(M.flows.map(x => x.f)),
    loose = new Set(),
    looseF = new Set();
  for (const t of M.techs)
    if (!T.includes(t) && !flowT.has(t) && (opts.showbs || !/^BACKSTOP/.test(t)) && (!opts.only || opts.only.has(t))) {
      T.push(t);
      loose.add(t);
    }
  if (!opts.only)
    for (const f of typeof cset === 'function' ? cset() : [])
      if (!F.includes(f) && !flowF.has(f)) {
        F.push(f);
        looseF.add(f);
      }
  // layering: Kahn on mode-1 (primary) edges, cycles broken by releasing the node with fewest open inputs
  for (const e of edges) e.aux = e.dir === 'in' && e.vmax < 0.2;
  const prim = edges.filter(e => !e.aux && (e.modes.has('1') || !edges.some(x => x.t === e.t && x.modes.has('1'))));
  // storages take part in the ordering like a commodity: charging technology -> storage -> discharging technology. A
  // technology fed only by a storage (a well, a dam outlet) then comes right after the storage instead of the first column.
  const SN = storageNodes(regs, new Set(T));
  const nodes = [...T.map(t => 'T:' + t), ...F.map(f => 'F:' + f), ...[...SN.keys()].map(s => 'S:' + s)];
  const preds = new Map(nodes.map(n => [n, new Set()]));
  for (const e of prim) {
    if (e.dir === 'in') preds.get('T:' + e.t).add('F:' + e.f);
    else preds.get('F:' + e.f).add('T:' + e.t);
  }
  for (const [s, o] of SN) {
    for (const t of o.to) preds.get('S:' + s).add('T:' + t);
    for (const t of o.from) if (!o.to.includes(t)) preds.get('T:' + t).add('S:' + s);
  }
  const lvl = new Map(),
    open = new Map(nodes.map(n => [n, new Set(preds.get(n))]));
  const succ = new Map(nodes.map(n => [n, []]));
  for (const [n, ps] of preds) for (const p of ps) succ.get(p).push(n);
  const back = new Set();
  let ready = nodes.filter(n => open.get(n).size === 0);
  while (lvl.size < nodes.length) {
    if (!ready.length) {
      const rest = nodes.filter(n => !lvl.has(n)).sort((a, b) => open.get(a).size - open.get(b).size || (a[0] === 'T' ? -1 : 1));
      const n = rest[0];
      for (const p of open.get(n)) back.add(p + '>' + n);
      open.get(n).clear();
      ready = [n];
    }
    const nxt = [];
    for (const n of ready) {
      if (lvl.has(n)) continue;
      let L = 0;
      for (const p of preds.get(n)) if (lvl.has(p)) L = Math.max(L, lvl.get(p) + 1);
      if (n[0] === 'T' && L % 2) L++;
      if ((n[0] === 'F' || n[0] === 'S') && !(L % 2)) L++;
      lvl.set(n, L);
      for (const s of succ.get(n)) {
        open.get(s).delete(n);
        if (open.get(s).size === 0 && !lvl.has(s)) nxt.push(s);
      }
    }
    ready = nxt;
  }
  // storage technologies sit just after the bus they charge from; a capacity-only technology beside the one its capacity is tied to
  const stl = storageLinks(regs);
  for (const t of T) {
    if (stl.has(t)) {
      const bus = edges.find(e => e.t === t && e.dir === 'in' && e.modes.has('1'));
      if (bus && lvl.has('F:' + bus.f)) lvl.set('T:' + t, lvl.get('F:' + bus.f) + 1);
    }
    if (!edges.some(e => e.t === t)) {
      const us = capUdc(t);
      const p = us.size && T.find(x => x !== t && edges.some(e => e.t === x) && lvl.has('T:' + x) && [...capUdc(x)].some(u => us.has(u)));
      if (p) lvl.set('T:' + t, lvl.get('T:' + p));
    }
  }
  // storages are nodes of their own (a circle in the column of the technology that charges them), linked from
  // the technologies that charge them (TechnologyToStorage) and to those that discharge them (TechnologyFromStorage)
  // a discharging technology goes UNDER its storage, in the column of the technology that charges it (the row below),
  // not in the next column to the right: the diagram stays short. Only when its other inputs place it further right it stays there.
  for (const [s, o] of SN) {
    const ch = o.to.map(t => lvl.get('T:' + t)).filter(v => v !== undefined);
    if (!ch.length) continue;
    const Lc = Math.max(...ch);
    lvl.set('S:' + s, Lc + 1);
    for (const t of o.from) if (!o.to.includes(t) && (lvl.get('T:' + t) || 0) <= Lc + 2) lvl.set('T:' + t, Lc);
  }
  return {T, F, edges, lvl, off, regs, loose, looseF, S: SN};
}
function storageNodes(regs, tset) {
  const m = new Map();
  for (const [pn, k] of [
    ['TechnologyToStorage', 'to'],
    ['TechnologyFromStorage', 'from']
  ])
    for (const r of P_(pn).recs) {
      if (!r.v || !regs.includes(r.idx[0]) || !tset.has(r.idx[1])) continue;
      const s = r.idx[2];
      if (!m.has(s)) m.set(s, {to: [], from: [], modes: {}});
      const o = m.get(s);
      if (!o[k].includes(r.idx[1])) o[k].push(r.idx[1]);
      (o.modes[k + '|' + r.idx[1]] = o.modes[k + '|' + r.idx[1]] || new Set()).add(String(r.idx[3]));
    }
  return m;
}

/* ============================== layout and drawing ============================== */
const BW = 176,
  BH = 40,
  GAPY = 14,
  FSP = 26,
  TOP = 150,
  SLANE_W = 76,
  COLGAP = 30,
  UNDERGAP = 18; // SLANE_W: lane of the storages; tighter columns, room above a technology under its storage
let G = null,
  view = {x: 0, y: 0, k: 1},
  sel = null;
function layout(g) {
  const maxL = Math.max(0, ...g.lvl.values());
  const tAt = [],
    fAt = [];
  for (let L = 0; L <= maxL; L++) {
    tAt[L] = g.T.filter(t => g.lvl.get('T:' + t) === L);
    fAt[L] = g.F.filter(f => g.lvl.get('F:' + f) === L);
  }
  // order commodities in a band by family, then name; technologies by their commodity positions (two sweeps)
  const famOrder = ['land', 'ren', 'nuc', 'coal', 'oil', 'gas', 'trade', 'elc', 'h2', 'other'];
  for (const a of fAt) a.sort((x, y) => famOrder.indexOf(fam(x)) - famOrder.indexOf(fam(y)) || x.localeCompare(y));
  const fIdx = new Map();
  fAt.forEach(a => a.forEach((f, i) => fIdx.set(f, i)));
  const tOut = t => g.edges.filter(e => e.t === t && e.dir === 'out').map(e => e.f),
    tIn = t => g.edges.filter(e => e.t === t && e.dir === 'in').map(e => e.f);
  const key = t => {
    const o = tOut(t),
      i = tIn(t);
    const f = o.length ? o : i;
    return f.length ? Math.min(...f.map(x => famOrder.indexOf(fam(x)) * 100 + (fIdx.get(x) || 0))) : 999;
  };
  for (const a of tAt) a.sort((x, y) => key(x) - key(y) || x.localeCompare(y));
  // the technology that discharges a storage on the row just under the one that charges it, in the same column
  for (const [s, o] of g.S || new Map()) {
    const c0 = o.to[0],
      Lc = g.lvl.get('T:' + c0);
    if (Lc === undefined || !tAt[Lc]) continue;
    for (const t of o.from) {
      if (t === c0 || g.lvl.get('T:' + t) !== Lc) continue;
      const col = tAt[Lc],
        i = col.indexOf(t);
      if (i < 0) continue;
      col.splice(i, 1);
      col.splice(col.indexOf(c0) + 1, 0, t);
    }
  }
  // x positions
  // a storage sits beside the technology that charges it, on the same row, in a lane to the right of that column
  const SLANE = SLANE_W,
    stoCol = new Map();
  for (const [s, o] of g.S || new Map()) {
    let Ls = g.lvl.get('S:' + s) || 0;
    if (Ls % 2) Ls--;
    stoCol.set(s, Ls);
  }
  const hasLane = new Set(stoCol.values());
  const x = new Map();
  let cx = 40;
  const colX = [];
  for (let L = 0; L <= maxL; L++) {
    colX[L] = cx;
    if (L % 2 === 0) {
      tAt[L].forEach(t => x.set('T:' + t, cx));
      cx += (tAt[L].length || hasLane.has(L) ? BW : 0) + (hasLane.has(L) ? SLANE : 0) + COLGAP;
    } else {
      fAt[L].forEach((f, i) => x.set('F:' + f, cx + 10 + i * FSP));
      cx += Math.max(1, fAt[L].length) * FSP + COLGAP;
    }
  }
  // y positions: stack each technology column
  const y = new Map();
  let maxY = TOP;
  const UNDER = new Set();
  for (const [s, o] of g.S || new Map()) {
    const Lc = g.lvl.get('T:' + o.to[0]);
    for (const t of o.from) if (t !== o.to[0] && g.lvl.get('T:' + t) === Lc) UNDER.add(t);
  }
  tAt.forEach(a => {
    let yy = TOP + 30;
    a.forEach((t, i) => {
      if (i) yy += BH + GAPY + (UNDER.has(t) ? UNDERGAP : 0);
      y.set('T:' + t, yy);
      maxY = Math.max(maxY, yy + BH);
    });
  });
  // a discharging technology takes the row of the technology that charges the storage when that row is free in its column
  for (const [s, o] of g.S || new Map()) {
    const c0 = o.to[0];
    if (!c0 || !y.has('T:' + c0)) continue;
    const yy = y.get('T:' + c0),
      Lc = g.lvl.get('T:' + c0);
    for (const t of o.from) {
      const Ld = g.lvl.get('T:' + t);
      if (t === c0 || Ld === undefined || Ld === Lc || !tAt[Ld]) continue;
      if (!tAt[Ld].some(u => u !== t && Math.abs(y.get('T:' + u) - yy) < BH + GAPY - 1)) {
        y.set('T:' + t, yy);
        maxY = Math.max(maxY, yy + BH);
      }
    }
  }
  {
    const used = new Map(); // storages charged by the same technology: one under the other in the lane
    for (const [s, o] of g.S || new Map()) {
      const Ls = stoCol.get(s),
        ch = o.to.filter(t => g.lvl.get('T:' + t) === Ls),
        t0 = ch.length ? ch[0] : o.from.find(t => g.lvl.get('T:' + t) === Ls);
      let yy = t0 && y.has('T:' + t0) ? y.get('T:' + t0) : TOP + 30;
      while ([...used.values()].some(v => v.L === Ls && Math.abs(v.y - yy) < BH + GAPY - 1)) yy += BH + GAPY;
      used.set(s, {L: Ls, y: yy});
      x.set('S:' + s, (colX[Ls] !== undefined ? colX[Ls] : 40) + BW + 14);
      y.set('S:' + s, yy);
      maxY = Math.max(maxY, yy + BH);
    }
  }
  // refine: order commodities in each band by mean y of their producers
  for (const a of fAt) {
    a.sort((p, q) => meanY(p) - meanY(q));
    a.forEach((f, i) => {
      const L = g.lvl.get('F:' + f);
      x.set('F:' + f, colX[L] + 10 + i * FSP);
    });
  }
  function meanY(f) {
    const ts = g.edges
      .filter(e => e.f === f && e.dir === 'out')
      .map(e => y.get('T:' + e.t))
      .filter(v => v !== undefined);
    return ts.length ? ts.reduce((s, v) => s + v, 0) / ts.length : 0;
  }
  return {x, y, W: cx + 20, H: maxY + 60, colX, maxL, tAt, fAt};
}
const svgNS = 'http://www.w3.org/2000/svg';
function el(n, a, p) {
  const e = document.createElementNS(svgNS, n);
  for (const k in a) e.setAttribute(k, a[k]);
  if (p) p.appendChild(e);
  return e;
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
}
function shortName(t) {
  const d = TD[t];
  if (!d) return t;
  const s = d.replace(/^v2\.0 - /, '').split(/[.(:;]/)[0];
  return s.length > 27 ? s.slice(0, 26) + '…' : s;
}

function draw() {
  const regs = state.region === 'ALL' ? REG : [state.region];
  if (typeof DVW !== 'undefined' && DVW._m !== M) {
    DVW._m = M;
    DVW.view = null;
    DVW.pick.clear();
    DVW.load();
  } // another model or case: no part, its own views
  G = buildGraph(regs, {showoff: state.showoff, showbs: state.showbs, only: typeof DVW !== 'undefined' ? DVW.active() : null});
  const Lo = (G.layout = layout(G));
  const svg = document.getElementById('svg');
  svg.innerHTML = '';
  const defs = el('defs', {}, svg);
  for (const fa of Object.keys(FAMLAB)) {
    const mk = el(
      'marker',
      {id: 'ar-' + fa, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse'},
      defs
    );
    el('path', {d: 'M0,0 L10,5 L0,10 z', fill: `var(--f-${fa})`}, mk);
  }
  for (const [f, c] of Object.entries(COLORS)) {
    const mk = el(
      'marker',
      {id: fmark(f), viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse'},
      defs
    );
    el('path', {d: 'M0,0 L10,5 L0,10 z', fill: c}, mk);
  }
  const root = el('g', {id: 'root'}, svg);
  // column headings
  const head = el('g', {}, root);
  for (let L = 0; L <= Lo.maxL; L += 2)
    if (Lo.tAt[L].length) {
      const lab = L === 0 ? 'Supply' : !Lo.tAt.slice(L + 1).some(a => a && a.length) ? 'End use' : 'Stage ' + L / 2;
      el('text', {x: Lo.colX[L], y: TOP + 14, class: 'col-h'}, head).textContent = lab;
    }
  const gE = el('g', {}, root),
    gF = el('g', {}, root),
    gSE = el('g', {}, root),
    gT = el('g', {}, root),
    gS = el('g', {}, root);
  // commodity lines
  const fExt = new Map();
  for (const e of G.edges) {
    const yy = Lo.y.get('T:' + e.t) + BH / 2;
    const k = e.f;
    const o = fExt.get(k) || [Infinity, -Infinity];
    fExt.set(k, [Math.min(o[0], yy), Math.max(o[1], yy)]);
  }
  for (const f of G.F) {
    const fx = Lo.x.get('F:' + f),
      [, y1] = fExt.get(f) || [0, TOP + 60];
    const gg = el('g', {class: 'fuel', 'data-f': f}, gF);
    el('line', {x1: fx, x2: fx, y1: TOP - 4, y2: y1 + 8, class: 'f-line', stroke: fcol(f)}, gg);
    el('line', {x1: fx, x2: fx, y1: TOP - 130, y2: y1 + 8, class: 'f-hit'}, gg);
    const t = el('text', {x: fx + 4, y: TOP - 10, class: 'f-lab', transform: `rotate(-90 ${fx + 4} ${TOP - 10})`, fill: fcol(f)}, gg);
    t.textContent = f;
    const fi = iconFor(f);
    if (fi) {
      el('circle', {cx: fx, cy: TOP + 8, r: 10, class: 'f-ib', stroke: fcol(f)}, gg);
      const g2 = el('g', {}, gg);
      g2.innerHTML = iconSVG(fi, fx - 7, TOP + 1, 14, fcol(f));
    }
    gg.addEventListener('click', ev => {
      ev.stopPropagation();
      if (typeof DVW !== 'undefined' && (DVW.tool || ev.ctrlKey || ev.metaKey || ev.shiftKey)) return DVW.toggleF(f);
      openFuel(f);
    });
    gg.addEventListener('mouseenter', () => hi({f}));
    gg.addEventListener('mouseleave', () => hi(null));
  }
  // edges
  const inCount = new Map(),
    outCount = new Map();
  for (const e of G.edges) {
    const m = e.dir === 'in' ? inCount : outCount;
    m.set(e.t, (m.get(e.t) || 0) + 1);
  }
  const inSeen = new Map(),
    outSeen = new Map();
  for (const e of G.edges) {
    const tx = Lo.x.get('T:' + e.t),
      ty = Lo.y.get('T:' + e.t),
      fx = Lo.x.get('F:' + e.f);
    const seen = e.dir === 'in' ? inSeen : outSeen,
      cnt = (e.dir === 'in' ? inCount : outCount).get(e.t);
    const k = (seen.get(e.t) || 0) + 1;
    seen.set(e.t, k);
    const yy = ty + (BH * k) / (cnt + 1);
    let d,
      back = false;
    if (e.dir === 'out') {
      if (fx > tx + BW) d = `M${tx + BW},${yy} H${fx}`;
      else {
        back = true;
        const yb = ty + BH + 5 + k * 2;
        d = `M${tx + BW},${yy} h8 V${yb} H${fx}`;
      }
    } else {
      if (fx < tx) d = `M${fx},${yy} H${tx}`;
      else {
        back = true;
        const yb = ty - 5 - k * 2;
        d = `M${fx},${yb} H${tx - 8} V${yy} H${tx}`;
      }
    }
    const p = el(
      'path',
      {
        d,
        class: 'edge' + (back ? ' back' : '') + (e.aux ? ' aux' : ''),
        stroke: fcol(e.f),
        'marker-end': `url(#${fmark(e.f)})`,
        'data-t': e.t,
        'data-f': e.f
      },
      gE
    );
    const tt = el('title', {}, p);
    tt.textContent = `${e.t} ${e.dir === 'in' ? '←' : '→'} ${e.f}  (mode ${[...e.modes].join(', ')}${e.aux ? ', own use' : ''})`;
  }
  // technologies
  const stLinks = storageLinks(regs);
  const emi = new Map();
  for (const r of P_('EmissionActivityRatio').recs) {
    const v = Number(r.v);
    if (!v || !regs.includes(r.idx[0])) continue;
    if (!emi.has(r.idx[1])) emi.set(r.idx[1], new Map());
    const m = emi.get(r.idx[1]);
    m.set(r.idx[2], (m.get(r.idx[2]) || 0) + v);
  }
  for (const t of G.T) {
    const tx = Lo.x.get('T:' + t),
      ty = Lo.y.get('T:' + t);
    const outs = G.edges.filter(e => e.t === t && e.dir === 'out').map(e => e.f),
      ins = G.edges.filter(e => e.t === t && e.dir === 'in').map(e => e.f);
    const main = outs.find(f => fam(f) !== 'other') || outs[0] || ins[0] || 'other';
    const isBad = checkPeek() && regs.some(r => checkPeek().bad.has(r + '|' + t));
    const gg = el(
      'g',
      {
        class:
          'tech' +
          (G.off.has(t) ? ' off' : '') +
          (G.loose && G.loose.has(t) ? ' loose' : '') +
          (isBad ? ' bad' : '') +
          (sel && sel.t === t ? ' sel' : ''),
        'data-t': t,
        tabindex: 0,
        role: 'button',
        'aria-label': t
      },
      gT
    );
    el('rect', {x: tx, y: ty, width: BW, height: BH, rx: 7, class: 't-box', stroke: fcol(main)}, gg);
    // the outer edge keeps the colour of the main commodity; a second, inner edge gives the system colour
    {
      const sy = typeof SYSTEMS !== 'undefined' && SYSTEMS.of(t, 'TECHNOLOGY');
      if (sy)
        el(
          'rect',
          {
            x: tx + 3.5,
            y: ty + 3.5,
            width: BW - 7,
            height: BH - 7,
            rx: 4.5,
            class: 't-sys',
            fill: 'none',
            stroke: SYSTEMS.color(sy),
            'stroke-width': 1.8,
            'pointer-events': 'none'
          },
          gg
        );
    }
    const ic = iconFor(t),
      tx0 = ic ? tx + 33 : tx + 9;
    if (ic) {
      const g2 = el('g', {}, gg);
      g2.innerHTML = iconSVG(ic, tx + 8, ty + 10, 20, fcol(main));
    }
    const nm = shortName(t);
    {
      const mx = ic ? 22 : 99;
      el('text', {x: tx0, y: ty + 17, class: 't-lab'}, gg).textContent = nm.length > mx ? nm.slice(0, mx - 1) + '…' : nm;
    } // room for the storage badge
    el('text', {x: tx0, y: ty + 32, class: 't-code'}, gg).textContent = t + (G.off.has(t) ? '  · inactive' : '');
    // an emissions badge on the top-right corner when the technology has an EmissionActivityRatio (minus = a sink)
    if (emi.has(t)) {
      const E = emi.get(t),
        sink = [...E.values()].every(v => v < 0),
        cx = tx + BW - 14,
        cy = ty;
      const gb = el('g', {class: 't-emi' + (sink ? ' sink' : '')}, gg);
      el('circle', {cx, cy, r: 9, class: 't-emib'}, gb);
      const g3 = el('g', {}, gb);
      g3.innerHTML = iconSVG('emission', cx - 6, cy - 6, 12, sink ? '#2f7d4f' : '#4a4f57');
      const tt = el('title', {}, gb);
      tt.textContent = `Emissions of ${t}: ` + [...E].map(([e, v]) => `${e}${v < 0 ? ' (absorbed)' : ''}`).join(', ');
    }
    gg.addEventListener('click', ev => {
      ev.stopPropagation();
      if ((DVW.tool || ev.ctrlKey || ev.metaKey || ev.shiftKey) && typeof DVW !== 'undefined') return DVW.toggle(t);
      build.on ? openEntity('tech', t) : openTech(t);
    });
    gg.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        openTech(t);
      }
    });
    gg.addEventListener('mouseenter', () => hi({t}));
    gg.addEventListener('mouseleave', () => hi(null));
  }
  drawStorages(G, Lo, gS, gSE);
  applyView();
  drawLegend();
  if (typeof DVW !== 'undefined') DVW.paint();
  document.getElementById('status').textContent =
    `${regs.length > 1 ? 'All regions' : RNAME[regs[0]]} · ${typeof DVW !== 'undefined' && DVW.view ? 'part: ' : ''}${G.T.length} technologies · ${G.F.length} commodities${G.off.size && !state.showoff ? ` · ${[...G.off].filter(t => !/^BACKSTOP/.test(t)).length} inactive hidden` : ''}`;
  const dl = document.getElementById('techlist');
  dl.innerHTML = G.T.map(t => `<option value="${t}">${esc(shortName(t))}</option>`).join('');
  renderBrowser();
  if (typeof rdEnhBar === 'function') rdEnhBar(); // banner of a strategic enhancement
}
/* legend: the commodities drawn in this view, with their colour and description (click = open, hover = highlight) */
let legendOpen = false; // the model browser lists the commodities; the legend opens on demand
function drawLegend() {
  const L = document.getElementById('legend');
  if (!L || !G) return;
  const famOrder = ['land', 'ren', 'nuc', 'coal', 'oil', 'gas', 'trade', 'elc', 'h2', 'other'];
  const F = [...G.F].sort((a, b) => famOrder.indexOf(fam(a)) - famOrder.indexOf(fam(b)) || a.localeCompare(b));
  const lab = f => {
    const d = FD[f] || (fam(f) === 'other' ? '' : FAMLAB[fam(f)].toLowerCase());
    const s = d.split(/[.(;]/)[0].trim();
    return s.length > 34 ? s.slice(0, 33) + '…' : s;
  };
  L.innerHTML = `<div class="lg-h"><button type="button" class="btn lg-t" aria-expanded="${legendOpen}">${legendOpen ? '▾' : '▸'} Legend · ${F.length} commodities</button>
    <span class="muted">Dashed = reverse direction · dotted = own use</span></div>${sysLegend()}
    ${legendOpen ? `<div class="lg-b">${F.map(f => `<span class="lg" data-f="${esc(f)}" title="${esc(FD[f] || f)}"><i style="background:${fcol(f)}"></i>${iconFor(f) ? `<svg class="lgi" viewBox="0 0 24 24" style="color:${fcol(f)}">${ICON_LIB[iconFor(f)][1]}</svg>` : ''}<b>${esc(f)}</b>${lab(f) ? ' ' + esc(lab(f)) : ''}</span>`).join('')}</div>` : ''}`;
  L.querySelector('.lg-t').onclick = () => {
    legendOpen = !legendOpen;
    drawLegend();
  };
  // the systems key (box edge colour = system); hover: the other systems fade; click: only that system
  L.querySelectorAll('.lgs').forEach(x => {
    const c = x.dataset.s,
      svg = document.getElementById('svg');
    x.onmouseenter = () =>
      svg.querySelectorAll('.tech').forEach(g => g.classList.toggle('dim', (SYSTEMS.of(g.dataset.t, 'TECHNOLOGY') || '') !== c));
    x.onmouseleave = () => svg.querySelectorAll('.tech.dim').forEach(g => g.classList.remove('dim'));
    x.onclick = () => {
      svg.querySelectorAll('.tech.dim').forEach(g => g.classList.remove('dim'));
      if (c) sysFilter([c]);
      else DVW.show(new Set(G.T.filter(t => !SYSTEMS.of(t, 'TECHNOLOGY'))), 'no system');
    };
  });
  L.querySelectorAll('.lg').forEach(x => {
    x.onclick = () => openFuel(x.dataset.f);
    x.onmouseenter = () => hi({f: x.dataset.f});
    x.onmouseleave = () => hi(null);
  });
}
function sysLegend() {
  if (typeof SYSTEMS === 'undefined' || !SYSTEMS.list.length || !G) return '';
  const n = new Map();
  for (const t of G.T) {
    const c = SYSTEMS.of(t, 'TECHNOLOGY') || '';
    n.set(c, (n.get(c) || 0) + 1);
  }
  const chip = (c, col, name, k) =>
    `<button type="button" class="lgs" data-s="${esc(c)}" title="${esc(name)}: ${k} technolog${k === 1 ? 'y' : 'ies'} in the diagram. Inner edge of the boxes = system colour (the outer edge is the colour of the main commodity). Hover: highlight; click: show only this system"><i style="--sc:${col}"></i>${esc(name)} <span class="muted">${k}</span></button>`;
  const L = SYSTEMS.list.filter(s => n.has(s.c)).map(s => chip(s.c, s.col, s.n, n.get(s.c)));
  if (n.has('')) L.push(chip('', 'var(--box-edge)', 'No system', n.get('')));
  return L.length ? `<div class="lg-s"><span class="lgsh">Systems · inner edge</span>${L.join('')}</div>` : '';
}
function storageLinks(regs) {
  const m = new Map();
  for (const pn of ['TechnologyToStorage', 'TechnologyFromStorage'])
    for (const r of P_(pn).recs) if (r.v && regs.includes(r.idx[0])) m.set(r.idx[1], r.idx[2]);
  return m;
}
function hi(o) {
  const svg = document.getElementById('svg');
  svg.querySelectorAll('.on').forEach(e => e.classList.remove('on'));
  if (!o) {
    svg.classList.remove('dim');
    return;
  }
  svg.classList.add('dim');
  if (o.t) {
    svg.querySelectorAll(`[data-t="${o.t}"]`).forEach(e => e.classList.add('on'));
    G.edges.filter(e => e.t === o.t).forEach(e => svg.querySelectorAll(`.fuel[data-f="${e.f}"]`).forEach(x => x.classList.add('on')));
  }
  if (o.s) {
    svg.querySelectorAll(`[data-s="${o.s}"]`).forEach(e => e.classList.add('on'));
    const so = G.S && G.S.get(o.s);
    if (so) [...so.to, ...so.from].forEach(t => svg.querySelectorAll(`.tech[data-t="${t}"]`).forEach(x => x.classList.add('on')));
  }
  if (o.t && G.S)
    for (const [s, so] of G.S)
      if (so.to.includes(o.t) || so.from.includes(o.t)) svg.querySelectorAll(`[data-s="${s}"]`).forEach(x => x.classList.add('on'));
  if (o.f) {
    svg.querySelectorAll(`[data-f="${o.f}"]`).forEach(e => e.classList.add('on'));
    G.edges.filter(e => e.f === o.f).forEach(e => svg.querySelectorAll(`.tech[data-t="${e.t}"]`).forEach(x => x.classList.add('on')));
  }
}

/* ============================== pan and zoom ============================== */
function applyView() {
  const r = document.getElementById('root');
  if (r) r.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);
}
// VIEWUSER: the person zoomed or moved the diagram since the last fit; then a change of the stage size (a panel opened or
// closed, the window resized) keeps their view, otherwise the diagram is fitted again to the space left
let VIEWUSER = false,
  SPACE = false;
function fit() {
  VIEWUSER = false;
  if (!G) return;
  const st = document.getElementById('stage').getBoundingClientRect();
  if (!st.width || !st.height) return;
  const k = Math.min(st.width / G.layout.W, st.height / (G.layout.H + 10), 1.2);
  view = {k: Math.max(k, 0.15), x: 8, y: Math.max(0, (st.height - G.layout.H * k) / 2) + 12};
  applyView();
}
function zoomAt(f, cx, cy) {
  VIEWUSER = true;
  const k = Math.min(3, Math.max(0.12, view.k * f));
  view.x = cx - ((cx - view.x) * k) / view.k;
  view.y = cy - ((cy - view.y) * k) / view.k;
  view.k = k;
  applyView();
}
(function () {
  const st = document.getElementById('stage');
  let drag = null;
    // with the selection tool on, the wheel MOVES the diagram (Shift + wheel: sideways; a trackpad moves both ways) and
  // Ctrl + wheel zooms; without the tool the wheel zooms as before. Dragging with the middle or right button, or with
  // Space held, always moves it; the arrow keys move it too.
  const pan = (dx, dy) => {
    VIEWUSER = true;
    view.x += dx;
    view.y += dy;
    applyView();
  };
  st.addEventListener(
    'wheel',
    e => {
      e.preventDefault();
      const b = st.getBoundingClientRect();
      if (typeof DVW !== 'undefined' && DVW.tool && !e.ctrlKey && !e.metaKey)
        return pan(-(e.shiftKey ? e.deltaY : e.deltaX), e.shiftKey ? 0 : -e.deltaY);
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - b.left, e.clientY - b.top);
    },
    {passive: false}
  );
  st.addEventListener('contextmenu', e => {
    if (st.dataset.panned === '1') {
      e.preventDefault();
      st.dataset.panned = '';
    }
  });
  st.addEventListener('pointerdown', e => {
    if (e.button === 1) e.preventDefault(); // no auto-scroll on the middle button
    if (e.target.closest('.tech,.fuel,.btn,.legend') && e.button === 0 && !SPACE) return;
    drag = {x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, btn: e.button};
    st.classList.add('drag');
    st.setPointerCapture(e.pointerId);
  });
  st.addEventListener('pointermove', e => {
    if (!drag) return;
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 3) {
      VIEWUSER = true;
      if (drag.btn === 2) st.dataset.panned = '1';
    }
    view.x = drag.vx + e.clientX - drag.x;
    view.y = drag.vy + e.clientY - drag.y;
    applyView();
  });
  st.addEventListener('pointerup', () => {
    drag = null;
    st.classList.remove('drag');
  });
  document.getElementById('zin').onclick = () => {
    const b = st.getBoundingClientRect();
    zoomAt(1.25, b.width / 2, b.height / 2);
  };
  document.getElementById('zout').onclick = () => {
    const b = st.getBoundingClientRect();
    zoomAt(0.8, b.width / 2, b.height / 2);
  };
  document.getElementById('zfit').onclick = fit;
  // Space held: the hand (drag moves the diagram, even with the selection tool on); arrow keys move it
  const typing = t =>
    t &&
    t.closest &&
    t.closest(
      'input,textarea,select,[contenteditable="true"],#mbrowser,#drawer,.msel-pop,[role=listbox],[role=menu],[role=dialog],table.grid'
    );
  document.addEventListener('keydown', e => {
    if (st.hidden || typing(e.target)) return;
    if (e.code === 'Space' && !SPACE) {
      SPACE = true;
      st.classList.add('hand');
      e.preventDefault();
      return;
    }
    const k = {ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60]}[e.key];
    if (
      k &&
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !(
        document.getElementById('drawer') &&
        !document.getElementById('drawer').hidden &&
        document.getElementById('drawer').contains(e.target)
      )
    ) {
      e.preventDefault();
      pan(k[0] * (e.shiftKey ? 3 : 1), k[1] * (e.shiftKey ? 3 : 1));
    }
  });
  document.addEventListener('keyup', e => {
    if (e.code === 'Space') {
      SPACE = false;
      st.classList.remove('hand');
    }
  });
  addEventListener('blur', () => {
    SPACE = false;
    st.classList.remove('hand');
  });
  // the stage changes size when an editor, Systems or another panel opens beside it: fit again so the whole system stays in view
  if (typeof ResizeObserver !== 'undefined') {
    let w0 = 0,
      h0 = 0,
      raf = 0;
    new ResizeObserver(en => {
      const r = en[0].contentRect;
      if (Math.abs(r.width - w0) < 2 && Math.abs(r.height - h0) < 2) return;
      w0 = r.width;
      h0 = r.height;
      st.classList.toggle('narrow', r.width < 760);
      if (VIEWUSER || !r.width) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => fit());
    }).observe(st);
  }
})();

/* a storage drawn like a technology: a circle (system colour on the inner ring), its code and name beside it; arrows
   from each technology that charges it (TechnologyToStorage) and to each technology that discharges it (TechnologyFromStorage).
   Click: its editor; hover: the storage, its technologies and links. */
function drawStorages(G, Lo, gS, gSE) {
  if (!G.S || !G.S.size) return;
  const stoCol0 = s => {
      let L = G.lvl.get('S:' + s) || 0;
      if (L % 2) L--;
      return L;
    },
    colXof = L => (Lo.colX[L] !== undefined ? Lo.colX[L] : 40);
  const R = BH / 2 + 2,
    defs = document.querySelector('#svg defs');
  if (defs && !defs.querySelector('#ar-sto')) {
    const mk = el(
      'marker',
      {id: 'ar-sto', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse'},
      defs
    );
    el('path', {d: 'M0,0 L10,5 L0,10 z', fill: 'var(--st-edge, #5f87ad)'}, mk);
  }
  const scol = s => {
    const sy = typeof SYSTEMS !== 'undefined' && SYSTEMS.of(s, 'STORAGE');
    return sy ? SYSTEMS.color(sy) : 'var(--st-edge, #5f87ad)';
  };
  let lane = -1;
  const order = [...G.S.keys()].sort((p, q) => Lo.x.get('S:' + p) - Lo.x.get('S:' + q) || Lo.y.get('S:' + p) - Lo.y.get('S:' + q));
  for (const s of order) {
    const o = G.S.get(s);
    lane++;
    const sx = Lo.x.get('S:' + s),
      sy0 = Lo.y.get('S:' + s);
    if (sx === undefined || sy0 === undefined) continue;
    const cx = sx + SLANE_W / 2 - 7,
      cy = sy0 + BH / 2;
    // links: charge (technology -> storage) and discharge (storage -> technology), as curves
    const L0 = stoCol0(s),
      colL = colXof(L0);
    const link = (t, dir) => {
      const tx = Lo.x.get('T:' + t),
        ty = Lo.y.get('T:' + t);
      if (tx === undefined) return;
      const tyc = ty + BH / 2,
        md = [...(o.modes[dir + '|' + t] || [])].join(', '),
        both = o.to.includes(t) && o.from.includes(t),
        same = Math.abs(tx - colL) < 2,
        row = Math.abs(ty - sy0) < 1;
      const ln = lane % 6,
        off = both ? 7 : 0,
        xin = c => cx - Math.sqrt(Math.max(0, R * R - c * c)),
        gapUp = sy0 - GAPY / 2 - ln * 1.5,
        gapDn = sy0 + BH + GAPY / 2 + ln * 1.5;
      let d,
        back = false;
      if (dir === 'to') {
        if (same && row)
          d = `M${tx + BW},${cy - off} H${xin(off)}`; // beside it: a short line
        else if (same) {
          const xl = colL + BW + 5 + ln * 2;
          d = `M${tx + BW},${tyc} H${xl} V${cy} H${cx - R}`;
        } // same column, another row
        else if (tx < colL) {
          const xl = colL - 12 - ln * 4;
          d = `M${tx + BW},${tyc} H${xl} V${gapUp} H${cx} V${cy - R}`;
        } // a column to the left
        else {
          back = true;
          const xl = tx + BW + 10 + ln * 4;
          d = `M${tx + BW},${tyc} H${xl} V${gapUp} H${cx} V${cy - R}`;
        }
      } // a column to the right
      else {
        if (same && row) {
          back = true;
          d = `M${xin(off)},${cy + off} H${tx + BW}`;
        } // back into the same technology
        else if (same && ty > sy0) {
          const xg = colL + BW + 6 + ln * 1.5,
            yg = (sy0 + BH + ty) / 2,
            xt = tx + BW - 28 - ln * 3; // under the storage (row below),
          d = `M${xin(6)},${cy + 6} H${xg} V${yg} H${xt} V${ty}`;
        } // entering the box from the top (outputs stay on the right)
        else if (same) {
          back = true;
          d = `M${cx},${cy - R} V${tyc} H${tx + BW}`;
        } // same column, a row above
        else if (tx > colL && Math.abs(tyc - cy) < 1)
          d = `M${cx + R},${cy} H${tx}`; // next column, same row: a straight line
        else if (tx > colL) {
          const xl = tx - 12 - ln * 4;
          d = `M${cx},${cy + R} V${gapDn} H${xl} V${tyc} H${tx}`;
        } // a column to the right
        else {
          back = true;
          const xr = tx + BW + 12 + ln * 4;
          d = `M${cx},${cy + R} V${gapDn} H${xr} V${tyc} H${tx + BW}`;
        }
      } // a column to the left
      const p = el(
        'path',
        {
          d,
          class: 'edge st-edge ' + (dir === 'to' ? 'charge' : 'discharge') + (back ? ' back' : ''),
          stroke: scol(s),
          'marker-end': 'url(#ar-sto)',
          'data-s': s,
          'data-t': t
        },
        gSE
      );
      el('title', {}, p).textContent =
        dir === 'to' ? `${t} charges ${s} (TechnologyToStorage, mode ${md})` : `${t} discharges ${s} (TechnologyFromStorage, mode ${md})`;
    };
    o.to.forEach(t => link(t, 'to'));
    o.from.forEach(t => link(t, 'from'));
    const gg = el(
      'g',
      {class: 'stor' + (sel && sel.s === s ? ' sel' : ''), 'data-s': s, tabindex: 0, role: 'button', 'aria-label': 'storage ' + s},
      gS
    );
    el('circle', {cx, cy, r: R, class: 't-box s-box', stroke: 'var(--st-edge, #5f87ad)'}, gg);
    el('circle', {cx, cy, r: R - 4, fill: 'none', stroke: scol(s), 'stroke-width': 1.8, 'pointer-events': 'none'}, gg);
    const ic = typeof iconFor === 'function' && iconFor(s);
    const g2 = el('g', {}, gg);
    if (ic) g2.innerHTML = iconSVG(ic, cx - 10, cy - 10, 20, 'var(--st-edge, #5f87ad)');
    else el('text', {x: cx, y: cy + 4, class: 'st-lab', 'text-anchor': 'middle'}, gg).textContent = 'S';
    // the code under the circle (the lane stays narrow: charge -> storage -> discharge on one row); the name in the tooltip
    const nm = (TD[s] || FD[s] || '').split(/[.(:;]/)[0],
      cw = Math.min(SLANE_W - 6, 7 * s.length + 10);
    el('rect', {x: cx - cw / 2, y: cy + R + 1, width: cw, height: 13, rx: 4, class: 's-lb'}, gg);
    el('text', {x: cx, y: cy + R + 11, class: 't-code', 'text-anchor': 'middle'}, gg).textContent =
      s.length > 13 ? s.slice(0, 12) + '…' : s;
    el('title', {}, gg).textContent =
      `Storage ${s}${nm ? ' · ' + nm : ''}\ncharged by: ${o.to.join(', ') || '–'}\ndischarged by: ${o.from.join(', ') || '–'}`;
    gg.addEventListener('click', ev => {
      ev.stopPropagation();
      openEntity('stor', s);
    });
    gg.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        openEntity('stor', s);
      }
    });
    gg.addEventListener('mouseenter', () => hi({s}));
    gg.addEventListener('mouseleave', () => hi(null));
  }
}
