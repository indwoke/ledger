const test = require('node:test');
const assert = require('node:assert');
const { CovCore, COV_CONFIG } = require('../shared/cov_core.js');

// Build a school's scanned forms: no identities, one row per form.
function forms({ parents = 0, fathers = 0, teachers = 0, grades = 3, score = 50, spread = 10, sessions = ['S1'], date = '2026-10-03' }) {
  const rows = []; let i = 0;
  const sc = () => score + ((i++ % 2) ? spread : -spread);
  for (let p = 0; p < parents; p++) rows.push({ session_key: sessions[p % sessions.length], session_date: date, group: 'parents', gender: p < fathers ? 'male' : 'female', grade: 'G' + (p % grades), score: sc() });
  for (let t = 0; t < teachers; t++) rows.push({ session_key: sessions[0], session_date: date, group: 'teachers', gender: '', grade: '', score: sc() });
  return rows;
}

test('a fully covered school away from band lines is ok', () => {
  const r = CovCore.assess('S', forms({ parents: 32, fathers: 6, teachers: 11, score: 52 }));
  assert.strictEqual(r.status, 'ok'); assert.deepStrictEqual(r.reasons, []); assert.strictEqual(r.band, 'MODERATE');
});
test('short on fathers after one session asks for a second, due in 14 days', () => {
  const r = CovCore.assess('S', forms({ parents: 44, fathers: 4, teachers: 12, score: 52 }));
  assert.strictEqual(r.status, 'second_session_needed');
  assert.deepStrictEqual(r.reasons, ['fathers_short']);
  assert.strictEqual(r.second_session_due, '2026-10-17');
});
test('score within 7 points of a band line triggers a second session', () => {
  const r = CovCore.assess('S', forms({ parents: 35, fathers: 6, teachers: 12, score: 60 }));
  assert.ok(r.reasons.includes('near_band_line_65')); assert.strictEqual(r.near_band_line, 65);
  const far = CovCore.assess('S', forms({ parents: 35, fathers: 6, teachers: 12, score: 57 }));
  assert.strictEqual(far.status, 'ok');
});
test('still short after two sessions: low confidence, never a third', () => {
  const r = CovCore.assess('S', forms({ parents: 12, fathers: 1, teachers: 4, sessions: ['S1', 'S2'] }));
  assert.strictEqual(r.status, 'low_confidence'); assert.strictEqual(r.second_session_due, null);
});
test('grade spread counts distinct parent grades', () => {
  const r = CovCore.assess('S', forms({ parents: 30, fathers: 5, teachers: 10, grades: 2, score: 52 }));
  assert.deepStrictEqual(r.reasons, ['grades_short']);
});
test('school with fewer teachers than 10: target drops to all available', () => {
  const r = CovCore.assess('S', forms({ parents: 30, fathers: 5, teachers: 6, score: 52 }), { teachers_available: 6 });
  assert.strictEqual(r.targets.teachers, 6); assert.strictEqual(r.status, 'ok');
});
test('fewer than 5 scored forms: score hidden, no band-line reason', () => {
  const r = CovCore.assess('S', forms({ parents: 3, fathers: 0, teachers: 1, score: 41 }));
  assert.strictEqual(r.score, null); assert.strictEqual(r.band, null);
  assert.ok(!r.reasons.some(x => x.startsWith('near_band_line')));
});
test('bands match the indicator spec', () => {
  assert.strictEqual(CovCore.band(39.9, COV_CONFIG.cutoffs), 'HIGH');
  assert.strictEqual(CovCore.band(40, COV_CONFIG.cutoffs), 'MODERATE');
  assert.strictEqual(CovCore.band(85, COV_CONFIG.cutoffs), 'PROTECTED');
});
test('no forms yet is pending', () => { assert.strictEqual(CovCore.assess('S', []).status, 'pending'); });
test('mapRow maps raw scan columns and Hindi gender values', () => {
  const map = { columns: { institute_code: 'ic', session_date: 'd', template_id: 't', group: 'g', gender: 'sex', grade: 'gr', score: 'ops' },
    groupValues: { parent: 'parents' }, maleValues: ['male', 'पुरुष'], femaleValues: ['female'] };
  const m = CovCore.mapRow({ ic: 'X1', d: '2026-10-03', t: 'adult', g: 'Parent', sex: 'पुरुष', gr: '5', ops: '62.5' }, map);
  assert.deepStrictEqual(m, { session_key: 'X1|2026-10-03|adult', session_date: '2026-10-03', group: 'parents', gender: 'male', grade: '5', score: 62.5 });
});
test('action list puts second sessions first, earliest due first', () => {
  const s = CovCore.sortForAction([
    { institute_code: 'A', status: 'ok' }, { institute_code: 'B', status: 'second_session_needed', second_session_due: '2026-10-20' },
    { institute_code: 'C', status: 'low_confidence' }, { institute_code: 'D', status: 'second_session_needed', second_session_due: '2026-10-15' }]);
  assert.deepStrictEqual(s.map(x => x.institute_code), ['D', 'B', 'C', 'A']);
});
