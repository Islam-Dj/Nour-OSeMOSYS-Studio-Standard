'use strict';
/* ---- searchable multi-select ----
   MSEL.open(anchor, opts): a list under the anchor with a search box (code and name, several words = all of them), tick
   boxes, "all" / "none" (of what the search shows), "selected first", counts, keyboard (Enter applies, Esc closes, ↑ ↓
   move, Space ticks), and only the visible part of a long list drawn (thousands of members stay fast).
     opts = {title, items: [{v, l, g}] (code, name, group), sel: [codes], single: false, allowNew: false, onApply(codes)}
   MSEL.button(opts) -> a button "<name>: A, B +3" that opens it and keeps its own selection (btn._sel). */
const MSEL = (() => {
  let pop = null,
    closeOuter = null;
  const ROWH = 24;
  function close() {
    if (pop) {
      pop.remove();
      pop = null;
    }
    if (closeOuter) {
      document.removeEventListener('mousedown', closeOuter, true);
      closeOuter = null;
    }
  }
  // placed in the window at any zoom of the Studio (Ctrl + / −: zoom on the page) and any panel width:
  // the scale is measured (screen px per CSS px), the popup goes under the anchor (or above it) and is pulled inside
  function place(el, anchor) {
    Object.assign(el.style, {left: '0px', top: '0px', width: '340px', maxHeight: 'none'});
    const s = el.getBoundingClientRect().width / el.offsetWidth || 1,
      VW = innerWidth,
      VH = innerHeight,
      M = 8;
    const r = anchor.getBoundingClientRect(),
      H = Math.min(440 * s, VH - 2 * M),
      W = el.getBoundingClientRect().width;
    el.style.maxHeight = H / s + 'px';
    let x = Math.min(r.left, VW - W - M),
      y = r.bottom + 4;
    const h = Math.min(el.getBoundingClientRect().height, H);
    if (y + h > VH - M) y = r.top - h - 4 >= M ? r.top - h - 4 : Math.max(M, VH - M - h);
    x = Math.max(M, x);
    Object.assign(el.style, {left: x / s + 'px', top: y / s + 'px'});
  }
  function open(anchor, o) {
    close();
    const items = (o.items || []).map(x => (typeof x === 'string' ? {v: x, l: '', g: ''} : {v: String(x.v), l: x.l || '', g: x.g || ''}));
    const sel = new Set((o.sel || []).map(String));
    let q = '',
      selFirst = false,
      cur = 0,
      shown = items;
    pop = document.createElement('div');
    pop.className = 'msel-pop';
    pop.setAttribute('role', 'dialog');
    pop.innerHTML = `<div class="msel-h"><b>${esc(o.title || 'Select')}</b><span class="msel-n"></span></div>
      <input type="search" class="msel-q" placeholder="search code or name${o.allowNew ? ' (or type a new code)' : ''}" autocomplete="off" spellcheck="false">
      <div class="msel-t">${o.single ? '' : '<button type="button" class="lnk msel-all">All</button><button type="button" class="lnk msel-none">None</button>'}
        <label class="small"><input type="checkbox" class="msel-sf"> selected first</label></div>
      <div class="msel-l" tabindex="-1"><div class="msel-in"></div></div>
      <div class="msel-a"><button type="button" class="btn sm msel-cancel">Cancel</button><button type="button" class="btn sm pri msel-ok">${o.single ? 'Choose' : 'Apply'}</button></div>`;
    document.body.appendChild(pop);
    place(pop, anchor);
    const qi = pop.querySelector('.msel-q'),
      L = pop.querySelector('.msel-l'),
      IN = pop.querySelector('.msel-in'),
      N = pop.querySelector('.msel-n');
    const match = it => {
      if (!q) return true;
      const s = (it.v + ' ' + it.l + ' ' + it.g).toLowerCase();
      return q.split(/\s+/).every(w => s.includes(w));
    };
    const filter = () => {
      shown = items.filter(match);
      if (selFirst) shown = [...shown.filter(x => sel.has(x.v)), ...shown.filter(x => !sel.has(x.v))];
      const nw =
        o.allowNew && q && /^[A-Za-z0-9_]+$/.test(q) && !items.some(x => x.v.toLowerCase() === q)
          ? [{v: q.toUpperCase(), l: 'new: add it', g: '', nw: 1}]
          : [];
      shown = [...nw, ...shown];
      cur = Math.min(cur, Math.max(0, shown.length - 1));
      draw(true);
    };
    let w0 = -1,
      w1 = -1;
    const draw = force => {
      const top = L.scrollTop,
        h = L.clientHeight || 300,
        s = Math.max(0, Math.floor(top / ROWH) - 10),
        e = Math.min(shown.length, s + Math.ceil(h / ROWH) + 20);
      if (!force && s === w0 && e === w1) return;
      w0 = s;
      w1 = e;
      IN.style.height = shown.length * ROWH + 'px';
      let html = '';
      let lastG = null;
      for (let i = s; i < e; i++) {
        const it = shown[i];
        html += `<div class="msel-i${i === cur ? ' cur' : ''}${it.nw ? ' nw' : ''}" data-i="${i}" style="top:${i * ROWH}px" title="${esc(it.v + (it.l ? ' · ' + it.l : '') + (it.g ? ' · ' + it.g : ''))}"><input type="${o.single ? 'radio' : 'checkbox'}" tabindex="-1" ${sel.has(it.v) ? 'checked' : ''}><b>${esc(it.v)}</b><span>${esc(it.l)}</span>${it.g && it.g !== lastG ? `<i>${esc(it.g)}</i>` : ''}</div>`;
        lastG = it.g;
      }
      IN.innerHTML = html;
      N.textContent = `${sel.size} selected · ${shown.length - (shown[0] && shown[0].nw ? 1 : 0)} of ${items.length}`;
    };
    const toggle = i => {
      const it = shown[i];
      if (!it) return;
      if (o.single) {
        sel.clear();
        sel.add(it.v);
      } else if (sel.has(it.v)) sel.delete(it.v);
      else sel.add(it.v);
      draw(true);
    };
    const apply = () => {
      const out = items.filter(x => sel.has(x.v)).map(x => x.v);
      for (const v of sel) if (!out.includes(v)) out.push(v);
      close();
      if (o.onApply) o.onApply(out);
    };
    L.addEventListener('scroll', () => requestAnimationFrame(() => draw()), {passive: true});
    IN.addEventListener('mousedown', e => e.preventDefault());
    IN.addEventListener('click', e => {
      const d = e.target.closest('.msel-i');
      if (!d) return;
      cur = +d.dataset.i;
      toggle(cur);
      if (o.single) apply();
    });
    IN.addEventListener('dblclick', e => {
      const d = e.target.closest('.msel-i');
      if (!d || o.single) return;
      sel.clear();
      sel.add(shown[+d.dataset.i].v);
      apply();
    });
    qi.addEventListener('input', () => {
      q = qi.value.trim().toLowerCase();
      cur = 0;
      L.scrollTop = 0;
      filter();
    });
    pop.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        anchor.focus && anchor.focus();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (o.single && shown[cur]) {
          sel.clear();
          sel.add(shown[cur].v);
        } else if (shown[cur] && shown[cur].nw) sel.add(shown[cur].v);
        apply();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        cur = Math.max(0, Math.min(shown.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1)));
        const y = cur * ROWH;
        if (y < L.scrollTop) L.scrollTop = y;
        else if (y + ROWH > L.scrollTop + L.clientHeight) L.scrollTop = y + ROWH - L.clientHeight;
        draw(true);
      } else if (e.key === ' ' && document.activeElement !== qi) {
        e.preventDefault();
        toggle(cur);
      }
    });
    const all = pop.querySelector('.msel-all');
    if (all)
      all.onclick = () => {
        for (const x of shown) if (!x.nw) sel.add(x.v);
        draw(true);
      };
    const none = pop.querySelector('.msel-none');
    if (none)
      none.onclick = () => {
        for (const x of shown) sel.delete(x.v);
        draw(true);
      };
    pop.querySelector('.msel-sf').onchange = e => {
      selFirst = e.target.checked;
      filter();
    };
    pop.querySelector('.msel-ok').onclick = apply;
    pop.querySelector('.msel-cancel').onclick = close;
    closeOuter = e => {
      if (pop && !pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) close();
    };
    setTimeout(() => document.addEventListener('mousedown', closeOuter, true), 0);
    filter();
    place(pop, anchor);
    qi.focus();
    return pop;
  }
  const label = (name, sel, all) => labelOf(name ? name[0].toUpperCase() + name.slice(1) : name, sel, all);
  const labelOf = (name, sel, all) =>
    !sel.length
      ? `${name}: none`
      : all && sel.length === all
        ? `${name}: all (${all})`
        : `${name}: ${sel.slice(0, 3).join(', ')}${sel.length > 3 ? ` +${sel.length - 3}` : ''}`;
  function button(o) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn sm msel-b' + (o.cls ? ' ' + o.cls : '');
    b._sel = (o.sel || []).map(String);
    const items = () => (typeof o.items === 'function' ? o.items() : o.items);
    const paint = () => {
      b.textContent = label(o.name, b._sel, o.allCount ? items().length : 0) + ' ▾';
      b.title = `${o.title || o.name}: ${b._sel.length} selected. Click to search and choose`;
    };
    b.onclick = () =>
      open(b, {
        title: o.title || o.name,
        items: items(),
        sel: b._sel,
        single: o.single,
        allowNew: o.allowNew,
        onApply: v => {
          b._sel = v;
          paint();
          if (o.onChange) o.onChange(v);
        }
      });
    b.set = v => {
      b._sel = v.map(String);
      paint();
    };
    paint();
    return b;
  }
  return {open, close, button, isOpen: () => !!pop};
})();
// the members of a set as items (code, name from the descriptions, group = the system of the item when there is one)
function mselItems(setName) {
  const nm = v =>
    setName === 'TECHNOLOGY'
      ? TD[v] || ''
      : setName === 'COMMODITY' || setName === 'FUEL'
        ? FD[v] || ''
        : (typeof sdesc === 'function' ? sdesc(setName, v) : '') || '';
  const grp = v => (typeof SYSTEMS !== 'undefined' && SYSTEMS.of ? SYSTEMS.of(v) || '' : '');
  return setOf(setName).map(v => ({v: String(v), l: nm(String(v)), g: grp(String(v))}));
}

/* every long list (more than 8 choices) and every multiple list of the RDM and Monte Carlo
   pages gets a searchable button that drives it (the select stays, hidden, with its own logic); new lists are upgraded as they
   appear. Each choice shows its meaning: the description of a result, a parameter, a technology or commodity. */
const MSEL_AUTO = (() => {
  const meaning = v => {
    v = String(v);
    if (typeof VDESC !== 'undefined' && VDESC[v]) return VDESC[v][1] || '';
    if (typeof PD !== 'undefined' && PD[v]) return Array.isArray(PD[v]) ? PD[v][1] || PD[v][0] || '' : String(PD[v]);
    if (typeof TD !== 'undefined' && TD[v]) return TD[v];
    if (typeof FD !== 'undefined' && FD[v]) return FD[v];
    return '';
  };
  const short = s => {
    s = String(s || '').replace(/^MASTER \[[^\]]+\]\s*/, '');
    return s.length > 90 ? s.slice(0, 89) + '…' : s;
  };
  function upgrade(sel) {
    if (sel._ms || sel.closest('.msel-pop')) return;
    const n = sel.options.length;
    if (!(sel.multiple || n > 8)) return;
    sel._ms = true;
    sel.hidden = true;
    sel.style.display = 'none';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn sm msel-b msel-auto';
    const cur = () => [...sel.options].filter(o => o.selected).map(o => o.value);
    const paint = () => {
      const c = cur(),
        lab = o => (o ? o.textContent : '');
      b.textContent = sel.multiple
        ? (c.length
            ? c.length <= 2
              ? c.map(v => lab([...sel.options].find(o => o.value === v))).join(', ')
              : `${c.length} of ${n} selected`
            : 'all (none selected)') + ' ▾'
        : (lab(sel.options[sel.selectedIndex]) || '—') + ' ▾';
      b.title = 'Click to search and choose' + (sel.multiple ? ' (several)' : '');
    };
    b.onclick = () =>
      MSEL.open(b, {
        title:
          sel.getAttribute('aria-label') ||
          (sel.closest('label') && sel.closest('label').firstChild && sel.closest('label').firstChild.textContent.trim()) ||
          'Choose',
        items: [...sel.options].map(o => ({v: o.value, l: o.textContent !== o.value ? o.textContent : short(meaning(o.value))})),
        sel: cur(),
        single: !sel.multiple,
        onApply: v => {
          const S = new Set(v.map(String));
          [...sel.options].forEach(o => (o.selected = S.has(o.value)));
          if (!sel.multiple && !v.length) return;
          paint();
          sel.dispatchEvent(new Event('change', {bubbles: true}));
        }
      });
    sel.insertAdjacentElement('afterend', b);
    paint();
    sel._msPaint = paint;
  }
  function scan(root) {
    root.querySelectorAll('select').forEach(upgrade);
  }
  function watch(id) {
    const el = document.getElementById(id);
    if (!el) return;
    scan(el);
    new MutationObserver(() => scan(el)).observe(el, {childList: true, subtree: true});
  }
  return {watch, scan, upgrade};
})();
document.addEventListener('DOMContentLoaded', () => {
  MSEL_AUTO.watch('rdmview');
  MSEL_AUTO.watch('mcview');
});
if (document.readyState !== 'loading') {
  MSEL_AUTO.watch('rdmview');
  MSEL_AUTO.watch('mcview');
}
