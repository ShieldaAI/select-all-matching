# Changelog

Notable changes to this project will be recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and published releases will follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0-beta.0] - 2026-09-04

### Added

- Immutable selection state with scoped mutations, token refresh, and indexed reads.
- Draft version-0 state and bulk codecs with server-side validation.
- Initial Node 22/24 setup, automated tests, and packed-package checks.

### Changed

- Repeated select-all commands are idempotent and no longer erase newer exclusions.

### Fixed

- Branded ID states no longer widen to a base string or number type.
- Forged runtime states, sparse ID lists, and inherited array values are rejected at input
  boundaries.

[Unreleased]: https://github.com/ShieldaAI/select-all-matching/compare/v0.1.0-beta.0...HEAD
[0.1.0-beta.0]: https://github.com/ShieldaAI/select-all-matching/tree/v0.1.0-beta.0
