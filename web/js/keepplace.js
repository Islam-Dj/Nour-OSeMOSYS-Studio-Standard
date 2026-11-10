'use strict';
/* ============================== keep your place when a page is drawn again ==============================
   Most pages of the side panel are drawn as one block of HTML (drawer.innerHTML = ...). After an edit the same page is
   drawn again, which used to close the sections you had opened, empty the search box and jump back to the top.

   keepPlace(element, pageKey) makes that automatic for one element: each time its innerHTML is replaced by the SAME page
   (same pageKey, e.g. "build · technology · CCGT"), the Studio puts back
     - the sections (<details>) that were open or closed,
     - the text of the search / filter boxes (and filters the list again),
     - the scroll of the page and of its inner scrolled boxes,
     - the field that had the cursor.
   A different page starts fresh, as before. Nothing else changes: pages keep building their HTML as they did.

   How an element is recognised in the new HTML: by its id, or its data-p / data-g / data-k / data-f / data-code /
   data-id attribute, or else by its tag and class, numbered in order (the n-th <details class="pblk">). */
const KEEP = {
  ATTR: ['p', 'g', 'k', 'f', 'code', 'id', 'c', 'ek'],
  // the boxes of the panel that scroll (studio.css: overflow auto); reading the scroll of every element was too slow
  SCROLLERS: '.db, .tw, .gw, .fbox, .log, .chartbox, .qlist, .msel-l, .rcfg, .speq, .dxprev, [data-keep-scroll]',

  /* a key for an element that is the same in the old and the new HTML of a page */
  key(el) {
    if (el.id) return '#' + el.id;
    for (const a of KEEP.ATTR) if (el.dataset && el.dataset[a] !== undefined) return el.tagName + '[' + a + '=' + el.dataset[a] + ']';
    return el.tagName + '.' + (el.className && typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '');
  },

  /* the keys of all elements matching a selector, numbered when two elements share a key */
  keyed(root, sel) {
    const seen = new Map(),
      out = [];
    for (const el of root.querySelectorAll(sel)) {
      const k = KEEP.key(el),
        n = seen.get(k) || 0;
      seen.set(k, n + 1);
      out.push([n ? k + '~' + n : k, el]);
    }
    return out;
  },

  /* what the user sees now: open sections, search text, scroll, focus */
  capture(root) {
    const s = {open: new Map(), text: new Map(), scroll: new Map(), focus: null};
    for (const [k, d] of KEEP.keyed(root, 'details')) s.open.set(k, d.open);
    for (const [k, i] of KEEP.keyed(root, 'input[type=search], input.uq, input[data-keep]')) if (i.value) s.text.set(k, i.value);
    s.scroll.set('', root.scrollTop);
    for (const [k, e] of KEEP.keyed(root, KEEP.SCROLLERS))
      if (e.scrollTop > 0 || e.scrollLeft > 0) s.scroll.set(k, [e.scrollTop, e.scrollLeft]);
    const a = document.activeElement;
    if (a && root.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) {
      const f = KEEP.keyed(root, a.tagName).find(([, e]) => e === a);
      if (f) s.focus = {k: f[0], tag: a.tagName, start: a.selectionStart, end: a.selectionEnd};
    }
    return s;
  },

  /* put it back on the new HTML (after the page has wired its buttons and filters) */
  restore(root, s) {
    // sections: those you had open are opened again (a section the page opens itself stays open)
    for (const [k, d] of KEEP.keyed(root, 'details')) if (s.open.get(k) && !d.open) d.open = true;
    for (const [k, i] of KEEP.keyed(root, 'input[type=search], input.uq, input[data-keep]'))
      if (s.text.has(k) && !i.value) {
        i.value = s.text.get(k);
        i.dispatchEvent(new Event('input', {bubbles: true}));
      }
    if (s.focus) {
      const f = KEEP.keyed(root, s.focus.tag).find(([k]) => k === s.focus.k);
      if (f) {
        try {
          f[1].focus({preventScroll: true});
          if (s.focus.start != null) f[1].setSelectionRange(s.focus.start, s.focus.end);
        } catch (e) {}
      }
    }
    const scroll = () => {
      root.scrollTop = s.scroll.get('') || 0;
      if (s.scroll.size < 2) return;
      for (const [k, e] of KEEP.keyed(root, KEEP.SCROLLERS)) {
        const v = s.scroll.get(k);
        if (v) {
          e.scrollTop = v[0];
          e.scrollLeft = v[1];
        }
      }
    };
    if (KEEP.jumped) {
      KEEP.jumped = false;
      return;
    } // the page itself scrolled to a target (go to a cell / a parameter)
    scroll();
    requestAnimationFrame(scroll);
    setTimeout(scroll, 80); // again after the layout: lazy grids draw their rows on open
  },
  jumped: false,
  /* a page that scrolls to a target after drawing itself calls KEEP.jump(): its target wins over the old scroll */
  jump() {
    KEEP.jumped = true;
    queueMicrotask(() =>
      queueMicrotask(() => {
        KEEP.jumped = false;
      })
    );
  },

  /* watch one element: every innerHTML of the same page keeps the place */
  watch(el, pageKey) {
    if (!el || el._keepPlace) return;
    const proto = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    let last = null;
    Object.defineProperty(el, 'innerHTML', {
      configurable: true,
      get() {
        return proto.get.call(this);
      },
      set(html) {
        const before = this.hidden ? null : pageKey(this),
          s = before && before === last && this.childElementCount ? KEEP.capture(this) : null;
        proto.set.call(this, html);
        if (typeof I18N !== 'undefined') I18N.tree(this); // translated at once, so the page key is in one language
        const after = pageKey(this);
        last = after;
        if (s && after === before)
          queueMicrotask(() => {
            if (pageKey(this) === after) KEEP.restore(this, s);
          });
      }
    });
    el._keepPlace = true;
  }
};

/* the side panel: a page is known by its small title line ("build · technology · CCGT", "library", "model · units"...) */
KEEP.watch(document.getElementById('drawer'), el => {
  const c = el.querySelector('.dh .code');
  return c ? c.textContent.trim() : null;
});
/* the Model setup page: a page = its section (Time, Technologies...) */
KEEP.watch(document.getElementById('setup'), () => (typeof SETUP !== 'undefined' ? 'setup:' + SETUP.tab : null));
