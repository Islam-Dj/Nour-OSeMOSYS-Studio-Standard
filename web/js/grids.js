'use strict';
// parameters that may be negative by nature: the fill tool lets them go below 0 only when asked
// VariableCost added (a negative variable cost is a revenue per unit of activity, as SalePrice)
// -1 is a code (no limit / not used / the land's value) in UDCTag, CropSoilMax, MaxUnderConstruction(Storage), FinanceRateTech / Storage;
// CropSowingDay counts back into the year before (0, -1 ...)
const NEGOK =
  /^(SalePrice|VariableCost|EmissionActivityRatio|EmissionToActivityChangeRatio|UDCMultiplier\w*|UDCConstant|UDCTag|EmissionsPenalty|CascadeSoilStart|LinkFrom|CropSowingDay|CropSoilMax|MaxUnderConstruction|MaxUnderConstructionStorage|FinanceRateTech|FinanceRateStorage)$/;
// shares: a value above 1 is suspect (factors by vintage or age, profiles of the ratios and crop coefficients may exceed 1)
const SHARE1 = new Set([
  'CascadeSoilDrain',
  'AvailabilityFactor',
  'CapacityFactor',
  'YearSplit',
  'SpecifiedDemandProfile',
  'DiscountRate',
  'DiscountRateIdv',
  'DaySplit',
  'MinStorageCharge',
  'StorageMaxLevel',
  'StorageAvailability',
  'StorageSelfDischarge',
  'StorageCapacityFade',
  'MinStableLoad', // OperationalProfile: any scale (only the shape counts)
  'FinanceRentShare',
  'FinanceRentShareTech',
  'FinanceMaxShare',
  'FinanceMinShare',
  'FinanceMaxShareStorage',
  'FinanceMinShareStorage',
  'FinanceDrawShare',
  'FinanceBudgetImportShare',
  'FinanceBudgetOpexShare'
]);
// what is wrong with a value of parameter p ('' = nothing): shown on the cell (⚠) and listed by the checks (VALUES)
function cellIssue(p, v) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'number' || !Number.isFinite(v)) return `not a number (${v})`;
  if (v < 0 && !NEGOK.test(p)) return 'negative value: this parameter is normally ≥ 0';
  if (v > 1 + 1e-9 && SHARE1.has(p)) return 'above 1: this parameter is a share (0 to 1)';
  return '';
}
// suspect values of the base data, by item: 'tech:PWRGAS' / 'comm:ELC' / 'stor:BAT' / 'emi:CO2' / 'udc:U1' / 'all' -> [{p, idx, msg}]
// (kept until the data changes: VI.stamp moves on every edit; used by the model browser, the editors and the checks)
const VI = {stamp: 0, at: -1, map: null};
const viTouch = () => {
  VI.stamp++;
};
function valueIssues() {
  if (VI.map && VI.at === VI.stamp) return VI.map;
  const m = new Map();
  if (M && M.D)
    for (const [p, P] of Object.entries(M.D.params)) {
      if (!P || !P.recs || !P.recs.length) continue;
      const d = dimsOf(p),
        ek = Object.entries(ENTSET)
          .map(([k, set]) => [k, d.indexOf(set)])
          .filter(x => x[1] >= 0)[0];
      for (const r of P.recs) {
        const msg = cellIssue(p, r.v);
        if (!msg) continue;
        const key = ek ? ek[0] + ':' + r.idx[ek[1]] : 'all';
        if (!m.has(key)) m.set(key, []);
        m.get(key).push({p, idx: r.idx.map(String), msg});
      }
    }
  VI.map = m;
  VI.at = VI.stamp;
  return m;
}
// open the editor of the item that holds a value, open its topic and block (region), and select the cell
function goToCell(p, idx) {
  const d = dimsOf(p),
    ek = Object.entries(ENTSET)
      .map(([k, set]) => [k, d.indexOf(set)])
      .filter(x => x[1] >= 0)[0];
  let kind = ek ? ek[0] : 'all',
    code = ek ? String(idx[ek[1]]) : null;
  if (ek && typeof paramsFor === 'function' && !paramsFor(kind).includes(p)) {
    kind = 'all';
    code = null;
  }
  if (
    !EDIT ||
    EDIT.kind !== kind ||
    EDIT.code !== code ||
    !document.querySelector('#drawer .pblk[data-p]') ||
    document.getElementById('drawer').hidden
  )
    openEntity(kind, code);
  const dr = document.getElementById('drawer'),
    b = dr.querySelector(`.pblk[data-p="${p}"]`);
  if (!b) return toast(`${p}: not in this editor`);
  for (let e = b.parentElement; e && e !== dr; e = e.parentElement) if (e.tagName === 'DETAILS') e.open = true;
  b._st = true;
  b.open = true;
  const host = b.querySelector('.ghost'),
    rs = b.querySelector('.preg'),
    rp = d.indexOf('REGION');
  if (rs && rp >= 0 && rs.value !== String(idx[rp])) {
    rs.value = String(idx[rp]);
    delete host.dataset.lazy;
    b._render();
  } else if (!host.innerHTML || host.dataset.lazy) {
    delete host.dataset.lazy;
    b._render();
  }
  b.scrollIntoView({block: 'start'});
  if (typeof KEEP !== 'undefined') KEEP.jump();
  if (!(host._goto && host._goto(idx))) toast(`${p} [${idx.join(', ')}]: the cell is not in this grid`);
}
/* ---- grid editor: one parameter for one entity (technology, commodity, ...) ----
   every operation (typing, Fill, paste, series, clear, remove row) works on the data, not on the cells drawn, so a
   grid with many rows draws only the rows in view (VROW); each operation is one step of undo / redo (Ctrl+Z / Ctrl+Y, up
   to 60 steps per editor); arrows, Enter and Tab move between cells; Shift + arrows select a block that Ctrl+C copies and
   Delete clears. The Excel way (select, then double-click / F2 / typing to edit), rows / columns / all selected by
   their headers, Ctrl+X / Ctrl+D / Ctrl+R / Ctrl+A, paste at the selected cell, suspect values marked (cellIssue). */
let EDIT = null; // {kind, code, snap, undo: [], redo: []}
const VROW = 150; // grids with more rows draw only the rows in view
// state of one cell, to undo exactly (in a scenario: whether the scenario changes it, and to what)
function cellSnap(p, idx) {
  const k = idx.map(String).join('|'),
    sc = typeof SCEN !== 'undefined' ? SCEN.edit : 'SC_0';
  if (sc === 'SC_0') return {sc, k, b: cellGetBase(p, idx)};
  const o = scenOv(sc, p);
  return {sc, k, has: !!o && Object.prototype.hasOwnProperty.call(o, k), v: o ? o[k] : undefined};
}
function cellRestore(p, idx, s) {
  if (s.sc === 'SC_0') return cellSetBase(p, idx, s.b === undefined ? null : s.b);
  const o = scenOv(s.sc, p, true);
  if (s.has) o[s.k] = s.v;
  else delete o[s.k];
}
// one undoable step: [[p, idx, before, after]]
function editLog(label) {
  const ch = [];
  return {
    ch,
    label,
    set(p, idx, v) {
      const b = cellSnap(p, idx);
      cellSet(p, idx, v);
      ch.push([p, idx, b, cellSnap(p, idx)]);
    },
    done() {
      if (!ch.length || !EDIT) return;
      (EDIT.undo = EDIT.undo || []).push({label, ch});
      if (EDIT.undo.length > 60) EDIT.undo.shift();
      EDIT.redo = [];
      EDIT.changed = true;
      viBadges();
    }
  };
}
// badges of suspect values: model browser (⚠ on the item), editor (⚠ n on the parameter and on its topic)
function viBadges() {
  viTouch();
  clearTimeout(VI.t);
  VI.t = setTimeout(() => {
    if (typeof renderBrowser === 'function') renderBrowser();
    edBadges();
  }, 150);
}
function edBadges() {
  const dr = document.getElementById('drawer');
  if (!dr || dr.hidden || !EDIT) return;
  const key = EDIT.kind === 'all' || EDIT.kind === 'glob' ? null : EDIT.kind + ':' + EDIT.code;
  const all = valueIssues(),
    L = key ? all.get(key) || [] : [...all.values()].flat(),
    byP = new Map();
  for (const x of L) {
    if (!byP.has(x.p)) byP.set(x.p, []);
    byP.get(x.p).push(x);
  }
  dr.querySelectorAll('details.pblk').forEach(b => {
    let w = b.querySelector(':scope > summary .wbadge');
    const n = (byP.get(b.dataset.p) || []).length;
    if (!n) {
      if (w) w.remove();
      return;
    }
    if (!w) {
      w = document.createElement('span');
      w.className = 'wbadge';
      b.querySelector(':scope > summary').appendChild(w);
    }
    w.textContent = `⚠ ${n}`;
    w.title = `${n} suspect value${n > 1 ? 's' : ''}: ${byP.get(b.dataset.p)[0].msg}. Click: go to the first one`;
    w.onclick = ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const x = byP.get(b.dataset.p)[0];
      goToCell(x.p, x.idx);
    };
  });
  dr.querySelectorAll('details.tgrp').forEach(g => {
    let w = g.querySelector(':scope > summary .wbadge');
    let n = 0;
    g.querySelectorAll('details.pblk').forEach(b => (n += (byP.get(b.dataset.p) || []).length));
    if (!n) {
      if (w) w.remove();
      return;
    }
    if (!w) {
      w = document.createElement('span');
      w.className = 'wbadge';
      const s = g.querySelector(':scope > summary');
      s.insertBefore(w, s.querySelector('.n'));
    }
    w.textContent = `⚠ ${n}`;
    w.title = `${n} suspect value${n > 1 ? 's' : ''} in this topic`;
    w.onclick = ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const b = [...g.querySelectorAll('details.pblk')].find(b => byP.has(b.dataset.p));
      if (b) {
        const x = byP.get(b.dataset.p)[0];
        goToCell(x.p, x.idx);
      }
    };
  });
}
function undoRedo(redo) {
  if (!EDIT) return;
  const from = redo ? EDIT.redo || [] : EDIT.undo || [],
    to = redo ? (EDIT.undo = EDIT.undo || []) : (EDIT.redo = EDIT.redo || []);
  const st = from.pop();
  if (!st) return toast(redo ? 'Nothing to redo' : 'Nothing to undo');
  const ps = new Set();
  for (const [p, idx, b, a] of redo ? st.ch : [...st.ch].reverse()) {
    cellRestore(p, idx, redo ? a : b);
    ps.add(p);
  }
  to.push(st);
  EDIT.changed = true;
  viBadges();
  document.querySelectorAll('#drawer .ghost').forEach(h => {
    if (h._refresh && ps.has(h._p)) (h._rebuild || h._refresh)();
  });
  toast(`${redo ? 'Redone' : 'Undone'}: ${st.label} (${st.ch.length} value${st.ch.length > 1 ? 's' : ''})`);
}

function gridFor(p, kind, code, region, host) {
  const d = dimsOf(p),
    es = ENTSET[kind],
    epos = es ? d.indexOf(es) : -1,
    rpos = d.indexOf('REGION');
  // columns: the years; without a year, the last small index (mode, season...) when another index gives the rows
  let ypos = d[d.length - 1] === 'YEAR' ? d.length - 1 : -1;
  const x0 = d.map((_, i) => i).filter(i => i !== epos && i !== rpos && i !== ypos);
  if (ypos < 0 && x0.length >= 2 && !SPARSE.has(d[x0[x0.length - 1]])) ypos = x0[x0.length - 1];
  const xpos = x0.filter(i => i !== ypos),
    colSet = ypos >= 0 ? (d[ypos] === 'YEAR' ? M.years.map(String) : setOf(d[ypos]).map(String)) : null;
  const sparse = xpos.some(i => SPARSE.has(d[i]));
  const fix = vals => {
    const idx = [];
    let k = 0;
    for (let i = 0; i < d.length; i++) {
      if (i === epos) idx.push(code);
      else if (i === rpos) idx.push(region);
      else if (i === ypos) idx.push(null);
      else idx.push(vals[k++]);
    }
    return idx;
  };
  const match = r => (epos < 0 || r.idx[epos] === code) && (rpos < 0 || r.idx[rpos] === region);
  const recs = [...(M.D.params[p] || {recs: []}).recs, ...scenRecs(p)].filter(match);
  let rows;
  if (sparse)
    rows = [
      ...new Map(
        recs.map(r => {
          const v = xpos.map(i => String(r.idx[i]));
          return [v.join('|'), v];
        })
      ).values()
    ];
  else {
    const mem = i => ((d[i] === 'AGE' || d[i] === 'VINTAGE') && es === 'TECHNOLOGY' && VINT.on() ? VINT.rowsFor(d[i], code) : setOf(d[i])); // a technology's own ages / vintages
    rows = [[]];
    for (const i of xpos) {
      const n = [];
      for (const a of rows) for (const m of mem(i)) n.push([...a, String(m)]);
      rows = n;
    }
  }
  // ---- what this grid shows while its editor is open: a search, filters on each row index
  //      (and on the season / day part of a time slice), rows and columns selected by a click (Ctrl / Shift for several),
  //      the rows just added, the scroll. Kept when the grid is redrawn, forgotten for another parameter or region.
  const ST =
    host._gst && host._gst.p === p && host._gst.region === region && host._gst.kind === kind && host._gst.code === code
      ? host._gst
      : (host._gst = {
          p,
          region,
          kind,
          code,
          q: '',
          flt: {},
          rsel: new Set(),
          csel: new Set(),
          newk: new Set(),
          top: 0,
          lastR: null,
          lastC: null
        });
  {
    const g0 = host.querySelector('.gw');
    if (g0) ST.top = g0.scrollTop;
  }
  const allRows = rows,
    rkey = r => r.join('|');
  const tsMap = {};
  xpos.forEach((i, k) => {
    if (d[i] === 'TIMESLICE')
      for (const cp of ['Conversionls', 'Conversionld', 'Conversionlh']) {
        const mm = new Map();
        for (const r of getRecs(cp, [])) if (r.v) mm.set(String(r.idx[0]), String(r.idx[1]));
        tsMap[k + '|' + cp] = mm;
      }
  });
  const rowText = r =>
    r
      .map(
        (v, k) => v + ' ' + (sdesc(d[xpos[k]], v) || (d[xpos[k]] === 'COMMODITY' ? FD[v] : d[xpos[k]] === 'TECHNOLOGY' ? TD[v] : '') || '')
      )
      .join(' ')
      .toLowerCase();
  const passes = r => {
    for (const [fk, set] of Object.entries(ST.flt)) {
      const [k, cp] = fk.split('|');
      const v = cp ? (tsMap[k + '|' + cp] || new Map()).get(r[+k]) : r[+k];
      if (!set.has(String(v))) return false;
    }
    if (ST.q) {
      const t = rowText(r);
      if (!ST.q.split(/\s+/).every(w => t.includes(w))) return false;
    }
    return true;
  };
  if (ST.q || Object.keys(ST.flt).length) rows = rows.filter(passes);
  const cols = colSet || ['value'],
    yearCols = ypos >= 0 && d[ypos] === 'YEAR';
  const def = defOf(p),
    defN = Number(def) || 0;
  // values when the editor was opened (EDIT.snap): a cell changed since then is marked (blue)
  const base0 = (() => {
    if (!EDIT || !EDIT.snap) return null;
    if (!EDIT._snap0) EDIT._snap0 = typeof EDIT.snap === 'string' ? JSON.parse(EDIT.snap).params : EDIT.snap.params;
    const P0 = EDIT._snap0[p];
    if (!P0) return new Map();
    if (!P0._m) P0._m = new Map(P0.recs.map(r => [r.idx.map(String).join('|'), r.v]));
    return P0._m;
  })();
  const changed = (ix, v) => {
    if (!base0 || (typeof SCEN !== 'undefined' && SCEN.edit !== 'SC_0')) return false;
    const b = base0.get(ix.map(String).join('|'));
    return (b === undefined ? undefined : Number(b)) !== (v === undefined || v === null || v === '' ? undefined : Number(v));
  };
  const unit = typeof paramUnitFor === 'function' ? paramUnitFor(p, kind, code) : '';
  const idxOf = (row, col) => {
    const idx = fix(row);
    if (ypos >= 0) idx[ypos] = col;
    return idx;
  };
  // data access (every operation goes through these: the rows not drawn are changed too)
  const val = (ri, ci) => {
    const v = cellGet(p, idxOf(rows[ri], cols[ci]));
    return v === undefined || v === null || v === '' ? undefined : Number(v);
  };
  const cur = (ri, ci) => {
    const v = val(ri, ci);
    return v === undefined ? defN : v;
  };
  const vh =
    VINT.on() && d.some(x => x === 'AGE' || x === 'VINTAGE')
      ? `<p class="hint">${esc(VINT.summary())}${es === 'TECHNOLOGY' ? ` · ${esc(code)}: life ${VINT.life(null, code)} years` : ''}. Ages and vintages are made by the Studio from the years and OperationalLife; the parameter applies only to technologies with VintageMode 1 or 2.${p === 'ResidualCapacityByVintage' && es === 'TECHNOLOGY' ? ` The cohorts still alive must add up to ResidualCapacity in every year. <button type="button" class="btn sm" onclick="vintResidual(${esc(JSON.stringify(code))})">ResidualCapacity from the vintages</button> <button type="button" class="btn sm" title="Split ResidualCapacity into cohorts: a fall in year y is a cohort built in y - life" onclick="vintFromResidual(${esc(JSON.stringify(code))})">Vintages from ResidualCapacity</button>` : ''}</p>`
      : '';
  const ncol = Math.max(1, xpos.length) + cols.length + (yearCols ? 1 : 0) + (sparse ? 1 : 0);
  const rowHtml = ri => {
    const row = rows[ri],
      rk0 = rkey(row),
      rcl = (ST.rsel.has(rk0) ? 'rsel ' : '') + (ST.newk.has(rk0) ? 'rnew' : '');
    return `<tr data-row="${esc(row.join('|'))}" data-ri="${ri}"${rcl.trim() ? ` class="${rcl.trim()}"` : ''}>${
      row.length
        ? row
            .map((v, k) => {
              const t = sdesc(d[xpos[k]], v) || (d[xpos[k]] === 'COMMODITY' ? FD[v] : d[xpos[k]] === 'TECHNOLOGY' ? TD[v] : '') || '';
              return `<td class="k" data-rk="${ri}" title="${esc((t ? t + ' · ' : '') + 'click: select the row · Ctrl+click: add or remove one · Shift+click: a range')}">${esc(v)}${t ? ` <span class="dsc">${esc(t.length > 22 ? t.slice(0, 21) + '…' : t)}</span>` : ''}</td>`;
            })
            .join('')
        : '<td class="k">—</td>'
    }${cols
      .map((c, ci) => {
        const ix = idxOf(row, c),
          v = cellGet(p, ix);
        const iss = cellIssue(p, v),
          cl = [scenHas(p, ix) ? 'ovr' : '', iss ? 'warn' : '', changed(ix, v) ? 'chg' : ''].filter(Boolean).join(' ');
        return `<td${ST.csel.has(String(c)) ? ' class="csel"' : ''}><input readonly data-r="${ri}" data-c="${ci}" ${cl ? `class="${cl}"` : ''} ${iss ? `title="⚠ ${esc(iss)}"` : scenHas(p, ix) ? 'title="changed in this scenario"' : ''} value="${v === undefined ? '' : esc(String(v))}" placeholder="${def}"></td>`;
      })
      .join('')}${
      yearCols ? `<td><input class="fill" data-r="${ri}" placeholder="e.g. 2025:1, 2050:2"></td>` : ''
    }${sparse ? `<td><button type="button" class="btn rmrow" data-r="${ri}" title="Remove row">×</button></td>` : ''}</tr>`;
  };
  const virt = rows.length > VROW;
  // toolbar of the grid: search, filters, selection
  const gbar =
    xpos.length && allRows.length > 1
      ? `<div class="gbar"><input type="search" class="gq" placeholder="Search rows" value="${esc(ST.q)}" title="Code or name; several words = all of them"><span class="gflt"></span>${
          ST.q || Object.keys(ST.flt).length
            ? '<button type="button" class="lnk gclr" title="Show every row again">Clear filters</button>'
            : ''
        }<span class="gcount">${rows.length} of ${allRows.length} rows</span>
      <span class="gsel"></span><button type="button" class="btn sm gsall" title="Select every row shown">Select shown</button><button type="button" class="btn sm gdel" hidden></button></div>`
      : '';
  const html =
    vh +
    gbar +
    `<div class="gw"${virt ? ' data-virt="1"' : ''}><table class="grid" data-p="${p}"><thead><tr>${xpos.map((i, k) => `<th class="k" data-all="1" title="click: select every cell">${d[i].replace('MODE_OF_OPERATION', 'MODE').toLowerCase()}${k === 0 && unit ? ` <span class="dsc gunit">${esc(unit)}</span>` : ''}</th>`).join('') || `<th class="k" data-all="1" title="click: select every cell">${unit ? `<span class="dsc gunit">${esc(unit)}</span>` : ''}</th>`}${cols
      .map((c, ci) => {
        const t = ypos >= 0 && d[ypos] !== 'YEAR' ? sdesc(d[ypos], c) : '';
        return `<th data-ck="${ci}"${ST.csel.has(String(c)) ? ' class="csel"' : ''} title="${esc((t ? t + ' · ' : '') + 'click: select the column · Ctrl+click: add or remove one · Shift+click: a range')}">${c}${t ? `<br><span class="dsc">${esc(t)}</span>` : ''}</th>`;
      })
      .join(
        ''
      )}${yearCols ? '<th class="fillh">Fill row (year:value)</th>' : ''}${sparse ? '<th></th>' : ''}</tr></thead><tbody></tbody></table></div>
    ${sparse ? `<div class="addrow"><span class="small">Add rows:</span><span class="addms"></span><button type="button" class="btn addr" title="Every combination of what is chosen above; rows already there are kept">+ add rows</button></div>` : ''}`;
  // fill tool: rows (all, one, or a group: same value of an index, season or day part of a time slice) x columns from-to x operation
  const yopt = sel => cols.map(c => `<option ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('');
  const groups = [];
  xpos.forEach((i, k) => {
    const vals = [...new Set(rows.map(r => r[k]))];
    if (vals.length > 1 && vals.length < rows.length && vals.length <= 80)
      vals.forEach(v =>
        groups.push([`g|${k}|${v}`, `all rows with ${d[i].toLowerCase()} ${v}${sdesc(d[i], v) ? ' (' + sdesc(d[i], v) + ')' : ''}`])
      );
    if (d[i] === 'TIMESLICE')
      for (const [cp, sn] of [
        ['Conversionls', 'SEASON'],
        ['Conversionlh', 'DAILYTIMEBRACKET'],
        ['Conversionld', 'DAYTYPE']
      ]) {
        const mm = new Map();
        for (const r of getRecs(cp, [])) if (r.v) mm.set(String(r.idx[0]), String(r.idx[1]));
        const vs = [...new Set(rows.map(r => mm.get(r[k])).filter(Boolean))];
        if (vs.length > 1)
          vs.forEach(v =>
            groups.push([
              `c|${k}|${cp}|${v}`,
              `time slices of ${sn.toLowerCase().replace('dailytimebracket', 'day part')} ${v}${sdesc(sn, v) ? ' (' + sdesc(sn, v) + ')' : ''}`
            ])
          );
      }
  });
  const rtool = rows.length
    ? `<div class="rtool"><button type="button" class="btn sm rt-undo" title="Undo (Ctrl+Z)">↶</button><button type="button" class="btn sm rt-redo" title="Redo (Ctrl+Y)">↷</button><b>Fill</b>
    <select class="rt-row" title="Rows">${rows.length > 1 ? '<option value="*">All rows</option>' : ''}${groups.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}${rows.length <= 400 ? rows.map((r, i) => `<option value="${i}">Row ${esc(r.join(' · ') || 'value')}</option>`).join('') : ''}</select>
    ${
      cols.length > 1
        ? `<label>${yearCols ? 'years' : 'columns'} from <select class="rt-y0">${yopt(cols[0])}</select></label><label>to <select class="rt-y1">${yopt(cols[cols.length - 1])}</select></label>`
        : rows.length > 1 && rows.length <= 400
          ? `<label>down the rows from <select class="rt-r0">${rows.map((r, i) => `<option value="${i}">${esc(r.join(' · '))}</option>`).join('')}</select></label><label>to <select class="rt-r1">${rows.map((r, i) => `<option value="${i}" ${i === rows.length - 1 ? 'selected' : ''}>${esc(r.join(' · '))}</option>`).join('')}</select></label>`
          : ''
    }
    <select class="rt-op" title="Operation">
      <option value="set">Set to</option><option value="lin">straight line from … to …</option>${cols.length > 1 || rows.length > 1 ? `<option value="gr">Grow by % per ${yearCols ? 'year' : 'step (negative = decline)'}</option><option value="st">Add a fixed amount per ${yearCols ? 'year' : 'step'} (cumulative: 25, 24, 23 …)</option>` : ''}
      <option value="mul">Multiply by</option><option value="add">Add (the same to every cell)</option><option value="hold">keep the first column's value</option><option value="clr">Clear (back to default)</option></select>
    <input class="rt-a" placeholder="Value"><input class="rt-b" placeholder="End value" hidden>
    ${NEGOK.test(p) ? '<label class="rt-neg" title="This parameter can be negative by nature (purchase price, sink, user-constraint coefficient)"><input type="checkbox" class="rt-negok"> allow negative values</label>' : '<span class="small" title="Every fill formula stops at 0: a value that would cross 0 is written as 0">No negatives</span>'}
    <span class="rt-cs small" hidden></span><button type="button" class="btn rt-go">Apply</button></div>`
    : '';
  host.innerHTML = html + rtool;
  host._p = p;
  const gw = host.querySelector('.gw'),
    tb = host.querySelector('table'),
    body = tb.tBodies[0];
  // ---- drawing: every row, or (many rows) the rows in view between two spacers
  let RH = 27,
    W0 = -1,
    W1 = -1;
  const SEL = {a: null, b: null}; // selection: anchor and focus [ri, ci]
  const spacer = h => `<tr class="vsp" aria-hidden="true"><td colspan="${ncol}" style="height:${h}px;padding:0;border:0"></td></tr>`;
  const drawWin = force => {
    let s = 0,
      e = rows.length;
    if (virt) {
      const top = gw.scrollTop,
        hgt = gw.clientHeight || 400;
      s = Math.max(0, Math.floor(top / RH) - 15);
      e = Math.min(rows.length, s + Math.ceil(hgt / RH) + 40);
    }
    if (!force && s === W0 && e === W1) return;
    W0 = s;
    W1 = e;
    const fa = document.activeElement,
      keep =
        fa && body.contains(fa) && fa.dataset.c !== undefined ? [+fa.dataset.r, +fa.dataset.c, fa.selectionStart, fa.selectionEnd] : null;
    let h = '';
    for (let ri = s; ri < e; ri++) h += rowHtml(ri);
    body.innerHTML = (virt ? spacer(s * RH) : '') + h + (virt ? spacer((rows.length - e) * RH) : '');
    if (virt) {
      const tr = body.querySelector('tr[data-ri]');
      if (tr && tr.offsetHeight > 10 && Math.abs(tr.offsetHeight - RH) > 1) {
        RH = tr.offsetHeight;
        return drawWin(true);
      }
    }
    paintSel();
    if (keep) {
      const i = inputAt(keep[0], keep[1]);
      if (i) {
        i.focus();
        try {
          i.setSelectionRange(keep[2], keep[3]);
        } catch (er) {}
      }
    }
  };
  const inputAt = (ri, ci) => body.querySelector(`input[data-r="${ri}"][data-c="${ci}"]`);
  const showRow = ri => {
    if (!virt) return;
    const top = ri * RH;
    if (top < gw.scrollTop || top + RH > gw.scrollTop + gw.clientHeight - RH) gw.scrollTop = Math.max(0, top - gw.clientHeight / 2);
    drawWin();
  };
  const mark = (i, ix, v) => {
    const iss = cellIssue(p, v);
    i.classList.toggle('ovr', scenHas(p, ix));
    i.classList.toggle('warn', !!iss);
    i.classList.toggle('chg', changed(ix, v));
    i.classList.remove('bad');
    i.title = iss ? '⚠ ' + iss : scenHas(p, ix) ? 'changed in this scenario' : '';
  };
  const refreshVals = () =>
    body.querySelectorAll('input[data-c]').forEach(i => {
      const ix = idxOf(rows[+i.dataset.r], cols[+i.dataset.c]),
        v = cellGet(p, ix);
      i.value = v === undefined ? '' : v;
      i.defaultValue = i.value;
      mark(i, ix, v);
    });
  host._refresh = refreshVals;
  host._rebuild = sparse ? () => gridFor(p, kind, code, region, host) : null;
  host._goto = ix => {
    const rk = xpos.map(i => String(ix[i])).join('|'),
      ri = rows.findIndex(r => r.join('|') === rk),
      ci = ypos >= 0 ? cols.indexOf(String(ix[ypos])) : 0;
    if (ri < 0 || ci < 0) return false;
    moveTo(ri, ci, false);
    const i = inputAt(ri, ci);
    if (i) {
      i.scrollIntoView({block: 'center', inline: 'center'});
      i.classList.add('flash');
      setTimeout(() => i.classList.remove('flash'), 1600);
    }
    return true;
  };
  if (virt) gw.addEventListener('scroll', () => requestAnimationFrame(() => drawWin()), {passive: true});
  // ---- selection (Shift + arrows / Shift + click): a block of cells
  const rect = () => {
    if (!SEL.a || !SEL.b) return null;
    return [Math.min(SEL.a[0], SEL.b[0]), Math.min(SEL.a[1], SEL.b[1]), Math.max(SEL.a[0], SEL.b[0]), Math.max(SEL.a[1], SEL.b[1])];
  };
  function paintSel() {
    const R = rect();
    body.querySelectorAll('input.sel').forEach(i => i.classList.remove('sel'));
    if (!R || (R[0] === R[2] && R[1] === R[3])) return;
    for (const i of body.querySelectorAll('input[data-c]')) {
      const r = +i.dataset.r,
        c = +i.dataset.c;
      if (r >= R[0] && r <= R[2] && c >= R[1] && c <= R[3]) i.classList.add('sel');
    }
  }
  const multi = () => {
    const R = rect();
    return R && !(R[0] === R[2] && R[1] === R[3]);
  };
  drawWin(true);
  if (ST.top) {
    gw.scrollTop = ST.top;
    drawWin(true);
  }
  if (ST.goNew) {
    ST.goNew = false;
    const i0 = rows.findIndex(r => ST.newk.has(rkey(r)));
    if (i0 >= 0 && virt) {
      gw.scrollTop = Math.max(0, i0 * RH - 40);
      drawWin(true);
    }
  }
  // ---- rows / columns selected by a click (Ctrl: one more or less, Shift: a range), used by Fill and Delete
  const selRows = () => rows.map((r, i) => (ST.rsel.has(rkey(r)) ? i : -1)).filter(i => i >= 0);
  function paintRC() {
    body.querySelectorAll('tr[data-ri]').forEach(tr => {
      const k = rkey(rows[+tr.dataset.ri]);
      tr.classList.toggle('rsel', ST.rsel.has(k));
      tr.classList.toggle('rnew', ST.newk.has(k));
    });
    tb.querySelectorAll('th[data-ck]').forEach(th => th.classList.toggle('csel', ST.csel.has(String(cols[+th.dataset.ck]))));
    body.querySelectorAll('input[data-c]').forEach(i => i.parentElement.classList.toggle('csel', ST.csel.has(String(cols[+i.dataset.c]))));
    const n = selRows().length,
      gs = host.querySelector('.gsel'),
      gd = host.querySelector('.gdel');
    if (gs)
      gs.textContent =
        n || ST.csel.size
          ? `${n ? n + ' row' + (n > 1 ? 's' : '') : ''}${n && ST.csel.size ? ' × ' : ''}${ST.csel.size ? ST.csel.size + ' column' + (ST.csel.size > 1 ? 's' : '') : ''} selected`
          : '';
    if (gd) {
      gd.hidden = !n;
      gd.textContent = sparse ? `Delete ${n} row${n > 1 ? 's' : ''}` : `Clear ${n} row${n > 1 ? 's' : ''}`;
      gd.title = sparse
        ? 'Remove the selected rows and their values (one undo step)'
        : 'Back to the default value in the selected rows (one undo step)';
    }
    const rs = host.querySelector('.rt-row');
    if (rs) {
      let o = rs.querySelector('option[value="sel"]');
      if (n) {
        if (!o) {
          o = document.createElement('option');
          o.value = 'sel';
          rs.insertBefore(o, rs.firstChild);
        }
        o.textContent = `selected rows (${n})`;
        rs.value = 'sel';
      } else if (o) {
        if (rs.value === 'sel') rs.value = rs.options[1] ? rs.options[1].value : '';
        o.remove();
      }
    }
    const cs = host.querySelector('.rt-cs');
    if (cs) {
      cs.hidden = !ST.csel.size;
      cs.textContent = `only the ${ST.csel.size} selected column${ST.csel.size > 1 ? 's' : ''}`;
    }
  }
  const pickRange = (set, list, last, i, e) => {
    const k = list(i);
    if (e.shiftKey && last !== null) {
      const a = Math.min(last, i),
        b = Math.max(last, i);
      if (!(e.ctrlKey || e.metaKey)) set.clear();
      for (let j = a; j <= b; j++) set.add(list(j));
    } else if (e.ctrlKey || e.metaKey) {
      if (set.has(k)) set.delete(k);
      else set.add(k);
    } else {
      set.clear();
      set.add(k);
    }
  };
  paintRC();
  // ---- typing in a cell (one undo step per cell)
  const put = inp => {
    const r = rows[+inp.dataset.r],
      c = cols[+inp.dataset.c],
      s = inp.value.trim(),
      n = Number(s);
    if (s !== '' && !Number.isFinite(n)) {
      inp.classList.add('bad');
      return;
    }
    inp.classList.remove('bad');
    const cv = val(+inp.dataset.r, +inp.dataset.c);
    inp.defaultValue = inp.value;
    if ((s === '' && cv === undefined) || (s !== '' && n === cv)) return; // nothing changed (blur after an arrow key)
    const L = editLog('typing');
    L.set(p, idxOf(r, c), s === '' ? null : n);
    L.done();
    mark(inp, idxOf(r, c), s === '' ? undefined : n);
    if (s !== '' && cellIssue(p, n)) toast(`⚠ ${p}: ${cellIssue(p, n)}`);
  };
  tb.addEventListener('change', e => {
    if (e.target.matches('input[data-c]')) put(e.target);
    if (e.target.matches('input.fill')) {
      try {
        const ser = parseSeries(e.target.value);
        if (!ser) return;
        const ri = +e.target.dataset.r,
          L = editLog('row series');
        for (const c of cols) L.set(p, idxOf(rows[ri], c), ser[c] ?? null);
        L.done();
        refreshVals();
        e.target.value = '';
      } catch (er) {
        toast(er.message);
      }
    }
  });
  // ---- Excel way: a click selects a cell; double-click, F2 or typing edits it; Enter / Tab / arrows move;
  //      Esc cancels the edit. A click on a column header selects the column, on a row label the row, on the corner all.
  const editing = i => !!i && !i.readOnly;
  const startEdit = (i, keep) => {
    i.readOnly = false;
    if (!keep) i.value = '';
    const n = i.value.length;
    try {
      i.setSelectionRange(n, n);
    } catch (er) {}
  };
  const stopEdit = (i, commit) => {
    if (!i || i.readOnly) return;
    if (commit) put(i);
    else i.value = i.defaultValue;
    i.readOnly = true;
  };
  const moveTo = (ri, ci, extend) => {
    ri = Math.max(0, Math.min(rows.length - 1, ri));
    ci = Math.max(0, Math.min(cols.length - 1, ci));
    if (extend) {
      if (!SEL.a) SEL.a = SEL.b || [ri, ci];
      SEL.b = [ri, ci];
    } else {
      SEL.a = [ri, ci];
      SEL.b = [ri, ci];
    }
    showRow(ri);
    const i = inputAt(ri, ci);
    if (i) {
      i._kbd = true;
      i.focus();
      i._kbd = false;
      i.select();
    }
    paintSel();
  };
  const selectBlock = (r0, c0, r1, c1) => {
    SEL.a = [r0, c0];
    SEL.b = [r1, c1];
    const i = inputAt(r0, c0) || body.querySelector('input[data-c]');
    if (i) {
      i._kbd = true;
      i.focus();
      i._kbd = false;
    }
    paintSel();
  };
  const block = () =>
    rect() ||
    (document.activeElement && document.activeElement.dataset && document.activeElement.dataset.c !== undefined
      ? [
          +document.activeElement.dataset.r,
          +document.activeElement.dataset.c,
          +document.activeElement.dataset.r,
          +document.activeElement.dataset.c
        ]
      : null);
  const blockText = R => {
    const L = [];
    for (let r = R[0]; r <= R[2]; r++) {
      const a = [];
      for (let c = R[1]; c <= R[3]; c++) {
        const v = val(r, c);
        a.push(v === undefined ? '' : String(v));
      }
      L.push(a.join('\t'));
    }
    return L.join('\n');
  };
  const clearBlock = (R, label) => {
    const L = editLog(label);
    for (let r = R[0]; r <= R[2]; r++) for (let c = R[1]; c <= R[3]; c++) L.set(p, idxOf(rows[r], cols[c]), null);
    L.done();
    refreshVals();
  };
  const copyText = t => {
    const ta = document.createElement('textarea');
    ta.value = t;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch (er) {}
    ta.remove();
  };
  tb.addEventListener('focusin', e => {
    const i = e.target;
    if (i.dataset && i.dataset.c !== undefined && !i._kbd) {
      if (!SEL.b || +i.dataset.r !== SEL.b[0] || +i.dataset.c !== SEL.b[1]) {
        SEL.a = [+i.dataset.r, +i.dataset.c];
        SEL.b = SEL.a;
        paintSel();
      }
    }
  });
  tb.addEventListener('focusout', e => {
    if (e.target.matches && e.target.matches('input[data-c]') && editing(e.target)) stopEdit(e.target, true);
  });
  tb.addEventListener('mousedown', e => {
    const i = e.target.closest('input[data-c]');
    if (i && e.shiftKey && SEL.a) {
      e.preventDefault();
      SEL.b = [+i.dataset.r, +i.dataset.c];
      paintSel();
    }
  });
  tb.addEventListener('dblclick', e => {
    const i = e.target.closest('input[data-c]');
    if (i && !editing(i)) startEdit(i, true);
  });
  tb.addEventListener('click', e => {
    const ck = e.target.closest('th[data-ck]'),
      rk = e.target.closest('td[data-rk]'),
      all = e.target.closest('th[data-all]');
    if (ck) {
      const ci = +ck.dataset.ck;
      pickRange(ST.csel, j => String(cols[j]), ST.lastC, ci, e);
      ST.lastC = ci;
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) selectBlock(0, ci, rows.length - 1, ci);
      paintRC();
    } else if (rk) {
      const ri = +rk.dataset.rk;
      pickRange(ST.rsel, j => rkey(rows[j]), ST.lastR, ri, e);
      ST.lastR = ri;
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) selectBlock(ri, 0, ri, cols.length - 1);
      paintRC();
    } else if (all) {
      ST.rsel = new Set(rows.map(rkey));
      ST.csel.clear();
      selectBlock(0, 0, rows.length - 1, cols.length - 1);
      paintRC();
    }
  });
  // a plain click in a cell ends the selection of rows and columns
  tb.addEventListener('mousedown', e => {
    if (
      e.target.matches &&
      e.target.matches('input[data-c]') &&
      !e.shiftKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      (ST.rsel.size || ST.csel.size)
    ) {
      ST.rsel.clear();
      ST.csel.clear();
      paintRC();
    }
  });
  tb.addEventListener('keydown', e => {
    const i = e.target;
    if (!i.matches || !i.matches('input[data-c]')) return;
    const ri = +i.dataset.r,
      ci = +i.dataset.c,
      mod = e.ctrlKey || e.metaKey,
      k = e.key;
    if (editing(i)) {
      // typing in the cell
      if (k === 'Enter' || k === 'Tab' || k === 'ArrowUp' || k === 'ArrowDown') {
        e.preventDefault();
        stopEdit(i, true);
        if (k === 'Tab') moveTo(ri, ci + (e.shiftKey ? -1 : 1), false);
        else moveTo(ri + (k === 'ArrowUp' || (k === 'Enter' && e.shiftKey) ? -1 : 1), ci, false);
      } else if (k === 'Escape') {
        e.preventDefault();
        stopEdit(i, false);
        i.select();
      } else if (mod && k.toLowerCase() === 'z') {
        e.preventDefault();
        i.value = i.defaultValue;
      }
      return;
    }
    if (mod && !e.shiftKey && k.toLowerCase() === 'z') {
      e.preventDefault();
      return undoRedo(false);
    }
    if (mod && (k.toLowerCase() === 'y' || (e.shiftKey && k.toLowerCase() === 'z'))) {
      e.preventDefault();
      return undoRedo(true);
    }
    if (mod && k.toLowerCase() === 'a') {
      e.preventDefault();
      return selectBlock(0, 0, rows.length - 1, cols.length - 1);
    }
    if (mod && (k.toLowerCase() === 'd' || k.toLowerCase() === 'r')) {
      e.preventDefault();
      const R = block();
      if (!R) return;
      const L = editLog(k.toLowerCase() === 'd' ? 'fill down' : 'fill right');
      if (k.toLowerCase() === 'd') {
        for (let c = R[1]; c <= R[3]; c++) {
          const v = val(R[0], c);
          for (let r = R[0] + 1; r <= R[2]; r++) L.set(p, idxOf(rows[r], cols[c]), v === undefined ? null : v);
        }
      } else {
        for (let r = R[0]; r <= R[2]; r++) {
          const v = val(r, R[1]);
          for (let c = R[1] + 1; c <= R[3]; c++) L.set(p, idxOf(rows[r], cols[c]), v === undefined ? null : v);
        }
      }
      L.done();
      refreshVals();
      return;
    }
    if (mod && k.toLowerCase() === 'x') {
      e.preventDefault();
      const R = block();
      if (!R) return;
      copyText(blockText(R));
      clearBlock(R, 'cut');
      return toast(`${(R[2] - R[0] + 1) * (R[3] - R[1] + 1)} cells cut`);
    }
    if (k === 'Delete' || k === 'Backspace') {
      e.preventDefault();
      const R = block();
      if (R) clearBlock(R, 'clear');
      return;
    }
    if (k === 'F2') {
      e.preventDefault();
      return startEdit(i, true);
    }
    if (k === 'Escape') {
      SEL.a = SEL.b = [ri, ci];
      return paintSel();
    }
    let dr = 0,
      dc = 0;
    if (k === 'ArrowUp') dr = -1;
    else if (k === 'ArrowDown' || (k === 'Enter' && !e.shiftKey)) dr = 1;
    else if (k === 'Enter' && e.shiftKey) dr = -1;
    else if (k === 'ArrowLeft' || (k === 'Tab' && e.shiftKey)) dc = -1;
    else if (k === 'ArrowRight' || k === 'Tab') dc = 1;
    else if (k.length === 1 && !mod) {
      startEdit(i, false);
      return;
    } // typing replaces the value, as in Excel
    else return;
    e.preventDefault();
    if (e.shiftKey && k !== 'Enter' && k !== 'Tab') {
      if (!SEL.a) SEL.a = [ri, ci];
      const b = SEL.b || [ri, ci];
      moveTo(b[0] + dr, b[1] + dc, true);
    } else moveTo(ri + dr, ci + dc, false);
  });
  tb.addEventListener('copy', e => {
    const i = e.target;
    if (editing(i)) return;
    const R = block();
    if (!R) return;
    e.clipboardData.setData('text/plain', blockText(R));
    e.preventDefault();
    const n = (R[2] - R[0] + 1) * (R[3] - R[1] + 1);
    if (n > 1) toast(`${n} cells copied`);
  });
  // paste: a table from Excel goes to its labels (when copied with them) or from the selected cell, right and down;
  // one value pasted on a block fills the block
  tb.addEventListener('paste', e => {
    const inp = e.target;
    if (!inp.matches('input[data-c]') || editing(inp)) return;
    const txt = (e.clipboardData || window.clipboardData).getData('text');
    e.preventDefault();
    const R = block(),
      one = !/[\t\n]/.test(txt.replace(/\r?\n$/, '')) && !/;\s*\S/.test(txt);
    if (one) {
      const x = txt.trim() === '' ? null : Number(txt.trim());
      if (x !== null && !Number.isFinite(x)) return toast(`Not a number: ${txt.trim().slice(0, 20)}`);
      const L = editLog('paste');
      for (let r = R[0]; r <= R[2]; r++) for (let c = R[1]; c <= R[3]; c++) L.set(p, idxOf(rows[r], cols[c]), x);
      L.done();
      refreshVals();
      if (x !== null && cellIssue(p, x)) toast(`⚠ ${p}: ${cellIssue(p, x)}`);
      return;
    }
    const n = host.pasteTable(txt, {dataset: {r: R ? R[0] : +inp.dataset.r, c: R ? R[1] : +inp.dataset.c}});
    toast(`Pasted ${n} values into ${p}`);
  });
  tb.addEventListener('click', e => {
    if (e.target.matches('.rmrow')) {
      const r = rows[+e.target.dataset.r],
        L = editLog('remove row');
      for (const c of cols) L.set(p, idxOf(r, c), null);
      L.done();
      ST.rsel.delete(rkey(r));
      gridFor(p, kind, code, region, host);
    }
  });
  const rt = host.querySelector('.rtool');
  if (rt) {
    const op = rt.querySelector('.rt-op'),
      A = rt.querySelector('.rt-a'),
      Bv = rt.querySelector('.rt-b');
    rt.querySelector('.rt-undo').onclick = () => undoRedo(false);
    rt.querySelector('.rt-redo').onclick = () => undoRedo(true);
    const hint = {
      set: ['value', ''],
      lin: ['start value', 'end value'],
      gr: [yearCols ? '% per year' : '% per step', 'start value (empty = current)'],
      st: [yearCols ? 'amount per year (e.g. -1)' : 'amount per step (e.g. -1)', 'start value (empty = current)'],
      mul: ['factor', ''],
      add: ['amount', ''],
      hold: ['', ''],
      clr: ['', '']
    };
    op.onchange = () => {
      const h = hint[op.value];
      A.placeholder = h[0];
      A.hidden = !h[0];
      Bv.placeholder = h[1];
      Bv.hidden = !h[1];
    };
    rt.querySelector('.rt-go').onclick = () => {
      const c0 = rt.querySelector('.rt-y0') ? cols.indexOf(rt.querySelector('.rt-y0').value) : 0,
        c1 = rt.querySelector('.rt-y1') ? cols.indexOf(rt.querySelector('.rt-y1').value) : cols.length - 1;
      const o = op.value,
        a = Number(A.value),
        b = Bv.value.trim() === '' ? null : Number(Bv.value);
      const negok = !!(rt.querySelector('.rt-negok') || {}).checked,
        floor0 = v => (v === null || negok || v >= 0 ? v : 0); // no formula writes a negative value (crossing 0 -> 0)
      if (c1 < c0) return toast('"to" must come after "from"');
      if (!['hold', 'clr'].includes(o) && (A.value.trim() === '' || !Number.isFinite(a))) return toast('Give a number');
      if ((o === 'lin' && (b === null || !Number.isFinite(b))) || (b !== null && !Number.isFinite(b)))
        return toast(o === 'lin' ? 'Give the end value' : 'The start value must be a number');
      const rsel = rt.querySelector('.rt-row').value;
      let ris;
      if (rsel === '*') ris = rows.map((_, i) => i);
      else if (rsel.startsWith('g|')) {
        const [, k, v] = rsel.split('|');
        ris = rows.map((r, i) => (r[+k] === v ? i : -1)).filter(i => i >= 0);
      } else if (rsel.startsWith('c|')) {
        const [, k, cp, v] = rsel.split('|');
        const mm = new Map();
        for (const r of getRecs(cp, [])) if (r.v) mm.set(String(r.idx[0]), String(r.idx[1]));
        ris = rows.map((r, i) => (mm.get(r[+k]) === v ? i : -1)).filter(i => i >= 0);
      } else if (rsel === 'sel') ris = selRows();
      else ris = [+rsel];
      const numCols = cols.every(c => /^-?\d+(\.\d+)?$/.test(String(c))); // years, ages, vintages: steps on the labels
      const pos = ci => (numCols ? +cols[ci] - +cols[c0] : ci - c0),
        span = numCols ? +cols[c1] - +cols[c0] : c1 - c0;
      let n = 0;
      const L = editLog('Fill ' + op.options[op.selectedIndex].text);
      const write = (ri, ci, v) => {
        v = floor0(v);
        if (v !== null && !Number.isFinite(v)) return;
        L.set(p, idxOf(rows[ri], cols[ci]), v === null ? null : +v.toPrecision(10));
        n++;
      };
      if (cols.length === 1 && rt.querySelector('.rt-r0')) {
        // one column: the fill runs down the rows (ages, vintages...)
        let r0 = +rt.querySelector('.rt-r0').value,
          r1 = +rt.querySelector('.rt-r1').value;
        if (r1 < r0) return toast('"to" must come after "from"');
        const sel = new Set(ris),
          lab = r => r[r.length - 1],
          numRows = rows.slice(r0, r1 + 1).every(r => /^-?\d+(\.\d+)?$/.test(String(lab(r))));
        const rpos = ri => (numRows ? +lab(rows[ri]) - +lab(rows[r0]) : ri - r0),
          rspan = numRows ? +lab(rows[r1]) - +lab(rows[r0]) : r1 - r0,
          first = cur(r0, 0);
        for (let ri = r0; ri <= r1; ri++) {
          if (!sel.has(ri)) continue;
          let v;
          const t = rpos(ri);
          if (o === 'set') v = a;
          else if (o === 'lin') v = rspan ? a + ((b - a) * t) / rspan : a;
          else if (o === 'gr') v = (b === null ? first : b) * Math.pow(1 + a / 100, t);
          else if (o === 'st') v = (b === null ? first : b) + a * t;
          else if (o === 'mul') v = cur(ri, 0) * a;
          else if (o === 'add') v = cur(ri, 0) + a;
          else if (o === 'hold') v = first;
          else v = null;
          write(ri, 0, v);
        }
        L.done();
        refreshVals();
        return toast(`${p}: ${n} cells changed`);
      }
      for (const ri of ris) {
        const first = cur(ri, c0);
        for (let ci = c0; ci <= c1; ci++) {
          if (ST.csel.size && !ST.csel.has(String(cols[ci]))) continue;
          let v;
          const t = pos(ci);
          if (o === 'set') v = a;
          else if (o === 'lin') v = span ? a + ((b - a) * t) / span : a;
          else if (o === 'gr') v = (b === null ? first : b) * Math.pow(1 + a / 100, t);
          else if (o === 'st') v = (b === null ? first : b) + a * t;
          else if (o === 'mul') v = cur(ri, ci) * a;
          else if (o === 'add') v = cur(ri, ci) + a;
          else if (o === 'hold') v = first;
          else v = null;
          write(ri, ci, v);
        }
      }
      L.done();
      refreshVals();
      toast(`${p}: ${n} cells changed`);
    };
  }
  // ---- add rows: one searchable multi-select per index (several commodities, modes, slices… at once); the new rows
  //      are selected, so Fill applies to them first
  const ad = host.querySelector('.addr'),
    am = host.querySelector('.addms'),
    pickers = [];
  if (ad && am) {
    const nameOf = i => d[i].replace('MODE_OF_OPERATION', 'mode').replace('DAILYTIMEBRACKET', 'day part').toLowerCase();
    xpos.forEach(i => {
      const sp = SPARSE.has(d[i]) && d[i] !== 'REGION';
      const b = MSEL.button({
        name: nameOf(i),
        title: `${nameOf(i)} of the new rows`,
        items: () => mselItems(d[i]),
        sel: sp ? [] : setOf(d[i]).map(String),
        allCount: !sp,
        allowNew: ['COMMODITY', 'FUEL', 'EMISSION', 'STORAGE', 'UDC'].includes(d[i]) || !!ENTSET['x_' + d[i]]
      });
      pickers.push(b);
      am.appendChild(b);
    });
    ad.onclick = async () => {
      const vals = pickers.map(b => b._sel);
      if (vals.some(v => !v.length)) return toast('Choose at least one member for every index of the new rows');
      let combos = [[]];
      vals.forEach(opts => {
        const nx = [];
        for (const a of combos) for (const o of opts) nx.push([...a, o]);
        combos = nx;
      });
      if (combos.length > 3000 && !await uiConfirm(`Add ${combos.length} rows?`)) return;
      xpos.forEach((i, k) => {
        for (const v of vals[k]) {
          if (setOf(d[i]).map(String).includes(v)) continue;
          if (d[i] === 'COMMODITY' || d[i] === 'FUEL') addComm(v);
          else addSet(d[i], v);
        }
      });
      const have = new Set(allRows.map(rkey)),
        L = editLog('add rows');
      let n = 0;
      ST.newk = new Set();
      ST.rsel = new Set();
      for (const r of combos) {
        const k = rkey(r);
        if (!have.has(k)) {
          for (const c of cols) if (cellGet(p, idxOf(r, c)) === undefined) L.set(p, idxOf(r, c), def);
          n++;
        }
        ST.newk.add(k);
        ST.rsel.add(k);
      }
      ST.q = '';
      ST.flt = {};
      ST.goNew = true;
      L.done();
      gridFor(p, kind, code, region, host);
      toast(`${n} row(s) added with the default ${def} and selected: type, paste or use Fill`);
    };
  }
  // ---- toolbar: search (redrawn as you type), a filter per index (and per season / day part of a time slice),
  //      select the rows shown, delete or clear the selected rows in one undo step, the place in the table kept
  const gb = host.querySelector('.gbar');
  if (gb) {
    const redraw = () => gridFor(p, kind, code, region, host);
    const gq = gb.querySelector('.gq');
    let tq = null;
    gq.addEventListener('input', () => {
      clearTimeout(tq);
      tq = setTimeout(() => {
        ST.q = gq.value.trim().toLowerCase();
        ST.top = 0;
        ST.focusQ = [gq.selectionStart, gq.selectionEnd];
        redraw();
      }, 160);
    });
    if (ST.focusQ) {
      const fq = ST.focusQ;
      ST.focusQ = null;
      gq.focus();
      try {
        gq.setSelectionRange(fq[0], fq[1]);
      } catch (er) {}
    }
    const gf = gb.querySelector('.gflt'),
      fdims = [];
    xpos.forEach((i, k) => {
      const vals = [...new Set(allRows.map(r => r[k]))];
      if (vals.length > 1)
        fdims.push([
          String(k),
          d[i].replace('MODE_OF_OPERATION', 'mode').replace('DAILYTIMEBRACKET', 'day part').toLowerCase(),
          vals.map(v => ({v, l: sdesc(d[i], v) || (d[i] === 'COMMODITY' ? FD[v] : d[i] === 'TECHNOLOGY' ? TD[v] : '') || ''}))
        ]);
      if (d[i] === 'TIMESLICE')
        for (const [cp, sn, nm] of [
          ['Conversionls', 'SEASON', 'season'],
          ['Conversionld', 'DAYTYPE', 'day type'],
          ['Conversionlh', 'DAILYTIMEBRACKET', 'day part']
        ]) {
          const mm = tsMap[k + '|' + cp];
          const vs = [...new Set(allRows.map(r => mm.get(r[k])).filter(x => x !== undefined))];
          if (vs.length > 1) fdims.push([k + '|' + cp, nm, vs.map(v => ({v, l: sdesc(sn, v) || ''}))]);
        }
    });
    for (const [fk, nm, items] of fdims) {
      const on = !!ST.flt[fk];
      const b = MSEL.button({
        name: nm,
        title: `Show only the rows with these ${nm}s`,
        items,
        sel: on ? [...ST.flt[fk]] : items.map(x => x.v),
        allCount: true,
        cls: on ? 'flt-on' : '',
        onChange: v => {
          if (!v.length || v.length === items.length) delete ST.flt[fk];
          else ST.flt[fk] = new Set(v.map(String));
          ST.top = 0;
          redraw();
        }
      });
      gf.appendChild(b);
    }
    const gc = gb.querySelector('.gclr');
    if (gc)
      gc.onclick = () => {
        ST.q = '';
        ST.flt = {};
        ST.top = 0;
        redraw();
      };
    gb.querySelector('.gsall').onclick = () => {
      for (const r of rows) ST.rsel.add(rkey(r));
      paintRC();
    };
    gb.querySelector('.gdel').onclick = async () => {
      const ris = selRows();
      if (!ris.length) return;
      if (ris.length > 20 && !await uiConfirm(`${sparse ? 'Delete' : 'Clear'} ${ris.length} rows?`)) return;
      const L = editLog(sparse ? 'delete rows' : 'clear rows');
      for (const ri of ris) for (const c of cols) L.set(p, idxOf(rows[ri], c), null);
      L.done();
      for (const ri of ris) {
        ST.rsel.delete(rkey(rows[ri]));
        ST.newk.delete(rkey(rows[ri]));
      }
      redraw();
      toast(`${p}: ${ris.length} row${ris.length > 1 ? 's' : ''} ${sparse ? 'deleted' : 'back to the default'} (Ctrl+Z to undo)`);
    };
  }
  // paste a whole table from Excel: rows and columns matched by their labels when the copy includes them; otherwise from the
  // cell clicked, down and right (also into rows not drawn). One undo step.
  host.pasteTable = (txt, at) => {
    const lines = txt
      .replace(/\r/g, '')
      .replace(/\n+$/, '')
      .split('\n')
      .map(l => l.split(/\t|;/).map(x => x.trim()));
    if (!lines.length) return 0;
    let n = 0,
      hdr = null;
    const kx = xpos.length || 1,
      L = editLog('paste');
    if (lines[0].filter(x => cols.includes(x)).length >= Math.min(2, cols.length)) {
      hdr = lines.shift();
    }
    const colIdx = hdr ? hdr.map(h => cols.indexOf(h)) : null;
    const byLabel = lines.every(
      l => l.length > kx && (xpos.length ? xpos.every((i, k) => setOf(d[i]).map(String).includes(l[k].split(' ')[0])) : true)
    );
    const num = v => {
      const x = Number(v);
      return v !== '' && Number.isFinite(x) ? x : null;
    };
    if (hdr || byLabel) {
      const key = new Map(rows.map((r, i) => [r.join('|'), i]));
      for (const l of lines) {
        const k = xpos.length ? xpos.map((_, j) => l[j].split(' ')[0]) : [],
          vals = l.slice(xpos.length ? kx : hdr && !cols.includes(hdr[0]) ? 1 : 0);
        let ri = key.get(k.join('|'));
        if (ri === undefined && xpos.length && sparse) {
          for (const c of cols) if (cellGet(p, idxOf(k, c)) === undefined) L.set(p, idxOf(k, c), def);
          rows.push(k);
          ri = rows.length - 1;
          key.set(k.join('|'), ri);
        }
        if (ri === undefined) continue;
        vals.forEach((v, j) => {
          const ci = colIdx ? colIdx[j + (l.length - vals.length)] : j,
            x = num(v);
          if (ci === undefined || ci < 0 || ci >= cols.length || x === null) return;
          L.set(p, idxOf(rows[ri], cols[ci]), x);
          n++;
        });
      }
      L.done();
      gridFor(p, kind, code, region, host);
      return n;
    }
    const r0 = at ? +at.dataset.r : 0,
      c0 = at ? +at.dataset.c : 0;
    lines.forEach((ln, i) =>
      ln.forEach((v, j) => {
        const ri = r0 + i,
          ci = c0 + j,
          x = num(v);
        if (ri < rows.length && ci < cols.length && x !== null) {
          L.set(p, idxOf(rows[ri], cols[ci]), x);
          n++;
        }
      })
    );
    L.done();
    refreshVals();
    return n;
  };
  // the whole grid as text (copy / export): from the data, every row (also those not drawn)
  host._tsv = () => {
    const head = [...(xpos.length ? xpos.map(i => d[i].replace('MODE_OF_OPERATION', 'MODE').toLowerCase()) : ['']), ...cols];
    return [
      head.join('\t'),
      ...rows.map((r, ri) =>
        [
          ...(r.length ? r : ['—']),
          ...cols.map((_, ci) => {
            const v = val(ri, ci);
            return v === undefined ? '' : String(v);
          })
        ].join('\t')
      )
    ].join('\n');
  };
  return {rows, cols};
}
function addComm(f) {
  if (!cset().includes(f)) cset().push(f);
}
function gridTSV(host) {
  if (host._tsv) return host._tsv();
  const t = host.querySelector('table');
  return [...t.rows]
    .map(tr =>
      [...tr.cells]
        .filter(c => !c.querySelector('.rmrow') && !c.querySelector('.fill') && !c.classList.contains('fillh'))
        .map(c => {
          const i = c.querySelector('input');
          return i ? i.value : c.textContent;
        })
        .join('\t')
    )
    .join('\n');
}
