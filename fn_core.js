/**
 * Facilitator Session Note: shared logic (validation, personal-data check, review flags, comparison).
 * Pure functions, no I/O. Runs in Apps Script (copy as FnCore.gs), the browser and Node tests.
 */
var FNCore = (function () {
  var REVIEW_FLAGGED_SHARE = 0.10; // decided 2 Oct
  var COMPARE_GAP = 2;             // decided 2 Oct
  var LIMIT_DESIRABILITY = 4;

  function isTime(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
  function minutes(s) { var p = s.split(':'); return Number(p[0]) * 60 + Number(p[1]); }
  function codes(f) { return (f.options || []).map(function (x) { return x.v; }); }
  function shown(f, note) { return !f.showIf || note[f.showIf.field] === f.showIf.equals; }
  function required(f, note) {
    if (f.requiredIf) return note[f.requiredIf.field] === f.requiredIf.equals;
    return !!f.required;
  }
  function empty(v) { return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0); }

  /** Personal-data check for free text. Returns a list of reasons; empty list = clean. */
  function piiCheck(text) {
    var reasons = [];
    if (!text) return reasons;
    var t = String(text);
    if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(t)) reasons.push('email');
    if (/(\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/.test(t)) reasons.push('phone');
    if (/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/.test(t)) reasons.push('id_number');
    if (/\d{7,}/.test(t.replace(/[\s-]/g, ''))) reasons.push('long_number');
    if (/\b(Mr|Mrs|Ms|Miss|Dr|Shri|Smt|Kumari|Sir|Madam|Ma'am)\.?\s+[A-Z][a-z]+/.test(t)) reasons.push('titled_name');
    if (/(श्री|श्रीमती|कुमारी|सौ\.)\s*\S+/.test(t)) reasons.push('titled_name');
    if (/\b(name is|named|called)\s+[A-Z][a-z]+/i.test(t)) reasons.push('named_person');
    if (/(नाम|नाव)\s*(है|आहे)?\s*[:\-]?\s*\S+/.test(t)) reasons.push('named_person');
    if (/\b(roll\s*(no|number)|class\s*\d+\s*[A-Z]\b|section\s+[A-Z]\b)/i.test(t)) reasons.push('class_detail');
    return reasons.filter(function (r, i, a) { return a.indexOf(r) === i; });
  }

  /** Validate a note against the schema. Returns { ok, errors: [{field, code}] }. */
  function validate(note, schema) {
    var errors = [];
    function err(field, code) { errors.push({ field: field, code: code }); }
    schema.fields.forEach(function (f) {
      var v = note[f.id];
      if (!shown(f, note)) { if (!empty(v)) err(f.id, 'not_applicable'); return; }
      if (empty(v)) { if (required(f, note)) err(f.id, 'required'); return; }
      switch (f.type) {
        case 'single':
          if (codes(f).indexOf(v) < 0) err(f.id, 'invalid_option'); break;
        case 'multi':
          if (!Array.isArray(v)) { err(f.id, 'invalid_type'); break; }
          if (v.some(function (x) { return codes(f).indexOf(x) < 0; })) err(f.id, 'invalid_option');
          if (f.exclusive && v.indexOf(f.exclusive) >= 0 && v.length > 1) err(f.id, 'exclusive_conflict');
          break;
        case 'scale':
          if (typeof v !== 'number' || v % 1 !== 0 || v < f.scale.min || v > f.scale.max) err(f.id, 'out_of_range'); break;
        case 'int':
          if (typeof v !== 'number' || v % 1 !== 0 || v < f.min || v > f.max) err(f.id, 'out_of_range'); break;
        case 'time':
          if (!isTime(v)) err(f.id, 'invalid_time'); break;
        case 'itemlist':
          if (!Array.isArray(v) || v.some(function (x) { return typeof x !== 'number' || x % 1 !== 0 || x < f.min || x > f.max; })) err(f.id, 'invalid_items');
          break;
        case 'text':
          if (typeof v !== 'string') { err(f.id, 'invalid_type'); break; }
          if (v.length > schema.textMax) err(f.id, 'too_long');
          if (piiCheck(v).length) err(f.id, 'personal_data');
          break;
      }
    });
    if (typeof note.forms_flagged === 'number' && typeof note.forms_collected === 'number' && note.forms_flagged > note.forms_collected) err('forms_flagged', 'more_than_collected');
    if (isTime(note.session_start) && isTime(note.session_end) && minutes(note.session_end) <= minutes(note.session_start)) err('session_end', 'end_before_start');
    var known = schema.fields.map(function (f) { return f.id; });
    Object.keys(note).forEach(function (k) { if (known.indexOf(k) < 0) err(k, 'unknown_field'); });
    return { ok: errors.length === 0, errors: errors };
  }

  function sessionMinutes(note) {
    if (!isTime(note.session_start) || !isTime(note.session_end)) return null;
    return minutes(note.session_end) - minutes(note.session_start);
  }

  /** Review and limitations flags (rules in the doc, decided 2 Oct). */
  function flags(note) {
    var review = [], limits = [];
    if (note.data_confidence === 'low') review.push('low_confidence');
    if (note.forms_collected > 0 && note.forms_flagged / note.forms_collected > REVIEW_FLAGGED_SHARE) review.push('flagged_forms_over_10pct');
    if (note.hostility === 'strong') review.push('strong_hostility');
    if (note.desirability_score >= LIMIT_DESIRABILITY) limits.push('social_desirability');
    if (note.authority_influence === 'clearly') limits.push('authority_influence');
    var op = note.others_present || [];
    if (op.indexOf('principal') >= 0 || op.indexOf('teacher') >= 0) limits.push('authority_present');
    return { review: review, limitations: limits };
  }

  /** Compare notes from different facilitators on one session: 1-5 scales differing by >= 2. */
  function compare(notes, schema) {
    var scales = schema.fields.filter(function (f) { return f.type === 'scale'; }).map(function (f) { return f.id; });
    var gaps = [];
    if (!notes || notes.length < 2) return gaps;
    scales.forEach(function (id) {
      var vals = notes.map(function (n) { return n[id]; }).filter(function (v) { return typeof v === 'number'; });
      if (vals.length < 2) return;
      var gap = Math.max.apply(null, vals) - Math.min.apply(null, vals);
      if (gap >= COMPARE_GAP) gaps.push({ field: id, gap: gap, values: vals });
    });
    return gaps;
  }

  /** Flat row for the sheet: fixed column order from the schema. */
  function columns(schema) {
    var cols = ['note_id', 'schema_version', 'submitted_at', 'session_key', 'institute_code', 'session_date', 'template_id', 'facilitator_code'];
    schema.fields.forEach(function (f) { cols.push(f.id); });
    return cols.concat(['session_minutes', 'review_flags', 'limitation_flags']);
  }
  function toRow(record, schema) {
    return columns(schema).map(function (c) {
      var v = record[c];
      if (Array.isArray(v)) return v.join(',');
      return v === undefined || v === null ? '' : v;
    });
  }

  return { piiCheck: piiCheck, validate: validate, sessionMinutes: sessionMinutes, flags: flags, compare: compare,
           columns: columns, toRow: toRow, REVIEW_FLAGGED_SHARE: REVIEW_FLAGGED_SHARE, COMPARE_GAP: COMPARE_GAP };
})();
if (typeof module !== 'undefined') { module.exports = FNCore; }
