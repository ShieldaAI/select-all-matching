# Changelog

Notable changes to this project will be recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and published releases will follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Preserve keyboard focus after pagination and bulk actions without reclaiming it after the user
  moves elsewhere.

### Changed

- Separate release validation from approval-gated publishing. Transfer the tested tarball by
  immutable artifact ID and verify its digest and package metadata before publishing.
- Require checked pull requests on `main` and limit release-tag changes to repository administrators.

### Added

- Generated scope/token race tests, direct/indexed read comparisons, and maximum-revision regressions.

## [1.0.0-rc.1] - 2026-09-06

### Changed

- Encode protocol and transfer-state version 1. Decoders still read the
  original beta's version 0; deploy the server decoder before upgrading clients.
- Export `BulkSelection` and `EncodedSelection`. Deprecated `Draft` types continue to describe
  version-0 inputs.
- Check the public declaration baseline and publish the exact tarball tested by the release job.
- Route prerelease tags to `next` and stable tags to `latest`.

### Added

- A runnable server-paginated table with expiring scopes, exclusions, previews, and permission checks.
- Browser and HTTP integration tests using the installed tarball, plus worker and duplicate-package
  transfer checks.
- Permanent format fixtures, boundary tests, and client/server integration guides.

## [0.1.0-beta.0] - 2026-09-06

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

[Unreleased]: https://github.com/ShieldaAI/select-all-matching/compare/v1.0.0-rc.1...HEAD
[1.0.0-rc.1]: https://github.com/ShieldaAI/select-all-matching/compare/v0.1.0-beta.0...v1.0.0-rc.1
[0.1.0-beta.0]: https://github.com/ShieldaAI/select-all-matching/releases/tag/v0.1.0-beta.0
