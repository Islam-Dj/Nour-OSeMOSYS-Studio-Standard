'use strict';
/* ---- systems.
   Each technology, commodity, storage and emission has ONE main system. An interlinkage is found from the flows: a commodity
   of system A used or made by a technology of system B (ELC of Energy used by the pumps of Water: Energy -> Water).
   Saved in the data file as comments (GLPK ignores them):  #@system <code> <#colour> <name>   #@sysof <set> <member> <code> */
const SYS_DEFAULTS = [
  ['ENE', '#2a78d6', 'Energy'],
  ['WAT', '#1baf7a', 'Water'],
  ['LAN', '#8a6a3e', 'Land use'],
  ['FOO', '#eda100', 'Food and agriculture'],
  ['CLI', '#66788a', 'Climate and emissions']
];
const SYS_SETS = ['TECHNOLOGY', 'COMMODITY', 'STORAGE', 'EMISSION'];
const SYSTEMS = {
  list: [],
  mem: {TECHNOLOGY: {}, COMMODITY: {}, STORAGE: {}, EMISSION: {}},
  reset() {
    this.list = [];
    this.mem = {TECHNOLOGY: {}, COMMODITY: {}, STORAGE: {}, EMISSION: {}};
  },
  load(text) {
    this.reset();
    for (const m of String(text || '').matchAll(/^#@system\s+(\S+)\s+(#[0-9a-fA-F]{6})\s+(.*)$/gm))
      this.list.push({c: m[1], col: m[2], n: m[3].trim()});
    for (const m of String(text || '').matchAll(/^#@subsystem\s+(\S+)\s+(\S+)/gm)) {
      const s = this.get(m[1]);
      if (s && m[2] !== m[1]) s.p = m[2];
    } // sub-systems
    for (const m of String(text || '').matchAll(/^#@sysof\s+(\S+)\s+(\S+)\s+(\S+)/gm)) {
      const s = m[1] === 'FUEL' ? 'COMMODITY' : m[1];
      if (this.mem[s]) this.mem[s][m[2]] = m[3];
    }
  },
  lines() {
    const S = M && M.D ? M.D.sets : {},
      cn = (M && M.D && M.D.cname) || 'COMMODITY',
      out = [
        ...this.list.map(s => `#@system ${s.c} ${s.col} ${s.n}`),
        ...this.list.filter(s => s.p && this.get(s.p)).map(s => `#@subsystem ${s.c} ${s.p}`)
      ];
    for (const set of SYS_SETS) {
      const have = new Set(((set === 'COMMODITY' ? S[cn] : S[set]) || []).map(String));
      for (const [m, c] of Object.entries(this.mem[set])) if (have.has(m) && this.get(c)) out.push(`#@sysof ${set} ${m} ${c}`);
    }
    return out;
  },
  get(c) {
    return this.list.find(s => s.c === c) || null;
  },
  // the system of a member; set = TECHNOLOGY / COMMODITY / STORAGE / EMISSION, or any of them
  of(m, set) {
    m = String(m);
    if (set) {
      const s = set === 'FUEL' ? 'COMMODITY' : set;
      return (this.mem[s] || {})[m] || '';
    }
    for (const s of SYS_SETS) if (this.mem[s][m]) return this.mem[s][m];
    return '';
  },
  name(c) {
    const s = this.get(c);
    return s ? s.n : '';
  },
  // sub-systems. A system may be part of another (Water > Renewable water, Food > Cereals): an item belongs to the
  // sub-system; the parent gathers its own items and those of its sub-systems (filters, counts).
  parent(c) {
    const s = this.get(c);
    return s && s.p && this.get(s.p) ? s.p : '';
  },
  full(c) {
    const p = this.parent(c);
    return p ? `${this.name(p)} › ${this.name(c)}` : this.name(c);
  },
  family(c) {
    const out = [c],
      q = [c];
    while (q.length) {
      const x = q.shift();
      for (const s of this.list)
        if (s.p === x && !out.includes(s.c)) {
          out.push(s.c);
          q.push(s.c);
        }
    }
    return out;
  },
  ordered() {
    const top = this.list.filter(s => !this.parent(s.c)),
      out = [];
    const add = (s, d) => {
      out.push({...s, depth: d});
      for (const k of this.list.filter(x => x.p === s.c && x.c !== s.c)) add(k, d + 1);
    };
    top.forEach(s => add(s, 0));
    for (const s of this.list) if (!out.some(o => o.c === s.c)) out.push({...s, depth: 0});
    return out;
  },
  color(c) {
    const s = this.get(c);
    return s ? s.col : '#9a978f';
  },
  set(set, m, c) {
    set = set === 'FUEL' ? 'COMMODITY' : set;
    if (!this.mem[set]) return;
    if (c) this.mem[set][String(m)] = c;
    else delete this.mem[set][String(m)];
  },
  rename(set, a, b) {
    set = set === 'FUEL' ? 'COMMODITY' : set;
    if (this.mem[set] && a in this.mem[set]) {
      this.mem[set][b] = this.mem[set][a];
      delete this.mem[set][a];
    }
  },
  add(c, n, col) {
    c = String(c)
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '');
    if (!c || this.get(c)) return null;
    const s = {c, n: n || c, col: col || '#66788a'};
    this.list.push(s);
    return s;
  },
  // a new code for a system; its items follow (returns '' when done, else why not)
  recode(a, b) {
    b = String(b || '')
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '');
    const s = this.get(a);
    if (!s) return 'no such system';
    if (!b) return 'a code is letters, digits or _';
    if (b === a) return '';
    if (this.get(b)) return `${b} is already a system`;
    s.c = b;
    for (const x of this.list) if (x.p === a) x.p = b;
    for (const set of SYS_SETS) for (const [m, x] of Object.entries(this.mem[set])) if (x === a) this.mem[set][m] = b;
    return '';
  },
  remove(c) {
    for (const s of this.list) if (s.p === c) s.p = this.parent(c) || '';
    this.list = this.list.filter(s => s.c !== c);
    for (const set of SYS_SETS) for (const [m, x] of Object.entries(this.mem[set])) if (x === c) delete this.mem[set][m];
  },
  members(c) {
    const out = [];
    for (const set of SYS_SETS)
      for (const m of setOf(set === 'COMMODITY' ? cname() : set).map(String)) if (this.mem[set][m] === c) out.push([set, m]);
    return out;
  },
  unassigned() {
    const out = [];
    for (const set of SYS_SETS)
      for (const m of setOf(set === 'COMMODITY' ? cname() : set).map(String)) if (!this.get(this.mem[set][m])) out.push([set, m]);
    return out;
  },
  // interlinkages: a commodity of system A used (input) or made (output) by a technology of system B != A
  links() {
    const L = new Map();
    if (!M || !M.flows) return L;
    for (const fl of M.flows) {
      const st = this.of(fl.t, 'TECHNOLOGY'),
        sf = this.of(fl.f, 'COMMODITY');
      if (!st || !sf || st === sf) continue;
      const [a, b] = fl.dir === 'in' ? [sf, st] : [st, sf],
        k = a + '>' + b;
      if (!L.has(k)) L.set(k, {a, b, comm: new Map()});
      const e = L.get(k).comm;
      if (!e.has(fl.f)) e.set(fl.f, new Set());
      e.get(fl.f).add(fl.t);
    }
    return L;
  },
  // a first guess from the codes and names (shown to the user before it is applied)
  guess(set, m) {
    const t = (m + ' ' + (set === 'TECHNOLOGY' ? TD[m] || '' : FD[m] || '')).toLowerCase(),
      has = c => this.get(c);
    const pick = [
      [/co2|ch4|n2o|ghg|emission|carbon/, 'CLI'],
      [/wheat|durum|cereal|maize|barley|rice|sorghum|food|fodder|livestock|milk|meat|dates|olive|potato|vegetable/, 'FOO'],
      [/\blnd|crplnd|land|crop land|cropland|forest|pasture|urban|bare|soil|tlnd/, 'LAN'],
      [/wtr|water|irrig|rain|precip|grwtr|surwtr|aquif|\bdam\b|dam |pump|desal|recharge|runoff|evapo/, 'WAT']
    ];
    if (set === 'EMISSION' && has('CLI')) return 'CLI';
    for (const [rx, c] of pick) if (rx.test(t) && has(c)) return c;
    return has('ENE') ? 'ENE' : '';
  }
};
const cname = () => (M && M.D && M.D.cname) || 'COMMODITY';
const sysDot = c => (c ? `<span class="sysdot" style="--sc:${SYSTEMS.color(c)}" title="${esc(SYSTEMS.name(c) || c)}"></span>` : '');
const sysSelect = (cls, cur, required) =>
  `<select class="${cls}"${required ? ' required' : ''}>${required && !cur ? '<option value="">— choose —</option>' : '<option value="">(none)</option>'}${SYSTEMS.ordered()
    .map(
      s =>
        `<option value="${esc(s.c)}" ${s.c === cur ? 'selected' : ''}>${'\u2003'.repeat(s.depth)}${s.depth ? '› ' : ''}${esc(s.n)} (${esc(s.c)})</option>`
    )
    .join('')}</select>`;

/* ---- the systems panel: create, rename, colour, delete; assign many items at once (searchable multi-select); a first guess;
   the interlinkages as a map and a table ---- */
function openSystems(tab) {
  const dr = document.getElementById('drawer');
  dr.hidden = false;
  tab = tab || 'list';
  const cnt = c => SYSTEMS.members(c).length,
    un = SYSTEMS.unassigned();
  const L = [...SYSTEMS.links().values()];
  dr.innerHTML = `<div class="dh"><div><div class="code">build · systems</div><h2>Systems</h2><p>Each technology, commodity, storage and emission belongs to one system. Commodities that cross from one system to another are the interlinkages (e.g. ELC of Energy used by the pumps of Water).</p></div><div class="acts"><button class="btn x" type="button" id="close">Close</button></div></div>
  <div class="db"><div class="seg" id="systab"><button type="button" data-t="list" aria-pressed="${tab === 'list'}">Systems</button><button type="button" data-t="map" aria-pressed="${tab === 'map'}">Interlinkages (${sysCross().size})</button></div>
  ${
    tab === 'list'
      ? `
   <table class="systbl"><thead><tr><th>Code</th><th>Name</th><th>Part of</th><th>Colour</th><th>Items</th><th></th></tr></thead><tbody>${
     SYSTEMS.ordered()
       .map(
         s => `<tr data-c="${esc(s.c)}"><td><input class="sysk" value="${esc(s.c)}" maxlength="12" pattern="[A-Za-z0-9_]+" title="Code of the system: letters, digits or _. Its items follow." aria-label="Code of ${esc(s.n)}"></td><td style="padding-left:${6 + 16 * s.depth}px">${s.depth ? '<span class="muted">› </span>' : ''}<input class="sysn" value="${esc(s.n)}"></td><td><select class="sysp" title="Make it a sub-system of another system (e.g. Water › Renewable water, Food › Cereals)"><option value="">— main system —</option>${SYSTEMS.list
           .filter(x => !SYSTEMS.family(s.c).includes(x.c))
           .map(x => `<option value="${esc(x.c)}" ${x.c === s.p ? 'selected' : ''}>${esc(SYSTEMS.full(x.c))}</option>`)
           .join(
             ''
           )}</select></td><td><input type="color" class="sysc" value="${s.col}"></td><td>${cnt(s.c)}${SYSTEMS.family(s.c).length > 1 ? ` <span class="muted" title="with its sub-systems">(${SYSTEMS.family(s.c).reduce((a, c) => a + cnt(c), 0)})</span>` : ''}</td>
     <td><button type="button" class="btn sm sysas">Assign items…</button> <button type="button" class="btn sm sysflt" title="Show only this system in the diagram (with the commodities that link it to the others)">Diagram</button> <button type="button" class="btn sm sysdel">Delete</button></td></tr>`
       )
       .join('') ||
     '<tr><td colspan="5" class="muted">No system yet: create the first ones (they are needed before adding technologies, commodities, storage or emissions).</td></tr>'
   }</tbody></table>
   <form id="sysnew" class="frm row3"><label>Code<input name="c" placeholder="e.g. WAT" pattern="[A-Za-z0-9_]+" required></label><label>Name<input name="n" placeholder="e.g. Water" required></label><label>Colour<input type="color" name="col" value="#66788a"></label><label>Part of<select name="p"><option value="">— main system —</option>${SYSTEMS.ordered()
     .map(x => `<option value="${esc(x.c)}">${esc(SYSTEMS.full(x.c))}</option>`)
     .join('')}</select></label><button class="btn pri" type="submit">Add system</button></form>
   ${
     SYS_DEFAULTS.some(([c]) => !SYSTEMS.get(c))
       ? `<p><button type="button" class="btn" id="sysdef">Add the usual systems</button> <span class="hint">${SYS_DEFAULTS.filter(
           ([c]) => !SYSTEMS.get(c)
         )
           .map(d => d[2])
           .join(', ')}</span></p>`
       : ''
   }
   <p class="hint">${un.length ? `${un.length} item${un.length > 1 ? 's have' : ' has'} no system yet. ` : 'Every item has a system. '}${un.length && SYSTEMS.list.length ? '<button type="button" class="btn sm" id="sysguess">Suggest from the codes and names…</button>' : ''}</p>`
      : sysLinksHtml(L)
  }
  </div>`;
  dr.querySelector('#close').onclick = () => (dr.hidden = true);
  dr.querySelectorAll('#systab button').forEach(b => (b.onclick = () => openSystems(b.dataset.t)));
  const changed = msg => {
    dirty = true;
    if (typeof afterEdit === 'function') afterEdit(msg);
  };
  dr.querySelectorAll('tr[data-c]').forEach(tr => {
    const c = tr.dataset.c,
      s = SYSTEMS.get(c);
    tr.querySelector('.sysn').onchange = e => {
      s.n = e.target.value.trim() || c;
      changed(`System ${c} renamed`);
    };
    tr.querySelector('.sysk').onchange = e => {
      const why = SYSTEMS.recode(c, e.target.value);
      if (why) {
        toast(why);
        e.target.value = c;
        return;
      }
      changed(`System ${c} is now ${s.c}`);
      if (typeof DVW !== 'undefined' && DVW.bar) DVW.bar();
      openSystems();
    };
    tr.querySelector('.sysc').onchange = e => {
      s.col = e.target.value;
      changed(`System ${c}: colour`);
    };
    tr.querySelector('.sysp').onchange = e => {
      s.p = e.target.value;
      changed(s.p ? `${s.n} is now part of ${SYSTEMS.name(s.p)}` : `${s.n} is a main system`);
      openSystems();
    };
    tr.querySelector('.sysdel').onclick = async () => {
      if (!await uiConfirm(`Delete the system ${c}? Its ${cnt(c)} items keep their data and have no system.`)) return;
      SYSTEMS.remove(c);
      changed(`System ${c} deleted`);
      openSystems();
    };
    tr.querySelector('.sysflt').onclick = () => {
      dr.hidden = true;
      sysFilter([c]);
    };
    tr.querySelector('.sysas').onclick = e => {
      const items = [];
      for (const set of SYS_SETS)
        for (const m of setOf(set === 'COMMODITY' ? cname() : set).map(String))
          items.push({
            v: set[0] + ':' + m,
            l: (set === 'TECHNOLOGY' ? TD[m] : set === 'COMMODITY' ? FD[m] : '') || '',
            g: set.toLowerCase() + (SYSTEMS.of(m, set) ? ' · ' + SYSTEMS.of(m, set) : '')
          });
      const cur = items
        .filter(x => SYSTEMS.of(x.v.slice(2), {T: 'TECHNOLOGY', C: 'COMMODITY', S: 'STORAGE', E: 'EMISSION'}[x.v[0]]) === c)
        .map(x => x.v);
      MSEL.open(e.target, {
        title: `Items of ${s.n}`,
        items,
        sel: cur,
        onApply: v => {
          const want = new Set(v);
          for (const x of items) {
            const set = {T: 'TECHNOLOGY', C: 'COMMODITY', S: 'STORAGE', E: 'EMISSION'}[x.v[0]],
              m = x.v.slice(2);
            if (want.has(x.v)) SYSTEMS.set(set, m, c);
            else if (SYSTEMS.of(m, set) === c) SYSTEMS.set(set, m, '');
          }
          changed(`System ${c}: ${v.length} items`);
          openSystems();
        }
      });
    };
  });
  const nf = dr.querySelector('#sysnew');
  if (nf)
    nf.onsubmit = ev => {
      ev.preventDefault();
      const f = Object.fromEntries(new FormData(nf));
      const ns = SYSTEMS.add(f.c, f.n.trim(), f.col);
      if (!ns) return toast(`${f.c}: already a system (or not a valid code)`);
      if (f.p) ns.p = f.p;
      changed(`System ${f.c} created`);
      openSystems();
    };
  const df = dr.querySelector('#sysdef');
  if (df)
    df.onclick = () => {
      for (const [c, col, n] of SYS_DEFAULTS) SYSTEMS.add(c, n, col);
      changed('The usual systems added');
      openSystems();
    };
  const gs = dr.querySelector('#sysguess');
  if (gs)
    gs.onclick = async () => {
      const g = un.map(([set, m]) => [set, m, SYSTEMS.guess(set, m)]).filter(x => x[2]);
      if (!g.length) return toast('No guess: assign them with "Assign items…"');
      const by = {};
      for (const x of g) (by[x[2]] = by[x[2]] || []).push(x[1]);
      if (
        !await uiConfirm(
          `Assign ${g.length} items?\n\n` +
            Object.entries(by)
              .map(([c, l]) => `${SYSTEMS.name(c)}: ${l.slice(0, 12).join(', ')}${l.length > 12 ? ` … (+${l.length - 12})` : ''}`)
              .join('\n') +
            '\n\nYou can change any of them afterwards.'
        )
      )
        return;
      for (const [set, m, c] of g) SYSTEMS.set(set, m, c);
      changed(`${g.length} items assigned to a system`);
      openSystems();
    };
  const mw = dr.querySelector('.smwrap');
  if (mw) {
    const sv = mw.querySelector('svg');
    sv.removeAttribute('width');
    sv.removeAttribute('height');
    sysMapWire(mw, () => (dr.hidden = true));
  }
  const mb = dr.querySelector('#smbig');
  if (mb) mb.onclick = sysMapBig;
}
// the interlinkages, drawn with the grammar of the reference system diagram: one box per system (the box style of
// the technologies, edge in the system colour), one vertical line per commodity that crosses from one system to another
// (its colour, icon and code on top), arrows from the systems that make it to the line and from the line to the systems
// that use it; systems in columns from the sources to the users; a flow that goes back runs under the boxes
function sysCross() {
  const C = new Map();
  if (!M || !M.flows) return C;
  for (const fl of M.flows) {
    const st = SYSTEMS.of(fl.t, 'TECHNOLOGY');
    if (!st) continue;
    if (!C.has(fl.f)) C.set(fl.f, {f: fl.f, P: new Map(), U: new Map()});
    const e = C.get(fl.f),
      m = fl.dir === 'in' ? e.U : e.P;
    if (!m.has(st)) m.set(st, new Set());
    m.get(st).add(fl.t);
  }
  for (const [f, e] of [...C]) {
    if (!e.P.size) {
      const cs = SYSTEMS.of(f, 'COMMODITY');
      if (cs) e.P.set(cs, new Set());
    }
    for (const u of [...e.U.keys()]) if (e.P.has(u) && e.P.size === 1) e.U.delete(u);
    if (!e.P.size || !e.U.size || new Set([...e.P.keys(), ...e.U.keys()]).size < 2) C.delete(f);
  }
  return C;
}
function sysMapSVG(pre) {
  pre = pre || 'sm';
  const S = SYSTEMS.list,
    C = [...sysCross().values()].sort((a, b) => a.f.localeCompare(b.f));
  const BW = 184,
    BH = 58,
    VG = 30,
    BG = 34,
    PAD = 16;
  // ranking: system graph from producers to users, cycles broken (sources first, then the largest out - in), longest path
  const out = new Map(S.map(s => [s.c, new Set()])),
    inn = new Map(S.map(s => [s.c, new Set()]));
  for (const e of C)
    for (const p of e.P.keys())
      for (const u of e.U.keys())
        if (p !== u && out.has(p) && out.has(u)) {
          out.get(p).add(u);
          inn.get(u).add(p);
        }
  const linked = S.map(s => s.c).filter(c => out.get(c).size || inn.get(c).size),
    rest = S.map(s => s.c).filter(c => !linked.includes(c));
  const left = new Set(linked),
    head = [],
    tail = [];
  const deg = (c, m) => [...m.get(c)].filter(x => left.has(x)).length;
  while (left.size) {
    let moved = true;
    while (moved) {
      moved = false;
      for (const c of [...left])
        if (!deg(c, out)) {
          tail.unshift(c);
          left.delete(c);
          moved = true;
        }
      for (const c of [...left])
        if (!deg(c, inn)) {
          head.push(c);
          left.delete(c);
          moved = true;
        }
    }
    if (left.size) {
      const c = [...left].sort(
        (a, b) => deg(b, out) - deg(b, inn) - (deg(a, out) - deg(a, inn)) || linked.indexOf(a) - linked.indexOf(b)
      )[0];
      head.push(c);
      left.delete(c);
    }
  }
  const order = [...head, ...tail],
    pos = new Map(order.map((c, i) => [c, i])),
    rank = new Map();
  for (const c of order) {
    let r = 0;
    for (const p of inn.get(c)) if (pos.get(p) < pos.get(c)) r = Math.max(r, rank.get(p) + 1);
    rank.set(c, r);
  }
  const ncol = Math.max(0, ...rank.values()) + 1,
    cols = Array.from({length: linked.length ? ncol : 0}, () => []);
  for (const c of order) cols[rank.get(c)].push(c);
  // commodity lines: in the gap after the last column that makes them
  const busCol = e => Math.max(...[...e.P.keys()].map(p => (rank.has(p) ? rank.get(p) : 0)));
  const gaps = cols.map(() => []);
  for (const e of C) gaps[Math.min(busCol(e), cols.length - 1)].push(e);
  const lab = Math.max(40, ...C.map(e => e.f.length * 8.2)),
    TOP = PAD + lab + 18;
  const colX = [],
    busX = new Map();
  let x = PAD;
  cols.forEach((col, k) => {
    colX[k] = x;
    x += BW;
    const g = gaps[k];
    if (g.length) {
      x += 40;
      g.forEach((e, i) => busX.set(e.f, x + i * BG));
      x += (g.length - 1) * BG + 40;
    } else if (k < cols.length - 1) x += 60;
  });
  // the arrows; one that would cross the boxes of a column in between runs on a lane above the boxes
  const E = [];
  for (const e of C) {
    const bc = Math.min(busCol(e), cols.length - 1);
    for (const p of e.P.keys()) if (rank.has(p)) E.push({e, s: p, kind: rank.get(p) < bc ? 'outL' : 'out'});
    for (const u of e.U.keys()) if (rank.has(u)) E.push({e, s: u, kind: rank.get(u) <= bc ? 'back' : rank.get(u) > bc + 1 ? 'inL' : 'in'});
  }
  let nl = 0;
  for (const z of E) if (z.kind === 'outL' || z.kind === 'inL') z.lane = nl++;
  const BTOP = TOP + 30 + nl * 12;
  const colH = cols.map(c => c.length * BH + (c.length - 1) * VG),
    Hc = Math.max(BH, ...colH),
    box = new Map();
  cols.forEach((col, k) => {
    let y = BTOP + (Hc - colH[k]) / 2;
    for (const c of col) {
      box.set(c, {x: colX[k], y});
      y += BH + VG;
    }
  });
  for (const z of E) if (z.lane !== undefined) z.yl = TOP + 30 + z.lane * 12;
  const side = (s, k) => E.filter(z => z.s === s && (k.startsWith('out') ? z.kind.startsWith('out') : !z.kind.startsWith('out')));
  for (const z of E) {
    const L = side(z.s, z.kind).sort((a, b) => (busX.get(a.e.f) - busX.get(b.e.f)) * (z.kind.startsWith('out') ? 1 : -1)),
      b = box.get(z.s);
    z.y = b.y + (BH * (L.indexOf(z) + 1)) / (L.length + 1);
    z.i = L.indexOf(z);
  }
  const bottom = BTOP + Hc;
  let lane = 0;
  for (const z of E) if (z.kind === 'back') z.yb = bottom + 22 + 14 * lane++;
  const restY = (lane ? bottom + 22 + 14 * lane : bottom) + 44;
  const W = Math.max(x + PAD, PAD * 2 + rest.length * (BW + 16), 360),
    H = (rest.length ? restY + BH + 24 : restY - 20) + PAD;
  const mk = new Map(),
    mid = col => {
      if (!mk.has(col)) mk.set(col, `${pre}a${mk.size}`);
      return mk.get(col);
    };
  let buses = '';
  for (const e of C) {
    const bx = busX.get(e.f),
      col = fcol(e.f),
      mine = E.filter(z => z.e === e);
    const y1 = Math.max(...mine.map(z => z.yb || z.yl || z.y)) + 2,
      ic = iconFor(e.f),
      am = mid(col);
    const tl =
      [...e.P].map(([s, ts]) => `${SYSTEMS.name(s)}${ts.size ? ' (' + [...ts].join(', ') + ')' : ''}`).join('; ') +
      ' → ' +
      [...e.U].map(([s, ts]) => `${SYSTEMS.name(s)} (${[...ts].join(', ')})`).join('; ');
    let d = '';
    for (const z of mine) {
      const b = box.get(z.s);
      if (z.kind === 'out')
        d += `<path class="sme" d="M${b.x + BW},${z.y.toFixed(1)} H${bx - 1}" stroke="${col}" marker-end="url(#${am})"/>`;
      else if (z.kind === 'in')
        d += `<path class="sme" d="M${bx},${z.y.toFixed(1)} H${b.x - 1}" stroke="${col}" marker-end="url(#${am})"/>`;
      else if (z.kind === 'outL')
        d += `<path class="sme" d="M${b.x + BW},${z.y.toFixed(1)} H${b.x + BW + 12 + 5 * z.i} V${z.yl} H${bx - 1}" stroke="${col}" marker-end="url(#${am})"/>`;
      else if (z.kind === 'inL')
        d += `<path class="sme" d="M${bx},${z.yl} H${b.x - 14 - 5 * z.i} V${z.y.toFixed(1)} H${b.x - 1}" stroke="${col}" marker-end="url(#${am})"/>`;
      else
        d += `<path class="sme back" d="M${bx},${z.yb} H${b.x - 16} V${z.y.toFixed(1)} H${b.x - 1}" stroke="${col}" marker-end="url(#${am})"/>`;
    }
    buses += `<g class="smbus" data-f="${esc(e.f)}" tabindex="0" role="button" aria-label="${esc(e.f)}"><title>${esc(e.f)}${FD[e.f] ? ' · ' + esc(FD[e.f]) : ''}\n${esc(tl)}</title>
      <line class="smf" x1="${bx}" x2="${bx}" y1="${TOP - 2}" y2="${y1}" stroke="${col}"/><line class="smhit" x1="${bx}" x2="${bx}" y1="${PAD}" y2="${y1}"/>${d}
      <text class="sml" x="${bx + 4}" y="${TOP - 14}" transform="rotate(-90 ${bx + 4} ${TOP - 14})" fill="${col}">${esc(e.f)}</text>
      <circle cx="${bx}" cy="${TOP + 8}" r="10.5" class="smib" stroke="${col}"/>${ic ? iconSVG(ic, bx - 7, TOP + 1, 14, col) : ''}</g>`;
  }
  const boxSvg = (c, X, Y, k) => {
    const s = SYSTEMS.get(c),
      n = SYSTEMS.members(c).length,
      w = BW * k,
      h = BH * k;
    return `<g class="smbox${k < 1 ? ' smrest' : ''}" data-s="${esc(c)}" tabindex="0" role="button" aria-label="${esc(s.n)}"><title>${esc(s.n)}: ${n} items. Click: the diagram shows this system</title>
      <rect x="${X}" y="${Y}" width="${w}" height="${h}" rx="7" class="smr" stroke="${s.col}"/><rect x="${X}" y="${Y}" width="7" height="${h}" rx="3" fill="${s.col}"/>
      <text x="${X + 16}" y="${Y + h / 2 - 3}" class="smn">${esc(s.n.length > 22 ? s.n.slice(0, 21) + '…' : s.n)}</text><text x="${X + 16}" y="${Y + h / 2 + 13}" class="smc">${esc(c)} · ${n} item${n === 1 ? '' : 's'}</text></g>`;
  };
  const boxes = [...box].map(([c, b]) => boxSvg(c, b.x, b.y, 1)).join('');
  const restSvg = rest.length
    ? `<text x="${PAD}" y="${restY - 10}" class="smh">Not linked to another system</text>` +
      rest.map((c, i) => boxSvg(c, PAD + i * (BW + 16), restY, 0.999)).join('')
    : '';
  const defs = [...mk]
    .map(
      ([col, id]) =>
        `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${col}"/></marker>`
    )
    .join('');
  const svg = `<svg class="sysmap2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Interlinkages between the systems"><defs>${defs}</defs>
    ${C.length ? '' : `<text x="${PAD}" y="${PAD + 14}" class="smh">No commodity crosses from one system to another yet.</text>`}<g>${buses}</g><g>${boxes}${restSvg}</g></svg>`;
  return {svg, W, H, n: C.length};
}
function sysMapWire(root, close) {
  root.querySelectorAll('.smbox').forEach(g => {
    const go = () => {
      close();
      sysFilter([g.dataset.s]);
    };
    g.onclick = go;
    g.onkeydown = e => {
      if (e.key === 'Enter') go();
    };
  });
  root.querySelectorAll('.smbus').forEach(g => {
    const f = g.dataset.f,
      go = () => {
        close();
        const ts = new Set((M.flows || []).filter(x => x.f === f).map(x => x.t));
        if (ts.size) DVW.show(ts, 'commodity ' + f);
      };
    g.onclick = go;
    g.onkeydown = e => {
      if (e.key === 'Enter') go();
    };
  });
}
function sysMapBig() {
  let ov = document.getElementById('sysbig');
  if (ov) ov.remove();
  const m = sysMapSVG('sb');
  ov = Object.assign(document.createElement('div'), {id: 'sysbig', className: 'sysbig'});
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-label', 'Interlinkages between the systems');
  ov.innerHTML = `<div class="sbh"><b>Interlinkages between the systems</b><span class="muted">${m.n} commodit${m.n === 1 ? 'y crosses' : 'ies cross'} · click a system or a commodity to see it in the diagram</span><button type="button" class="btn sm" id="sbsvg">Save SVG</button><button type="button" class="btn sm" id="sbx">Close</button></div><div class="sbb">${m.svg}</div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  const sv = ov.querySelector('svg');
  sv.removeAttribute('width');
  sv.removeAttribute('height');
  ov.querySelector('#sbx').onclick = close;
  ov.onkeydown = e => {
    if (e.key === 'Escape') close();
  };
  ov.tabIndex = -1;
  ov.focus();
  ov.querySelector('#sbsvg').onclick = () => {
    const css =
      '.sme{fill:none;stroke-width:2}.sme.back{stroke-dasharray:6 4}.smf{stroke-width:3}.smhit{display:none}.smib{fill:#fff;stroke-width:2}.smr{fill:#fff;stroke-width:2.6}.sml{font:700 12.5px sans-serif;letter-spacing:.04em}.smn{font:700 13.5px sans-serif;fill:#1b1b1a}.smc{font:10.5px monospace;fill:#555}.smh{font:600 12px sans-serif;fill:#555}';
    const t = m.svg.replace('<defs>', `<defs><style>${css}</style>`);
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([t], {type: 'image/svg+xml'})),
      download: 'interlinkages.svg'
    });
    a.click();
  };
  sysMapWire(ov, close);
}
function sysLinksHtml(L) {
  const S = SYSTEMS.list;
  if (!S.length) return '<p class="muted">No system yet.</p>';
  const m = sysMapSVG('sm');
  const map = `<div class="smbar"><span class="muted">${m.n} commodit${m.n === 1 ? 'y crosses' : 'ies cross'} between the systems</span><button type="button" class="btn sm" id="smbig">Large view</button></div><div class="smwrap">${m.svg}</div>`;
  const rows = L.sort((x, y) => x.a.localeCompare(y.a) || x.b.localeCompare(y.b))
    .map(
      l =>
        `<tr><td>${sysDot(l.a)}${esc(SYSTEMS.name(l.a))}</td><td>→</td><td>${sysDot(l.b)}${esc(SYSTEMS.name(l.b))}</td><td>${[...l.comm.entries()].map(([f, ts]) => `<b>${esc(f)}</b> <span class="muted">(${esc([...ts].join(', '))})</span>`).join('<br>')}</td></tr>`
    )
    .join('');
  return `${map}<p class="hint">Click a system: the diagram shows its technologies; click a commodity: the technologies that make and use it. Dashed: a flow that goes back to an earlier system. ${L.length ? '' : 'No interlinkage yet: assign the technologies and the commodities to their systems.'}</p>
    ${L.length ? `<table class="systbl"><thead><tr><th>From (commodity of)</th><th></th><th>To (used / made by a technology of)</th><th>Commodities (technologies)</th></tr></thead><tbody>${rows}</tbody></table>` : ''}`;
}
// the diagram shows only some systems: their technologies (the commodities between them follow); with links: the
// technologies on both sides of each commodity that crosses from one of them to another
function sysFilter(codes, linksOnly) {
  if (typeof DVW === 'undefined' || !DVW.show) return toast('The diagram filter is not available in this view');
  const want = new Set(codes.flatMap(c => SYSTEMS.family(c))),
    keep = new Set(); // with the sub-systems
  if (!linksOnly) {
    for (const t of M.techs) if (want.has(SYSTEMS.of(t, 'TECHNOLOGY'))) keep.add(t);
  } else
    for (const l of SYSTEMS.links().values())
      if (want.has(l.a) && want.has(l.b))
        for (const [f, ts] of l.comm) {
          for (const t of ts) keep.add(t);
          for (const fl of M.flows || []) if (fl.f === f) keep.add(fl.t);
        }
  if (!keep.size)
    return toast(linksOnly ? 'No commodity crosses between these systems.' : 'No technology in these systems yet: assign them in Systems.');
  DVW.show(keep, `${linksOnly ? 'interlinkages ' : 'systems: '}${codes.map(c => SYSTEMS.name(c) || c).join(linksOnly ? ' ↔ ' : ', ')}`);
}
const SYS_KIND = kind => ['tech', 'comm', 'stor', 'emi'].includes(kind);
