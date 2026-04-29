# Changelog

## v0.1.1

### Added
- Now supports Discord voice overlay.
- Discord voice overlay now supports marquee animation for long usernames.
- First-launch setup no longer blocks dashboard access when Spotify Client ID or Discord StreamKit URL is missing.

### Changed
- Discord avatar overlay layout now aligns avatars from left to right.
- Short usernames remain centered under avatars.
- Discord StreamKit URL is treated as an optional feature setting; a built-in default StreamKit URL is used when none is configured.

### Fixed
- Fixed Discord avatar overlap when multiple users join voice.
- Fixed StreamKit layout instability caused by moving React-managed DOM nodes.
- Fixed runtime errors when users join or leave Discord voice channels.