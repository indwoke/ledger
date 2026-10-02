/**
 * School coverage check (field direction 5): backend module for Bodh-Yantra.
 * Needs CovCore.gs (shared/cov_core.js) and the fnSheets_ / fnMasterId_ helpers from FacilitatorNote.gs
 * (or the existing Code.gs equivalents).
 *
 * What it does
 *  - Hourly job covRefresh(): for every school with a form scanned in the last 48 hours, recompute coverage
 *    from all of that school's scanned forms and write one row per school to the "school_coverage" tab
 *    (updated in place, never deleted). So a school's status is current within about an hour of scanning,
 *    well inside the 48-hour promise.
 *  - Emails Prajakta (COV_NOTIFY_TO) when a school newly needs a second session, with the due date.
 *  - API: cov.list (Prajakta's list, sorted by what needs action) and cov.school (one school's card).
 *
 * Integration points (see BUILD_PROMPT.md)
 *  - COV_SOURCE: where scanned forms live and which columns hold what. Map it to the real Bodh scan tab.
 *  - Optional "school_profile" tab: institute_code | teachers_available, so a school with fewer than
 *    10 teachers is not flagged as short when every teacher took part.
 */

var COV_TAB = 'school_coverage';
var COV_PROFILE_TAB = 'school_profile';
var COV_SOURCE = {
  tab: 'responses',                  // the tab where Bodh writes one row per scanned form (rename to the real one)
  scannedAtColumn: 'scanned_at',     // ISO timestamp of the scan
  columns: {                         // field -> column header in that tab
    institute_code: 'institute_code', session_date: 'session_date', template_id: 'template_id',
    group: 'respondent_group', gender: 'gender', grade: 'grade', score: 'overall_protection_score'
  },
  groupValues: { parent: 'parents', parents: 'parents', teacher: 'teachers', teachers: 'teachers', staff: 'staff', student: 'students', students: 'students' },
  maleValues: ['male', 'm', 'पुरुष', 'father'],
  femaleValues: ['female', 'f', 'स्त्री', 'महिला', 'mother']
};
var COV_COLUMNS = ['institute_code', 'status', 'reasons', 'sessions_held', 'first_session', 'second_session_due',
  'parents', 'parents_target', 'fathers', 'fathers_target', 'teachers', 'teachers_target', 'grades', 'grades_target',
  'scored_forms', 'score', 'score_low', 'score_high', 'band', 'near_band_line', 'updated_at'];

function covHandle_(action, body, user) {
  if (!user) return { ok: false, error: 'not_signed_in' };
  switch (action) {
    case 'cov.list':   return { ok: true, schools: CovCore.sortForAction(covReadCoverage_()) };
    case 'cov.school': return { ok: true, school: covAssessSchool_(body && body.institute_code) };
    default:           return { ok: false, error: 'unknown_action' };
  }
}

/** Hourly trigger. */
function covRefresh() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    var src = covReadSource_();
    var since = Date.now() - 48 * 3600 * 1000;
    var touched = {};
    src.raw.forEach(function (r) {
      var t = new Date(r[COV_SOURCE.scannedAtColumn]).getTime();
      if (!isNaN(t) && t >= since) touched[String(r[COV_SOURCE.columns.institute_code])] = true;
    });
    var codes = Object.keys(touched);
    if (!codes.length) return;
    var profiles = covReadProfiles_();
    var existing = covReadCoverage_();
    var before = {};
    existing.forEach(function (c) { before[c.institute_code] = c.status; });
    var newlyNeeding = [];
    var updated = codes.map(function (code) {
      var rows = src.mapped.filter(function (r) { return r.institute_code === code; });
      var rec = CovCore.assess(code, rows, profiles[code]);
      if (rec.status === 'second_session_needed' && before[code] !== 'second_session_needed') newlyNeeding.push(rec);
      return rec;
    });
    covWriteCoverage_(updated, existing);
    covNotify_(newlyNeeding);
  } finally {
    lock.releaseLock();
  }
}

function covAssessSchool_(code) {
  if (!code) return null;
  var src = covReadSource_();
  var rows = src.mapped.filter(function (r) { return r.institute_code === String(code); });
  return CovCore.assess(String(code), rows, covReadProfiles_()[String(code)]);
}

function covNotify_(list) {
  var to = PropertiesService.getScriptProperties().getProperty('COV_NOTIFY_TO');
  if (!to || !list.length) return;
  var lines = list.map(function (c) {
    var short = c.shortfalls.map(function (s) { return s.item + ' ' + s.have + '/' + s.target; }).join(', ');
    return c.institute_code + ': second session by ' + c.second_session_due +
      (short ? '. Short: ' + short : '') + (c.near_band_line ? '. Score near the ' + c.near_band_line + ' line' : '') + '.';
  });
  MailApp.sendEmail(to, 'Schools needing a second session (' + list.length + ')',
    lines.join('\n') + '\n\nSchedule at a different time of day (evening or weekend for fathers). Maximum two sessions per school.');
}

// ---------------------------------------------------------------- storage

function covReadSource_() {
  var values = fnSheets_.call(fnSheets_.base + fnMasterId_() + '/values/' + encodeURIComponent(COV_SOURCE.tab), 'get').values || [];
  var header = values[0] || [];
  var raw = values.slice(1).map(function (row) {
    var o = {}; header.forEach(function (h, i) { o[h] = row[i]; }); return o;
  });
  var mapped = raw.map(function (o) {
    var m = CovCore.mapRow(o, COV_SOURCE);
    m.institute_code = String(o[COV_SOURCE.columns.institute_code] || '').trim();
    return m;
  });
  return { raw: raw, mapped: mapped };
}

function covReadProfiles_() {
  var out = {};
  try {
    var v = fnSheets_.call(fnSheets_.base + fnMasterId_() + '/values/' + encodeURIComponent(COV_PROFILE_TAB), 'get').values || [];
    v.slice(1).forEach(function (r) { if (r[0]) out[String(r[0])] = { teachers_available: r[1] === undefined || r[1] === '' ? undefined : Number(r[1]) }; });
  } catch (e) { /* tab is optional */ }
  return out;
}

function covReadCoverage_() {
  var v = fnSheets_.read(fnMasterId_(), COV_TAB, COV_COLUMNS);
  return v.slice(1).map(function (r) {
    var o = {}; COV_COLUMNS.forEach(function (c, i) { o[c] = r[i] === undefined ? '' : r[i]; });
    o.institute_code = String(o.institute_code);
    return o;
  });
}

function covRow_(c) {
  var t = c.targets, k = c.counts;
  return [c.institute_code, c.status, c.reasons.join(','), c.sessions_held, c.first_session || '', c.second_session_due || '',
    k.parents, t.parents, k.fathers, t.fathers, k.teachers, t.teachers, k.grades, t.grades,
    k.scored_forms, c.score === null ? '' : c.score, c.score_range ? c.score_range[0] : '', c.score_range ? c.score_range[1] : '',
    c.band || '', c.near_band_line || '', new Date().toISOString()];
}

/** Update rows in place for schools already listed; append new schools. Nothing is deleted. */
function covWriteCoverage_(records, existing) {
  var id = fnMasterId_();
  var index = {};
  existing.forEach(function (c, i) { index[c.institute_code] = i + 2; }); // sheet row number (header is row 1)
  var appends = [];
  var lastCol = String.fromCharCode(64 + COV_COLUMNS.length);
  records.forEach(function (c) {
    var row = covRow_(c);
    if (index[c.institute_code]) {
      var range = COV_TAB + '!A' + index[c.institute_code] + ':' + lastCol + index[c.institute_code];
      fnSheets_.call(fnSheets_.base + id + '/values/' + encodeURIComponent(range) + '?valueInputOption=RAW', 'put', { values: [row] });
    } else {
      appends.push(row);
    }
  });
  if (appends.length) fnSheets_.append(id, COV_TAB, appends, COV_COLUMNS);
}
