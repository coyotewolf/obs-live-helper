# Multer security revalidation — 2026-11-16

PR #3 already locks Multer 2.5.0. No further Multer dependency upgrade is needed for the two reported advisories:

- CVE-2026-3520 / GHSA-5528-5vmv-3xc2 affects versions below 2.1.1: https://github.com/expressjs/multer/security/advisories/GHSA-5528-5vmv-3xc2
- GHSA-q7qp-rjg7-q26m affects versions from 2.0.0 below 2.5.0, specifically with a pending asynchronous fileFilter after request teardown: https://github.com/expressjs/multer/security/advisories/GHSA-q7qp-rjg7-q26m

The production font upload route uses `multer({ dest: dir })` without an asynchronous fileFilter. Do not claim that this route meets the latter advisory's trigger condition. The malformed-request issue does not need that condition.

Added a regression guard checking the installed Multer version and every Multer entry in package-lock.json against the 2.5.0 floor. Existing upload and redirect tests remain intact. This is a version-floor assertion, not proof of immunity to every present or future vulnerability.

## Verification

On an isolated Windows clone using host Node 24.16.0:

- `npm ci --ignore-scripts --no-audit --no-fund`: passed, 389 packages installed; no lockfile changes.
- `node --check tests/dependency-security.test.cjs`: passed.
- `node --test tests/security.test.cjs`: passed, 4/4 credential/admin tests.
- `node tests/dependency-security.test.cjs`: passed. Actual font upload/list/missing/malformed requests, asynchronous filter fixture, aborted-upload cleanup, redirect header stripping, modern glob/minimatch and retained legacy glob API checks.
- Electron installed into the isolated clone using its official installer. `node tests/electron-smoke.cjs`: passed outside the command sandbox after the sandboxed process exited before producing a report. Verified Electron 42.11.16, Node 24.19.0, Chromium 148.0.7778.280, real entry/server startup, hidden renderer isolation, synthetic data/config/font APIs, navigation guards, and server-port closure after quit.
- `git diff --check`: passed.

No installed user application, existing profile, original working checkout, real OAuth, OBS/Discord device integration, or public tunnel was touched. Full npm audit and a new installer build were not run in this pass. Previous CI evidence belongs to its recorded commit; it is not evidence for this updated head.

PR #3 stays draft and stacked on security PR #1. Nothing was merged, released, installed, or deployed. Repository validation does not establish the installed runtime's patch state.
