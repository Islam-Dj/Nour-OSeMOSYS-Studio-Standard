'use strict';
/* ============================== drawer: technology ============================== */
const fmt = v =>
  typeof v !== 'number'
    ? esc(v)
    : v === 0
      ? '0'
      : Math.abs(v) >= 1e5
        ? v.toExponential(2)
        : Math.abs(v) >= 100
          ? v.toFixed(1)
          : Math.abs(v) >= 1
            ? +v.toFixed(3) + ''
            : +v.toPrecision(4) + '';
function tableFor(recs, regs, allYears) {
  // recs share a param; index = [r, t, ...rest]; years in the last position when numeric and in YEAR
  const yset = new Set(M.years.map(String));
  const hasYear = recs.some(r => yset.has(String(r.idx[r.idx.length - 1])));
  const rows = new Map();
  const cols = new Set();
  for (const r of recs) {
    const rest = r.idx.slice(2);
    let rk, ck;
    if (hasYear && yset.has(String(rest[rest.length - 1]))) {
      ck = rest[rest.length - 1];
      rk = rest.slice(0, -1).join(' · ');
    } else if (rest.length >= 2) {
      ck = rest[rest.length - 1];
      rk = rest.slice(0, -1).join(' · ');
    } else {
      ck = 'value';
      rk = rest.join(' · ');
    }
    if (regs.length > 1) rk = r.idx[0] + (rk ? ' · ' + rk : '');
    if (!rows.has(rk)) rows.set(rk, {});
    rows.get(rk)[ck] = r.v;
    cols.add(String(ck));
  }
  let C = [...cols];
  // every model year is a column, also a year with no value (it was left out, hiding a gap such as a missing 2045)
  if (hasYear) {
    C = [...new Set([...C.map(Number), ...M.years.map(Number)])].sort((a, b) => a - b);
    if (!allYears) C = C.filter(y => KEYY.includes(y));
    C = C.map(String);
  }
  const R = [...rows.keys()].sort();
  return {C, R, rows, hasYear};
}
function renderTable(tb) {
  return `<div class="tw"><table><thead><tr><th>${tb.hasYear ? 'row / year' : 'row'}</th>${tb.C.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${tb.R.map(
    r =>
      `<tr><td class="k">${esc(r || '—')}</td>${tb.C.map(c => (tb.rows.get(r)[c] === undefined ? `<td${tb.hasYear ? ' class="ymiss" title="no value in this year (the default is used): enter it in Build and edit"' : ''}>${tb.hasYear ? '–' : ''}</td>` : `<td>${fmt(tb.rows.get(r)[c])}</td>`)).join('')}</tr>`
  ).join('')}</tbody></table></div>`;
}
function csvOf(tb) {
  return [['row', ...tb.C].join(','), ...tb.R.map(r => [JSON.stringify(r), ...tb.C.map(c => tb.rows.get(r)[c] ?? '')].join(','))].join(
    '\n'
  );
}
let tables = [];
/* the year of the flows shown in this panel, chosen here
   (it was in the top bar, where it looked as if it changed the whole Studio) */
const yearSel = y => `<select class="pyear" aria-label="Year of the flows shown">${M.years.map(v => `<option ${v === y ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
function wireYearSel(root, reopen) {
  root.querySelectorAll('select.pyear').forEach(s => (s.onchange = () => {
    state.year = +s.value;
    if (typeof save === 'function') save();
    reopen();
  }));
}
function openTech(t) {
  sel = {t};
  markBrowser('tech', t);
  document.querySelectorAll('.tech.sel').forEach(e => e.classList.remove('sel'));
  document.querySelectorAll(`.tech[data-t="${t}"]`).forEach(e => e.classList.add('sel'));
  const regs = state.region === 'ALL' ? REG : [state.region],
    y = state.year;
  const recs = (M.byTech.get(t) || []).filter(r => regs.includes(r.idx[0]) && r.idx[1] === t);
  const cau = techVals(t, 'CapacityToActivityUnit', regs[0])[0]?.v ?? P_('CapacityToActivityUnit').def;
  const life = techVals(t, 'OperationalLife', regs[0])[0]?.v ?? P_('OperationalLife').def;
  const cc = r => techVals(t, 'CapitalCost', regs[0]).find(x => +x.idx[2] === r)?.v;
  const yA = M.years.includes(2025) ? 2025 : M.years[0],
    yB = M.years[M.years.length - 1];
  const res = techVals(t, 'ResidualCapacity', regs[0]).find(x => +x.idx[2] === y)?.v;
  const unit =
    cau == 31.536
      ? 'GW'
      : cau == 1
        ? 'activity unit/yr'
        : cau !== undefined
          ? `capacity unit (1 = ${fmt(cau)} activity/yr)`
          : 'capacity unit';
  const flows = M.flows.filter(f => f.t === t && regs.includes(f.r) && f.y === y);
  const fl = dir => {
    const m = new Map();
    for (const f of flows.filter(f => f.dir === dir)) {
      const k = (regs.length > 1 ? f.r + ' ' : '') + f.f + ' |m' + f.m;
      m.set(k, f);
    }
    return [...m.values()];
  };
  const ins = fl('in'),
    outs = fl('out');
  const eff = (() => {
    const i = ins.filter(f => f.m === '1' && !['WTR'].includes(f.f)).reduce((s, f) => s + f.v, 0),
      o = outs.filter(f => f.m === '1').reduce((s, f) => s + f.v, 0);
    return i && o ? o / i : null;
  })();
  const udcs = [...new Set(recs.filter(r => r.p.startsWith('UDCMultiplier') && r.v).map(r => r.idx[2]))];
  const stl = storageLinks(regs).get(t);
  const flowList = arr =>
    arr.length
      ? arr
          .map(
            f =>
              `<div class="fl" data-f="${f.f}"><i style="background:${fcol(f.f)}"></i>${regs.length > 1 ? f.r + ' · ' : ''}${f.f}<em>mode ${f.m} · ${fmt(f.v)}</em></div>`
          )
          .join('')
      : '<div class="fl" style="cursor:default;color:var(--muted)">None</div>';
  // parameter sections
  const byP = new Map();
  for (const r of recs) {
    if (!byP.has(r.p)) byP.set(r.p, []);
    byP.get(r.p).push(r);
  }
  const groups = new Map(GROUPS.map(g => [g, []]));
  for (const [p, rs] of byP) {
    const g = (PD[p] || ['Other'])[0];
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push([p, rs]);
  } // a group not listed still shows
  tables = [];
  let html = '';
  for (const [g, list] of groups) {
    if (!list.length) continue;
    list.sort((a, b) => a[0].localeCompare(b[0]));
    html += `<details class="tgrp" style="--tc:${TOPICS.color(g)}" ${['Conversion', 'Costs', 'Capacity', 'Activity limits'].includes(g) ? 'open' : ''}><summary><span class="tdot"></span>${g}<span class="n">${list.length} parameter${list.length > 1 ? 's' : ''}</span></summary>`;
    for (const [p, rs] of list) {
      const tb = tableFor(rs, regs, state.allYears);
      const id = tables.push({p, tb}) - 1;
      html += `<div class="pdesc"><b style="color:var(--ink);font-family:var(--mono);font-size:12px">${p}</b> · default ${esc(P_(p).def ?? '—')} · ${esc((PD[p] || ['', 'Model parameter.'])[1])} <button class="btn cp" data-tb="${id}" type="button" style="padding:4px 7px;margin-left:6px">Copy CSV</button></div>${renderTable(tb)}`;
    }
    html += `</details>`;
  }
  // storage parameters
  if (stl) {
    const srec = (M.byStor.get(stl) || []).filter(r => regs.includes(r.idx[0]));
    const sp = new Map();
    for (const r of srec) {
      if (!sp.has(r.p)) sp.set(r.p, []);
      sp.get(r.p).push(r);
    }
    html += `<details class="tgrp" style="--tc:${TOPICS.color('Storage')}" open><summary><span class="tdot"></span>Storage ${stl}<span class="n">${sp.size} parameters</span></summary>`;
    for (const [p, rs] of sp) {
      const tb = tableFor(
        rs.map(r => ({...r, idx: [r.idx[0], r.idx[1], ...r.idx.slice(2)]})),
        regs,
        state.allYears
      );
      const id = tables.push({p, tb}) - 1;
      html += `<div class="pdesc"><b style="color:var(--ink);font-family:var(--mono);font-size:12px">${p}</b> <button class="btn cp" data-tb="${id}" type="button" style="padding:4px 7px;margin-left:6px">Copy CSV</button></div>${renderTable(tb)}`;
    }
    html += `</details>`;
  }
  const dr = document.getElementById('drawer');
  dr.hidden = false;
  dr.innerHTML = `<div class="dh"><div style="min-width:0"><div class="code">${t} · ${regs.length > 1 ? 'all regions' : RNAME[regs[0]]}</div><h2>${esc(shortName(t))}</h2><p>${esc(TD[t] || 'No description yet (load a descriptions CSV: code,description).')}</p></div><div class="acts"><button class="btn" type="button" id="edit">Edit</button><button class="btn" type="button" id="expall" data-t="${esc(t)}">Export all (CSV)</button><button class="btn x" type="button" id="close" aria-label="Close">Close</button></div></div>
  <div class="db">
    <div class="chips">
      <span class="chip">Capacity unit <b>${unit}</b></span>
      <span class="chip">Life <b>${fmt(life)}</b> yr</span>
      ${cc(yA) !== undefined ? `<span class="chip">Capital ${yA} <b>${fmt(cc(yA))}</b>${cau == 31.536 ? ' $/kW' : ''}</span>` : ''}
      ${cc(yB) !== undefined && cc(yB) !== cc(yA) ? `<span class="chip">Capital ${yB} <b>${fmt(cc(yB))}</b></span>` : ''}
      ${res !== undefined ? `<span class="chip">Existing ${y} <b>${fmt(res)}</b> ${unit}</span>` : ''}
      ${eff ? `<span class="chip">Output / input (mode 1) <b>${fmt(eff)}</b></span>` : ''}
      ${udcs.length ? `<span class="chip">In UDC <b>${udcs.join(', ')}</b></span>` : ''}
      ${G && G.off.has(t) ? '<span class="chip warn">Inactive here (no capacity possible)</span>' : ''}
      ${checkPeek() && regs.some(r => checkPeek().bad.has(r + '|' + t)) ? '<span class="chip bad">Infeasible data - see Check</span>' : ''}
    </div>
    <div class="flows"><div><h4>Inputs · ${yearSel(y)}</h4>${flowList(ins)}</div><div><h4>Outputs · ${y}</h4>${flowList(outs)}</div></div>
    <div class="ctl"><label><input type="checkbox" id="ally" ${state.allYears ? 'checked' : ''}> All ${M.years.length} years (untick for every 5th year)</label></div>
    ${html || '<div class="empty">No parameter values for this technology in this region.</div>'}
  </div>`;
  wireDrawer(() => openTech(t));
  dr.querySelector('#edit').onclick = () => openEntity('tech', t);
}
function wireDrawer(reopen) {
  const dr = document.getElementById('drawer');
  dr.querySelector('#close').onclick = () => {
    dr.hidden = true;
    sel = null;
    markBrowser(null);
    document.querySelectorAll('.tech.sel').forEach(e => e.classList.remove('sel'));
  };
  wireYearSel(dr, reopen);
  const a = dr.querySelector('#ally');
  if (a)
    a.onchange = () => {
      state.allYears = a.checked;
      reopen();
    };
  dr.querySelectorAll('.cp').forEach(
    b =>
      (b.onclick = ev => {
        ev.preventDefault();
        ev.stopPropagation();
        const tb = tables[+b.dataset.tb];
        const txt = `# ${tb.p}\n` + csvOf(tb.tb);
        (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject())
          .then(() => toast('Copied ' + tb.p + ' as CSV'))
          .catch(() => toast('Copy not allowed here - select the table instead'));
      })
  );
  const ea = dr.querySelector('#expall');
  if (ea)
    ea.onclick = () => {
      const t = ea.dataset.t,
        rs = M.byTech.get(t) || [];
      saveFile(
        `${t}_all_parameters.csv`,
        ['parameter,index,value', ...rs.map(r => `${r.p},"${r.idx.join(',')}",${r.v}`)].join('\n'),
        'text/csv'
      );
    };
  dr.querySelectorAll('.fl[data-f]').forEach(d => (d.onclick = () => openFuel(d.dataset.f)));
}
/* ============================== drawer: commodity ============================== */
function openFuel(f) {
  markBrowser('comm', f);
  const regs = state.region === 'ALL' ? REG : [state.region],
    y = state.year;
  const fl = M.flows.filter(x => x.f === f && regs.includes(x.r) && x.y === y);
  const uniq = arr => {
    const m = new Map();
    for (const x of arr) m.set(x.r + x.t + x.m, x);
    return [...m.values()];
  };
  const prod = uniq(fl.filter(x => x.dir === 'out')),
    cons = uniq(fl.filter(x => x.dir === 'in'));
  const row = x =>
    `<div class="fl" data-t="${x.t}"><i style="background:${fcol(f)}"></i>${regs.length > 1 ? x.r + ' · ' : ''}${x.t}<em>mode ${x.m} · ${fmt(x.v)}</em></div>`;
  tables = [];
  let html = '';
  for (const p of ['SpecifiedAnnualDemand', 'AccumulatedAnnualDemand', 'SpecifiedDemandProfile', 'TradeRoute']) {
    const rs = P_(p).recs.filter(r => r.idx.includes(f) && (p === 'TradeRoute' ? regs.includes(r.idx[0]) : regs.includes(r.idx[0])));
    if (!rs.length) continue;
    let rr = rs;
    if (p === 'SpecifiedAnnualDemand' || p === 'AccumulatedAnnualDemand') rr = rs.map(r => ({...r, idx: [r.idx[0], r.idx[1], r.idx[2]]}));
    if (p === 'SpecifiedDemandProfile') rr = rs.map(r => ({...r, idx: [r.idx[0], r.idx[1], r.idx[2], r.idx[3]]}));
    if (p === 'TradeRoute') rr = rs.map(r => ({...r, idx: [r.idx[0], r.idx[2], r.idx[1], r.idx[3]]}));
    const tb = tableFor(rr, regs, state.allYears);
    const id = tables.push({p, tb}) - 1;
    html += `<details open><summary>${p}<span class="n">${tb.R.length} rows</span></summary><div class="pdesc">${p === 'TradeRoute' ? 'Partner countries linked for this commodity (1 = route open).' : p === 'SpecifiedDemandProfile' ? 'Share of the yearly demand in each time slice.' : 'Demand of this commodity (PJ).'} <button class="btn cp" data-tb="${id}" type="button" style="padding:4px 7px;margin-left:6px">Copy CSV</button></div>${renderTable(tb)}</details>`;
  }
  const dr = document.getElementById('drawer');
  dr.hidden = false;
  dr.innerHTML = `<div class="dh"><div style="min-width:0"><div class="code">commodity · ${f} · ${regs.length > 1 ? 'all regions' : RNAME[regs[0]]}</div><h2 style="color:${fcol(f)}">${f}</h2><p>${esc(FD[f] || (fam(f) === 'trade' ? 'Cross-border link commodity between two countries (traded through TradeRoute).' : 'No description yet.'))} Family: ${FAMLAB[fam(f)]}.</p></div><div class="acts"><button class="btn" type="button" id="edit">Edit</button><button class="btn x" type="button" id="close" aria-label="Close">Close</button></div></div>
  <div class="db"><div class="flows"><div><h4>Produced by · ${yearSel(y)}</h4>${prod.length ? prod.map(row).join('') : '<div class="fl">None</div>'}</div><div><h4>Used by · ${y}</h4>${cons.length ? cons.map(row).join('') : '<div class="fl">None</div>'}</div></div>
  <div class="ctl"><label><input type="checkbox" id="ally" ${state.allYears ? 'checked' : ''}> All ${M.years.length} years (untick for every 5th year)</label></div>${html}</div>`;
  wireDrawer(() => openFuel(f));
  dr.querySelector('#edit').onclick = () => openEntity('comm', f);
  dr.querySelectorAll('.fl[data-t]').forEach(d => (d.onclick = () => openTech(d.dataset.t)));
  hi({f});
}
function toast(s) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = s;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}
