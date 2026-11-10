/* ============================== the language of the Studio ==============================
   - English is the language the Studio is written in; French, Spanish and Arabic are translations of what it shows.
   - The pages are not rewritten: each text the page shows (and its tooltip, placeholder, label) is looked up in a table
     (i18n_fr.js, i18n_es.js, i18n_ar.js) when it appears. A text with values in it ("System {0} renamed") is matched as a pattern
     and the values are kept as they are.
   - Never translated: codes and numbers, the data grids, the diagram, the charts, code and text you type.
   - Arabic is written right to left; the diagram, the charts and the numbers stay left to right.
   - Text not in the table stays in English (long help texts, descriptions of parameters, the reference PDF).
   The choice is kept in this browser (mst_lang) and applied when the page loads. */
const I18N = (() => {
  const LANGS = {en: 'English', fr: 'Français', es: 'Español', ar: 'العربية'};
  let lang = 'en';
  try {
    lang = localStorage.getItem('mst_lang') || 'en';
  } catch (e) {}
  if (!LANGS[lang]) lang = 'en';
  const exact = new Map(), // English -> translation
    pats = [], // {re, lit, tr}
    memo = new Map(); // text -> translation or null
  const SKIP = 'svg,script,style,textarea,code,pre,kbd,[data-notr],[contenteditable="true"],.js-plotly-plot,table.grid td';
  const ATTRS = ['title', 'placeholder', 'aria-label'];
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const norm = s => s.replace(/\s+/g, ' ').trim();

  function add(l, table) {
    if (l !== lang) return;
    for (const [k, v] of Object.entries(table)) {
      if (!/\{\d+\}/.test(k)) {
        exact.set(k, v);
        continue;
      }
      // "Value{0}": the value is an element after the text, so the text node alone is "Value"
      const m = k.match(/^(.*?)\{0\}$/);
      if (m && m[1].trim() && !/\{\d+\}/.test(m[1]) && /\{0\}$/.test(v) && !exact.has(m[1].trim()))
        exact.set(m[1].trim(), v.replace(/\{0\}$/, '').trim());
      const order = [];
      const src = k
        .split(/(\{\d+\})/)
        .map(p => {
          const n = p.match(/^\{(\d+)\}$/);
          if (n) {
            order.push(+n[1]);
            return '(.+?)';
          }
          return esc(p);
        })
        .join('');
      const lits = k.split(/\{\d+\}/).map(s => s.trim()).filter(Boolean);
      // a value glued to a word ("Unit{0}") was an element next to the text: no pattern (it would cut words: "Unit|s of ...")
      if (!lits.length || /[A-Za-z]\{\d+\}|\{\d+\}[A-Za-z]/.test(k)) continue;
      const len = lits.join('').length;
      pats.push({re: new RegExp('^' + src + '$'), lit: lits.sort((a, b) => b.length - a.length)[0], len, order, tr: v});
    }
    pats.sort((a, b) => b.lit.length - a.lit.length);
  }

  /* one text: the translation, or null */
  function tr(text) {
    const t = norm(text);
    if (!t || !/[A-Za-z]/.test(t)) return null;
    if (memo.has(t)) return memo.get(t);
    let r = exact.get(t);
    if (r === undefined) {
      // a trailing colon or ellipsis on a known text
      const m = t.match(/^(.*?)(\s*[:…]|\.\.\.)$/);
      if (m && exact.has(m[1])) r = exact.get(m[1]) + m[2];
    }
    if (r === undefined && t.length < 400)
      for (const p of pats) {
        if (!t.includes(p.lit)) continue;
        const m = t.match(p.re);
        if (!m) continue;
        // a value is a code, a number, a name or a known text; English prose in a short pattern ("Open {0}") is not a value
        if (p.len < 12 && m.slice(1).some(v => /(^|\s)[a-z]{3,}/.test(v) && !exact.has(norm(v)))) continue;
        r = p.tr.replace(/\{(\d+)\}/g, (_, i) => {
          const v = m[p.order.indexOf(+i) + 1];
          return v === undefined ? '' : exact.get(norm(v)) ?? v;
        });
        break;
      }
    if (r === undefined && /^[·:—] /.test(t)) {
      // a fragment after a separator ("· suggested from ..."): the separator kept
      const x = tr(t.slice(2));
      if (x !== null) r = t.slice(0, 2) + x;
    }
    if (r === undefined && t.includes(' · ')) {
      // parts joined by " · " ("window 1: ... · window 2: ..."): each part on its own
      const parts = t.split(' · '),
        out = parts.map(x => tr(x));
      if (out.some(x => x !== null)) r = out.map((x, i) => x ?? parts[i]).join(' · ');
    }
    if (r === undefined) r = null;
    if (memo.size > 20000) memo.clear();
    memo.set(t, r);
    return r;
  }

  function textNode(n) {
    const v = n.nodeValue;
    if (!v || v.length > 2000) return;
    const r = tr(v);
    if (r === null || r === norm(v)) return;
    const lead = v.match(/^\s*/)[0],
      tail = v.match(/\s*$/)[0];
    n.nodeValue = lead + r + tail;
  }
  function attrs(el) {
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (!v) continue;
      const r = tr(v);
      if (r !== null && r !== v) el.setAttribute(a, r);
    }
    if (el.tagName === 'INPUT' && (el.type === 'button' || el.type === 'submit') && el.value) {
      const r = tr(el.value);
      if (r !== null) el.value = r;
    }
  }
  const skipped = el => el && el.closest && el.closest(SKIP);

  /* translate an element and everything in it (called by the observer, and at once by keepplace.js for the side panel) */
  function tree(root) {
    if (lang === 'en' || !root) return;
    if (root.nodeType === 3) {
      if (!skipped(root.parentElement)) textNode(root);
      return;
    }
    if (root.nodeType !== 1 || skipped(root)) return;
    attrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: n =>
        n.nodeType === 1 && n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    let n;
    while ((n = w.nextNode())) n.nodeType === 3 ? textNode(n) : attrs(n);
  }

  let obs = null;
  function start() {
    if (lang === 'en') return;
    const de = document.documentElement;
    de.lang = lang;
    if (lang === 'ar') de.dir = 'rtl';
    de.classList.add('lang-' + lang);
    tree(document.body);
    if (document.title) document.title = tr(document.title) || document.title;
    obs = new MutationObserver(list => {
      for (const m of list) {
        if (m.type === 'childList') m.addedNodes.forEach(tree);
        else if (m.type === 'characterData') {
          if (!skipped(m.target.parentElement)) textNode(m.target);
        } else if (m.type === 'attributes' && !skipped(m.target)) attrs(m.target);
      }
    });
    obs.observe(document.body, {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...ATTRS, 'value']});
  }

  /* the menu of the top bar: English / Français / Español / العربية; a new choice reloads the page (the case is saved first) */
  function menu() {
    const w = document.getElementById('lngsel');
    if (!w) return;
    w.innerHTML = `<label class="lngl" title="Language of the Studio"><span aria-hidden="true">🌐</span><select id="lngs" data-notr aria-label="Language">${Object.entries(
      LANGS
    )
      .map(([k, v]) => `<option value="${k}"${k === lang ? ' selected' : ''}>${v}</option>`)
      .join('')}</select></label>`;
    w.querySelector('#lngs').onchange = async e => {
      const v = e.target.value;
      try {
        localStorage.setItem('mst_lang', v);
      } catch (x) {}
      try {
        if (typeof LIB !== 'undefined' && LIB.flush) await LIB.flush();
      } catch (x) {}
      location.reload();
    };
  }

  return {LANGS, add, tr, tree, start, menu, table: () => exact, get lang() {
      return lang;
    }};
})();
/* the text as shown: t('Undo') -> 'Deshacer' (for code that writes text itself, e.g. alerts) */
const t_ = s => I18N.tr(s) ?? s;
