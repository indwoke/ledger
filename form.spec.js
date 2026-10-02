// Browser test for the facilitator-note screen (Playwright). Run: node tests/form.spec.js
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');
(async () => {
  const browser = await chromium.launch(process.env.PW_EXEC ? { executablePath: process.env.PW_EXEC } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const url = 'file://' + path.resolve(__dirname, '../frontend/demo.html');
  await page.goto(url);
  // Empty submit shows errors and sends nothing
  await page.click('.fn-submit');
  assert.ok(await page.locator('.fn-bad').count() > 10, 'errors shown');
  assert.strictEqual(await page.evaluate(() => window.__sent.length), 0);
  // Fill everything
  const pick = (f, v) => page.check(`#fn_${f}_${v}`);
  for (const [f, v] of [['role','lead'],['entry_mode','live'],['respondent_group','parents'],['headcount_band','26-50'],['gender_mix','mostly_women'],
    ['form_language','mr'],['readout_language','ur'],['venue','classroom'],['privacy_score','2'],['others_present','none'],['start_delay','on_time'],
    ['noise_score','3'],['interruptions','caregiving'],['comprehension_score','4'],['hostility','none'],['objections','none'],['answer_sharing','few'],
    ['engagement_score','5'],['desirability_score','2'],['authority_influence','no'],['facilitator_lead','no'],['disclosure','no'],
    ['help_requests_band','1-2'],['data_confidence','high']]) await pick(f, v);
  await page.fill('#fn_forms_collected', '48'); await page.fill('#fn_forms_flagged', '1');
  await page.fill('#fn_session_start', '10:30'); await page.fill('#fn_session_end', '12:05');
  await page.fill('#fn_items_reexplained', '15, 16, 17');
  // Personal data is blocked
  await page.fill('#fn_stood_out', 'Mrs Sharma was upset');
  await page.click('.fn-submit');
  assert.ok(await page.locator('[data-field=stood_out].fn-bad').isVisible(), 'pii blocked');
  await page.fill('#fn_stood_out', 'Parents thanked us for asking.');
  // E2 appears only when disclosure = yes
  assert.ok(!(await page.locator('[data-field=protocol_followed]').isVisible()));
  await pick('disclosure', 'yes');
  assert.ok(await page.locator('[data-field=protocol_followed]').isVisible());
  await pick('protocol_followed', 'yes');
  await page.click('.fn-submit');
  const sent = await page.evaluate(() => window.__sent);
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].action, 'fn.save');
  assert.deepStrictEqual(sent[0].body.note.items_reexplained, [15, 16, 17]);
  assert.strictEqual(sent[0].body.note.forms_collected, 48);
  assert.ok(sent[0].body.note_id);
  // Hindi and Marathi render
  for (const l of ['hi', 'mr']) { await page.goto(url + '?lang=' + l); assert.ok((await page.textContent('h2')).length > 3); }
  await page.screenshot({ path: path.resolve(__dirname, 'form-mr.png'), fullPage: false });
  await browser.close();
  console.log('form.spec: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
