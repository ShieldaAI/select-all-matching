# select-all-matching

Selection state for server-paginated tables.

The library represents either a known list of selected IDs or every row in a server-defined scope except a short exclusion list. It never needs to load every matching ID into the browser.

This repository is in early development and no npm package has been published.

## Implemented so far

- immutable empty, explicit, and all-matching states;
- single-row and page-sized selection operations;
- protection against stale scope events and reordered token refreshes;
- scope-aware membership and page-checkbox reads;
- draft persisted-state and bulk-request codecs with bounded, non-throwing decoding; and
- a separate server entry point for decoding untrusted bulk requests.

```ts
import {
  emptySelection,
  selectAllMatching,
  setIdsSelected,
  toBulkSelection,
} from "select-all-matching";

const empty = emptySelection("customers:active");
const explicit = setIdsSelected(empty, {
  context: { scopeKey: "customers:active", scopeRevision: 0 },
  ids: ["customer-17", "customer-42"],
  selected: true,
});

if (explicit.applied) {
  const all = selectAllMatching(explicit.state, {
    scopeKey: "customers:active",
    scopeRevision: 0,
    scopeToken: "opaque-server-reference",
  });

  if (all.applied) {
    const request = toBulkSelection(all.state);
    // Send request.value in an authenticated bulk-action request when request.ok.
  }
}
```

A scope token represents selection intent; it is not authorization. The server must resolve it from server-owned data and recheck the current user, tenant, operation, and affected rows before doing any work.

## Development

Use a current Node 22 or Node 24 release:

```sh
npm ci
npm run check
npm run test:coverage
```

Coverage is enforced at 90% statements/lines, 85% branches, and 95% functions.

See the [project plan](./docs/PROJECT_PLAN.md), [technical specification](./docs/TECHNICAL_SPEC.md), and [versioning policy](./docs/versioning.md) for the remaining work and current draft contracts.
