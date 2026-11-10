'use strict';
/* ============================== SET FOR SEVERAL ITEMS ==============================
   One value for many items at once (for example the capital cost of a list of technologies, or the demand of several
   commodities).
   In "All parameters", each parameter indexed by technology, commodity, storage, emission or constraint has "Set for
   several…": choose the items (searchable, by system), the other indices (region, mode, commodity, time slice… one member
   or all), the years and the values (one number, year:value points with straight lines between them, or one per year).
   Every chosen combination gets the values; one Undo (Undo changes) takes them back. */
const BATCH_ENT = ['TECHNOLOGY', 'COMMODITY', 'STORAGE', 'EMISSION', 'UDC'];
const batchPl = (ent, n) => {
  const w = ent.toLowerCase();
  return n === 1 ? w : w.replace(/y$/, 'ie') + 's';
};
function batchEntity(p) {
  const d = dimsOf(p);
  return BATCH_ENT.find(s => d.includes(s)) || null;
}
function batchForm(p, blk, rerender) {
  const d = dimsOf(p),
    ent = batchEntity(p);
  if (!ent) return;
  const box =
    blk.querySelector('.batchf') ||
    (() => {
      const x = document.createElement('div');
      x.className = 'batchf';
      blk.querySelector('.ptools').after(x);
      return x;
    })();
  if (box.dataset.open === '1') {
    box.dataset.open = '';
    box.innerHTML = '';
    return;
  }
  box.dataset.open = '1';
  const other = d.filter((s, i) => s !== ent && s !== 'YEAR' && i !== d.indexOf(ent));
  const memOf = s => setOf(s).map(String),
    sysSet = ent === 'UDC' ? null : ent;
  const lab = m => (ent === 'TECHNOLOGY' ? TD[m] || '' : ent === 'COMMODITY' ? FD[m] || '' : '');
  const sel = {items: []};
  const optFor = s => {
    const L = memOf(s),
      allOk = ['REGION', 'MODE_OF_OPERATION', 'TIMESLICE', 'SEASON', 'DAILYTIMEBRACKET', 'DAYTYPE'].includes(s);
    return `<label>${esc(s === 'MODE_OF_OPERATION' ? 'Mode' : s.charAt(0) + s.slice(1).toLowerCase())}<select data-dim="${esc(s)}">${allOk && L.length > 1 ? '<option value="*">All</option>' : ''}${L.map(m => `<option value="${esc(m)}">${esc(m)}${s !== 'REGION' && typeof sdesc === 'function' && sdesc(s, m) ? ' · ' + esc(sdesc(s, m)) : ''}</option>`).join('')}</select></label>`;
  };
  const hasY = d.includes('YEAR');
  box.innerHTML = `<div class="bt-h"><b>Set ${esc(p)} for several ${esc(batchPl(ent, 2))}</b><span class="muted"> · the same values for every item chosen</span></div>
    <div class="row3"><label>${esc(batchPl(ent, 2).replace(/^./, c => c.toUpperCase()))}<button type="button" class="btn bt-items">Choose…</button><span class="muted bt-n">None chosen</span></label>${other.map(optFor).join('')}</div>
    ${
      hasY
        ? `<div class="row2"><label>Values<input class="bt-v" placeholder="e.g. 900, or 2025:900, 2050:500, or one per year"></label><label>Years<span class="bt-yr"><input class="bt-y0" type="number" value="${M.years[0]}" style="width:80px"> to <input class="bt-y1" type="number" value="${M.years[M.years.length - 1]}" style="width:80px"></span></label></div>`
        : `<div class="row2"><label>Value<input class="bt-v" placeholder="A number"></label><span></span></div>`
    }
    <div class="acts"><button type="button" class="btn pri bt-go">Apply</button><button type="button" class="btn bt-clr" title="Remove the values of the items chosen (back to the default)">Clear for these items</button><button type="button" class="btn x bt-x">Close</button><span class="muted bt-msg"></span></div>`;
  const nEl = box.querySelector('.bt-n'),
    msg = box.querySelector('.bt-msg');
  box.querySelector('.bt-items').onclick = e =>
    MSEL.open(e.target, {
      title: `${p}: ${batchPl(ent, 2)}`,
      sel: sel.items,
      items: memOf(ent).map(m => ({v: m, l: lab(m), g: sysSet && SYSTEMS.of(m, sysSet) ? SYSTEMS.full(SYSTEMS.of(m, sysSet)) : ''})),
      onApply: v => {
        sel.items = v;
        nEl.textContent = v.length ? `${v.length} chosen: ${v.slice(0, 4).join(', ')}${v.length > 4 ? '…' : ''}` : 'none chosen';
      }
    });
  box._setItems = v => {
    sel.items = v.map(String);
    nEl.textContent = `${v.length} chosen`;
  }; // used by the tests
  box.querySelector('.bt-x').onclick = () => {
    box.dataset.open = '';
    box.innerHTML = '';
  };
  const combos = () => {
    let L = [{}];
    for (const s of other) {
      const v = box.querySelector(`[data-dim="${s}"]`).value,
        ms = v === '*' ? memOf(s) : [v];
      L = L.flatMap(c => ms.map(m => ({...c, [s]: m})));
    }
    return L;
  };
  const idxOf = (item, c, y) => d.map(s => (s === ent ? item : s === 'YEAR' ? String(y) : c[s]));
  const run = clear => {
    if (!sel.items.length) return (msg.textContent = 'Choose the items first.');
    let vals = null,
      years = [null];
    if (!clear) {
      const t = box.querySelector('.bt-v').value.trim();
      if (!t) return (msg.textContent = 'Give a value.');
      if (hasY) {
        try {
          vals = parseSeries(t);
        } catch (e) {
          return (msg.textContent = e.message);
        }
      } else {
        const v = Number(t);
        if (isNaN(v)) return (msg.textContent = `"${t}" is not a number`);
        vals = v;
      }
    }
    if (hasY) {
      const y0 = +box.querySelector('.bt-y0').value,
        y1 = +box.querySelector('.bt-y1').value;
      years = M.years.filter(y => y >= Math.min(y0, y1) && y <= Math.max(y0, y1));
    }
    const C = combos();
    let n = 0;
    for (const it of sel.items)
      for (const c of C)
        for (const y of years) {
          const v = clear ? null : hasY ? vals[y] : vals;
          cellSet(p, idxOf(it, c, y), v);
          n++;
        }
    if (EDIT) EDIT.changed = true;
    msg.textContent = `${clear ? 'cleared' : 'set'} ${n} value${n === 1 ? '' : 's'} (${sel.items.length} ${batchPl(ent, sel.items.length)}${C.length > 1 ? ' × ' + C.length + ' combinations' : ''}${hasY ? ' × ' + years.length + ' years' : ''})`;
    toast(`${p}: ${msg.textContent}`);
    if (rerender) rerender();
  };
  box.querySelector('.bt-go').onclick = () => run(false);
  box.querySelector('.bt-clr').onclick = async () => {
    if (await uiConfirm(`Remove ${p} for the ${sel.items.length} item(s) chosen?`)) run(true);
  };
}
