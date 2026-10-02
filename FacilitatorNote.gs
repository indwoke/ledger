/**
 * Facilitator Session Note: backend module for the Bodh-Yantra Apps Script web app.
 * Add alongside Code.gs with FnSchema.gs (shared/fn_schema.js) and FnCore.gs (shared/fn_core.js).
 *
 * Integration points (adapt to the existing Ledger script; see BUILD_PROMPT.md):
 *   1. Router: call fnHandle_(action, body, user) from the existing doPost dispatcher for actions starting "fn.".
 *   2. Auth: `user` is whatever the existing passcode sign-in resolves (needs user.code, user.role).
 *   3. Storage: fnSheets_ below uses the Sheets REST API with the script's own token, matching how Ledger
 *      reads and writes app-created sheets under the drive.file scope. If Code.gs already has helpers
 *      (append rows, read range, add tab), use those instead and delete fnSheets_.
 *   4. Spreadsheet: the note tab lives in the app-created "PRAJA — master" spreadsheet. fnMasterId_()
 *      reads its id from Script Properties; swap for the existing getter if there is one.
 * No delete operations anywhere, consistent with the app's permissions.
 */

var FN_TAB = 'facilitator_notes';

function fnHandle_(action, body, user) {
  switch (action) {
    case 'fn.schema':     return { ok: true, schema: FN_SCHEMA };
    case 'fn.save':       return fnSave_(body, user);
    case 'fn.siteMemory': return fnSiteMemory_(body && body.institute_code);
    case 'fn.compare':    return fnCompareSession_(body && body.session_key, user);
    default:              return { ok: false, error: 'unknown_action' };
  }
}

/**
 * body = { note_id, session: {institute_code, session_date, template_id}, note: {...answers} }
 * note_id is a UUID generated on the phone, so retries from the offline queue never create duplicates.
 */
function fnSave_(body, user) {
  if (!user || !user.code) return { ok: false, error: 'not_signed_in' };
  if (!body || !body.note_id || !body.session || !body.note) return { ok: false, error: 'bad_request' };
  var s = body.session;
  if (!s.institute_code || !/^\d{4}-\d{2}-\d{2}$/.test(String(s.session_date || ''))) return { ok: false, error: 'bad_session' };

  var check = FNCore.validate(body.note, FN_SCHEMA);
  if (!check.ok) return { ok: false, error: 'invalid', errors: check.errors };

  var sessionKey = [s.institute_code, s.session_date, s.template_id || ''].join('|');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var existing = fnReadAll_();
    for (var i = 0; i < existing.length; i++) {
      if (existing[i].note_id === body.note_id) return { ok: true, duplicate: true, note_id: body.note_id };
      if (existing[i].session_key === sessionKey && existing[i].facilitator_code === user.code) {
        return { ok: false, error: 'already_submitted' }; // one independent note per facilitator per session
      }
    }
    var f = FNCore.flags(body.note);
    var record = Object.assign({}, body.note, {
      note_id: body.note_id,
      schema_version: FN_SCHEMA.version,
      submitted_at: new Date().toISOString(),
      session_key: sessionKey,
      institute_code: s.institute_code,
      session_date: s.session_date,
      template_id: s.template_id || '',
      facilitator_code: user.code,
      session_minutes: FNCore.sessionMinutes(body.note),
      review_flags: f.review,
      limitation_flags: f.limitations
    });
    fnSheets_.append(fnMasterId_(), FN_TAB, [FNCore.toRow(record, FN_SCHEMA)], FNCore.columns(FN_SCHEMA));
    return { ok: true, note_id: body.note_id, review: f.review, limitations: f.limitations };
  } finally {
    lock.releaseLock();
  }
}

/** Last three "what the next facilitator should know" notes for a site, newest first. No names by construction. */
function fnSiteMemory_(instituteCode) {
  if (!instituteCode) return { ok: false, error: 'bad_request' };
  var rows = fnReadAll_().filter(function (r) { return r.institute_code === String(instituteCode) && r.next_facilitator; });
  rows.sort(function (a, b) { return String(b.submitted_at).localeCompare(String(a.submitted_at)); });
  return { ok: true, notes: rows.slice(0, 3).map(function (r) { return { date: r.session_date, text: r.next_facilitator }; }) };
}

/** Scale gaps between facilitators on one session. Lead and admin roles only. */
function fnCompareSession_(sessionKey, user) {
  if (!user || (user.role !== 'admin' && user.role !== 'lead')) return { ok: false, error: 'forbidden' };
  var notes = fnReadAll_().filter(function (r) { return r.session_key === sessionKey; });
  return { ok: true, count: notes.length, gaps: FNCore.compare(notes, FN_SCHEMA) };
}

/** Scheduled job (add to the existing triggers, daily): email leads a digest of flagged sessions and gaps. */
function fnDailyDigest() {
  var since = Date.now() - 24 * 3600 * 1000;
  var rows = fnReadAll_().filter(function (r) { return new Date(r.submitted_at).getTime() >= since; });
  var bySession = {};
  rows.forEach(function (r) { (bySession[r.session_key] = bySession[r.session_key] || []).push(r); });
  var lines = [];
  Object.keys(bySession).forEach(function (k) {
    var notes = bySession[k];
    var review = notes.filter(function (n) { return n.review_flags.length; });
    var gaps = FNCore.compare(notes, FN_SCHEMA);
    if (review.length || gaps.length) {
      lines.push(k + ': ' + notes.length + ' notes' +
        (review.length ? '; review: ' + review.map(function (n) { return n.review_flags.join('+'); }).join(', ') : '') +
        (gaps.length ? '; gaps: ' + gaps.map(function (g) { return g.field + ' (' + g.gap + ')'; }).join(', ') : ''));
    }
  });
  if (!lines.length) return;
  var to = PropertiesService.getScriptProperties().getProperty('FN_DIGEST_TO'); // e.g. lead facilitator + research lead
  if (to) MailApp.sendEmail(to, 'Facilitator notes: sessions to review', lines.join('\n'));
}

// ---------------------------------------------------------------- storage

function fnMasterId_() {
  var id = PropertiesService.getScriptProperties().getProperty('PRAJA_MASTER_ID');
  if (!id) throw new Error('PRAJA_MASTER_ID not set');
  return id;
}

function fnReadAll_() {
  var cols = FNCore.columns(FN_SCHEMA);
  var values = fnSheets_.read(fnMasterId_(), FN_TAB, cols);
  var multi = FN_SCHEMA.fields.filter(function (f) { return f.type === 'multi' || f.type === 'itemlist'; }).map(function (f) { return f.id; })
    .concat(['review_flags', 'limitation_flags']);
  var numeric = FN_SCHEMA.fields.filter(function (f) { return f.type === 'scale' || f.type === 'int'; }).map(function (f) { return f.id; });
  return values.slice(1).map(function (row) {
    var r = {};
    cols.forEach(function (c, i) {
      var v = row[i] === undefined ? '' : row[i];
      if (multi.indexOf(c) >= 0) v = v === '' ? [] : String(v).split(',');
      else if (numeric.indexOf(c) >= 0 && v !== '') v = Number(v);
      r[c] = v;
    });
    return r;
  });
}

/** Minimal Sheets REST helpers (replace with Code.gs helpers if they exist). */
var fnSheets_ = {
  base: 'https://sheets.googleapis.com/v4/spreadsheets/',
  call: function (url, method, payload) {
    var res = UrlFetchApp.fetch(url, {
      method: method, contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      payload: payload ? JSON.stringify(payload) : undefined
    });
    if (res.getResponseCode() >= 300) throw new Error('Sheets API ' + res.getResponseCode() + ': ' + res.getContentText());
    return JSON.parse(res.getContentText() || '{}');
  },
  ensureTab: function (id, tab, header) {
    var meta = this.call(this.base + id + '?fields=sheets.properties.title', 'get');
    var has = (meta.sheets || []).some(function (s) { return s.properties.title === tab; });
    if (!has) {
      this.call(this.base + id + ':batchUpdate', 'post', { requests: [{ addSheet: { properties: { title: tab } } }] });
      this.call(this.base + id + '/values/' + encodeURIComponent(tab + '!A1') + '?valueInputOption=RAW', 'put', { values: [header] });
    }
  },
  append: function (id, tab, rows, header) {
    this.ensureTab(id, tab, header);
    this.call(this.base + id + '/values/' + encodeURIComponent(tab + '!A1') + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', 'post', { values: rows });
  },
  read: function (id, tab, header) {
    this.ensureTab(id, tab, header);
    var r = this.call(this.base + id + '/values/' + encodeURIComponent(tab), 'get');
    return r.values || [header];
  }
};
