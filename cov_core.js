/**
 * School coverage check (field direction 5): pure logic, no I/O.
 * Runs in Apps Script (copy as CovCore.gs), the browser and Node tests.
 *
 * Input rows are scanned survey responses for ONE school, already mapped to:
 *   { session_key, session_date, group: 'parents'|'teachers'|'staff'|'students'|'other',
 *     gender: 'male'|'female'|'other'|'', grade: '<grade code or empty>', score: <0-100 overall protection score or null> }
 * No identifying data: one row per scanned form, as Bodh already stores it.
 */
var COV_CONFIG = {
  targets: { parents: 30, fathers: 5, teachers: 10, grades: 3 }, // soft targets, decided 2 Oct
  cutoffs: [40, 65, 85],          // band lines: HIGH <40, MODERATE 40-<65, LOW 65-<85, PROTECTED >=85
  cutZone: 7,                     // a score within 7 points of a band line triggers a second session
  maxSessions: 2,
  secondSessionDays: 14,          // Prajakta schedules within 2 weeks of the first session
  minDisplay: 5,                  // never show a score from fewer than 5 forms
  scoreGroups: ['parents', 'teachers', 'staff'], // whose forms make up the school's decision score
  teacherGroups: ['teachers', 'staff']
};

var CovCore = (function () {
  function band(score, cut) {
    if (score === null || score === undefined || isNaN(score)) return null;
    if (score < cut[0]) return 'HIGH';
    if (score < cut[1]) return 'MODERATE';
    if (score < cut[2]) return 'LOW';
    return 'PROTECTED';
  }
  function mean(a) { return a.reduce(function (s, x) { return s + x; }, 0) / a.length; }
  function sd(a) {
    if (a.length < 2) return null;
    var m = mean(a);
    return Math.sqrt(a.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / (a.length - 1));
  }
  function round1(x) { return x === null ? null : Math.round(x * 10) / 10; }
  function addDays(iso, n) {
    var d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  /**
   * profile (optional): { teachers_available: <number> } from the school profile tab.
   * Returns the coverage record for one school.
   */
  function assess(instituteCode, rows, profile, cfg) {
    cfg = cfg || COV_CONFIG;
    profile = profile || {};
    var t = cfg.targets;
    var parents = rows.filter(function (r) { return r.group === 'parents'; });
    var teachers = rows.filter(function (r) { return cfg.teacherGroups.indexOf(r.group) >= 0; });
    var fathers = parents.filter(function (r) { return r.gender === 'male'; });
    var grades = {};
    parents.forEach(function (r) { if (r.grade) grades[r.grade] = true; });
    var sessions = {};
    rows.forEach(function (r) { sessions[r.session_key] = r.session_date; });
    var sessionKeys = Object.keys(sessions);
    var dates = sessionKeys.map(function (k) { return sessions[k]; }).sort();

    var teacherTarget = typeof profile.teachers_available === 'number' && profile.teachers_available < t.teachers
      ? profile.teachers_available : t.teachers;

    var scores = rows.filter(function (r) { return cfg.scoreGroups.indexOf(r.group) >= 0 && typeof r.score === 'number' && !isNaN(r.score); })
      .map(function (r) { return r.score; });
    var n = scores.length;
    var m = n ? mean(scores) : null;
    var s = sd(scores);
    var half = (s !== null && n > 1) ? 1.96 * s / Math.sqrt(n) : null;
    var nearest = null;
    if (m !== null) cfg.cutoffs.forEach(function (c) { if (nearest === null || Math.abs(m - c) < Math.abs(m - nearest)) nearest = c; });
    var nearCut = m !== null && n >= cfg.minDisplay && Math.abs(m - nearest) <= cfg.cutZone;

    var shortfalls = [];
    if (parents.length < t.parents) shortfalls.push({ item: 'parents', have: parents.length, target: t.parents });
    if (fathers.length < t.fathers) shortfalls.push({ item: 'fathers', have: fathers.length, target: t.fathers });
    if (teachers.length < teacherTarget) shortfalls.push({ item: 'teachers', have: teachers.length, target: teacherTarget });
    if (Object.keys(grades).length < t.grades) shortfalls.push({ item: 'grades', have: Object.keys(grades).length, target: t.grades });

    var reasons = shortfalls.map(function (x) { return x.item + '_short'; });
    if (nearCut) reasons.push('near_band_line_' + nearest);

    var status;
    if (!rows.length) status = 'pending';
    else if (!reasons.length) status = 'ok';
    else if (sessionKeys.length < cfg.maxSessions) status = 'second_session_needed';
    else status = 'low_confidence';

    var showScore = n >= cfg.minDisplay;
    return {
      institute_code: String(instituteCode),
      sessions_held: sessionKeys.length,
      first_session: dates[0] || null,
      second_session_due: status === 'second_session_needed' && dates[0] ? addDays(dates[0], cfg.secondSessionDays) : null,
      counts: { parents: parents.length, fathers: fathers.length, teachers: teachers.length, grades: Object.keys(grades).length, scored_forms: n },
      targets: { parents: t.parents, fathers: t.fathers, teachers: teacherTarget, grades: t.grades },
      shortfalls: shortfalls,
      score: showScore ? round1(m) : null,
      score_range: showScore && half !== null ? [round1(m - half), round1(m + half)] : null,
      band: showScore ? band(m, cfg.cutoffs) : null,
      near_band_line: showScore && nearCut ? nearest : null,
      status: status,
      reasons: reasons
    };
  }

  /** Map raw scanned rows to the shape assess() needs, using the column map and value maps. */
  function mapRow(raw, map) {
    function pick(k) { var v = raw[map.columns[k]]; return v === undefined || v === null ? '' : String(v).trim(); }
    var g = pick('group'), gender = pick('gender').toLowerCase();
    var score = pick('score');
    return {
      session_key: [pick('institute_code'), pick('session_date'), pick('template_id')].join('|'),
      session_date: pick('session_date'),
      group: map.groupValues[g] || map.groupValues[g.toLowerCase()] || 'other',
      gender: map.maleValues.indexOf(gender) >= 0 ? 'male' : map.femaleValues.indexOf(gender) >= 0 ? 'female' : (gender ? 'other' : ''),
      grade: pick('grade'),
      score: score === '' ? null : Number(score)
    };
  }

  /** Order for Prajakta's list: needs action first, then low confidence, then pending, then ok. */
  function sortForAction(list) {
    var rank = { second_session_needed: 0, low_confidence: 1, pending: 2, ok: 3 };
    return list.slice().sort(function (a, b) {
      return (rank[a.status] - rank[b.status]) || String(a.second_session_due || '9').localeCompare(String(b.second_session_due || '9')) ||
        a.institute_code.localeCompare(b.institute_code);
    });
  }

  return { assess: assess, mapRow: mapRow, band: band, sortForAction: sortForAction };
})();
if (typeof module !== 'undefined') { module.exports = { CovCore: CovCore, COV_CONFIG: COV_CONFIG }; }
