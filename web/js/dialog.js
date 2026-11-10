'use strict';
/* ============================== questions in the Studio's own style ==============================
   The browser's confirm() and prompt() boxes are replaced by a dialog drawn by the Studio: its colour, fonts and edges,
   the question in paragraphs, a clear main button (red when it deletes), Enter / Escape, and the focus kept inside.
     await uiConfirm(text, {ok: 'Delete'})       -> true / false
     await uiPrompt(text, default value)         -> the text typed, or null when cancelled
   (Under automated tests, whose scripts answer the browser's own boxes, the browser's boxes are still used.) */
const UIDLG = {
  open(text, {input = null, ok, cancel = 'Cancel', danger} = {}) {
    if (typeof navigator !== 'undefined' && navigator.webdriver && !window.UIDLG_FORCE)
      return Promise.resolve(input === null ? window.confirm(text) : window.prompt(text, input));
    return new Promise(res => {
      const prev = document.activeElement,
        w = document.createElement('div');
      w.className = 'uidlg-w';
      const paras = String(text)
        .split(/\n\s*\n/)
        .map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
        .join('');
      const isDel = danger ?? /^\s*(delete|remove|clear|discard|replace|overwrite)\b/i.test(String(text));
      const okLabel = ok || (input !== null ? 'OK' : isDel ? (String(text).match(/^\s*(\w+)/) || [0, 'OK'])[1].replace(/^./, c => c.toUpperCase()) : 'OK');
      w.innerHTML = `<div class="uidlg" role="dialog" aria-modal="true" aria-label="Question">
        <div class="uidlg-t">${paras}</div>
        ${input !== null ? `<input class="uidlg-i" type="text" value="${esc(input ?? '')}">` : ''}
        <div class="acts"><button type="button" class="btn" data-a="no">${esc(cancel)}</button><button type="button" class="btn pri${isDel ? ' danger' : ''}" data-a="yes">${esc(okLabel)}</button></div></div>`;
      document.body.appendChild(w);
      const inp = w.querySelector('.uidlg-i'),
        done = v => {
          w.remove();
          document.removeEventListener('keydown', key, true);
          try {
            prev && prev.focus && prev.focus();
          } catch (e) {}
          res(v);
        },
        yes = () => done(input !== null ? inp.value : true),
        no = () => done(input !== null ? null : false);
      const key = e => {
        if (e.key === 'Escape') {
          e.preventDefault();
          no();
        } else if (e.key === 'Enter' && (!e.target.closest || !e.target.closest('textarea'))) {
          e.preventDefault();
          yes();
        } else if (e.key === 'Tab') {
          const f = [...w.querySelectorAll('input, button')];
          const i = f.indexOf(document.activeElement);
          e.preventDefault();
          f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus();
        }
      };
      document.addEventListener('keydown', key, true);
      w.querySelector('[data-a="yes"]').onclick = yes;
      w.querySelector('[data-a="no"]').onclick = no;
      w.onclick = e => {
        if (e.target === w) no();
      };
      setTimeout(() => (inp ? (inp.focus(), inp.select()) : w.querySelector('[data-a="yes"]').focus()), 0);
    });
  }
};
const uiConfirm = (text, o) => UIDLG.open(text, o);
const uiPrompt = (text, def, o) => UIDLG.open(text, {...(o || {}), input: def == null ? '' : String(def)});
