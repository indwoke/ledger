/**
 * School coverage list: Prajakta's screen (plain JS). Needs cov_core.js for COV_CONFIG labels only.
 *
 * CoverageList.mount(container, { lang: 'en'|'hi'|'mr', load: function () { return Promise<{schools:[...]}> } })
 * `load` calls the backend action cov.list. Offline, show the last list the app cached.
 */
var CoverageList = (function () {
  var T = {
    title: { en: 'School coverage', hi: 'स्कूल कवरेज', mr: 'शाळा कव्हरेज' },
    status: {
      second_session_needed: { en: 'Second session needed', hi: 'दूसरा सत्र ज़रूरी', mr: 'दुसरे सत्र आवश्यक' },
      low_confidence: { en: 'Low confidence (2 sessions held)', hi: 'कम भरोसा (2 सत्र हो चुके)', mr: 'कमी विश्वास (2 सत्र झाले)' },
      pending: { en: 'No forms scanned yet', hi: 'अभी कोई फ़ॉर्म स्कैन नहीं', mr: 'अजून फॉर्म स्कॅन नाहीत' },
      ok: { en: 'Covered', hi: 'पूरा', mr: 'पूर्ण' }
    },
    items: {
      parents: { en: 'Parents', hi: 'अभिभावक', mr: 'पालक' }, fathers: { en: 'Fathers', hi: 'पिता', mr: 'वडील' },
      teachers: { en: 'Teachers and staff', hi: 'शिक्षक और स्टाफ', mr: 'शिक्षक व कर्मचारी' }, grades: { en: 'Grades', hi: 'कक्षाएँ', mr: 'इयत्ता' }
    },
    due: { en: 'Due by', hi: 'अंतिम तारीख', mr: 'शेवटची तारीख' },
    near: { en: 'Score near the band line', hi: 'स्कोर बैंड रेखा के पास', mr: 'गुण बँड रेषेजवळ' },
    hidden: { en: 'Score hidden: fewer than 5 forms', hi: 'स्कोर छिपा: 5 से कम फ़ॉर्म', mr: 'गुण लपवले: 5 पेक्षा कमी फॉर्म' }
  };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

  function card(c, L) {
    var box = el('div', 'cov-card cov-' + c.status);
    var head = el('div', 'cov-head');
    head.appendChild(el('strong', null, c.institute_code));
    head.appendChild(el('span', 'cov-status', T.status[c.status][L]));
    box.appendChild(head);
    if (c.second_session_due) box.appendChild(el('p', 'cov-due', T.due[L] + ' ' + c.second_session_due));
    var grid = el('div', 'cov-grid');
    ['parents', 'fathers', 'teachers', 'grades'].forEach(function (k) {
      var have = Number(c[k]), target = Number(c[k + '_target']);
      var cell = el('div', 'cov-item ' + (have >= target ? 'cov-met' : 'cov-short'));
      cell.appendChild(el('span', 'cov-num', have + ' / ' + target));
      cell.appendChild(el('span', 'cov-lbl', T.items[k][L]));
      grid.appendChild(cell);
    });
    box.appendChild(grid);
    if (c.score === '' || c.score === null) {
      if (c.status !== 'pending') box.appendChild(el('p', 'cov-score', T.hidden[L]));
    } else {
      var txt = c.band + ' · ' + c.score + (c.score_low !== '' && c.score_low !== undefined ? ' (' + c.score_low + '–' + c.score_high + ')' : '');
      box.appendChild(el('p', 'cov-score', txt));
      if (c.near_band_line) box.appendChild(el('p', 'cov-near', T.near[L] + ' ' + c.near_band_line));
    }
    return box;
  }

  function mount(root, opts) {
    var L = opts.lang || 'en';
    root.innerHTML = '';
    root.appendChild(el('h2', 'cov-title', T.title[L]));
    var list = el('div', 'cov-list');
    root.appendChild(list);
    return opts.load().then(function (r) {
      (r.schools || []).forEach(function (c) { list.appendChild(card(c, L)); });
    });
  }
  return { mount: mount };
})();
