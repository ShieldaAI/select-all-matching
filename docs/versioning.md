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

Bulk requests carry `protocolVersion`. Draft protocol version `0` is limited to prereleases and has
no long-term compatibility promise. Protocol version `1` will not be assigned until the server
decoder, authorization-boundary tests, packed client/server fixtures, and external beta feedback
support freezing the shape.

Once a stable protocol version ships:

1. Deploy a server decoder before any client can emit that version.
2. Keep the package-major default encoder on its baseline stable version.
3. Make a newer encoder target an explicit option until the next package major.
4. Keep permanent golden fixtures for every stable protocol version.
5. Support decoding a stable version for the remainder of the package major in which it shipped.

Changing the default encoder target or removing a stable decoder requires a package-major release.
This policy allows clients and servers to roll out independently without assuming they update at
the same time.

## Persisted-state versions

If persisted selection encoding ships, it carries `stateVersion` rather than `protocolVersion`.
Draft state version `0` has the same prerelease-only status. A stable state decoder remains
available for its package major, and migrations are documented when a real migration exists.

Runtime state objects are not a storage format. Do not serialize them by accident or depend on
their property layout; use the versioned encoder when one is provided.

## Runtime and toolchain support

The initial runtime target is unbundled ESM at ES2022. The only claimed runtime majors are Node 22
and Node 24. Required CI runs a packed package on their exact `.0.0` minima and on their latest
available releases; no other Node major is claimed. Build tools can require a newer patch release
than the emitted library requires.

Only versions exercised by required or nightly CI appear in the public support matrix. After 1.0,
dropping a supported Node, React, or table-adapter range is a package-major change unless that range
was explicitly marked experimental. Maintainers aim to announce a support drop one minor release
or 90 days ahead when practical.

TypeScript compatibility is proven from the declarations in the packed tarball, not inferred from
the compiler used to build the repository. A TypeScript minimum will be advertised only after those
consumer fixtures exist.

## Release artifacts

A candidate artifact for each package version is built once as an npm tarball, hashed, installed
into every release fixture, and validated with Publint and Are the Types Wrong. After approval,
that same versioned tarball is published with provenance; it is not rebuilt during publication.
The `0.9.0-rc.0` and `1.0.0` tarballs are distinct: after the stable version bump, the new `1.0.0`
artifact runs the complete release-candidate suite before it can be published unchanged.

Every release records user-visible changes in `CHANGELOG.md`. Stable protocol fixtures, support
matrix changes, and migration instructions are release artifacts when applicable.
