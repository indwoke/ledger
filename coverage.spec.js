// Browser test for the coverage list (Playwright). Run: node tests/coverage.spec.js
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');
(async () => {
  const browser = await chromium.launch(process.env.PW_EXEC ? { executablePath: process.env.PW_EXEC } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const url = 'file://' + path.resolve(__dirname, '../frontend/coverage-demo.html');
  await page.goto(url);
  await page.waitForSelector('.cov-card');
  const codes = await page.$$eval('.cov-card strong', els => els.map(e => e.textContent));
  assert.deepStrictEqual(codes, ['MCGM-0001', 'MCGM-0012', 'MCGM-0007'], 'action order');
  assert.ok((await page.textContent('.cov-second_session_needed .cov-due')).includes('2026-10-17'));
  assert.strictEqual(await page.locator('.cov-second_session_needed .cov-short').count(), 2, 'fathers and teachers short');
  assert.ok((await page.textContent('.cov-low_confidence .cov-score')).includes('fewer than 5'));
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  for (const l of ['hi', 'mr']) { await page.goto(url + '?lang=' + l); await page.waitForSelector('.cov-card'); }
  await browser.close();
  console.log('coverage.spec: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
