# select-all-matching

[![npm version](https://img.shields.io/npm/v/select-all-matching/next)](https://www.npmjs.com/package/select-all-matching)
[![CI](https://github.com/ShieldaAI/select-all-matching/actions/workflows/ci.yml/badge.svg)](https://github.com/ShieldaAI/select-all-matching/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/npm/l/select-all-matching)](https://github.com/ShieldaAI/select-all-matching/blob/main/LICENSE)

“Select all” for tables where most rows live on another page.

A browser usually knows only the current page. Fetching every matching ID just to run a bulk action
is slow, wasteful, and easy to get wrong when filters change. This library represents either a known
list of selected IDs or every row in a server-defined scope except a short exclusion list.

It is framework-agnostic, has no runtime dependencies, and never needs to load every matching ID
into the browser.

The next release is `1.0.0-rc.1`. It writes version-1 payloads and reads both version 1 and the
original beta's version 0. The public npm package may still be an earlier prerelease; the command
below installs the release currently on `next`.

## Install

```sh
npm install select-all-matching@next
```

## Included

- Immutable empty, explicit, and all-matching states
- Single-row and page-sized selection operations
- Rejection of stale scope events and reordered token refreshes
- Scope-aware membership and page-checkbox reads
- Versioned state-transfer and bulk-request codecs with input limits
- A separate server entry point for untrusted bulk requests

Use it when a bulk action spans server pages and fetching all selected IDs is impractical. If your
table already holds every row, its built-in selection may be enough. This package supplies no table
components, authentication, or database queries.

## Try the complete example

From a checkout, run `npm ci` and `npm run example`, then open the printed local URL. The
[server table example](https://github.com/ShieldaAI/select-all-matching/tree/main/examples/server-table) installs the packed package and includes
real HTTP pagination, filters, expiring scopes, permission changes, and a harmless bulk action.

The [client guide](./docs/client-guide.md) covers query changes and delayed responses. The
[server guide](./docs/server-guide.md) explains scope resolution and execution-time authorization.

## Basic use

```ts
import {
  emptySelection,
  selectAllMatching,
  setIdSelected,
  toBulkSelection,
} from "select-all-matching";

const empty = emptySelection("customers:active");
const all = selectAllMatching(empty, {
  scopeKey: "customers:active",
  scopeRevision: 0,
  scopeToken: "opaque-server-reference",
});

if (all.applied) {
  const excluded = setIdSelected(all.state, {
    context: { scopeKey: "customers:active", scopeRevision: 0 },
    id: "customer-42",
    selected: false,
  });

  if (excluded.applied) {
    const request = toBulkSelection(excluded.state);
    if (request.ok && request.value) {
      await fetch("/customers/archive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request.value),
      });
    }
  }
}
```

On the server, decode the untrusted request before resolving any rows:

```ts
import { decodeBulkSelection } from "select-all-matching/server";

const selection = decodeBulkSelection(requestBody);
if (!selection.ok) {
  return Response.json({ error: selection.error.code }, { status: 400 });
}

// Resolve scopeToken, authorize the current user and operation, then apply exclusions.
await archiveCustomers(selection.value);
```

A scope token represents selection intent; it is not authorization. The server must resolve it from
server-owned data and recheck the current user, tenant, operation, and affected rows before doing
any work.

## API at a glance

| What you need                    | API                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------- |
| Start or clear selection         | `emptySelection`, `clearSelection`                                            |
| Change one row or a loaded page  | `setIdSelected`, `setIdsSelected`                                             |
| Select the whole filtered result | `selectAllMatching`                                                           |
| Read row and page checkbox state | `createSelectionView`, `isIdSelected`, `getPageSelection`                     |
| Transfer or submit selection     | `encodeSelection`, `decodeSelection`, `toBulkSelection`                       |
| Validate a bulk request          | `decodeBulkSelection` from `select-all-matching/server`                       |
| Move to a changed query scope    | `reconcileScope`; stale transitions are returned rather than silently applied |

The [API reference](./docs/api.md) lists arguments, return values, limits, and errors.

Runtime states belong to the package instance that created them. Use `encodeSelection` and
`decodeSelection` across workers or separate copies of the package. Encoded state may contain a
sensitive scope token; it is not a durable saved query and does not renew authorization or expiry.

## Compatibility

- ESM only, targeting ES2022; no CommonJS build.
- Node 22 and 24. Development tools need a current patch release.
- TypeScript 5.4 or later, with NodeNext or Bundler module resolution.
- Browser execution is checked with Chromium, Firefox, and WebKit in the reference app.
- No framework dependencies or framework-specific support promises.

## Development

Use a current Node 22 or Node 24 release:

```sh
npm ci
npm run check
npm run test:coverage
npx playwright install chromium firefox webkit
npm run test:browser
```

Coverage is enforced at 90% statements/lines, 85% branches, and 95% functions.

The [technical design](./docs/TECHNICAL_SPEC.md) covers scope behavior, the wire format, and
the server trust boundary. Compatibility rules are in [versioning.md](./docs/versioning.md).
