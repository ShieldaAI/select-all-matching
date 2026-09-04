# select-all-matching

Selection state for server-paginated tables.

The library represents either a known list of selected IDs or every row in a server-defined scope
except a short exclusion list. It never needs to load every matching ID into the browser.

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

A scope token represents selection intent; it is not authorization. The server must resolve it from
server-owned data and recheck the current user, tenant, operation, and affected rows before doing
any work.

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
