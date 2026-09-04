# Technical design

This document describes the state machine and version-0 codecs that exist today. Version `0` is a
draft and may change before the first release. Planned adapters and server helpers are not
specified here as finished APIs.

## Model

There are three selection states:

```ts
type SelectionState<Id extends string | number> =
  | { mode: "empty"; scopeKey: string; scopeRevision: number }
  | {
      mode: "explicit";
      scopeKey: string;
      scopeRevision: number;
      ids: readonly Id[];
    }
  | {
      mode: "allMatching";
      scopeKey: string;
      scopeRevision: number;
      scopeToken: string;
      excludedIds: readonly Id[];
    };
```

The public type also carries type-only markers used to preserve the `Id` type. At runtime, the
package tracks the states it creates and freezes them. This protects state invariants; it is not an
authorization or security boundary.

Runtime states belong to the loaded package instance that created them. Before sending state to a
worker, another JavaScript realm, or a separately installed copy of the package, encode it; decode
it on the other side.

Terms used below:

- A **row ID** is a non-empty string or a finite safe integer.
- The **candidate scope** is the server result set before action-specific authorization and row
  eligibility are applied.
- A **scope key** is an opaque equality value describing candidate-set membership.
- A **scope revision** distinguishes separate visits to a scope, including `A -> B -> A`.
- A **scope token** is an opaque server reference used to recover an all-matching scope.
- A **page** is only an input to an operation. It is not stored in selection state.

At execution time, the server still intersects the selection with current authorization and row
eligibility. Selection state records intent, not permission.

### State invariants

- An explicit state always has at least one ID. Removing the last ID produces an empty state.
- IDs are unique and keep their first-insertion order.
- The number `1` and the string `"1"` are different IDs.
- `-0` is stored as `0`.
- String IDs are kept verbatim. They are not trimmed or Unicode-normalized.
- Scope keys and tokens are non-empty strings.
- Scope revisions are non-negative safe integers.
- Inputs and caller-owned arrays are not mutated.
- Counts, filters, cursors, page numbers, and row objects are not stored in the state.
- All-matching state never expands into a list of every included ID.

## Scope identity

The server decides when two list responses represent the same candidate set. A scope key normally
includes the tenant, subject, resource, normalized filter/search, and any permission or dataset
revision required by the application's consistency model. Page, cursor, page size, and
presentation-only sorting normally do not affect it.

Ordering belongs in the key only when it changes membership, such as “top 100 by revenue.” The
client treats the key as an opaque string. It is not a query and it does not grant access.

### Why the local revision exists

A key cannot tell an old render of scope A from a later return to A:

```text
A revision 4 -> B revision 5 -> A revision 6
```

Every command carries the key and revision from the data that produced the event. A command from
revision 4 is rejected even if revision 6 has the same key.

`reconcileScope` uses compare-and-set behavior:

- if its expected key or revision is stale, it returns `staleScope` and keeps the state;
- adopting the same key is a no-op; and
- adopting a different key increments the revision and clears the selection.

The data-fetching layer still has to discard list responses that no longer belong to the active
query before reconciling their scope.

### Token refresh

A scope token may rotate without changing membership. `refreshScopeToken` takes the current
context, the token it expects, and the replacement token.

- A stale key or revision returns `staleScope`.
- A different current token returns `staleToken`.
- A matching token is replaced without changing exclusions.
- Empty and explicit states do not store a token, so a same-context refresh is a no-op.

Calling `selectAllMatching` while already in all-matching mode is an idempotent no-op. This keeps a
replayed token response from erasing exclusions added after the request began. To intentionally
include every excluded row again, pass the current `excludedIds` to `setIdsSelected` with
`selected: true`.

Token requests made before all-matching state exists are an application concern. When tokens are
loaded lazily, tie each request to the rendered context and discard it if the query changes, a newer
request wins, the user cancels the action, or the selection state is no longer the same object from
which the request began. A stale response should never reach `selectAllMatching`.

## Mutations

`applySelectionCommand` implements all state changes. The public helpers are:

```ts
emptySelection(scopeKey);
setIdSelected(state, input);
setIdsSelected(state, input);
selectAllMatching(state, scope);
refreshScopeToken(state, input);
clearSelection(state, context);
reconcileScope(state, input);
```

Each operation returns either an applied state or the unchanged state with `staleScope` or
`staleToken`. Invalid direct API arguments are programmer errors and throw `TypeError`. An empty ID
list is a valid no-op.

For commands in the current scope:

| Current state | Select IDs                   | Deselect IDs                              |
| ------------- | ---------------------------- | ----------------------------------------- |
| Empty         | Create an explicit selection | No change                                 |
| Explicit      | Add IDs in stable order      | Remove IDs; become empty when none remain |
| All matching  | Remove IDs from exclusions   | Add IDs to exclusions                     |

Selecting all matching from empty or explicit state stores the supplied token and starts with no
exclusions. Clearing returns to empty state in the current scope.

There is no toggle command. UI adapters should send the checkbox's explicit checked value so a
repeated event remains idempotent. Selecting a page is simply `setIdsSelected` with the eligible IDs
from that page; the package does not decide which rows are disabled.

## Reads

Membership and page reads require a complete `SelectionContext`. They return
`{ scopeMatches: false }` when the context is stale rather than showing checkmarks from another
scope revision.

```ts
createSelectionView(state, context);
isIdSelected(state, context, id);
getPageSelection(state, context, pageIds);
summarizeSelectionState(state);
```

`getPageSelection` returns `noRows`, `none`, `some`, or `all`. `createSelectionView` builds an index
once, which is the preferred path when rendering many rows. The summary reports an exact count for
explicit state and only an exclusion count for all-matching state. An exact all-matching count has
to come from the server and may change before execution.

These helpers trust the application to supply IDs from the stated page. They do not establish
candidate membership, eligibility, or authorization.

## Draft formats

Stored client state and bulk requests have separate version fields. Both current formats use draft
version `0`.

```ts
type EncodedSelectionDraft<Id> = {
  stateVersion: 0;
  scopeKey: string;
  scopeRevision: number;
  selection:
    | { mode: "empty" }
    | { mode: "explicit"; ids: readonly Id[] }
    | {
        mode: "allMatching";
        scopeToken: string;
        excludedIds: readonly Id[];
      };
};

type BulkSelectionDraft<Id> =
  | { protocolVersion: 0; mode: "explicit"; ids: readonly Id[] }
  | {
      protocolVersion: 0;
      mode: "allMatching";
      scopeToken: string;
      excludedIds: readonly Id[];
    };
```

`encodeSelection` produces stored state. `decodeSelection` validates it and restores a normalized
package state. `toBulkSelection` converts current state into a request; empty state becomes `null`.
The `/server` entry point exports `decodeBulkSelection` for untrusted request bodies.

External decoders accept `unknown` and return structured errors for payload failures. Bad codec
configuration is a programmer error and throws. The HTTP server still needs a whole-body byte limit
before JSON parsing.

### Typed IDs

The default decoder accepts mixed string and number IDs. Applications using branded IDs or a
narrower domain provide `decodeId`:

```ts
decodeSelection(input, {
  decodeId(value) {
    return isCustomerId(value) ? { ok: true, value } : { ok: false, code: "not_customer_id" };
  },
});
```

The decoder may narrow or brand an ID, but it may not change its wire value. Representation changes
belong in an application-level codec. Rejection codes are trusted application diagnostics: keep
them short, stable, and unrelated to user-provided text.

### Limits

The defaults are:

| Value                                |             Limit |
| ------------------------------------ | ----------------: |
| IDs in one included or excluded list |            10,000 |
| Scope key                            |   512 UTF-8 bytes |
| Scope token                          | 4,096 UTF-8 bytes |
| One string ID                        | 1,024 UTF-8 bytes |

Limit values are positive safe integers. In-memory checkbox operations validate IDs and scope
values but do not apply endpoint size policy. Stored-state decoding uses `StateDecodeLimits`; bulk
conversion and server decoding use `BulkLimits`.

`encodeSelection` has no size setting, so decoding its output only round-trips when the decoder's
limits are large enough for that state. `toBulkSelection` returns `tooManyIds`, `tokenTooLong`, or
`idTooLong` when a valid in-memory selection does not fit the endpoint limits. The server checks the
limits again.

Payloads use exact object shapes. Unknown or missing fields, unsupported versions, invalid scalar
types, over-limit strings or lists, invalid IDs, duplicates, and empty explicit selections are
rejected. When more than one problem exists, validation reports the first in this order:

1. top-level value and version;
2. mode and fields;
3. list length;
4. scalar type and UTF-8 length;
5. IDs from the first array position onward; and
6. the first duplicate ID.

## Server boundary

An all-matching request should follow this shape:

1. The list endpoint applies the current tenant and read-access rules and returns rows, a scope key,
   and a token or a way to request one.
2. The client keeps the state in that scope and sends a bounded bulk request.
3. The HTTP endpoint authenticates the request, handles CSRF where needed, limits the body, and
   decodes the payload.
4. The server resolves the token from server-owned data and checks its expiry and binding.
5. The endpoint authorizes its own operation and applies current row-level eligibility.
6. Only then does it subtract the requested exclusions and preview or execute the action.

The operation name comes from server routing or application code, never from the decoded selection
body. Resolution and authorization failures should look the same to an external caller when
detailed errors would create an oracle. A preview is advisory under live-query semantics; execution
resolves and authorizes again.

For explicit mode, the request intentionally omits the old scope. Each ID is authorized directly.
An ID that no longer matches the filter where it was selected can still be acted on. Applications
that require “explicit and still in the original scope” need their own authoritative scope token or
a future protocol variant.

The package does not choose whether missing, unauthorized, or ineligible IDs fail the whole action
or are skipped. An application should use one consistent response policy so those cases do not leak
different information.

Treat scope tokens as sensitive even though they are not credentials:

- do not put them in URLs, analytics, routine logs, or long-lived browser storage;
- bind them to the subject, tenant, and resource;
- use sufficient entropy for stored handles;
- expire and rotate them; and
- reauthorize every operation and affected row at execution time.

The application owns token creation and storage, authentication, query reconstruction,
authorization, transactions, idempotency, partial failures, and background jobs.

## Package surface

The package currently has two entry points:

```ts
import { emptySelection, setIdsSelected } from "select-all-matching";
import { decodeBulkSelection } from "select-all-matching/server";
```

The root contains the state machine, reads, state codec, and bulk conversion. `/server` contains the
untrusted bulk decoder. The core has no runtime dependencies, network calls, telemetry, DOM access,
or global registration.

The build is unbundled ESM targeting ES2022. Node 22 and 24 are the current runtime targets. The
packed declarations are tested with TypeScript 5.4 and the current project compiler. There are no
framework peer dependencies yet.

## Performance and tests

The cost depends on the stored IDs and current page, never on the total number of matching rows:

- select all and clear: O(1);
- encode state or create an indexed view: O(k), where `k` is the included/excluded count;
- change a page: O(k + p), where `p` is the number of page IDs;
- indexed membership: expected O(1); and
- indexed page status: O(p).

The current tests cover state transitions, stale scope and token races, string/number identity,
limits, malformed payloads, typed ID decoders, immutability, model-based command sequences, package
exports, and installation from the generated tarball.
