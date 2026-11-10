'use strict';
/* ============================== the colour of the Studio ==============================
   One colour for the whole Studio: box edges, the clicked item, buttons, Model setup. Every tint is made from it in
   css/theme.css. Chosen in the top bar (Colour ▾) or on Model setup; kept in this browser (the same key as before). */
const THEME = {
  COLORS: [
    ['#6f8fb3', 'Steel blue'],
    ['#8a9bb0', 'Slate'],
    ['#b59a6d', 'Sand'],
    ['#9a86b5', 'Lavender'],
    ['#c08a8a', 'Rose clay'],
    ['#7aa39b', 'Sage'],
    ['#9aa0a6', 'Grey']
  ],
  get() {
    try {
      return localStorage.getItem('mst_spcol') || THEME.COLORS[0][0];
    } catch (e) {
      return THEME.COLORS[0][0];
    }
  },
  /* white or near-black text on the colour, whichever reads better */
  onColor(c) {
    const n = parseInt(c.slice(1), 16),
      L = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
    return L > 0.62 ? '#1b1b1a' : '#ffffff';
  },
  apply() {
    const c = THEME.get(),
      R = document.documentElement.style;
    R.setProperty('--th', c);
    R.setProperty('--th-on', THEME.onColor(c));
    const b = document.querySelector('#thcolb i');
    if (b) b.style.background = c;
  },
  set(c) {
    try {
      localStorage.setItem('mst_spcol', c);
    } catch (e) {}
    THEME.apply();
    if (typeof spApplyColor === 'function' && document.getElementById('setup')) spApplyColor(document.getElementById('setup'));
  },
  /* the Colour ▾ menu of the top bar */
  menu() {
    const w = document.getElementById('thcol');
    if (!w) return;
    const c = THEME.get();
    w.innerHTML = `<button type="button" class="btn" id="thcolb" aria-haspopup="listbox" aria-expanded="false" title="Colour of the Studio: box edges, the item you click, buttons"><i style="background:${c}"></i> Colour ▾</button>
      <div class="thm" role="listbox" aria-label="Colour of the Studio" hidden>${THEME.COLORS.map(([v, l]) => `<button type="button" role="option" data-c="${v}" aria-selected="${v === c}"><i style="background:${v}"></i>${l}</button>`).join('')}
      <label><input type="color" id="thcolc" value="${c}"> Any colour…</label></div>`;
    const b = w.querySelector('#thcolb'),
      m = w.querySelector('.thm');
    b.onclick = e => {
      e.stopPropagation();
      m.hidden = !m.hidden;
      b.setAttribute('aria-expanded', String(!m.hidden));
    };
    m.querySelectorAll('[data-c]').forEach(x => (x.onclick = () => {
      THEME.set(x.dataset.c);
      THEME.menu();
    }));
    m.querySelector('#thcolc').oninput = e => THEME.set(e.target.value);
    m.querySelector('#thcolc').onchange = () => THEME.menu();
    document.addEventListener('click', ev => {
      if (!w.contains(ev.target)) m.hidden = true;
    });
  }
};
THEME.apply();
THEME.menu();
