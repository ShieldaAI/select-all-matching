# select-all-matching

[![CI](https://github.com/ShieldaAI/select-all-matching/actions/workflows/ci.yml/badge.svg)](https://github.com/ShieldaAI/select-all-matching/actions/workflows/ci.yml)

“Select all” for tables where most rows live on another page.

A browser usually knows only the current page. Fetching every matching ID just to run a bulk action
is slow, wasteful, and easy to get wrong when filters change. This library represents either a known
list of selected IDs or every row in a server-defined scope except a short exclusion list.

It is framework-agnostic, has no runtime dependencies, and never needs to load every matching ID
into the browser.

The API and version-0 formats are prerelease and may change before the first stable version.

## Install

```sh
npm install select-all-matching@next
```

## Current status

- Immutable empty, explicit, and all-matching states
- Single-row and page-sized selection operations
- Rejection of stale scope events and reordered token refreshes
- Scope-aware membership and page-checkbox reads
- Draft stored-state and bulk-request codecs with input limits
- A separate server entry point for untrusted bulk requests

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
| Store or submit selection        | `encodeSelection`, `decodeSelection`, `toBulkSelection`                       |
| Validate a bulk request          | `decodeBulkSelection` from `select-all-matching/server`                       |
| Move to a changed query scope    | `reconcileScope`; stale transitions are returned rather than silently applied |

## Development

Use a current Node 22 or Node 24 release:

```sh
npm ci
npm run check
npm run test:coverage
```

Coverage is enforced at 90% statements/lines, 85% branches, and 95% functions.

The [technical design](./docs/TECHNICAL_SPEC.md) covers scope behavior, the draft wire format, and
the server trust boundary. Compatibility rules are in [versioning.md](./docs/versioning.md).
