# Facilitator Session Note: Yantra build pack (fn-v1)

Built 2 Oct 2026 from the "Facilitator Session Note v0" doc. 31 typed questions (A1 is filled by the app), English, Hindi and Marathi.

| Folder | What it is |
|---|---|
| shared/fn_schema.js | Questions, options and labels in en/hi/mr. Hindi and Marathi are drafts pending back-translation. |
| shared/fn_core.js | Validation, personal-data check, review and limitation flags, facilitator comparison, sheet row layout. Runs in Apps Script, the browser and Node. |
| backend/FacilitatorNote.gs | Apps Script module: save (idempotent on note_id), site memory, session comparison, daily digest, Sheets storage. |
| frontend/ | PWA screen (plain JS), styles, and a demo page used by the browser test. |
| shared/cov_core.js | School coverage check: counts by group, fathers, grades, band-line zone, status, second-session due date. |
| backend/Coverage.gs | Hourly refresh of schools scanned in the last 48 hours, coverage tab, email to Prajakta, cov.list and cov.school API. |
| frontend/coverage-list.js | Prajakta's school coverage screen (en/hi/mr), with a demo page. |
| tests/ | 25 unit tests (`node --test tests/core.test.js tests/coverage.test.js`) and two Playwright browser tests (`node tests/form.spec.js`, `node tests/coverage.spec.js`). |
| BUILD_PROMPT.md | The prompt to give Claude Code in the bodh-yantra repo. |

Rules built in: review if confidence is low, more than 10% of forms are flagged, or hostility is strong; facilitator gap of 2 or more on any 1 to 5 scale; limitations if social desirability is 4 or more, authority influence is clear, or a teacher or principal was present. Sessions before 3 Oct are entered with A10 = from memory.

Coverage rules (field direction 5, decided 2 Oct): 30 parents from at least 3 grades, at least 5 fathers or male caregivers, at least 10 teachers and staff (or all available); a score within 7 points of 40, 65 or 85 triggers a second session; at most two sessions; the second is due within 14 days of the first; schools still short stay in as low confidence.
