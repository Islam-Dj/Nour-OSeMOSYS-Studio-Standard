'use strict';
/* ---- a part of the diagram, and deleting several items ----
   The bar at the top left of the diagram is always there. "Select" turns the selection tool on: a click on a box selects a
   technology, a click on a commodity line selects the commodity, a drag on the empty diagram draws a rectangle that
   selects everything in it. Without the tool: Ctrl / Shift / ⌘ + click, Shift + drag. The model browser selects too
   ("Select" under the list: ticks, a family by its header, every listed row; Ctrl + click a row) - technologies and
   commodities. Esc clears the selection.
   With a selection: Show only these (the technologies, those of the selected commodities, and the commodities between
   them, laid out again) · + suppliers · + users · Remove from the part · Delete... (the selected technologies and
   commodities and all their data, after a confirmation; Undo delete puts everything back) · Save view... (named, kept
   with the case) · Views · Full system. The image export is unchanged: it exports what the diagram shows. */
const DVW = {
  pick: new Set(),
  pickF: new Set(),
  view: null,
  selMode: false,
  tool: false,
  saved: [],
  undoSnap: null,
  active() {
    return this.view ? this.view.techs : null;
  },
  n() {
    return this.pick.size + this.pickF.size;
  },
  has(kind, c) {
    return kind === 'comm' ? this.pickF.has(c) : this.pick.has(c);
  },
  toggle(t) {
    this.pick.has(t) ? this.pick.delete(t) : this.pick.add(t);
    this.paint();
  },
  toggleF(f) {
    this.pickF.has(f) ? this.pickF.delete(f) : this.pickF.add(f);
    this.paint();
  },
  toggleItem(kind, c) {
    kind === 'comm' ? this.toggleF(c) : this.toggle(c);
  },
  set(list, on = true, kind = 'tech') {
    const S = kind === 'comm' ? this.pickF : this.pick;
    for (const x of list) on ? S.add(x) : S.delete(x);
    this.paint();
  },
  clear() {
    this.pick.clear();
    this.pickF.clear();
    this.paint();
  },
  full() {
    const regs = state.region === 'ALL' ? REG : [state.region];
    return buildGraph(regs, {showoff: state.showoff, showbs: state.showbs});
  },
  techsOf(fs) {
    if (!fs.size) return [];
    const F = this.full();
    return [...new Set(F.edges.filter(e => fs.has(e.f)).map(e => e.t))];
  },
  base() {
    const s = new Set([...this.pick, ...this.techsOf(this.pickF)]);
    return s.size ? s : this.view ? new Set(this.view.techs) : s;
  },
  show(set, name) {
    set = new Set([...(set || []), ...this.techsOf(this.pickF)]);
    if (!set.size)
      return toast('Select technologies or commodities first: "Select", then click boxes / commodity lines or drag a rectangle.');
    this.view = {techs: set, name: name || ''};
    this.pick.clear();
    this.pickF.clear();
    this.tool = false;
    draw();
    fit();
  },
  grow(dir) {
    const F = this.full(),
      cur = this.base();
    if (!cur.size) return toast('Select technologies or show a part first.');
    const ins = new Set(F.edges.filter(e => cur.has(e.t) && e.dir === 'in').map(e => e.f)),
      outs = new Set(F.edges.filter(e => cur.has(e.t) && e.dir === 'out').map(e => e.f));
    const add = new Set(
      F.edges
        .filter(e => (dir === 'up' ? e.dir === 'out' && ins.has(e.f) : e.dir === 'in' && outs.has(e.f)))
        .map(e => e.t)
        .filter(t => !cur.has(t))
    );
    if (!add.size) return toast(dir === 'up' ? 'No other technology supplies these.' : 'No other technology uses what these make.');
    const next = new Set([...(this.view ? this.view.techs : []), ...cur, ...add]);
    this.view = {techs: next, name: this.view ? this.view.name : ''};
    this.pick.clear();
    this.pickF.clear();
    draw();
    fit();
    toast(
      `${add.size} ${dir === 'up' ? 'supplier' : 'user'}${add.size > 1 ? 's' : ''} added: ${[...add].slice(0, 6).join(', ')}${add.size > 6 ? '…' : ''}`
    );
  },
  remove() {
    if (!this.view || !this.pick.size) return;
    const next = new Set([...this.view.techs].filter(t => !this.pick.has(t)));
    if (!next.size) return toast('That would leave nothing: use "Full system".');
    this.view = {techs: next, name: this.view.name};
    this.pick.clear();
    draw();
    fit();
  },
  exit() {
    this.view = null;
    this.pick.clear();
    this.pickF.clear();
    draw();
    fit();
  },
  // ---- delete the selected technologies and commodities, with all their data (one undo)
  async del() {
    const T = [...this.pick],
      F = [...this.pickF];
    if (!T.length && !F.length) return;
    const list = [...T, ...F],
      short = list.slice(0, 12).join(', ') + (list.length > 12 ? ` and ${list.length - 12} more` : '');
    if (
      !await uiConfirm(
        `Delete ${T.length ? T.length + ' technolog' + (T.length > 1 ? 'ies' : 'y') : ''}${T.length && F.length ? ' and ' : ''}${F.length ? F.length + ' commodit' + (F.length > 1 ? 'ies' : 'y') : ''} and all their data?\n\n${short}\n\nThe ratios of other technologies on a deleted commodity go too. "Undo delete" puts everything back.`
      )
    )
      return;
    const snap = {text: writeData(), meta: {...M.meta}, view: this.view ? {techs: [...this.view.techs], name: this.view.name} : null};
    for (const t of T) deleteEntity('tech', t);
    for (const f of F) deleteEntity('comm', f);
    if (this.view) {
      for (const t of T) this.view.techs.delete(t);
      if (!this.view.techs.size) this.view = null;
    }
    this.pick.clear();
    this.pickF.clear();
    const keepView = this.view;
    if (typeof EDIT !== 'undefined') EDIT = null;
    const dr = document.getElementById('drawer');
    if (dr) dr.hidden = true;
    afterEdit(`${list.length} deleted: ${short}`);
    this._m = M;
    this.view = keepView;
    this.undoSnap = snap;
    draw();
    this.bar();
  },
  undoDel() {
    const s = this.undoSnap;
    if (!s) return;
    this.undoSnap = null;
    load(s.text, s.meta);
    afterEdit('delete undone');
    this._m = M;
    this.view = s.view ? {techs: new Set(s.view.techs), name: s.view.name} : null;
    draw();
    fit();
    toast('Everything deleted is back.');
  },
  // ---- saved views
  async load() {
    try {
      this.saved = typeof LIB !== 'undefined' && LIB.views ? await LIB.views() : [];
    } catch (e) {
      this.saved = [];
    }
    this.bar();
  },
  async store() {
    try {
      if (typeof LIB !== 'undefined' && LIB.views) this.saved = await LIB.views(this.saved);
    } catch (e) {}
    this.bar();
  },
  async saveAs() {
    const set = this.view ? this.view.techs : this.base();
    if (!set.size) return toast('Show a part (or select technologies) first.');
    const name = (await uiPrompt('Name of this view (e.g. Water–land, Gas chain):', (this.view && this.view.name) || '') || '').trim();
    if (!name) return;
    this.saved = this.saved.filter(v => v.name !== name).concat([{name, techs: [...set], region: state.region}]);
    if (this.view) this.view.name = name;
    await this.store();
    toast(`View "${name}" saved with the case (${set.size} technologies).`);
  },
  async drop(name) {
    this.saved = this.saved.filter(v => v.name !== name);
    if (this.view && this.view.name === name) this.view.name = '';
    await this.store();
  },
  open(name) {
    const v = this.saved.find(x => x.name === name);
    if (!v) return;
    const have = new Set(M.techs),
      techs = v.techs.filter(t => have.has(t));
    if (techs.length < v.techs.length)
      toast(
        `${v.techs.length - techs.length} technolog${v.techs.length - techs.length > 1 ? 'ies' : 'y'} of this view no longer in the model.`
      );
    this.show(new Set(techs), v.name);
  },
  setTool(on) {
    this.tool = on;
    const st = document.getElementById('stage');
    if (st) st.classList.toggle('seltool', on);
    this.bar();
    if (on && !this.n())
      toast(
        'Selection: click boxes or lines, or drag a rectangle. Move: wheel (Shift = sideways), Space + drag, right-drag or arrow keys. Zoom: Ctrl + wheel. Esc clears.'
      );
  },
  // ---- drawing
  paint() {
    const svg = document.getElementById('svg');
    if (svg) {
      svg.querySelectorAll('.tech').forEach(g => g.classList.toggle('pick', this.pick.has(g.dataset.t)));
      svg.querySelectorAll('.fuel').forEach(g => g.classList.toggle('pick', this.pickF.has(g.dataset.f)));
    }
    document.querySelectorAll('#mbrowser .bri').forEach(b => {
      if (b.dataset.k !== 'tech' && b.dataset.k !== 'comm') return;
      const on = this.has(b.dataset.k, b.dataset.c);
      b.classList.toggle('pick', on);
      const c = b.querySelector('.bpk');
      if (c) c.checked = on;
    });
    this.bar();
  },
  // the bar sits under the Build bar when that one is open (it used to go to the bottom, over the legend)
  pos() {
    const b = document.getElementById('dvbar'),
      bb = document.getElementById('buildbar');
    if (!b) return;
    if (bb && !bb.hidden && bb.offsetHeight) {
      b.style.top = bb.offsetTop + bb.offsetHeight + 8 + 'px';
      b.style.bottom = 'auto';
    } else {
      b.style.top = '';
      b.style.bottom = '';
    }
  },
  bar() {
    const st = document.getElementById('stage');
    if (!st) return;
    let b = document.getElementById('dvbar');
    if (!b) {
      b = document.createElement('div');
      b.id = 'dvbar';
      b.className = 'dvbar';
      b.setAttribute('role', 'toolbar');
      b.setAttribute('aria-label', 'Select a part of the diagram');
      st.appendChild(b);
    }
    if (typeof M === 'undefined' || !M) {
      b.hidden = true;
      return;
    }
    b.hidden = false;
    st.classList.toggle('seltool', this.tool);
    const nT = this.pick.size,
      nF = this.pickF.size,
      n = nT + nF,
      total = M.techs ? M.techs.size || M.techs.length : 0,
      v = this.view;
    const btn = (a, l, t, cls) =>
      `<button type="button" class="btn sm${cls ? ' ' + cls : ''}" data-dv="${a}" title="${esc(t)}">${l}</button>`;
    b.innerHTML =
      `<button type="button" class="btn sm${this.tool ? ' pri' : ''}" data-dv="tool" aria-pressed="${this.tool}" title="Selection tool: click boxes or commodity lines, or drag a rectangle (Ctrl / Shift + click works too)">⬚ Select${this.tool ? ': on' : ''}</button>` +
      (v ? `<span class="dvst"><b>${esc(v.name || 'Part of the system')}</b> · ${v.techs.size} of ${total} technologies</span>` : '') +
      (n
        ? `<span class="dvst">${nT ? nT + ' technolog' + (nT > 1 ? 'ies' : 'y') : ''}${nT && nF ? ' + ' : ''}${nF ? nF + ' commodit' + (nF > 1 ? 'ies' : 'y') : ''} selected</span>`
        : this.tool
          ? '<span class="dvst muted">click or drag a rectangle · move: wheel, Space + drag · zoom: Ctrl + wheel</span>'
          : '') +
      (n
        ? btn(
            'show',
            'Show only these',
            'Draw only the selection (and the technologies of selected commodities) with the commodities between them',
            'pri'
          )
        : '') +
      (n || v
        ? btn('up', '+ suppliers', 'Add the technologies that produce what this part uses') +
          btn('down', '+ users', 'Add the technologies that use what this part produces')
        : '') +
      (v && nT ? btn('rm', 'Remove from the part', 'Take the selected technologies out of the part shown (they stay in the model)') : '') +
      (n
        ? btn(
            'del',
            'Delete…',
            'Delete the selected technologies and commodities and all their data from the model (Undo delete puts them back)',
            'danger'
          )
        : '') +
      (this.undoSnap ? btn('undo', 'Undo delete', 'Put back everything the last delete removed') : '') +
      (n ? btn('clear', 'Clear', 'Unselect everything (Esc)') : '') +
      (v || n ? btn('save', 'Save view…', 'Keep this part under a name, with the case') : '') +
      (this.saved.length
        ? `<select data-dv="views" aria-label="Saved views"><option value="">Views (${this.saved.length})…</option>${this.saved.map(x => `<option value="${esc(x.name)}">${esc(x.name)} · ${x.techs.length}</option>`).join('')}<option value="__del">Delete a view…</option></select>`
        : '') +
      (v ? btn('full', 'Full system', 'Show the whole system again', n ? '' : 'pri') : '') +
      (typeof SYSTEMS !== 'undefined' && SYSTEMS.list.length
        ? '<span class="dvsys"></span>' +
          btn('links', 'Interlinkages', 'Map and table of the commodities that cross from one system to another')
        : '');
    b.querySelectorAll('[data-dv]').forEach(x => {
      if (x.tagName === 'SELECT')
        x.onchange = async () => {
          const val = x.value;
          x.value = '';
          if (val === '__del') {
            const nm = await uiPrompt('Delete which view? ' + this.saved.map(s => s.name).join(', '));
            if (nm) await this.drop(nm.trim());
          } else if (val) this.open(val);
        };
      else
        x.onclick = () =>
          ({
            tool: () => this.setTool(!this.tool),
            show: () => this.show(this.pick),
            up: () => this.grow('up'),
            down: () => this.grow('down'),
            rm: () => this.remove(),
            del: () => this.del(),
            undo: () => this.undoDel(),
            clear: () => this.clear(),
            save: () => this.saveAs(),
            full: () => this.exit(),
            links: () => openSystems('map')
          })[x.dataset.dv]();
    });
    const ds = b.querySelector('.dvsys');
    if (ds)
      ds.appendChild(
        MSEL.button({
          name: 'systems',
          title: 'Show only the technologies of some systems',
          items: () => SYSTEMS.ordered().map(s => ({v: s.c, l: (s.depth ? '› ' : '') + SYSTEMS.full(s.c)})),
          sel: SYSTEMS.list.map(s => s.c),
          allCount: true,
          onChange: c => {
            if (!c.length || c.length === SYSTEMS.list.length) this.exit();
            else sysFilter(c);
          }
        })
      );
    this.pos();
    const bb = document.getElementById('buildbar');
    if (bb && !bb._dvro && typeof ResizeObserver !== 'undefined') {
      bb._dvro = new ResizeObserver(() => this.pos());
      bb._dvro.observe(bb);
      new MutationObserver(() => this.pos()).observe(bb, {attributes: true, attributeFilter: ['hidden']});
    }
  }
};
// rectangle selection: with the tool on, a drag on the empty diagram; without it, Shift (or Ctrl / ⌘) + drag
(function () {
  const st = document.getElementById('stage');
  if (!st) return;
  let box = null;
  st.addEventListener(
    'pointerdown',
    e => {
      if (
        !(DVW.tool || e.shiftKey || e.ctrlKey || e.metaKey) ||
        e.button !== 0 ||
        (typeof SPACE !== 'undefined' && SPACE) ||
        e.target.closest('.tech,.fuel,.btn,.legend,.dvbar,select,.zoom,.dtools,.buildbar')
      )
        return;
      e.stopImmediatePropagation();
      e.preventDefault();
      const r = st.getBoundingClientRect();
      box = {
        x0: e.clientX - r.left,
        y0: e.clientY - r.top,
        add: e.ctrlKey || e.metaKey || e.shiftKey,
        el: Object.assign(document.createElement('div'), {className: 'dvrect'})
      };
      st.appendChild(box.el);
      st.setPointerCapture(e.pointerId);
    },
    true
  );
  st.addEventListener(
    'pointermove',
    e => {
      if (!box) return;
      const r = st.getBoundingClientRect(),
        x = e.clientX - r.left,
        y = e.clientY - r.top;
      Object.assign(box.el.style, {
        left: Math.min(x, box.x0) + 'px',
        top: Math.min(y, box.y0) + 'px',
        width: Math.abs(x - box.x0) + 'px',
        height: Math.abs(y - box.y0) + 'px'
      });
      box.x1 = x;
      box.y1 = y;
    },
    true
  );
  st.addEventListener(
    'pointerup',
    e => {
      if (!box) return;
      e.stopImmediatePropagation();
      box.el.remove();
      if (box.x1 !== undefined && Math.abs(box.x1 - box.x0) + Math.abs(box.y1 - box.y0) > 6) {
        const r = st.getBoundingClientRect();
        const A = {
          l: r.left + Math.min(box.x0, box.x1),
          r: r.left + Math.max(box.x0, box.x1),
          t: r.top + Math.min(box.y0, box.y1),
          b: r.top + Math.max(box.y0, box.y1)
        };
        const hit = el => {
          const q = el.getBoundingClientRect();
          return q.width + q.height > 0 && q.left < A.r && q.right > A.l && q.top < A.b && q.bottom > A.t;
        };
        const T = [...document.querySelectorAll('#svg .tech')].filter(g => hit(g.querySelector('.t-box') || g)).map(g => g.dataset.t);
        const F = [...document.querySelectorAll('#svg .fuel')].filter(g => hit(g.querySelector('.f-line') || g)).map(g => g.dataset.f);
        DVW.pick = new Set([...DVW.pick, ...T]);
        DVW.pickF = new Set([...DVW.pickF, ...F]);
        DVW.paint();
        if (T.length + F.length)
          toast(
            `${T.length} technolog${T.length === 1 ? 'y' : 'ies'}${F.length ? ` and ${F.length} commodit${F.length === 1 ? 'y' : 'ies'}` : ''} selected`
          );
      }
      box = null;
    },
    true
  );
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && DVW.n() && !e.target.closest('input,textarea,select')) DVW.clear();
  });
})();
