# Build prompt: add the Facilitator Session Note to Bodh-Yantra

Paste this into Claude Code in the bodh-yantra repo, with this folder copied into the repo as `facilitator-note-pack/`.

---

Add a "Facilitator session note" screen to Bodh-Yantra using the files in `facilitator-note-pack/`. Follow the existing patterns of the Ledger script and the PWA; reuse existing helpers wherever they exist.

**Backend (Apps Script, same Code.gs project as Ledger)**
1. Add `shared/fn_schema.js` as `FnSchema.gs` and `shared/fn_core.js` as `FnCore.gs`, unchanged.
2. Add `backend/FacilitatorNote.gs`. Route every action that starts with `fn.` from the existing `doPost` dispatcher to `fnHandle_(action, body, user)`, where `user` is what the existing passcode sign-in resolves. Map `user.code` and `user.role` to whatever the sign-in returns.
3. Storage: replace `fnSheets_` and `fnMasterId_` with the existing Sheets helpers and the existing getter for the app-created "PRAJA — master" spreadsheet. Keep the tab name `facilitator_notes` and the column order from `FNCore.columns(FN_SCHEMA)`.
4. Add `fnDailyDigest` to the existing scheduled jobs (daily, morning). Recipients come from the script property `FN_DIGEST_TO`. Use the existing email helper and its English/Hindi switch if there is one.
5. Do not add any OAuth scope. No delete operations anywhere.

**Frontend (PWA on GitHub Pages)**
6. Load `fn_schema.js`, `fn_core.js`, `facilitator-note.js` and `facilitator-note.css` the way other screens load their scripts, and add all four to the service worker's cache list.
7. Add an entry point on the session screen ("Facilitator note") that calls `FacilitatorNote.mount(container, { lang, session, send, fetchSiteMemory, onDone })`:
   - `lang`: the user's current app language (en, hi or mr).
   - `session`: `{ institute_code, session_date, template_id }` from the session the coordinator selected.
   - `send`: the existing offline-queued API call. It must queue when offline and retry on reconnect; `note_id` makes retries safe.
   - `fetchSiteMemory`: calls `fn.siteMemory` when online; resolves to nothing offline.
8. Show the screen to every signed-in facilitator, observer and volunteer for each session in both trial arms. One note per person per session; the backend rejects a second one.

**Tests**
9. Run `node --test facilitator-note-pack/tests/core.test.js` and keep it green.
10. Fold `tests/form.spec.js` into the existing Playwright suite, pointing it at the real screen instead of `demo.html`. Add one case to the Apps Script imitation in Node: save a note, save it again with the same `note_id` (expect `duplicate: true`), save a different `note_id` for the same person and session (expect `already_submitted`).

**Rules that must hold**
- No respondent names, phone numbers or identifying details are stored. Free text is checked by `FNCore.piiCheck` on the phone and again on the server.
- Stored values are the English codes in the schema; Hindi and Marathi change labels only.
- The note never feeds a respondent's risk score or any individual flag.

**School coverage check (field direction 5)**
11. Add `shared/cov_core.js` as `CovCore.gs` and `backend/Coverage.gs`. Route actions starting `cov.` to `covHandle_(action, body, user)`.
12. Point `COV_SOURCE` at the real tab where Bodh writes one row per scanned form: map the column headers for institute code, session date, template, respondent group, gender, grade, overall protection score and scan timestamp, and the raw values for groups and gender (including Hindi and Marathi values if the scan writes them). If respondent group comes from the template rather than a column, derive it in `covReadSource_`.
13. Add `covRefresh` to the existing scheduled jobs, hourly. Set the script property `COV_NOTIFY_TO` to Prajakta's email. Optionally create a `school_profile` tab (institute_code, teachers_available).
14. Add a "School coverage" screen for Prajakta and admins only, using `frontend/coverage-list.js` with `load` calling `cov.list`; cache the last list for offline viewing. Add the file to the service worker cache.
15. Run `node --test facilitator-note-pack/tests/coverage.test.js` and fold `tests/coverage.spec.js` into the Playwright suite.

Coverage rules that must hold: targets 30 parents, 5 fathers or male caregivers, 10 teachers and staff (or all available), 3 grades; a score within 7 points of 40, 65 or 85 triggers a second session; at most two sessions per school; second session due 14 days after the first; no score shown from fewer than 5 forms; nothing is ever deleted.

Report back with the files changed and the test results.
