# Versioning and compatibility

This project versions three things independently: the npm package, the bulk wire protocol, and an
optional persisted-state format. A matching number in two domains does not imply compatibility.

## Package versions

Published package versions follow Semantic Versioning once `1.0.0` is released.

Before 1.0, the API is experimental. Breaking changes are allowed between minor prereleases, but
they must be explained in the changelog. A prerelease such as `0.1.0-beta.0` is published under the
`next` npm tag. The `latest` tag is reserved for stable versions.

After 1.0:

- patch releases fix behavior without changing the supported API;
- minor releases add backward-compatible API, exports, or decoder support; and
- major releases may remove or change supported API, defaults, runtime ranges, or peer ranges after
  the documented deprecation process.

Adding a subpath export is normally minor. Removing or renaming one is major after 1.0. The initial
implementation exposes only the package root and `/server`; planned framework adapters are not
compatibility promises until they ship.

## Protocol versions

Bulk requests carry `protocolVersion`. Draft protocol version `0` is prerelease-only and may
change. Protocol version `1` will be the first stable wire format.

For a new stable version, deploy the server decoder before clients can emit it. The default encoder
stays on the package major's baseline version; newer formats are explicit opt-ins. Stable formats
keep permanent fixtures and decoder support for that package major. Changing the default encoder or
removing a stable decoder requires a package-major release.

## Persisted-state versions

Persisted selections carry `stateVersion` rather than `protocolVersion`. Draft state version `0`
has the same prerelease-only status. A stable state decoder remains available for its package
major, and migrations are documented when a real migration exists.

Runtime state objects are not a storage format. Do not serialize them by accident or depend on
their property layout; use the versioned encoder when one is provided.

## Runtime and toolchain support

The initial runtime target is unbundled ESM at ES2022. The supported runtime majors are Node 22 and
Node 24. Build tools may require a newer patch release than the emitted library.

Only versions exercised in CI are claimed as supported. After 1.0, dropping a supported Node,
React, or table-adapter range is a package-major change unless that range was marked experimental.

TypeScript compatibility is tested from the declarations in the packed tarball. The minimum
supported version is TypeScript 5.4.

Every release records visible changes in `CHANGELOG.md`. Stable protocol fixtures, support-matrix
changes, and migration instructions are included when relevant.
