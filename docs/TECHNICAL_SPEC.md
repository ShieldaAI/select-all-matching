# Technical specification

- Status: core and draft codecs implemented; adapter and server-coordination contracts remain candidates
- Last updated: 2026-09-04
- Owner: ShieldaAI maintainers
- Related plan: [PROJECT_PLAN.md](./PROJECT_PLAN.md)

This document owns the proposed runtime behavior. The project plan owns priorities, gates, estimates, and release decisions. Until the first stable protocol is frozen, code examples here are candidates to test, not compatibility promises.

## 1. Required behavior

The package must let an application represent and operate on either:

- a finite list of selected row IDs; or
- every candidate row in a server-defined scope except a finite list of excluded IDs.

It must do this without fetching or materializing every matching ID in the browser.

The core owns selection state and deterministic transitions. It does not own table rendering, data fetching, query construction, authentication, authorization, transaction handling, or bulk-job execution.

## 2. Terms

- **Row ID**: a stable application ID represented by a non-empty string or safe integer.
- **Page**: the rows currently loaded by the client. A page is input to an operation, not part of stored selection state.
- **Candidate scope**: the server-defined result set before action-specific authorization and row eligibility are applied.
- **Scope key**: an opaque server-issued equality value identifying candidate-set membership semantics.
- **Scope revision**: a client-side incarnation number. It changes whenever a different scope is adopted, including `A → B → A`.
- **Scope token**: an opaque, expiring server reference used to recover a candidate scope for execution.
- **Explicit selection**: a finite list of included IDs.
- **All-matching selection**: client intent to target the candidate scope minus excluded IDs.
- **Endpoint operation**: an application-owned constant describing the resource and action being executed. It never comes from the decoded selection payload.

At execution, the server intersects all-matching intent with current action authorization and row eligibility. Selection state itself is never evidence that an operation is allowed.

## 3. State model

### 3.1 Candidate types

```ts
export type RowId = string | number;

export type SelectionContext = Readonly<{
  scopeKey: string;
  scopeRevision: number;
}>;

export type AllMatchingScope = Readonly<{
  scopeKey: string;
  scopeRevision: number;
  scopeToken: string;
}>;

declare const normalizedSelection: unique symbol;
declare const selectionIdType: unique symbol;

export type SelectionState<Id extends RowId = RowId> = (
  | Readonly<{
      mode: "empty";
      scopeKey: string;
      scopeRevision: number;
    }>
  | Readonly<{
      mode: "explicit";
      scopeKey: string;
      scopeRevision: number;
      ids: readonly Id[];
    }>
  | Readonly<{
      mode: "allMatching";
      scopeKey: string;
      scopeRevision: number;
      scopeToken: string;
      excludedIds: readonly Id[];
    }>
) & {
  readonly [normalizedSelection]: true;
  readonly [selectionIdType]?: Id;
};
```

The normalization brand is absent from the public entry point and is represented at runtime by a non-enumerable marker. The second, type-only phantom field keeps the ID parameter attached to every variant, including after narrowing to `mode: "empty"`. Public constructors and decoders create frozen normalized state; every public state consumer checks the runtime marker so object-spread imitations fail instead of escaping invariants. This is still not an authorization boundary: application code controls its own process and can use casts or reflection. Public operations also validate new IDs and scope values at runtime.

An application with no accepted server scope yet keeps that loading state outside this package.

### 3.2 Invariants

- `explicit.ids` is non-empty. Removing the final ID produces `empty`.
- Stored ID arrays contain no duplicates and preserve first-insertion order.
- The number `1` and string `"1"` remain distinct.
- Number IDs are finite safe integers; `-0` is canonicalized to `0`.
- String IDs are non-empty and otherwise remain verbatim. The core does not trim or Unicode-normalize them.
- Scope keys and tokens are non-empty opaque strings.
- Scope revisions are non-negative safe integers.
- `allMatching` never requires the complete matching set as included IDs. Its exclusion list may still grow to equal the current set.
- Counts, rows, filters, pages, cursors, and display labels are not stored selection state.
- Operations do not mutate the input state or caller-owned arrays.
- Repeated encoding of the same normalized state produces deeply equal output.

### 3.3 Scope identity

The server decides whether two list responses describe the same candidate membership. A scope key should account for:

- tenant and authenticated subject;
- resource or dataset;
- normalized filters and search;
- permission or dataset revision when required by the application's consistency model; and
- ordering or limits only when they change membership, such as “top 100 by revenue.”

It should normally ignore page, cursor, page size, and presentation-only sorting.

The client never parses a scope key. The key is an equality value, not an authorization credential and not a query.

## 4. Scope lifecycle and concurrency

### 4.1 Why a revision is required

A key alone does not distinguish the first visit to scope A from a later return to the same scope:

```text
A revision 4 → B revision 5 → A revision 6
```

A delayed event from A revision 4 must not apply to A revision 6. Row, page, clear, and select-all commands therefore carry both `scopeKey` and `scopeRevision` from the rendered data that produced the event.

The fetch layer still owns request ordering. It must discard a response that no longer belongs to the active query before asking the selection core to adopt that response's scope.

### 4.2 Deliberate scope adoption

```ts
reconcileScope(state, {
  expected: { scopeKey, scopeRevision },
  nextScopeKey,
}): TransitionResult
```

- If the state's key or revision differs from `expected`, return `staleScope` and leave state unchanged.
- If `nextScopeKey` equals the current key, return the current state unchanged.
- If the key differs, increment the revision and return `empty` in the new scope.
- Revision exhaustion is treated as invalid programmer state; it is not allowed to wrap and reuse an older revision.

### 4.3 Scope-token renewal

A token can expire or rotate without changing candidate membership. Renewal is compare-and-set:

```ts
refreshScopeToken(state, {
  context,
  expectedScopeToken,
  nextScopeToken,
}): TransitionResult
```

- A different key or revision returns `staleScope`.
- In all-matching mode, a current token different from `expectedScopeToken` returns `staleToken`.
- A matching token is replaced while exclusions remain unchanged.
- Empty and explicit states store no token, so same-context renewal is an applied no-op.
- If membership semantics changed, the server issues a different key and the caller reconciles instead of renewing.

This is the only operation that changes the token of an existing all-matching state. Repeating `selectAllMatching` clears exclusions but preserves the token already in that state. Once all-matching state exists, those rules prevent either an older refresh response or a delayed select-all command from overwriting its newer token.

### 4.4 Token acquisition before all-matching state

Empty and explicit state intentionally store no token. The core therefore cannot order eager list tokens or lazy token requests before all-matching state exists. That request lifecycle belongs to the application, like list-response ordering.

The application must keep a monotonically increasing pre-selection token generation for the active view:

1. Accepting an eager token or starting a lazy token request assigns a new generation and captures the current `SelectionContext`.
2. Accepting a newer token, starting another request, changing scope, applying a later selection command, or otherwise cancelling the user's select-all intent invalidates the captured generation and aborts outstanding requests when possible.
3. An event or response may call `selectAllMatching` only if its generation is still current, the rendered context still matches, and the user still intends all-matching selection.
4. A stale response is discarded before it reaches the core, even if its token remains server-valid.

The application passes the token from the current generation rather than one captured by an obsolete render or request. The demo must implement this gate and reorder, replace, and cancel token responses deliberately. The package does not claim that `scopeKey` or `scopeRevision` orders token responses within one scope.

## 5. Mutations and reads

### 5.1 Commands

```ts
type SelectionCommand<Id extends RowId> =
  | {
      type: "setIdsSelected";
      context: SelectionContext;
      ids: readonly Id[];
      selected: boolean;
    }
  | {
      type: "selectAllMatching";
      scope: AllMatchingScope;
    }
  | {
      type: "refreshScopeToken";
      context: SelectionContext;
      expectedScopeToken: string;
      nextScopeToken: string;
    }
  | {
      type: "clear";
      context: SelectionContext;
    };

type TransitionResult<Id extends RowId> =
  | { applied: true; state: SelectionState<Id> }
  | {
      applied: false;
      reason: "staleScope" | "staleToken";
      state: SelectionState<Id>;
    };
```

`applySelectionCommand` is the authoritative mutation implementation. Convenience helpers call it and return the same result:

```ts
emptySelection(scopeKey)
applySelectionCommand(state, command)
reconcileScope(state, input)
refreshScopeToken(state, input)
setIdSelected(state, input)
setIdsSelected(state, input)
clearSelection(state, context)
selectAllMatching(state, scope)
```

Direct programmer APIs throw a documented `TypeError` for an invalid ID, scope string, revision, token, or limits object. Scope and token races are expected outcomes and return a non-applied result rather than throwing. An empty ID list is a valid applied no-op.

The beta and proposed stable API do not expose toggle. Adapters use explicit checked booleans so repeated events remain idempotent.

### 5.2 Transition table

For a command with the current key and revision:

| Current mode | Select IDs | Deselect IDs |
| --- | --- | --- |
| `empty` | Create `explicit` | Applied no-op |
| `explicit` | Stable-order union | Subtract; become `empty` if none remain |
| `allMatching` | Remove IDs from exclusions | Add IDs to exclusions |

Other transitions:

| Action | Result |
| --- | --- |
| Select all matching from `empty` or `explicit` | Enter `allMatching`, store the supplied token, clear exclusions |
| Select all again while already `allMatching` | Preserve the current token and clear exclusions |
| Clear | Enter `empty` in the current context |
| Adopt same key | Keep state and revision |
| Adopt different key | Increment revision and enter `empty` |
| Old key or revision command | Return `staleScope`; keep state |
| Matching token refresh | Replace token; preserve exclusions |
| Reordered token refresh | Return `staleToken`; keep newer token |

“Select page” is `setIdsSelected` over the eligible IDs supplied by the application. The core does not decide which visible rows are disabled. Business eligibility is enforced again by the server.

### 5.3 Scope-aware reads

```ts
type ScopedRead<Value> =
  | { scopeMatches: true; value: Value }
  | { scopeMatches: false };

type PageSelection = "noRows" | "none" | "some" | "all";

createSelectionView(state, context): ScopedRead<SelectionView>
isIdSelected(state, context, id): ScopedRead<boolean>
getPageSelection(state, context, pageIds): ScopedRead<PageSelection>

summarizeSelectionState(state):
  | { kind: "empty"; selectedCount: 0 }
  | { kind: "explicit"; selectedCount: number }
  | { kind: "allMatching"; excludedCount: number }
```

The summary is deliberately named as a state-only read. It does not claim that a page context matches. Page and membership reads require the complete context so rows from another scope incarnation cannot inherit checkmarks.

Read helpers evaluate IDs the application says came from the matching scoped page. They cannot prove candidate membership, action eligibility, or authorization.

`createSelectionView` builds an index once in O(k), where k is the stored included or excluded count. A matching view provides expected O(1) membership reads and O(p) page reads. React and TanStack adapters memoize it by immutable state identity and context.

There is no unconditional exact selected count for all-matching state. A server preview may return a scope-bound count, but under live semantics that count is advisory until execution.

## 6. Encoding and protocol

### 6.1 ID decoding

Default decoders produce `SelectionState<RowId>` or `BulkSelection<RowId>` after validating non-empty strings and safe integers.

Typed or branded IDs require an application decoder:

```ts
type DecodeResult<Value> =
  | { ok: true; value: Value }
  | { ok: false; code: string };

decodeSelection(input, {
  decodeId(value: unknown): DecodeResult<ApplicationId>,
  limits,
})
```

A successful decoder is a refinement, not a transcoder: its returned string or
number must be SameValueZero-equal to the normalized wire value. This supports
branding and narrower ID domains while preserving deterministic codec round
trips. Applications that need to change ID representation must do so in a
separate application-level wire codec.

Decoder rejection codes are trusted application diagnostics. They must be
stable, non-sensitive identifiers rather than payload-derived messages. The
library propagates only 1–64 character ASCII identifier codes and omits an
exact echo of a rejected string ID; applications remain responsible for not
deriving secrets into a different accepted code.

A caller cannot obtain `SelectionState<Uuid>` merely by supplying a generic type argument. Tests cover default mixed IDs, number-only IDs, and a branded UUID decoder.

### 6.2 Separate version domains

Persisted client state and client/server bulk requests use separate version fields:

```ts
type EncodedSelectionDraft<Id> = {
  readonly stateVersion: 0;
  readonly scopeKey: string;
  readonly scopeRevision: number;
  readonly selection:
    | { mode: "empty" }
    | { mode: "explicit"; readonly ids: readonly Id[] }
    | {
        mode: "allMatching";
        readonly scopeToken: string;
        readonly excludedIds: readonly Id[];
      };
};

type BulkSelectionDraft<Id> =
  | {
      protocolVersion: 0;
      mode: "explicit";
      readonly ids: readonly Id[];
    }
  | {
      protocolVersion: 0;
      mode: "allMatching";
      readonly scopeToken: string;
      readonly excludedIds: readonly Id[];
    };
```

Version `0` is explicitly experimental and appears only in prereleases published under the npm `next` tag. The server implementation, abuse suite, packed client/server fixtures, and external beta feedback must run before the fields are frozen as version `1`.

After a stable version is published:

- Default encoders keep emitting the baseline stable version chosen for their package major.
- A newer wire version requires an explicit target option or version-named encoder until the next package major changes the default.
- Servers deploy new decoders before clients deploy new encoders.
- Every published stable wire revision has permanent golden fixtures.
- A stable decoder remains supported for the package major in which it shipped.
- Changing the default encoder target or removing stable decoder support requires deprecation and a package major release.
- Draft version `0` has no long-term compatibility promise; its changes are still called out in prerelease notes.

The persisted-state codec is included in the beta only if design partners need storage or restoration. The bulk protocol is part of the required vertical slice.

### 6.3 Explicit-selection execution

For explicit mode, `scopeKey` is a client UI and staleness namespace only. It is intentionally absent from the bulk request. The server authorizes and checks eligibility for each listed ID, but does not automatically require the ID to still match the filter where it was selected.

An authorized record that stops matching the old list filter can therefore still be targeted by an already-created explicit request. Applications requiring “explicit and still in original scope” need an application-level protocol extension with an authoritative scope token.

The application chooses whether missing, unauthorized, or ineligible IDs fail the entire action or are skipped. It must apply one documented disclosure policy; the package does not choose it.

### 6.4 Limits and deterministic errors

```ts
type BulkLimits = Readonly<{
  maxIds: number;
  maxScopeTokenBytes: number;
  maxStringIdBytes: number;
}>;

type StateDecodeLimits = BulkLimits & Readonly<{
  maxScopeKeyBytes: number;
}>;
```

All limit values are positive safe integers. The starting defaults, subject to the Phase 0 payload spike, are:

| Limit | Candidate default |
| --- | ---: |
| IDs in one included or excluded list | 10,000 |
| Scope key | 512 UTF-8 bytes |
| Scope token | 4,096 UTF-8 bytes |
| One string ID | 1,024 UTF-8 bytes |

Recognized decoder options and limit fields must be own properties. Inherited
recognized fields are rejected as programmer configuration errors so prototype
pollution cannot weaken a limit or silently remove a typed ID decoder.

UTF-8 byte length is the exact unit. The HTTP server still applies a whole-body byte limit before JSON parsing.

Pure in-memory transitions enforce ID and scope invariants but do not impose an endpoint's size policy. State decoding uses `StateDecodeLimits`; bulk conversion and server decoding use `BulkLimits`. This lets one in-memory selection be checked against different endpoint limits and prevents hidden policy inside ordinary checkbox operations.

`encodeSelection` also leaves size policy to its caller and therefore always
encodes normalized state. Its round-trip guarantee is conditional on decoding
with limits large enough for that state; callers that persist larger values
must save and reuse an equal or broader `StateDecodeLimits` policy. Default
decoding can intentionally reject an otherwise valid in-memory state that
exceeds the default storage boundary.

External codecs accept `unknown` and return structured errors; they never throw for payload contents. They reject unsupported versions, extra or missing fields, invalid scalar types, over-limit values, invalid IDs, duplicate IDs, and empty explicit selections.

Validation reports the first error using a documented order:

1. top-level value and version;
2. mode and exact field set;
3. list length;
4. scalar type and UTF-8 byte length;
5. IDs from lowest array index to highest; and
6. the first duplicate ID.

`toBulkSelection(state, limits)` returns a result because a user can legitimately build a selection that exceeds an endpoint's limit:

```ts
type BulkConversionResult<Id extends RowId> =
  | { ok: true; value: BulkSelectionDraft<Id> | null }
  | {
      ok: false;
      reason: "tooManyIds" | "tokenTooLong" | "idTooLong";
    };
```

The server always decodes and limits again.

## 7. Client/server boundary

### 7.1 Normal flow

1. The list endpoint normalizes browser query input and applies tenant and read-access rules.
2. It returns rows, display metadata, a scope key, and either a scope token or a way to request one when the user chooses all matching.
3. The fetch layer confirms the response belongs to the active request, then reconciles its scope using the expected current context.
4. Page actions carry the page's key and revision.
5. Select-all uses the latest accepted eager token or an application-gated lazy response, then stores it with an empty exclusion list.
6. The client converts state to a bounded bulk request.
7. The HTTP layer applies authentication, CSRF protection where relevant, and request-body limits.
8. The server codec parses the request with endpoint limits.
9. Explicit mode authorizes and resolves every ID according to application policy.
10. All-matching mode resolves the server-owned scope, verifies its binding and expiry, authorizes the endpoint-owned operation, applies row eligibility, and subtracts exclusions.
11. Preview or execution returns an application-defined result.

A preview under live-scope semantics is advisory. Execution resolves and authorizes again, and the final affected count may differ.

### 7.2 Responsibility matrix

| Concern | Package owns | Application owns |
| --- | --- | --- |
| State transitions and stale-context rejection | Yes | Supplying the context belonging to rendered data |
| Request ordering | No | Discarding inactive list responses and stale or cancelled pre-selection token attempts |
| Payload shape and configured limits | Codec only | HTTP byte limits and endpoint configuration |
| Scope key/token creation | No | Canonicalization, entropy, storage/signing, expiry, rotation |
| Authentication and CSRF | No | Entirely |
| Tenant, subject, resource, and operation binding | Types and example only | Entire enforcement |
| Query reconstruction | No | From server-owned scope data only |
| Per-row authorization and eligibility | No | At execution time |
| Exclusion subtraction | Request representation | Authorized query/database operation |
| Transactions, idempotency, partial failure, jobs | No | Entirely |
| Exact affected count | No | Preview/execution response under documented semantics |

### 7.3 Resolver and authorizer interfaces

Keep resolution and authorization distinct. The endpoint supplies `operation`; it never reads it from the selection body.

```ts
interface ScopeResolver<Context, ResolvedScope> {
  resolve(input: {
    token: string;
    context: Context;
  }): Promise<
    | { ok: true; scope: ResolvedScope }
    | { ok: false; reason: "invalidOrExpiredScope" }
  >;
}

interface ScopeAuthorizer<Context, Operation, ResolvedScope> {
  authorize(input: {
    context: Context;
    operation: Operation;
    scope: ResolvedScope;
  }): Promise<
    | { ok: true }
    | { ok: false; reason: "notExecutable" }
  >;
}
```

For all-matching input, the small `/server` coordinator validates the payload, calls the resolver, then the authorizer, and returns a non-detailed failure. Explicit input is returned for application-owned per-ID authorization. A thrown callback becomes `callbackFailure`; there is never a fallback to browser filters, page IDs, or a default scope.

The resolver is responsible for token authenticity or lookup, expiry, and binding to the current authenticated subject, tenant, and resource. The authorizer checks the endpoint-owned operation against the current context and resolved resource. The execution query still enforces current row-level authorization and eligibility.

Contract tests cover a valid same-principal token replayed against the wrong resource or operation, and ensure authorization for one operation cannot be reused to execute another.

### 7.4 Token handling

The package does not prescribe signed tokens versus random stored handles. The reference demo uses a short-lived random handle in an in-memory store.

Documentation must say:

- treat tokens as potentially sensitive even though they are not sufficient authorization;
- do not place them in URLs, analytics, ordinary logs, or long-lived browser storage;
- bind them to subject, tenant, and resource;
- use sufficient entropy for handles;
- expire and rotate them;
- reauthorize every operation; and
- return coarse external failures that do not turn token probing into an oracle.

## 8. Package architecture

Publish one package with subpath exports:

```text
select-all-matching
├── src
│   ├── core
│   ├── react
│   ├── tanstack
│   └── server
├── tests
│   ├── core
│   ├── adapters
│   ├── server-contract
│   └── package-fixtures
├── examples
│   └── tanstack-server
└── docs
```

```ts
import { ... } from "select-all-matching";
import { ... } from "select-all-matching/react";
import { ... } from "select-all-matching/tanstack";
import { ... } from "select-all-matching/server";
```

- The default export contains state, transitions, views, bulk conversion, and optional persisted-state codecs.
- `/react` contains the controlled hook and peers on React.
- `/tanstack` contains translation helpers and peers on React plus `@tanstack/react-table`.
- `/server` contains the bulk decoder, resolver/authorizer contracts, and fail-closed coordinator.
- The example is private and absent from the tarball.

The core has zero runtime dependencies and performs no network calls, telemetry, or global registration. Production dependencies require a written reason and bundle-impact review.

Initial build assumptions, all verified in Phase 0 before being advertised:

- npm as package manager;
- strict TypeScript;
- unbundled ESM targeting ES2022;
- declarations and source maps;
- Node 22 and 24 support;
- one evidence-selected TanStack major for the first beta; and
- a TypeScript floor and React peer range proven by packed consumer fixtures.

The second TanStack major is added only if one branch-free adapter passes its declared minimum and latest fixtures. Otherwise it is separate follow-up work rather than a compatibility claim hidden in one export.

## 9. Adapter contracts

### 9.1 React

The hook is controlled and accepts the context belonging to the currently rendered data plus a functional state updater:

```ts
useSelection({
  state,
  context,
  onStateChange,
});

onStateChange(updater: (previous) => SelectionState): void
```

The hook does not require a scope token for explicit or page selection. Its select-all command accepts an `AllMatchingScope` when the application has one, allowing servers to issue tokens lazily only after the user asks for all matching.

The application supplies that scope at call time after applying the pre-selection token-generation gate in section 4.4. The hook does not start, order, or cancel data requests.

Bound hook commands return `void`. Their functional updater applies the command to the latest state and returns either the next state or the unchanged state for a stale context. It performs no logging, callbacks, analytics, or other side effects because React may invoke an updater more than once in development.

The hook exposes a render-time `scopeMatches` flag. That flag is informative, not a promise that a queued update will apply. Core users that need a `TransitionResult` use `applySelectionCommand` directly in their state owner.

Requirements:

- no update during render;
- no automatic scope reconciliation in an effect;
- one state update for a page operation;
- no lost update when two commands fire before a parent rerender;
- correct Strict Mode behavior;
- stable callbacks where useful; and
- SSR-safe imports with no DOM or `window` access.

### 9.2 TanStack Table

TanStack's own row-selection state is not authoritative because it cannot encode this server-wide intent. The adapter derives loaded-row checkbox values from a memoized selection view and translates checkbox events into scoped commands.

Prefer an application `getId(row.original)` callback. This preserves string/number identity without forcing the global selection through TanStack's string-keyed state. If the compatibility spike proves a row-key bridge necessary, it uses reversible type-prefixed encoding and tests prefix strings, colons, Unicode, `1`, and `"1"`.

The first beta supports one TanStack major selected from demand and compatibility evidence. All versions in the advertised peer range are tested from the packed tarball.

## 10. Reference demo

Build one realistic example with:

- a deterministic in-memory dataset of roughly 23,000 rows;
- server-side search, filtering, sorting, and page or cursor pagination;
- React and the selected TanStack major;
- labelled, keyboard-operable row and header checkboxes;
- explicit selection across pages;
- page selection and correct indeterminate state;
- an offer to escalate page selection to all matching;
- exclusions after all-matching selection;
- filter changes, `A → B → A`, token rotation, and deliberately reordered responses;
- a compact request inspector;
- advisory preview and final server-authoritative result;
- permission revocation and token expiry scenarios; and
- a harmless bulk action such as adding a label.

Suggested UI copy:

- `50 rows on this page are selected. Select all 23,481 matching rows.`
- `All matching rows are selected, except 3.`
- `The result changed since preview. 23,476 rows were updated.`

Exact totals are shown only when they come from scope-bound server metadata. The demo labels its in-memory store and live-scope semantics clearly; neither is a production token implementation or snapshot guarantee.

## 11. Verification

### 11.1 Core examples and properties

Cover every state/action combination plus:

- repeated and empty many-ID commands;
- duplicate, reordered, and empty pages;
- same ID in two scope revisions;
- `A → B → A` with an event from the first A;
- same-key token renewals arriving out of order;
- a delayed select-all command before and after a newer token renewal;
- selecting all again after exclusions;
- numeric/string distinctions, `-0`, negative safe integers, hostile property-name strings, whitespace, emoji, and combining Unicode;
- invalid direct input versus non-throwing external decoding;
- exact and one-over limits; and
- explicit execution after an ID stops matching its original filter.

Use a finite-universe `Set` oracle and generate 1–200 command sequences. Required properties include model equivalence, idempotent set operations, page permutation invariance, stale-context rejection, exclusion subtraction, non-mutation of frozen inputs, codec round trips under matching limits, and parser totality over arbitrary JSON-compatible values.

All-matching membership properties evaluate only IDs known to belong to the modeled candidate scope. The reference server model separately generates live inserts and removals.

### 11.2 Codec and server abuse tests

- Default, number-only, and branded UUID ID decoders.
- Deterministic error order and exact paths.
- Unknown versions and fields, duplicate IDs, invalid Unicode lengths, and hostile JSON shapes.
- Invalid, altered, expired, and unknown tokens fail closed.
- Cross-subject, cross-tenant, cross-resource, and cross-operation replay fails.
- Revoked permission prevents execution after token issuance or preview.
- Browser filters are ignored during all-matching execution.
- Explicit IDs receive current per-ID authorization.
- Unauthorized and nonexistent IDs follow the application's same documented external policy.
- Exclusions only subtract from the authorized query.
- Resolver or authorizer exceptions never trigger fallback behavior.
- HTTP body limits are demonstrated separately from codec limits.

### 11.3 Adapter, demo, and packaging tests

- Eager and lazy pre-selection token responses that are reordered, superseded, or cancelled by the application gate.
- Every declared React/TanStack version tuple, including the minimum and latest of each peer range.
- Strict Mode and two synchronous commands before a parent rerender.
- A mismatch discovered only when a queued updater receives newer state.
- Real table rows, header status, typed IDs, and accessible checkboxes.
- SSR import of every subpath.
- Plain Node ESM consumers on Node 22 and 24.
- A Vite browser consumer and Chromium smoke test.
- The actual `npm pack` tarball, not source aliases.
- Publint, Are the Types Wrong, declaration paths, exports, license, tree shaking, and package contents.
- A committed public API report and golden fixtures for every stable wire revision.
- Old-server/new-client fixtures showing that a client upgrade keeps the package-major default wire version, plus explicit opt-in behavior after the server adds the newer decoder.

### 11.4 Complexity and size

- Select-all and clear: O(1).
- State encoding: O(k).
- Page mutation: at worst O(k + p).
- Selection-view creation: O(k).
- Indexed membership read: expected O(1).
- Indexed page read: O(p).
- No operation allocates or loops over total matching rows.

Benchmark 10 versus one billion conceptual matches, 10,000 stored IDs, a 100-row page, 100,000 indexed reads, and payload-limit parsing. Wall-clock numbers remain informational until CI has a stable baseline. Record the initial minified/gzipped core size; set the enforced budget from the accepted API spike rather than inventing a benchmark afterward.
