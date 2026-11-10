'use strict';
/* ============================== Years a technology is on ==============================
   As done in a national model (no new gas or export capacity in 2022-24, shale from 2030, GME conversion from 2053...):
   a technology can be BUILT only in some years and USED only in some years, in all or some regions, or switched OFF.
   Written into the data (so any solver sees it), with the values it replaced kept, so changing or removing the rule
   puts them back:
     no new capacity outside the build years   TotalAnnualMaxCapacityInvestment[r,t,y] = 0
     no activity outside the years of use      TotalTechnologyAnnualActivityUpperLimit[r,t,y] = 0   (existing capacity may stay idle)
   Saved in the data file as comment lines (GLPK ignores them):
     #@onoff <tech> build <from> <to> use <from> <to> regions <R1,R2|all>      #@onoffbak <tech> <param> <index...> <value|none> */
let ONOFF = {}; // {tech: {build: [a, b] | null, use: [a, b] | null, regions: [] (all), bak: {'param|r|t|y': value | null}}}
const OO_P = {build: 'TotalAnnualMaxCapacityInvestment', use: 'TotalTechnologyAnnualActivityUpperLimit'};
function ooIdx(p, r, t, y) {
  const d = dimsOf(p);
  return d.map(x => (x === 'REGION' ? r : x === 'TECHNOLOGY' ? t : x === 'YEAR' ? String(y) : null));
}
function ooRestore(t) {
  const o = ONOFF[t];
  if (!o) return 0;
  let n = 0;
  for (const [k, v] of Object.entries(o.bak || {})) {
    const [p, ...idx] = k.split('|');
    cellSetBase(p, idx, v === null ? null : v);
    n++;
  }
  o.bak = {};
  return n;
}
/* set (or clear, with rule null) the years of a technology; returns the number of values written */
function setOnOff(t, rule) {
  ooRestore(t);
  if (!rule || (!rule.build && !rule.use && !rule.off)) {
    delete ONOFF[t];
    return 0;
  }
  const ys = (M.D.sets.YEAR || []).map(String),
    regs = rule.regions && rule.regions.length ? rule.regions : REG,
    bak = {};
  let n = 0;
  const outside = w => y => rule.off || (w && (+y < +w[0] || +y > +w[1]));
  for (const [kind, p] of Object.entries(OO_P)) {
    if (!pinfo(p) || !dimsOf(p).length) continue;
    const out = outside(rule[kind]);
    for (const r of regs)
      for (const y of ys)
        if (out(y)) {
          const idx = ooIdx(p, r, t, y);
          if (idx.includes(null)) continue;
          const k = [p, ...idx].join('|'),
            old = cellGetBase(p, idx);
          bak[k] = old === undefined ? null : old;
          cellSetBase(p, idx, 0);
          n++;
        }
  }
  ONOFF[t] = {
    build: rule.off ? null : rule.build || null,
    use: rule.off ? null : rule.use || null,
    off: !!rule.off,
    regions: rule.regions || [],
    bak
  };
  return n;
}
function onoffLines() {
  const L = [];
  for (const [t, o] of Object.entries(ONOFF)) {
    if (!(M.D.sets.TECHNOLOGY || []).includes(t)) continue;
    L.push(
      `#@onoff ${t} ${o.off ? 'off' : ''}${o.build ? ` build ${o.build[0]} ${o.build[1]}` : ''}${o.use ? ` use ${o.use[0]} ${o.use[1]}` : ''} regions ${o.regions.length ? o.regions.join(',') : 'all'}`.replace(
        /\s+/g,
        ' '
      )
    );
    for (const [k, v] of Object.entries(o.bak || {})) L.push(`#@onoffbak ${t} ${k.split('|').join(' ')} ${v === null ? 'none' : v}`);
  }
  return L;
}
function parseOnoff(text) {
  const O = {};
  for (const m of text.matchAll(/^#@onoff\s+(\S+)\s+(.*)$/gm)) {
    const w = m[2].trim().split(/\s+/),
      o = {build: null, use: null, off: false, regions: [], bak: {}};
    for (let i = 0; i < w.length; i++) {
      if (w[i] === 'off') o.off = true;
      else if (w[i] === 'build' || w[i] === 'use') {
        o[w[i]] = [w[i + 1], w[i + 2]];
        i += 2;
      } else if (w[i] === 'regions') {
        o.regions = w[i + 1] === 'all' ? [] : w[i + 1].split(',');
        i++;
      }
    }
    O[m[1]] = o;
  }
  for (const m of text.matchAll(/^#@onoffbak\s+(\S+)\s+(.*)$/gm)) {
    const w = m[2].trim().split(/\s+/),
      v = w.pop();
    if (O[m[1]]) O[m[1]].bak[w.join('|')] = v === 'none' ? null : Number(v);
  }
  return O;
}
const ooText = t => {
  const o = ONOFF[t];
  if (!o) return '';
  if (o.off) return 'off';
  return (
    [o.build ? `built ${o.build[0]}–${o.build[1]}` : '', o.use ? `used ${o.use[0]}–${o.use[1]}` : ''].filter(Boolean).join(', ') +
    (o.regions.length ? ` (${o.regions.join(', ')})` : '')
  );
};

/* the row in a technology's panel */
function onoffRow(t) {
  const o = ONOFF[t] || {},
    ys = (M.D.sets.YEAR || []).map(String),
    y0 = ys[0],
    y1 = ys[ys.length - 1];
  const ysel = (id, cur) =>
    `<select id="${id}">${ys.map(y => `<option ${String(cur) === y ? 'selected' : ''}>${y}</option>`).join('')}</select>`;
  return `<fieldset class="oorow"><legend>Years this technology is on ${ooText(t) ? `<span class="sev info">${esc(ooText(t))}</span>` : ''}</legend>
    <label class="chk"><input type="checkbox" id="oooff" ${o.off ? 'checked' : ''}> switched off (no new capacity, no activity, all years)</label>
    <div class="oogrid"><label class="chk"><input type="checkbox" id="oob" ${o.build ? 'checked' : ''}> can be built only from</label>${ysel('oob0', o.build ? o.build[0] : y0)}<span>to</span>${ysel('oob1', o.build ? o.build[1] : y1)}
      <label class="chk"><input type="checkbox" id="oou" ${o.use ? 'checked' : ''}> can be used only from</label>${ysel('oou0', o.use ? o.use[0] : y0)}<span>to</span>${ysel('oou1', o.use ? o.use[1] : y1)}</div>
    ${REG.length > 1 ? `<div class="ooregs">In: ${REG.map(r => `<label class="chk"><input type="checkbox" class="oor" value="${esc(r)}" ${!o.regions || !o.regions.length || o.regions.includes(r) ? 'checked' : ''}> ${esc(r)}</label>`).join('')}</div>` : ''}
    <div class="acts"><button type="button" class="btn" id="ooapply">Apply the years</button>${ONOFF[t] ? '<button type="button" class="btn" id="ooclear">Remove (put the values back)</button>' : ''}</div>
    <p class="hint">Outside the build years: TotalAnnualMaxCapacityInvestment = 0 (no new capacity). Outside the years of use: TotalTechnologyAnnualActivityUpperLimit = 0 (existing capacity stays idle). Written in the data, so every solver sees it; the replaced values are kept and come back when you change or remove the rule.</p></fieldset>`;
}
function wireOnoff(dr, t, done) {
  const q = s => dr.querySelector(s);
  if (!q('#ooapply')) return;
  q('#ooapply').onclick = () => {
    const regs = [...dr.querySelectorAll('.oor')],
      on = regs.filter(c => c.checked).map(c => c.value);
    if (regs.length && !on.length) return toast('Tick at least one region');
    const rule = {
      off: q('#oooff').checked,
      build: q('#oob').checked ? [q('#oob0').value, q('#oob1').value] : null,
      use: q('#oou').checked ? [q('#oou0').value, q('#oou1').value] : null,
      regions: on.length === REG.length ? [] : on
    };
    if ((rule.build && +rule.build[0] > +rule.build[1]) || (rule.use && +rule.use[0] > +rule.use[1]))
      return toast('The first year must come before the last one');
    const n = setOnOff(t, rule);
    afterEdit(ONOFF[t] ? `${t}: ${ooText(t)} (${n} values set to 0)` : `${t}: on in every year`);
    done && done();
  };
  const c = q('#ooclear');
  if (c)
    c.onclick = () => {
      const n = ooRestore(t);
      delete ONOFF[t];
      afterEdit(`${t}: years removed, ${n} values put back`);
      done && done();
    };
}
