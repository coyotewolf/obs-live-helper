# Security patch — 2026-10-24

This patch addresses authorization/exposure defects found during a source review. It is not evidence that an attack occurred.

- Runtime storage is no longer an HTTP static directory. security.json and spotify.json must return 404.
- Local privilege requires a loopback TCP peer AND a literal loopback Host, with no proxy headers and no foreign Origin.
- Editor, style, font, and Spotify write endpoints require a direct local request or the admin token.
- Audience request and read-only overlay routes remain available.

Run `node --test tests/security.test.cjs` after installing the existing dependencies. The HTTP test uses actual Express routing with external Spotify/tunnel services stubbed; it does not test a running Windows installation.

Install/rebuild the patched app on the computer that runs OBS. If a public tunnel previously exposed this version, revoke the Spotify app authorization and sign in again; also regenerate the local admin token and audience PIN. This audit cannot access or rotate credentials stored on that computer. No dependency upgrades are included; the registry update was blocked by automatic approval review.
