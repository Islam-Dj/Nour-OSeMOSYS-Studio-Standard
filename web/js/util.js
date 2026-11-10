'use strict';
const fmtN = (v, d) => (Math.abs(v) < 1e-12 ? 0 : v).toLocaleString('en-US', {minimumFractionDigits: d, maximumFractionDigits: d});
function niceTicks(lo, hi, n = 5) {
  if (hi === lo) {
    hi = lo + 1;
  }
  const span = hi - lo,
    step0 = span / n,
    mag = Math.pow(10, Math.floor(Math.log10(step0))),
    f = step0 / mag;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  const t = [];
  let v = Math.floor(lo / step + 1e-9) * step;
  t.push(+v.toPrecision(12));
  while (t[t.length - 1] < hi - step * 1e-9) {
    v += step;
    t.push(+v.toPrecision(12));
  }
  return t;
}
const compact = v => {
  const a = Math.abs(v);
  return a >= 1e9
    ? +(v / 1e9).toPrecision(3) + 'B'
    : a >= 1e6
      ? +(v / 1e6).toPrecision(3) + 'M'
      : a >= 1e3
        ? +(v / 1e3).toPrecision(3) + 'K'
        : +v.toPrecision(4) + '';
};
/*
   one placement for every popup (position: fixed): measured in screen pixels, so the Studio zoom (Ctrl + / −) is taken into
   account, flipped to the other side of the mouse / button when it would leave the window, and always kept inside it.
   placeAt(el, x, y): near the mouse point x, y (screen px).   placeNear(el, rect): under (or above) a button's rectangle. */
function popScale(el) {
  const w = el.offsetWidth;
  return w ? el.getBoundingClientRect().width / w || 1 : 1;
}
function popPut(el, px, py) {
  const s = popScale(el),
    r = el.getBoundingClientRect(),
    M = 8,
    VW = innerWidth,
    VH = innerHeight;
  px = Math.max(M, Math.min(px, VW - M - r.width));
  py = Math.max(M, Math.min(py, VH - M - r.height));
  el.style.right = 'auto';
  el.style.bottom = 'auto';
  el.style.left = px / s + 'px';
  el.style.top = py / s + 'px';
}
function placeAt(el, x, y, gap = 14) {
  const r = el.getBoundingClientRect(),
    VW = innerWidth,
    VH = innerHeight;
  const px = x + gap + r.width > VW - 8 ? x - gap - r.width : x + gap,
    py = y + gap + r.height > VH - 8 ? y - gap - r.height : y + gap;
  popPut(el, px, py);
}
function placeNear(el, a, align) {
  const r = el.getBoundingClientRect(),
    VH = innerHeight;
  const px = align === 'right' ? a.right - r.width : a.left,
    py = a.bottom + 6 + r.height > VH - 8 && a.top - 6 - r.height >= 8 ? a.top - 6 - r.height : a.bottom + 6;
  popPut(el, px, py);
}
function wireTips(box) {
  let tipEl = document.getElementById('ctip');
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.id = 'ctip';
    document.body.appendChild(tipEl);
  }
  box.querySelectorAll('[data-tip]').forEach(el => {
    el.addEventListener('mousemove', ev => {
      tipEl.textContent = el.getAttribute('data-tip');
      tipEl.style.display = 'block';
      placeAt(tipEl, ev.clientX, ev.clientY);
      el.style.opacity = 0.85;
    });
    el.addEventListener('mouseleave', () => {
      tipEl.style.display = 'none';
      el.style.opacity = '';
    });
  });
}
async function saveFile(name, data, type) {
  const app = window.pywebview && window.pywebview.api && window.pywebview.api.save_file; // desktop app: native "Save as" dialog
  if (app && window.pywebview.api.save_begin) {
    const b = data instanceof Blob ? data : new Blob([data], {type});
    if (b.size > 4e6) {
      try {
        const tok = await window.pywebview.api.save_begin(name);
        if (!tok) return toast('Save cancelled'); // large files in 4 MB pieces
        const CH = 3 * (1 << 20);
        for (let o = 0; o < b.size; o += CH) {
          const u = new Uint8Array(await b.slice(o, o + CH).arrayBuffer());
          let s = '';
          for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
          await window.pywebview.api.save_chunk(tok, btoa(s));
        }
        const p = await window.pywebview.api.save_end(tok);
        toast('Saved ' + p);
      } catch (e) {
        toast('Save failed: ' + e);
      }
      return;
    }
  }
  if (app) {
    const b = data instanceof Blob ? data : new Blob([data], {type});
    const buf = new Uint8Array(await b.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    try {
      const r = await window.pywebview.api.save_file(name, btoa(bin));
      toast(r ? 'Saved ' + r : 'Save cancelled');
    } catch (e) {
      toast('Save failed: ' + e);
    }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], {type}));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
  toast('Saved ' + name);
}
