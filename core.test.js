const test = require('node:test');
const assert = require('node:assert');
const S = require('../shared/fn_schema.js');
const C = require('../shared/fn_core.js');

const good = () => ({
  role: 'lead', entry_mode: 'live', respondent_group: 'parents', headcount_band: '26-50', gender_mix: 'mostly_women',
  forms_collected: 48, forms_flagged: 1, form_language: 'mr', readout_language: 'ur',
  session_start: '10:30', session_end: '12:05', venue: 'classroom', privacy_score: 2,
  others_present: ['none'], start_delay: 'up_to_15', noise_score: 3, interruptions: ['caregiving'],
  comprehension_score: 4, items_reexplained: [15, 16, 17], hostility: 'none', objections: ['none'],
  answer_sharing: 'few', engagement_score: 5, desirability_score: 2, authority_influence: 'no',
  facilitator_lead: 'no', disclosure: 'no', help_requests_band: '1-2', data_confidence: 'high',
  stood_out: 'Parents thanked us for asking.', next_facilitator: 'Bring Marathi copies; read-out needed in Urdu.'
});

test('schema covers A2 to F4: 31 typed questions (A1 is auto), A6 and A9 are two fields each', () => {
  assert.strictEqual(S.fields.length, 33);
  assert.strictEqual(new Set(S.fields.map(f => f.q)).size, 31);
});
test('every field has en, hi, mr labels and option labels', () => {
  for (const f of S.fields) {
    for (const l of ['en', 'hi', 'mr']) assert.ok(f[l], f.id + ' ' + l);
    for (const o of f.options || []) for (const l of ['en', 'hi', 'mr']) assert.ok(o[l], f.id + ':' + o.v + ' ' + l);
  }
});
test('valid note passes', () => { assert.deepStrictEqual(C.validate(good(), S), { ok: true, errors: [] }); });
test('required, options, ranges', () => {
  const n = good(); delete n.role; n.noise_score = 7; n.venue = 'roof';
  const codes = C.validate(n, S).errors.map(e => e.field + ':' + e.code).sort();
  assert.deepStrictEqual(codes, ['noise_score:out_of_range', 'role:required', 'venue:invalid_option']);
});
test('E2 required only when disclosure = yes', () => {
  const n = good(); n.disclosure = 'yes';
  assert.ok(C.validate(n, S).errors.some(e => e.field === 'protocol_followed' && e.code === 'required'));
  n.protocol_followed = 'yes'; assert.ok(C.validate(n, S).ok);
  const m = good(); m.protocol_followed = 'yes';
  assert.ok(C.validate(m, S).errors.some(e => e.code === 'not_applicable'));
});
test('end must be after start; flagged <= collected; exclusive none', () => {
  const n = good(); n.session_end = '10:00'; n.forms_flagged = 60; n.others_present = ['none', 'teacher'];
  const codes = C.validate(n, S).errors.map(e => e.code).sort();
  assert.deepStrictEqual(codes, ['end_before_start', 'exclusive_conflict', 'more_than_collected']);
});
test('personal data blocked in text', () => {
  for (const t of ['Call her on 9876543210', 'Mrs Sharma was upset', 'mail a@b.com', 'her name is Priya', 'श्रीमती पाटील आल्या', 'roll no 12', '1234 5678 9012'])
    assert.ok(C.piiCheck(t).length, t);
  for (const t of ['Parents thanked us for asking.', 'Hall noisy after 1 pm; 48 forms', 'Teachers stayed in the room'])
    assert.deepStrictEqual(C.piiCheck(t), [], t);
  const n = good(); n.stood_out = 'Mr Khan objected';
  assert.ok(C.validate(n, S).errors.some(e => e.code === 'personal_data'));
});
test('text limit 300', () => { const n = good(); n.contradicts = 'x'.repeat(301); assert.ok(C.validate(n, S).errors.some(e => e.code === 'too_long')); });
test('unknown field rejected', () => { const n = good(); n.child_name = 'x'; assert.ok(C.validate(n, S).errors.some(e => e.code === 'unknown_field')); });
test('flags', () => {
  const n = good(); n.data_confidence = 'low'; n.forms_flagged = 6; n.hostility = 'strong';
  n.desirability_score = 4; n.authority_influence = 'clearly'; n.others_present = ['principal'];
  assert.deepStrictEqual(C.flags(n), { review: ['low_confidence', 'flagged_forms_over_10pct', 'strong_hostility'], limitations: ['social_desirability', 'authority_influence', 'authority_present'] });
  assert.deepStrictEqual(C.flags(good()), { review: [], limitations: [] });
});
test('10% boundary is not flagged; above is', () => {
  const n = good(); n.forms_collected = 50; n.forms_flagged = 5; assert.deepStrictEqual(C.flags(n).review, []);
  n.forms_flagged = 6; assert.deepStrictEqual(C.flags(n).review, ['flagged_forms_over_10pct']);
});
test('session minutes', () => { assert.strictEqual(C.sessionMinutes(good()), 95); });
test('compare: gap of 2 flagged, 1 not', () => {
  const a = good(), b = good(); b.noise_score = 5; b.engagement_score = 4;
  assert.deepStrictEqual(C.compare([a, b], S).map(g => g.field), ['noise_score']);
  assert.deepStrictEqual(C.compare([a], S), []);
});
test('row matches columns', () => {
  const r = Object.assign(good(), { note_id: 'x', session_key: 'k', review_flags: [], limitation_flags: ['a', 'b'] });
  const row = C.toRow(r, S);
  assert.strictEqual(row.length, C.columns(S).length);
  assert.strictEqual(row[C.columns(S).indexOf('items_reexplained')], '15,16,17');
});
