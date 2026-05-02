# TODO

## v0.2 — Pink Theme & HTML Integration

- [ ] Review the two new HTML files and identify which parts belong to the dashboard settings page and which parts belong to the OBS display page.
- [ ] Integrate the settings-related HTML features into the existing dashboard instead of keeping them as a separate standalone page.
- [ ] Integrate the display-related HTML features into the OBS-facing HTML display page.
- [ ] Add a new pink cute theme alongside the existing blue night theme.
- [ ] Add a dashboard theme switcher so users can choose between the blue night theme and the pink cute theme.
- [ ] Make sure the selected theme applies consistently to the dashboard UI.
- [ ] Make sure the selected theme also applies correctly to OBS display pages where appropriate.
- [ ] Check that theme switching does not break existing Spotify lyric sync, OBS text display, or dashboard controls.

## v0.3 — Dashboard Structure & UX Cleanup

- [ ] Organize the dashboard settings into clear sections for Spotify lyrics, OBS display, editor controls, and theme selection.
- [ ] Keep the dashboard layout usable on common desktop browser sizes.
- [ ] Add clear labels and helper text for settings that affect OBS display output.
- [ ] Preserve the current blue night style as the default theme unless a saved user preference exists.
- [ ] Save the selected theme locally so it persists after refresh or restart.

## v0.4 — OBS Display Editor Enhancements

- [ ] Add font family selection for OBS display text.
- [ ] Support custom font upload or custom font registration if feasible.
- [ ] Add font size controls.
- [ ] Add text alignment controls, including horizontal and vertical alignment.
- [ ] Add basic text styles: bold, italic, underline, and strikethrough.
- [ ] Add paragraph and line-spacing controls.
- [ ] Add text shadow or similar visual effects.
- [ ] Add emoji and kaomoji insertion support.
- [ ] Support different fonts for different languages if technically feasible.

## v0.5 — Spotify Lyrics Module Improvements

- [ ] Confirm Spotify API integration uses real playback data instead of mock data.
- [ ] Keep LRCLib synced lyrics display stable during track changes, pauses, and missing lyrics cases.
- [ ] Make the lyric history or sync log area scrollable.
- [ ] Add or improve the Spotify login button and authorization popup flow.
- [ ] Add an optional auto-authorization setting.
- [ ] Add a log/debug popup for runtime status and troubleshooting.
- [ ] Verify the fallback message appears when synced lyrics cannot be found.

## v1.0 — Release Stabilization

- [ ] Test the dashboard and OBS display pages with both blue night and pink cute themes.
- [ ] Test the complete Spotify lyric sync flow from login to OBS text output.
- [ ] Test missing lyrics, paused playback, track switching, and network error cases.
- [ ] Review file structure and remove unused standalone HTML/CSS/JS files after integration.
- [ ] Update README with setup steps, theme switching instructions, and OBS usage notes.
- [ ] Add screenshots or short examples showing both available themes.
