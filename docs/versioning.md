# Versioning and compatibility

The npm package, bulk-request protocol, and encoded-state format have separate versions.

## Package

The 1.x contract covers the root and `/server` exports, their types, documented state transitions,
codec limits, and accepted formats. New optional exports can be added in a minor release. Removing
an export, changing existing input/output types, changing defaults, or dropping a supported runtime
requires a major release. Deprecated exports remain available throughout 1.x.

The checked-in declaration report records the public type surface. Review changes alongside the
changelog; regenerating the report does not make a breaking change acceptable.

The working version is `1.0.0-rc.2`. An RC can still change before 1.0; any such change must be called
out. Release tags with a prerelease suffix publish to `next`; stable tags publish to `latest`. npm
assigned `latest` to the initial beta as well and rejected its removal, so check the version itself
when evaluating the current public package.

## Wire protocol and encoded state

`protocolVersion: 1` and `stateVersion: 1` are the 1.x baseline formats. Encoders emit version 1.
Decoders accept versions 0 and 1, and bulk decoding normalizes either to version 1. Version 0 refers
specifically to the format shipped in `0.1.0-beta.0`; it is retained for upgrades, not extended.
The deprecated `BulkSelectionDraft` and `EncodedSelectionDraft` types describe that original
version-0 data. New code should use `BulkSelection` and `EncodedSelection`.

Permanent JSON fixtures cover every mode. Support for these accepted formats remains throughout
1.x. New formats must be explicit encoder opt-ins. Changing the default output format or dropping
an accepted decoder version requires a major release.

To upgrade a deployed beta:

1. Deploy the new server decoder first; it accepts existing version-0 clients.
2. Upgrade clients, which now send version 1. Old servers reject those requests.
3. Decode old encoded state and encode it again if transfer is needed. Revalidate the active scope
   and token with the server; decoding does not renew expiry or permission.

Runtime state is not a storage format. Object copies, structured clones, and states created by a
second installed package are rejected. Transfer them through the codec. Encoded all-matching state
contains a scope token and must not be treated as a permanent bookmark or saved query. An
application that saves selection must define its own retention, expiry, and revalidation policy.

## Errors

The existing transition reasons, conversion reasons, and `PayloadErrorCode` members are part of
the 1.x contract. Consumers may switch exhaustively on these unions. Adding a new member to an
existing result union requires a major release; an additive API can define its own result type.

For ordinary JSON payloads, validation order is documented in the technical design. Error `path`
is diagnostic text, not a parsing API. Do not base application control flow on a path or thrown
error message. Message wording and paths may improve in patch releases. Custom decoder codes are
owned by the application. JavaScript programmer errors throw `TypeError`; malformed external
payloads return a decode error instead.

## Runtime support

The library ships ESM targeting ES2022. Node 22 and 24 are supported; CI checks their current
releases and packed imports at each major's minimum version. Tooling may need a newer patch than
the library itself. Dropping a supported Node major is a package-major change.

Packed declarations are tested with TypeScript 5.4 and the current project compiler, under both
NodeNext and Bundler resolution. Browser tests run the installed package in Chromium, Firefox,
and WebKit. This does not promise compatibility with old browser versions or any framework.

The example is application code, not another supported package API. No React, TanStack, database,
or web-server adapter is included in the 1.x contract.
