/**
 * Facilitator Session Note: PWA screen (plain JS, no framework).
 * Needs fn_schema.js and fn_core.js loaded first.
 *
 * Usage:
 *   FacilitatorNote.mount(document.getElementById('app'), {
 *     lang: 'en' | 'hi' | 'mr',
 *     session: { institute_code, session_date: 'YYYY-MM-DD', template_id },   // from the current Bodh session
 *     send: function (action, body) { ... },   // the app's existing queued API call; must queue offline
 *     fetchSiteMemory: function (instituteCode) { return Promise<{notes:[{date,text}]}> } // optional
 *     onDone: function () { ... }              // optional
 *   });
 */
var FacilitatorNote = (function () {
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k]; else if (k === 'cls') e.className = attrs[k]; else e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (k) { if (k) e.appendChild(k); });
    return e;
  }
  var DRAFT_KEY = 'fn_draft_';

  function mount(root, opts) {
    var S = FN_SCHEMA, L = opts.lang || 'en';
    var draftKey = DRAFT_KEY + [opts.session.institute_code, opts.session.session_date, opts.session.template_id].join('|');
    var note = {};
    try { note = JSON.parse(localStorage.getItem(draftKey) || '{}'); } catch (e) { note = {}; }
    var noteId = note.__id || uuid(); note.__id = noteId;

    function save() { try { localStorage.setItem(draftKey, JSON.stringify(note)); } catch (e) {} }
    function val(f) { return note[f.id]; }

    root.innerHTML = '';
    var form = el('form', { cls: 'fn-form', novalidate: 'novalidate' });
    form.appendChild(el('h2', { text: S.ui.title[L] }));
    form.appendChild(el('p', { cls: 'fn-warn', text: S.ui.noNames[L] }));

    if (opts.fetchSiteMemory) {
      var mem = el('div', { cls: 'fn-memory' });
      form.appendChild(mem);
      opts.fetchSiteMemory(opts.session.institute_code).then(function (r) {
        if (!r || !r.notes || !r.notes.length) return;
        mem.appendChild(el('h3', { text: S.ui.siteMemory[L] }));
        r.notes.forEach(function (n) { mem.appendChild(el('p', { text: n.date + ': ' + n.text })); });
      }).catch(function () {});
    }

    var blocks = {};
    S.sections.forEach(function (sec) {
      var fs = el('fieldset', { cls: 'fn-section' }, [el('legend', { text: sec.id + '. ' + sec[L] })]);
      S.fields.filter(function (f) { return f.sec === sec.id; }).forEach(function (f) {
        var b = el('div', { cls: 'fn-q', 'data-field': f.id }, [el('label', { cls: 'fn-label', text: f.q + '  ' + f[L] + (f.required ? ' *' : '') })]);
        if (f.help) b.appendChild(el('p', { cls: 'fn-help', text: f.help[L] }));
        b.appendChild(input(f));
        b.appendChild(el('p', { cls: 'fn-err' }));
        blocks[f.id] = b; fs.appendChild(b);
      });
      form.appendChild(fs);
    });
    var status = el('p', { cls: 'fn-status', role: 'status' });
    form.appendChild(el('button', { type: 'submit', cls: 'fn-submit', text: S.ui.submit[L] }));
    form.appendChild(status);
    root.appendChild(form);
    refreshVisibility();

    function input(f) {
      var name = 'fn_' + f.id, wrap;
      if (f.type === 'single' || f.type === 'multi') {
        wrap = el('div', { cls: 'fn-options' });
        f.options.forEach(function (op) {
          var id = name + '_' + op.v;
          var i = el('input', { type: f.type === 'single' ? 'radio' : 'checkbox', name: name, id: id, value: op.v });
          if (f.type === 'single' ? val(f) === op.v : (val(f) || []).indexOf(op.v) >= 0) i.checked = true;
          i.addEventListener('change', function () {
            if (f.type === 'single') note[f.id] = op.v;
            else {
              var cur = (note[f.id] || []).filter(function (x) { return x !== op.v; });
              if (i.checked) {
                if (op.v === f.exclusive) cur = [];
                else cur = cur.filter(function (x) { return x !== f.exclusive; });
                cur.push(op.v);
              }
              note[f.id] = cur;
              Array.prototype.forEach.call(wrap.querySelectorAll('input'), function (x) { x.checked = cur.indexOf(x.value) >= 0; });
            }
            save(); refreshVisibility();
          });
          wrap.appendChild(el('label', { cls: 'fn-opt', 'for': id }, [i, el('span', { text: op[L] })]));
        });
        return wrap;
      }
      if (f.type === 'scale') {
        wrap = el('div', { cls: 'fn-scale' });
        wrap.appendChild(el('span', { cls: 'fn-anchor', text: f.anchors[L][0] }));
        for (var n = f.scale.min; n <= f.scale.max; n++) (function (n) {
          var id = name + '_' + n, i = el('input', { type: 'radio', name: name, id: id, value: String(n) });
          if (val(f) === n) i.checked = true;
          i.addEventListener('change', function () { note[f.id] = n; save(); });
          wrap.appendChild(el('label', { cls: 'fn-opt', 'for': id }, [i, el('span', { text: String(n) })]));
        })(n);
        wrap.appendChild(el('span', { cls: 'fn-anchor', text: f.anchors[L][1] }));
        return wrap;
      }
      var attrs = { name: name, id: name };
      if (f.type === 'int') { attrs.type = 'number'; attrs.inputmode = 'numeric'; attrs.min = f.min; attrs.max = f.max; }
      if (f.type === 'time') attrs.type = 'time';
      if (f.type === 'itemlist') { attrs.type = 'text'; attrs.inputmode = 'numeric'; attrs.placeholder = '3, 7, 12'; }
      var x = el(f.type === 'text' ? 'textarea' : 'input', Object.assign(attrs, f.type === 'text' ? { maxlength: S.textMax, rows: 3 } : {}));
      var v = val(f);
      if (v !== undefined) x.value = Array.isArray(v) ? v.join(', ') : v;
      x.addEventListener('input', function () {
        var s = x.value.trim();
        if (f.type === 'int') note[f.id] = s === '' ? undefined : Number(s);
        else if (f.type === 'itemlist') note[f.id] = s === '' ? undefined : s.split(/[,\s]+/).filter(Boolean).map(Number);
        else note[f.id] = s === '' ? undefined : (f.type === 'text' ? x.value : s);
        save();
      });
      return x;
    }

    function refreshVisibility() {
      S.fields.forEach(function (f) {
        if (!f.showIf) return;
        var on = note[f.showIf.field] === f.showIf.equals;
        blocks[f.id].style.display = on ? '' : 'none';
        if (!on && note[f.id] !== undefined) { delete note[f.id]; save(); }
      });
    }

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var clean = {};
      S.fields.forEach(function (f) { if (note[f.id] !== undefined) clean[f.id] = note[f.id]; });
      Object.keys(blocks).forEach(function (k) { blocks[k].classList.remove('fn-bad'); blocks[k].querySelector('.fn-err').textContent = ''; });
      var res = FNCore.validate(clean, S);
      if (!res.ok) {
        res.errors.forEach(function (e) {
          var b = blocks[e.field]; if (!b) return;
          b.classList.add('fn-bad'); b.querySelector('.fn-err').textContent = e.code.replace(/_/g, ' ');
        });
        status.textContent = S.ui.fixErrors[L];
        var first = form.querySelector('.fn-bad'); if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      opts.send('fn.save', { note_id: noteId, session: opts.session, note: clean });
      try { localStorage.removeItem(draftKey); } catch (e) {}
      status.textContent = S.ui.saved[L];
      form.querySelector('.fn-submit').disabled = true;
      if (opts.onDone) opts.onDone();
    });
  }
  return { mount: mount };
})();
