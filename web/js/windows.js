'use strict';
/* ============================== several windows (second screen) ==============================
   Any workflow opens in a new window (New window, or the ↗ next to a workflow). Windows are LINKED by default: the case,
   the region, the year and the selected item follow each other (and a saved change reloads the case in the others).
   A window can be set ALONE (its own region, year and selection) and linked again later. Messages go through the
   Studio server (/api/bus), so app windows and browser windows link alike; without a server, a BroadcastChannel. */
const WIN = {
  id: Math.random().toString(36).slice(2, 9),
  link: true,
  others: new Map(),
  quiet: false,
  ch: null,
  lastData: null,
  view0: null,
  wantCase: null,
  second: false,
  init() {
    const p = new URLSearchParams(location.search);
    this.view0 = p.get('view');
    this.wantCase = p.get('case');
    this.second = p.has('view');
    this.link = p.get('link') !== '0';
    if (LIB.srv)
      this.poll(); // through the Studio server: app windows and browser windows alike
    else
      try {
        this.ch = new BroadcastChannel('nour-studio');
        this.ch.onmessage = e => this.recv(e.data);
      } catch (e) {
        this.ch = null;
      }
    addEventListener('beforeunload', () => this.send('bye'));
  },
  send(type, data) {
    if (this.quiet) return;
    const m = {type, from: this.id, link: this.link, view: CURVIEW, ...(data || {})};
    if (LIB.srv) {
      if (type === 'bye' && navigator.sendBeacon)
        return navigator.sendBeacon(SERVER.url + '/api/bus', new Blob([JSON.stringify(m)], {type: 'application/json'}));
      fetch(SERVER.url + '/api/bus', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(m),
        keepalive: true
      }).catch(() => {});
      return;
    }
    if (this.ch)
      try {
        this.ch.postMessage(m);
      } catch (e) {}
  },
  async poll() {
    let since = 1e12,
      fails = 0;
    try {
      since = (await (await fetch(SERVER.url + '/api/bus?since=1000000000000&wait=0')).json()).seq;
    } catch (e) {}
    for (;;) {
      try {
        const r = await (await fetch(`${SERVER.url}/api/bus?since=${since}&wait=20`)).json();
        since = r.seq;
        fails = 0;
        for (const m of r.msgs) if (m.from !== this.id) this.recv(m);
      } catch (e) {
        fails++;
        await new Promise(ok => setTimeout(ok, Math.min(10000, 1000 * fails)));
      }
    }
  },
  async start() {
    if (this.wantCase && LIB.srv) {
      const rec = await LIB.get(this.wantCase);
      if (rec) this.silent(() => LIB.openRec(rec));
    }
    // what other windows must hear about
    const save0 = save;
    save = (...a) => {
      save0(...a);
      this.send('place', {region: state.region, year: state.year});
    };
    const mb = markBrowser;
    markBrowser = (kind, code) => {
      mb(kind, code);
      if (code && (kind === 'tech' || kind === 'comm')) this.send('sel', {kind, code});
    };
    const or = LIB.openRec.bind(LIB);
    LIB.openRec = rec => {
      const r = or(rec);
      this.lastData = rec.data;
      this.send('case', {id: rec.id});
      return r;
    };
    const put = LIB.put.bind(LIB);
    LIB.put = async rec => {
      const ok = await put(rec);
      if (ok && rec.id === LIB.current && rec.data && rec.data !== this.lastData) {
        this.lastData = rec.data;
        this.send('saved', {id: rec.id});
      }
      return ok;
    };
    if (this.view0) goView(this.view0);
    if (this.second) document.title = `${this.titleOf(this.view0)} · ${APPNAME}`;
    this.send('hello');
    setInterval(() => {
      this.send('ping');
      const now = Date.now();
      for (const [k, o] of this.others) if (now - o.t > 12000) this.others.delete(k);
      this.chip();
    }, 4000);
    this.chip();
  },
  silent(fn) {
    this.quiet = true;
    try {
      return fn();
    } finally {
      this.quiet = false;
    }
  },
  async recv(m) {
    if (!m || m.from === this.id) return;
    if (m.type === 'bye') {
      this.others.delete(m.from);
      return this.chip();
    }
    const isNew = !this.others.has(m.from);
    this.others.set(m.from, {view: m.view, link: m.link, t: Date.now()});
    if (m.type === 'hello' && isNew) this.send('ping');
    this.chip();
    if (!this.link || !m.link) return; // alone, or the sender is alone
    if (m.type === 'place') {
      if (m.region && m.region !== state.region && (REG.includes(m.region) || (m.region === 'ALL' && REG.length > 1))) {
        this.silent(() => {
          const b = [...document.querySelectorAll('#regions button')].find(
            x => (x.dataset.r || x.textContent) === m.region
          );
          if (b) b.click();
        });
        if (typeof RV !== 'undefined' && RV.def && !document.getElementById('results').hidden) {
          if (m.region === 'ALL') delete RV.def.filters.REGION;
          else RV.def.filters.REGION = [m.region];
          renderResults();
        }
      }
      if (m.year && +m.year !== state.year && M && M.years.includes(+m.year)) {
        state.year = +m.year;
        this.silent(() => {
          if (sel && sel.t) openTech(sel.t);
          else if (sel && sel.f && typeof openFuel === 'function') openFuel(sel.f);
        });
      }
    }
    if (m.type === 'sel') {
      if (CURVIEW === 'dia')
        this.silent(() => {
          if (m.kind === 'tech' && M.techs.has(m.code)) {
            brCenter('T:' + m.code);
            openTech(m.code);
          } else if (m.kind === 'comm') openFuel(m.code);
        });
      else {
        markBrowser(m.kind, m.code);
        if (m.kind === 'tech') sel = {t: m.code};
      }
    }
    if ((m.type === 'case' && m.id !== LIB.current) || (m.type === 'saved' && m.id === LIB.current && !dirty)) {
      if (!LIB.srv) return;
      const rec = await LIB.get(m.id);
      if (!rec) return;
      const keep = sel && sel.t;
      this.silent(() => LIB.openRec(rec));
      this.lastData = rec.data;
      if (keep && M.techs.has(keep) && CURVIEW === 'dia') this.silent(() => openTech(keep));
      if (m.type === 'case') toast(`Case ${rec.name} opened in another window`);
    }
  },
  viewChanged(v) {
    this.send('ping');
  },
  titleOf(v) {
    return (
      {res: 'Results', mc: 'Monte Carlo', mon: 'Jobs and monitor', dia: 'Diagram and data', 'res-off': 'Diagram and data'}[v] || 'Studio'
    );
  },
  chip() {
    const c = document.getElementById('linkchip');
    if (!c) return;
    const n = this.others.size + 1;
    c.hidden = n < 2 && !this.second;
    c.textContent = this.link ? `Linked · ${n} window${n > 1 ? 's' : ''}` : `Alone · ${n} window${n > 1 ? 's' : ''}`;
    c.classList.toggle('alone', !this.link);
    c.title = this.link
      ? 'This window follows the other linked windows (case, region, year, selection). Click to make it alone.'
      : 'This window has its own region, year and selection. Click to link it again.';
    c.onclick = () => {
      this.link = !this.link;
      this.chip();
      if (this.link) {
        this.send('place', {region: state.region, year: state.year});
      }
      toast(this.link ? 'Linked: this window follows the others again' : 'Alone: this window keeps its own region, year and selection');
    };
  },
  open(view, link = true, where = 'browser') {
    const q = new URLSearchParams({view: view || 'res', link: link ? '1' : '0'});
    if (LIB.current) q.set('case', LIB.current);
    const url = location.origin + location.pathname + '?' + q.toString(),
      title = this.titleOf(view);
    const api = window.pywebview && window.pywebview.api;
    if (api && api.new_window && where !== 'browser') return api.new_window(url, title);
    if (api && api.open_browser) return api.open_browser(url);
    const w = window.open(url, '_blank', 'popup=yes,width=1400,height=900');
    if (!w) toast('The browser blocked the new window: allow pop-ups for this page');
  },
  dialog() {
    let d = document.getElementById('nwdlg');
    if (d) {
      d.remove();
      return;
    }
    if (!LIB.srv) {
      toast('Several windows need the Studio server (the app or START_SOLVER.bat): open the Studio from it');
    }
    d = document.createElement('div');
    d.id = 'nwdlg';
    d.className = 'pop';
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-label', 'Open in a new window');
    const flows = [
      ['res', 'Results'],
      ['mc', 'Monte Carlo'],
      ['dia', 'Diagram and data'],
      ['mon', 'Jobs and monitor']
    ];
    d.innerHTML = `<h3>Open in a new window</h3><p class="muted">Drag the new window to another screen. It opens on the workflow you choose.</p>
      <div class="pchoices">${flows.map(([k, l], i) => `<label class="pch"><input type="radio" name="nwv" value="${k}" ${i ? '' : 'checked'}> ${l}</label>`).join('')}</div>
      <div class="pmodes"><label class="pmode"><input type="radio" name="nwl" value="1" checked><span><b>Linked (standard)</b><br><span class="muted">Follows this window: case, region, year and the selected item.</span></span></label>
      <label class="pmode"><input type="radio" name="nwl" value="0"><span><b>Alone</b><br><span class="muted">Its own region, year and selection; can be linked later.</span></span></label></div>
      ${window.pywebview ? `<div class="pmodes"><label class="pch"><input type="radio" name="nww" value="browser" checked> In the web browser (a window or a tab)</label><label class="pch"><input type="radio" name="nww" value="app"> As another app window (trial)</label></div>` : ''}
      <div class="acts"><button class="btn" type="button" id="nwc">Cancel</button><button class="btn pri" type="button" id="nwo">Open window</button></div>`;
    document.body.appendChild(d);
    placeNear(d, document.getElementById('neww').getBoundingClientRect(), 'right');
    d.querySelector('#nwc').onclick = () => d.remove();
    d.querySelector('#nwo').onclick = () => {
      const w = d.querySelector('[name=nww]:checked');
      this.open(d.querySelector('[name=nwv]:checked').value, d.querySelector('[name=nwl]:checked').value === '1', w ? w.value : 'browser');
      d.remove();
    };
    d.querySelector('input').focus();
    const esc_ = e => {
      if (e.key === 'Escape') {
        d.remove();
        removeEventListener('keydown', esc_);
      }
    };
    addEventListener('keydown', esc_);
  }
};
WIN.init();
