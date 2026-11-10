'use strict';
/* ============================== start-up texts ==============================
   The built-in MUIO 5.4 model file and the example data. In the single-file (portable) page they are embedded as
   <script type="text/plain"> blocks; in the app and with START_SOLVER they are files under web/data/. */
/* the edition of this Studio.
   'master'   the full Studio (OSeMOSYS master model and every extension), kept private
   'standard' Nour OSeMOSYS Studio, published: the standard OSeMOSYS model only; tools/build_edition.py writes it */
const EDITION = 'standard';
const STANDARD = EDITION === 'standard';
const APPNAME = STANDARD ? 'Nour OSeMOSYS Studio' : 'Nour OSeMOSYS Studio';
const STUDIO_VERSION = '0.22.1';
document.title = APPNAME;
const TEXT = {model: null, example: null, exampleMeta: null, examples: []};
const inlineText = id => {
  const e = document.getElementById(id);
  return e ? e.textContent : null;
};
const MODELTXT = () => TEXT.model;
async function loadTexts() {
  const get = async (id, url) => {
    const t = inlineText(id);
    if (t !== null) return t;
    try {
      const r = await fetch(url);
      return r.ok ? await r.text() : null;
    } catch (e) {
      return null;
    }
  };
  TEXT.model = await get('muio-model', 'data/builtin_model.txt');
  // the example models (examples/make_examples.py): one per topic of the parameter reference, each with what to check
  TEXT.examples = [];
  const inl = inlineText('examples-data');
  if (inl) {
    try {
      TEXT.examples = JSON.parse(inl);
    } catch (e) {}
  } else {
    const j = await get('', 'data/examples/examples.json');
    let L = [];
    try {
      L = JSON.parse(j || '[]');
    } catch (e) {}
    for (const x of L) {
      const t = await get('', 'data/examples/' + x.file);
      if (t) TEXT.examples.push({...x, text: t});
    }
  }
  const e0 = TEXT.examples[0];
  TEXT.example = e0 ? e0.text : null;
  TEXT.exampleMeta = e0 ? {name: e0.name, note: 'example'} : {name: 'example'};
}

/* Studio fonts inside exported charts: an exported SVG / PNG cannot reach the font files, so the @font-face rules
   are given the font data itself (read once at start; the single-file page already has it) */
const FONTURLS = {};
const embedFontCss = css => css.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/g, (m, u) => (FONTURLS[u] ? `url(${FONTURLS[u]})` : m));
async function loadFontData() {
  for (const sh of document.styleSheets) {
    let rules;
    try {
      rules = sh.cssRules;
    } catch (e) {
      continue;
    }
    for (const r of rules) {
      if (r.type !== 5) continue;
      for (const [, u] of r.cssText.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
        if (u.startsWith('data:') || FONTURLS[u]) continue;
        try {
          const b = await (await fetch(new URL(u, sh.href || location.href))).blob();
          FONTURLS[u] = await new Promise((ok, no) => {
            const fr = new FileReader();
            fr.onload = () => ok(fr.result);
            fr.onerror = no;
            fr.readAsDataURL(b);
          });
        } catch (e) {}
      }
    }
  }
}

/* every list of tick boxes gets "all" and "none": added to the lists that do not have their own */
const BULK_SEL = '.rlist, .rv .vbox, .scpick';
function addBulk(box) {
  if (box.dataset.bulk) return;
  const boxes = () => [...box.querySelectorAll('input[type=checkbox]')].filter(c => !c.disabled && !c.closest('[hidden]'));
  if (boxes().length < 3) return;
  box.dataset.bulk = '1';
  const bar = document.createElement('div');
  bar.className = 'bulkbar';
  bar.innerHTML =
    '<button type="button" class="lnk" data-b="1">All</button><button type="button" class="lnk" data-b="0">None</button><span class="muted"></span>';
  const count = () => {
    const b = boxes();
    bar.querySelector('span').textContent = `${b.filter(c => c.checked).length} of ${b.length} ticked`;
  };
  bar.querySelectorAll('[data-b]').forEach(
    bt =>
      (bt.onclick = () => {
        let last = null;
        for (const c of boxes()) {
          const v = bt.dataset.b === '1';
          if (c.checked !== v) {
            c.checked = v;
            last = c;
          }
        }
        if (last) last.dispatchEvent(new Event('change', {bubbles: true}));
        count();
      })
  );
  box.addEventListener('change', count);
  box.parentNode.insertBefore(bar, box);
  count();
}
new MutationObserver(() => {
  clearTimeout(addBulk.t);
  addBulk.t = setTimeout(() => document.querySelectorAll(BULK_SEL).forEach(addBulk), 120);
}).observe(document.documentElement, {childList: true, subtree: true});

/* the explanations of the panels (the text under a panel title, the grey hints) are behind
   a "!" icon; a click shows or hides them. Warnings, errors and hints with buttons or fields in them stay visible. */
const INFO_SEL = '.dh p, p.hint, div.hint';
function infoOne(p) {
  if (p.dataset.inf || p.closest('.vexp, .msel-pop, .infotxt, .sysbig')) return;
  if (p.matches('.warnt, .err, .bad') || p.querySelector('button, input, select, textarea, a, label') || p.textContent.trim().length < 70) {
    p.dataset.inf = 'keep';
    return;
  }
  p.dataset.inf = '1';
  p.classList.add('infotxt');
  p.hidden = true;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'infob';
  b.textContent = '!';
  b.title = 'What is this? (click)';
  b.setAttribute('aria-expanded', 'false');
  b.setAttribute('aria-label', 'Show the explanation');
  const h = p.closest('.dh') && p.closest('.dh').querySelector('h2');
  if (h) h.after(b);
  else p.before(b);
  b.onclick = e => {
    e.preventDefault();
    e.stopPropagation();
    p.hidden = !p.hidden;
    b.setAttribute('aria-expanded', String(!p.hidden));
  };
}
function infoize(n) {
  if (!n || n.nodeType !== 1) return;
  if (n.matches(INFO_SEL)) infoOne(n);
  n.querySelectorAll(INFO_SEL).forEach(infoOne);
}
new MutationObserver(ms => {
  for (const m of ms) for (const n of m.addedNodes) infoize(n);
}).observe(document.documentElement, {childList: true, subtree: true});
document.addEventListener('DOMContentLoaded', () => infoize(document.body));
