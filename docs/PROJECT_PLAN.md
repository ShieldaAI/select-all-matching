# Project plan

- Status: ready for implementation
- Last updated: 2026-09-04
- Repository: `ShieldaAI/select-all-matching`
- Planned npm package: `select-all-matching`

## 1. Product decision

Build a small TypeScript library for one awkward piece of table behavior: keeping selection correct when rows are fetched page by page from a server.

The library will represent either:

- a known list of selected IDs; or
- every row in a server-defined scope, minus a small list of excluded IDs.

It will not fetch every matching ID and will not treat the current page as the complete selection.

This is worth building, but the useful part is narrow. The state machine alone is easy to copy. The project earns its place by making the edge cases explicit, providing a server contract people can trust, and showing a complete working example. If those three parts are weak, this becomes another tiny helper package with little reason to adopt it.

## 2. Problem

A table may show 50 rows while a server-side filter matches 50,000. The user expects these actions to have clear meanings:

- Select one or more visible rows.
- Move to another page without losing the earlier selection.
- Select the current page.
- Select every row matching the active server query.
- Exclude a few rows after selecting everything.
- Change the filter, tenant, dataset, or membership-changing sort without accidentally acting on the old set.
- Submit a compact bulk-action request that the server can authorize again.

Most table libraries model the IDs currently known by the client. That is enough for page selection, but it cannot faithfully represent “all 50,000 matching rows except these three” without application-specific state. TanStack Table documents that, with manual pagination, its selected-row model only includes rows present in the supplied page. MUI has an include/exclude selection model, but applications still own server-pagination cleanup, scope identity, and authorization.

The reusable problem is the selection contract, not the table UI.

## 3. Intended users

Primary users:

- TypeScript applications with server-side pagination, filtering, or search.
- React applications using TanStack Table.
- Teams implementing bulk actions such as export, archive, label, assign, or delete.

Secondary users:

- Authors of other data-grid adapters who can build on the framework-free core.
- Backend teams that want a concrete request shape and validation boundary.

The project is not aimed at simple client-only tables where the complete row set is already in memory.

## 4. Product principles

1. Selection belongs to a scope, not to a page.
2. “All matching” is represented symbolically; it is never expanded on the client.
3. Scope changes clear selection by default.
4. Late events from an old scope cannot modify a newer scope.
5. Scope tokens are opaque references, not proof of authorization.
6. The server owns query reconstruction and authorization.
7. The core is immutable, deterministic, serializable, and independent of UI or backend frameworks.
8. Counts are only called exact when the application can prove they are exact.
9. Compatibility and security claims must match automated tests.
10. Version 1 stays small enough to understand from one short guide.

## 5. Version 1 scope

Version 1 will include:

- Empty, explicit, and all-matching selection modes.
- String and safe-integer row IDs without coercing one to the other.
- Single-ID and many-ID select/deselect operations.
- Current-page select/deselect behavior based on supplied page IDs.
- Select-all-matching and clear operations.
- Safe handling of deliberate scope changes and stale page events.
- Page checkbox status.
- A versioned client-state codec.
- A versioned bulk-request codec with configurable size limits.
- A controlled React hook.
- A TanStack Table adapter tested against supported major versions.
- Small server-side interfaces for resolving and verifying opaque scopes.
- A realistic server-paginated demo.
- Unit, property, integration, abuse, packaging, and browser tests.

Explicit non-goals for version 1:

- A table or checkbox component.
- Fetching, caching, pagination, filtering, or sorting.
- Query builders, ORM adapters, database migrations, or job queues.
- An authorization framework or production token format.
- Snapshot creation or automatic live-data consistency.
- Progress tracking, retrying, or undoing a bulk job.
- Tree, group, range, or shift-click selection.
- Disabled-row policy.
- Cross-tab, collaborative, or offline synchronization.
- Vue, Svelte, MUI, AG Grid, or other adapters before real demand appears.

## 6. Domain contract

### 6.1 Terms

- **Row ID**: a stable application ID, represented as a string or safe integer.
- **Page**: the rows currently loaded by the client. It has no special meaning in stored selection state.
- **Scope**: a server-defined candidate set. It usually captures tenant, user or authorization subject, dataset, normalized filters, and search.
- **Scope key**: an opaque server-issued equality value. The client uses it only to decide whether two responses describe the same membership scope.
- **Scope token**: an opaque, expiring reference that lets the server recover the authoritative scope for a bulk action.
- **Explicit selection**: a finite list of included IDs.
- **All-matching selection**: the client's intent to target every candidate row represented by the scope, except a finite list of excluded IDs. At execution, the server intersects that intent with current action-specific authorization and eligibility.

### 6.2 Proposed state model

```ts
export type RowId = string | number;

export type SelectionScope = Readonly<{
  key: string;
  token: string;
}>;

export type SelectionState<Id extends RowId = RowId> =
  | Readonly<{
      mode: "empty";
      scopeKey: string;
    }>
  | Readonly<{
      mode: "explicit";
      scopeKey: string;
      ids: readonly Id[];
    }>
  | Readonly<{
      mode: "allMatching";
      scopeKey: string;
      scopeToken: string;
      excludedIds: readonly Id[];
    }>;
```

An application that has not loaded a scope yet keeps that loading state outside the library. Once a server scope exists, even an empty selection carries its key. This removes ambiguity when an old page response arrives later.

### 6.3 Invariants

- `explicit.ids` is never empty. Removing the last ID produces `empty`.
- ID arrays are unique and preserve first-insertion order.
- The number `1` and string `"1"` are different IDs.
- Number IDs are finite safe integers. `-0` is canonicalized to `0`.
- String IDs must be non-empty and are otherwise kept verbatim; the core does not trim or Unicode-normalize them.
- Scope keys and scope tokens are non-empty opaque strings.
- `allMatching` never requires or materializes the complete matching set as included IDs. Its exclusion list may still grow to equal the current set if a user deselects every row.
- Page IDs, cursors, totals, and display labels do not live in selection state.
- Public operations do not mutate the input state or caller-owned arrays.
- Repeated encoding of the same normalized state is deeply equal.

### 6.4 Scope identity

The server decides when two list responses have the same membership scope. Its scope identity should account for:

- tenant and authorization subject;
- resource or dataset;
- normalized filter and search;
- any permission or dataset revision required by the product's consistency policy; and
- sort or limit only when they change membership, such as “top 100 by revenue.”

It should normally ignore:

- page number;
- cursor;
- page size; and
- presentation-only sorting.

Changing to a different scope key clears the selection. There is no configurable preserve-on-change policy in version 1.

The server may renew an expired token while keeping the same scope key. An explicit token-refresh operation may then preserve exclusions. If membership semantics changed, the server must issue a new key. The library will never infer that two different keys are equivalent.

### 6.5 Commands and stale events

The primary mutation is idempotent `set selected`. Version 1 will not expose toggle; adapters must use explicit booleans so retries have a stable meaning.

Every row or page command carries the scope key from the data that produced the event:

```ts
type SelectionCommand<Id extends RowId> =
  | {
      type: "setIdsSelected";
      scopeKey: string;
      ids: readonly Id[];
      selected: boolean;
    }
  | {
      type: "selectAllMatching";
      scope: SelectionScope;
    }
  | {
      type: "refreshScopeToken";
      scope: SelectionScope;
    }
  | {
      type: "clear";
      scopeKey: string;
    };
```

Applying a command returns a result rather than silently crossing a scope boundary:

```ts
type TransitionResult<Id extends RowId> =
  | { applied: true; state: SelectionState<Id> }
  | {
      applied: false;
      reason: "scopeMismatch";
      state: SelectionState<Id>;
    };
```

A deliberate scope adoption includes the state key the caller expects to replace:

```ts
reconcileScope(state, {
  expectedScopeKey,
  nextScopeKey,
}): TransitionResult
```

If `state.scopeKey` no longer equals `expectedScopeKey`, the response itself is stale and the operation returns `scopeMismatch`. Otherwise a different `nextScopeKey` produces an empty selection in that new scope. This distinction protects both directions of the race: a stale row event cannot alter the new selection, and a late list response cannot reconcile the client back to an older scope.

The data-fetching layer must still discard responses that no longer belong to the active query. The library can compare opaque keys and expected state; it cannot know which browser request the user currently intends.

Programmer-facing constructors and commands validate IDs and scope strings at runtime and throw a documented `TypeError` for invalid direct input. External or persisted data must go through the non-throwing codecs described below. A scope mismatch is an expected concurrency result, not a programmer error, so it never throws.

An empty ID list is a valid applied no-op. Arbitrary object literals that merely resemble `SelectionState` are not supported external input; applications must create in-memory states through library factories or decode persisted values first.

### 6.6 Proposed core API

The Phase 0 API spike starts from this surface and may change names before the first release, but not the semantics:

```ts
emptySelection(scopeKey)
applySelectionCommand(state, command)
reconcileScope(state, { expectedScopeKey, nextScopeKey })
refreshScopeToken(state, scope)

setIdSelected(state, { scopeKey, id, selected })
setIdsSelected(state, { scopeKey, ids, selected })
clearSelection(state, scopeKey)
selectAllMatching(state, scope)

createSelectionView(state, scopeKey)
isIdSelected(state, scopeKey, id)
getPageSelection(state, scopeKey, pageIds)
getSelectionSummary(state)

encodeSelection(state)
decodeSelection(input, options)
toBulkSelection(state, limits)
```

`applySelectionCommand` is the authoritative mutation implementation. The named mutation helpers invoke it and return the same `TransitionResult`; they must not develop separate behavior. With the same key, `refreshScopeToken` replaces the token and preserves exclusions in all-matching mode; it is an applied no-op in empty or explicit mode because those states store no token. A different key returns `scopeMismatch`. `decodeBulkSelection` belongs to the `/server` entry point.

### 6.7 Transition rules

For a command with the current scope key:

| Current mode | Select IDs | Deselect IDs |
| --- | --- | --- |
| `empty` | Create an explicit selection | No change |
| `explicit` | Add IDs | Remove IDs; become empty when none remain |
| `allMatching` | Remove IDs from exclusions | Add IDs to exclusions |

Other transitions:

| Action | Result |
| --- | --- |
| Select all matching | Enter `allMatching` with no exclusions |
| Select all again | Keep `allMatching` and clear exclusions |
| Clear | Enter `empty` in the current scope |
| Same scope key received | Keep the selection |
| Different scope key received deliberately | Enter `empty` in the new scope |
| Old-scope row/page event received | Reject as `scopeMismatch`; keep current state |
| Late scope response with an outdated expected key | Reject as `scopeMismatch`; keep current state |
| Renew token for the same key | Replace the token and keep exclusions in `allMatching`; otherwise applied no-op |
| Renew token with a different key | Reject; caller must reconcile the scope |

“Select page” and “deselect page” are ordinary many-ID operations over eligible IDs supplied by the application. The core does not decide whether a row is disabled or selectable. UI-disabled policy stays outside the core, but any business rule that makes a row ineligible for a bulk action must be enforced by the server's resolved query or action-specific authorization.

### 6.8 Read operations

Reads are scope-aware so a newly rendered page cannot inherit checkmarks from an older scope merely because it contains the same IDs. The initial read API should cover only common decisions:

```ts
type ScopedRead<Value> =
  | { scopeMatches: true; value: Value }
  | { scopeMatches: false }

isIdSelected(state, scopeKey, id): ScopedRead<boolean>

getPageSelection(state, scopeKey, pageIds): ScopedRead<
  | "noRows"
  | "none"
  | "some"
  | "all"
>

getSelectionSummary(state):
  | { kind: "empty"; selectedCount: 0 }
  | { kind: "explicit"; selectedCount: number }
  | { kind: "allMatching"; excludedCount: number }
```

The final page-status labels are `noRows`, `none`, `some`, and `all`; `noRows` avoids confusing an empty page with empty selection state. A scope mismatch returns no value rather than treating an old page as unselected.

Read helpers evaluate only IDs the application says came from a matching page with that scope key. They cannot prove that an arbitrary ID belongs to the server scope, remains eligible, or will be authorized for an action.

For repeated row reads, `createSelectionView(state, scopeKey)` validates the scope and indexes stored IDs once in O(k). A matching view provides expected O(1) membership checks and O(p) page status, where `k` is the stored included/excluded count and `p` is page size. React and TanStack adapters memoize the view by immutable state identity.

Version 1 will not expose an unconditional exact count for all-matching state. The client usually cannot prove that `totalMatching - excludedIds.length` remains exact after inserts, deletes, permission changes, or scope expiry. A server preview can provide an authoritative execution-time count.

### 6.9 Serialization

Persisted client state uses an explicit version:

```ts
type EncodedSelectionV1<Id extends RowId> = {
  version: 1;
  scopeKey: string;
  selection:
    | { mode: "empty" }
    | { mode: "explicit"; ids: Id[] }
    | {
        mode: "allMatching";
        scopeToken: string;
        excludedIds: Id[];
      };
};
```

The codec accepts `unknown` and returns a success/error result. It does not throw for bad external input. It rejects:

- unsupported versions;
- missing, extra, or mistyped fields;
- invalid IDs;
- duplicate IDs in serialized input;
- empty explicit selections;
- empty scope values; and
- arrays over the configured limit.

Normal state operations deduplicate repeated application input. The external decoder stays strict so a malformed or non-canonical payload cannot acquire accidental meaning.

State construction and decoding have separate character limits for scope keys, scope tokens, and optionally individual string IDs. These limits do not make the bulk request authoritative; they bound client state and parsing work.

Scope tokens may expire and may be sensitive in some applications. Documentation will discourage treating encoded all-matching state as permanent local storage.

### 6.10 Bulk request

The client submits one of these shapes:

```ts
type BulkSelectionV1<Id extends RowId> =
  | {
      version: 1;
      mode: "explicit";
      ids: Id[];
    }
  | {
      version: 1;
      mode: "allMatching";
      scopeToken: string;
      excludedIds: Id[];
    };
```

Empty selection produces `null` and cannot be executed. `scopeKey` is deliberately absent: it is a client equality key, not an authority-bearing server field.

`toBulkSelection(state, limits)` is limit-aware so the client can report an oversized explicit or exclusion list before submission. Reaching a limit is an expected user-state outcome, so this function returns rather than throws:

```ts
type BulkConversionResult<Id extends RowId> =
  | { ok: true; value: BulkSelectionV1<Id> | null }
  | {
      ok: false;
      reason: "tooManyIds" | "tokenTooLong" | "idTooLong";
    };
```

The server still applies its own limits and never trusts the client's result. Bulk limits are defined in characters or item counts, not ambiguous byte estimates:

- maximum IDs in one explicit or exclusion list;
- maximum scope-token characters; and
- optional maximum characters in one string ID.

The server decoder uses the same strict version, field, ID, and duplicate rules, plus its own ID-count and token-length limits. It rejects invalid input before calling the scope resolver, authorization code, or database. It validates shape only; it does not authorize or construct a query. The HTTP layer remains responsible for request-body byte limits before JSON parsing.

An explicit request acts on the listed IDs after current per-ID authorization and eligibility checks. It is not automatically re-filtered through the list query in which the user selected those IDs. An application that requires that stronger rule needs an application-level scoped explicit request; it is not part of the version 1 wire shape.

The application decides whether unauthorized, ineligible, or missing rows make the whole action fail or are skipped. Its preview and result must follow one documented disclosure policy; the generic package does not choose that policy.

## 7. Client/server flow

1. The list endpoint receives browser filter and pagination input.
2. The server normalizes the query, applies tenant and authorization rules, and returns rows, a display total, `scopeKey`, and an action-neutral `scopeToken`.
3. The fetch layer first confirms that the response still belongs to the active request. It then reconciles the returned key using the scope key that was current when the request began.
4. Checkbox events submit IDs tagged with the page's scope key.
5. “Select all matching” stores the current scope token and an empty exclusion list.
6. The client sends a versioned bulk request for preview or execution.
7. The server parses it with explicit size limits.
8. In explicit mode, the server resolves and authorizes every ID independently.
9. In all-matching mode, the server verifies or resolves the token, checks its principal, tenant, resource, and expiry, rebuilds the query from server-owned data, authorizes the requested action, applies current eligibility rules, and subtracts exclusions.
10. The server previews or performs the action and returns an authoritative result.

The server never turns raw browser filters into a trusted bulk query. Possessing a valid scope token does not skip current authorization.

Applications must document whether all-matching means rows matching at selection time or rows matching at execution time. The library cannot manufacture snapshot semantics. The demo will use live-scope semantics and an execution-time preview so this behavior is visible. That preview is advisory: execution resolves the scope and authorizes again, so its final affected count may differ.

## 8. Package and repository design

Publish one discoverable package rather than a multi-package framework:

```text
select-all-matching
├── src
│   ├── core
│   ├── react
│   ├── tanstack
│   ├── server
│   └── index.ts
├── tests
│   ├── core
│   ├── adapters
│   ├── server-contract
│   └── package-fixtures
├── examples
│   └── tanstack-server
├── docs
└── .github
```

Planned exports:

```ts
import { ... } from "select-all-matching";
import { ... } from "select-all-matching/react";
import { ... } from "select-all-matching/tanstack";
import { ... } from "select-all-matching/server";
```

Boundaries:

- The default export contains state, transitions, predicates, and client codecs.
- `/react` contains a controlled hook and has React as an optional peer dependency.
- `/tanstack` contains translation helpers and has TanStack Table as an optional peer dependency.
- `/server` contains the bulk decoder, verifier/resolver interfaces, and a small fail-closed resolver coordinator. It contains no framework, database, token-signing, authorization, or query-building implementation.
- The example is private and is never part of the published package.

The package will have no runtime dependencies in the core. It performs no network calls, telemetry, or global registration. Any proposed production dependency needs a written reason and bundle impact before addition.

## 9. Technical baseline

Initial decisions:

- Package manager: npm.
- Language: strict TypeScript.
- Output: ESM-only, targeting ES2022, with declarations and source maps.
- Runtime CI: Node 22 and 24.
- TypeScript consumers: a declared minimum version plus the latest stable; the minimum is fixed by a package-output spike before implementation.
- React adapter: React 18.3 and 19, if both pass the same contract suite.
- TanStack adapter target: one `/tanstack` implementation across declared version 8 and 9 peer ranges, but only if the same code passes the minimum and latest version in each range without version branching. If the spike disproves that, version 1 will support one major and record the other as follow-up work instead of hiding two implementations behind one export.
- Browser smoke tests: Chromium on pull requests and release candidates. Add Firefox and WebKit gates only before making explicit compatibility claims for them.

As of 2026-09-04, npm reports TanStack React Table 9.2.4, React 19.2.8, and TypeScript 7.0.2 as latest. These are planning inputs, not compatibility claims. The supported matrix will be written from passing consumer fixtures.

Use unbundled ESM from the TypeScript compiler unless the package-output spike shows a concrete reason to bundle. Validate the actual tarball with `npm pack`, Publint, Are the Types Wrong, and small consumer projects. Do not test only source files.

## 10. Adapter design

### 10.1 React

The React layer should be controlled-first:

```ts
useSelection({
  state,
  scope,
  onStateChange,
});
```

`scope` is the currently accepted `SelectionScope`. `onStateChange` accepts a functional updater so two commands fired before the parent rerenders cannot overwrite each other:

```ts
onStateChange(updater: (previous) => SelectionState): void
```

It may return bound commands and derived page status, but the core remains the source of truth. Requirements:

- no state updates during render;
- stable callback identities where practical;
- one logical update for a page operation, not one per row;
- no lost update when two commands fire synchronously;
- correct behavior under React Strict Mode;
- safe server-side import with no `window` or DOM access; and
- no effect that silently reconciles a scope after a stale event.

If `scope.key` differs from `state.scopeKey`, the hook exposes the mismatch and rejects bound selection commands until the caller explicitly reconciles. It never decides that the new server response is the request the user still intends.

An uncontrolled convenience wrapper can wait until there is evidence it reduces real integration code without hiding scope changes.

### 10.2 TanStack Table

TanStack's `RowSelectionState` is not the authoritative state because it cannot express a server-wide symbolic selection. The adapter will derive checkbox state for loaded rows from this library and translate table events back into scoped commands.

The adapter peers on React and `@tanstack/react-table` and should depend on the smallest public surface possible. It must not rely on TanStack internals or on selected-row models containing off-page rows.

Prefer reading the application's typed ID from `row.original` and keeping this library as the source of truth. That avoids forcing the complete selection through TanStack's string-keyed `RowSelectionState`. If the compatibility spike proves that a string-key bridge is necessary, it must use reversible type-prefixed encoding and test prefixes, colons, Unicode, `1`, and `"1"`; the two values must never collide.

The demo must cover:

- explicit selections surviving page navigation;
- page header checked and indeterminate states;
- switching to all matching;
- exclusions in all-matching mode;
- filter changes clearing selection;
- presentation-only sort retaining selection; and
- an old-scope checkbox or page command being rejected after a newer scope is active.

## 11. Reference server contract

The `/server` export should define narrow interfaces rather than an implementation that appears universally safe:

```ts
interface ScopeResolver<Context, ResolvedScope> {
  resolve(input: {
    token: string;
    context: Context;
    action: string;
  }): Promise<
    | { ok: true; scope: ResolvedScope }
    | { ok: false; reason: "invalidOrExpiredScope" }
  >;
}
```

The accompanying `resolveScopeToken` coordinator calls the resolver only for a valid all-matching request, preserves the typed context and requested action, and returns either the resolved scope, `invalidOrExpiredScope`, or a non-detailed `resolverFailure`. It never substitutes browser filters, page IDs, or a default scope. Applications still own authorization and query execution.

The example server will use a short-lived random handle backed by an in-memory store. The stored record contains the canonical filter, principal, tenant, resource, consistency mode, and expiry. The token identifies a scope but is action-neutral; `resolve` receives the requested action and the example rechecks that action at execution. This is a demonstration, not a prescribed production token system.

Package contract tests cover only behavior the package owns:

- strict parsing and configured limits;
- no resolver call after invalid input;
- unchanged propagation of token, typed context, and action;
- one coarse external result for invalid or expired scope; and
- conversion of a thrown resolver error into an internal failure, with no fallback behavior.

The reference demo's abuse tests must prove its application behavior:

- malformed, changed, unknown, and expired tokens fail closed;
- a token from one principal or tenant cannot be replayed by another;
- permission revocation after token creation blocks execution;
- valid tokens do not bypass action-specific authorization;
- browser filters are ignored during bulk execution;
- explicit IDs are independently authorized and tenant-scoped;
- exclusions can only subtract rows;
- unauthorized and nonexistent explicit IDs follow the same documented external error or omission policy, and responses do not identify which submitted IDs fell into either group;
- oversized arrays and tokens are rejected before resolver, authorization, or database work; and
- resolver failure never falls back to visible-page IDs or untrusted filters.

## 12. Demo

Build one realistic example, not several toy snippets.

The example will contain:

- a deterministic in-memory dataset of roughly 23,000 rows;
- server-side search, filtering, sorting, and cursor or page pagination;
- a React table using TanStack Table;
- labelled, keyboard-operable row and header checkboxes with a correct indeterminate state;
- visible scope key changes in a developer panel;
- page selection and selection across pages;
- “select all matching” followed by exclusions;
- a compact request preview;
- a server-authoritative affected-row preview;
- scope expiry and refresh;
- a filter-change warning and automatic clear;
- simulated slow responses to show fetch-layer response discarding and the core's separate rejection of old-scope commands; and
- a harmless bulk action, such as adding a label, instead of destructive deletion.

The demo should make the protocol inspectable in browser developer tools. It must not imply that its in-memory token store is production infrastructure. Its preview is advisory under live-scope semantics, and the execute endpoint always resolves and authorizes again.

## 13. Test strategy

### 13.1 Example-based tests

Cover the full transition table and these edge cases:

- empty, one-ID, and many-ID states;
- repeated selects and deselects;
- empty many-ID commands as applied no-ops;
- duplicate, reordered, and empty page ID arrays;
- removing the last explicit ID;
- selecting all after an explicit selection;
- selecting all again after exclusions exist;
- reselecting an excluded ID;
- page navigation within one scope;
- tenant, dataset, filter, and membership-changing sort changes;
- presentation-only sort with the same scope key;
- a late old-scope row or page action;
- a late scope response whose expected key is no longer current;
- the same row ID appearing in two scopes without leaking read state across them;
- same-key token renewal and different-key rejection;
- inserted and removed rows under documented live-scope behavior;
- IDs such as `0`, `-0`, negative safe integers, `"0"`, `"__proto__"`, whitespace, emoji, and combining Unicode, plus rejection of `""`;
- invalid versions, modes, fields, IDs, tokens, and oversized arrays; and
- ID lists and key, token, and string-ID lengths exactly at each configured limit and one item or character over it.

Direct programmer APIs must throw the documented `TypeError` for invalid IDs or scope strings. External codecs must return errors for the same values without throwing.

### 13.2 Property-based tests

Use a finite-universe `Set` model as an oracle. Generate scopes, IDs, duplicate page arrays, and sequences of roughly 1–200 commands. Required properties:

- the implementation matches the reference model after every command;
- setting selected true or false is idempotent;
- selecting or deselecting page unions is associative;
- page permutations and duplicates do not change meaning;
- all-matching membership equals the reference universe minus exclusions;
- a deliberate scope change always clears;
- an old-scope command never alters the current scope;
- a late reconcile with an outdated expected key never alters the current scope;
- serialize then parse preserves semantic state;
- repeatedly encoding the same normalized state produces deeply equal output;
- arbitrary JSON-compatible input never crashes the parser;
- accepted decoded values satisfy every invariant; and
- public operations do not mutate frozen inputs.

Failed random seeds and shrink paths must be printed and promoted to regression fixtures when they reveal a bug.

The reference server model adds generated inserts and removals for live scopes. Newly matching rows are included by all-matching execution, removed rows are no longer targeted, explicit mode never invents a missing row, and exclusions only subtract from the execution-time authorized universe.

### 13.3 Adapter and browser tests

- Every declared React/TanStack version tuple, including the minimum and latest version in each peer range. React fixtures cover Strict Mode and two synchronous commands before a parent rerender; the TanStack adapter uses one implementation with no major-version branch.
- Safe SSR imports for every subpath.
- Page checkbox behavior using real table rows.
- Checkbox names, keyboard operation, and indeterminate state in the demo.
- A packed-package Vite consumer.
- An automated Chromium smoke test in the release-candidate workflow.
- Typed-ID edge cases for any row-key codec the compatibility spike proves necessary.

### 13.4 Packaging and type tests

- Import every public subpath from the packed tarball.
- Import every public subpath from a plain Node ESM consumer on Node 22 and 24, catching extensionless or invalid relative imports.
- Compile consumers with the declared minimum and latest TypeScript.
- Confirm optional peers are not pulled into core consumers.
- Check exports, declaration paths, tree shaking, license, README, and package contents.
- Run Publint and Are the Types Wrong.
- Record the core's minified and gzipped size. Start with a 5 KB target, then enforce the measured budget once the public API settles.

### 13.5 Complexity checks

The important bound is independence from the total number of matching rows:

- `selectAllMatching` and `clear` are O(1).
- Serialization is O(k), where `k` is stored included or excluded IDs.
- Page operations are at worst O(k + p), where `p` is page size.
- Creating a selection view is O(k); its membership reads are expected O(1) and page reads are O(p).
- Nothing allocates or loops over the server's total matching count.

Benchmark 10 versus one billion conceptual matches, 10,000 stored IDs, 100-row page operations, 100,000 indexed-view membership checks, and payload-limit parsing. Keep wall-clock benchmarks informational until CI produces a stable baseline; enforce asymptotic behavior and package size immediately.

### 13.6 Pull-request gate

Every pull request must pass:

- strict typecheck;
- lint and formatting checks;
- unit and transition tests;
- property tests with fixed regression seeds and fresh generated cases;
- parser fuzz/property tests;
- adapter integration tests;
- build and packed-package consumer tests; and
- at least 95% branch coverage in the core state machine and codecs.

Documentation examples must compile. A behavior change must update its contract text and tests in the same pull request.

## 14. Documentation plan

Required documents:

- `README.md`: the problem, a small example, install command, scope-change behavior, and links to deeper guides.
- `docs/semantics.md`: state model, transition table, page behavior, stale responses, and count semantics.
- `docs/server-contract.md`: request format, authoritative query reconstruction, authorization, expiry, and live versus snapshot behavior.
- `docs/react.md`: controlled hook integration.
- `docs/tanstack-table.md`: complete table wiring for supported versions.
- `docs/migration.md`: breaking changes and serialized-format migrations once needed.
- `SECURITY.md`: reporting route and a clear boundary between library validation and application authorization.
- `CONTRIBUTING.md`: local commands, test expectations, and API-change process.
- `CHANGELOG.md`: user-visible changes from the first prerelease onward.

Writing rules:

- Use the terms people search for: server-side pagination, select all rows, select all filtered rows, bulk actions, TanStack row selection, exclusions.
- State limitations next to examples that cross the client/server boundary.
- Do not claim “secure,” “production-ready,” framework compatibility, or performance without a named test or boundary.
- Avoid generic launch language and inflated comparisons.

## 15. Delivery phases

Estimates are focused engineering time for one experienced contributor. They are planning ranges, not calendar promises.

### Phase 0: freeze semantics and prove packaging — 1–2 days

Work:

- Write the semantic contract and transition table.
- Confirm stale-command and token-refresh behavior with executable API sketches.
- Decide the minimum TypeScript version from consumer fixtures.
- Prove ESM subpath exports, declarations, optional peers, and tree shaking from an `npm pack` tarball.
- Test the smallest TanStack adapter shape against versions 8 and 9.
- Write the initial threat model.

Exit criteria:

- Every public state/action combination has an enumerated expected result and a planned contract-test case; unresolved questions are recorded as release blockers.
- A tiny packed spike imports correctly from every planned subpath.
- The support matrix reflects passing fixtures rather than package-version guesses.

### Phase 1: repository scaffold and CI — 1 day

Work:

- Add package metadata, TypeScript configuration, tests, lint/format configuration, and npm scripts.
- Add CI for Node 22 and 24.
- Add coverage, package-validation, and dependency-review checks.
- Add contribution, security, and changelog files.

Exit criteria:

- A clean checkout can install, typecheck, test, build, and validate a tarball with documented commands.
- The initial CI matrix is green.

### Phase 2: core and codecs — 2–3 days

Work:

- Implement normalized state creation and ID validation.
- Implement scoped commands and transition results.
- Implement membership, page status, summary, and bulk conversion.
- Implement strict version 1 state and bulk encode/decode functions, including the decoder-only `/server` export.
- Add transition, edge-case, property, mutation-safety, and parser tests.
- Record complexity and package-size baselines.

Exit criteria:

- The published core contract is covered through public APIs.
- Core branch coverage is at least 95%.
- No operation depends on total matching rows.
- The packed core has zero runtime dependencies.
- Wire version 1 is reviewed and frozen before any `0.1.0` publish. Once published, incompatible changes require a new wire version even while the npm package remains `0.x`.

### Phase 3: React and TanStack adapters — 1–2 days

Work:

- Implement the controlled React hook.
- Implement loaded-row and header-checkbox translation for TanStack.
- Handle typed row-key encoding without collisions only if the compatibility spike shows that a row-key bridge is necessary.
- Run React and TanStack compatibility fixtures and SSR imports.
- Add adapter documentation with compiling examples.

Exit criteria:

- Explicit, page, all-matching, exclusion, and scope-change flows pass against real table instances.
- Every advertised framework version is continuously tested.

### Phase 4: server contract and demo — 2–3 days

Work:

- Implement the resolver interfaces and fail-closed coordinator on top of the Phase 2 bulk decoder.
- Build the reference scope store and list/bulk endpoints.
- Build the interactive server-paginated table.
- Add preview, expiry, permission-change, and stale-response scenarios.
- Add the abuse and browser suites.

Exit criteria:

- The demo exercises every selection mode without loading every matching ID.
- The package contract suite and reference demo abuse suite pass at their documented boundaries.
- README code runs against the packed package.

### Phase 5: hardening and beta — 2–3 days

Work:

- Review names and error messages from a consumer's point of view.
- Finish documentation and API reference.
- Validate license, exports, provenance setup, package contents, and release notes.
- Publish a prerelease only after explicit approval.

Exit criteria:

- No known open release-blocking correctness or trust-boundary issue remains, based on tracked tests, threat-model findings, and review.
- Versioned serialization has an explicit compatibility policy.
- A documented clean-project usability exercise can install the tarball, compile the quick start, and perform a selection flow without reading source code.

### Phase 6: external beta and version 1

Work:

- Get one external application through the full beta integration and seek a second independent user.
- Record setup friction and missing primitives instead of adding speculative adapters.
- Make breaking API corrections while still on `0.x`.
- Review every exported name for semver durability while preserving the already-published wire version.

Version 1 exit criteria:

- At least one real server-paginated application has used every selection mode; two external users are preferred.
- The public API is deliberately frozen and the already-published version 1 wire shapes remain unchanged.
- No known open release-blocking correctness or trust-boundary issue remains, based on tracked tests, threat-model findings, and review.
- The compatibility, browser, packaging, and documentation suites are green from the release tarball.

Expected implementation effort through beta readiness: roughly 10–15 focused days, followed by real-user feedback time.

## 16. Initial issue backlog

Create issues in this order; work that can run in parallel is marked after its dependency.

1. Freeze version 1 semantics, transitions, and terminology.
2. Run package-output and TanStack 8/9 compatibility spikes.
3. Add TypeScript, test, lint, build, and CI scaffold. Depends on 2.
4. Implement core states and scoped transitions. Depends on 1 and 3.
5. Implement strict state and bulk codecs. Depends on 4.
6. Add reference-model property suite and parser fuzz suite. Starts with 4.
7. Implement controlled React hook. Depends on 4.
8. Implement TanStack adapter and compatibility fixtures. Depends on 2, 4, and 7.
9. Define server resolver contract and abuse harness. Depends on 5.
10. Build the end-to-end demo. Depends on 8 and 9.
11. Write quick start, semantics, server, and adapter guides. Starts with 4; finishes after 10.
12. Validate packed consumers, Chromium smoke tests, and package size. Depends on 5–10.
13. Prepare prerelease workflow and checklist. Depends on 12.
14. Run external beta and resolve API feedback before `1.0.0`.

Every implementation issue should include its observable behavior, public API impact, tests, documentation change, and explicit out-of-scope items.

## 17. Release plan

Suggested sequence:

- `0.1.0`: core state machine, state codecs, and decoder-only `/server` bulk codec.
- `0.2.0`: React and TanStack adapters plus the server contract and demo.
- `0.9.0`: API-frozen beta for external integrations.
- `1.0.0`: stable public API after beta evidence; wire version 1 was already frozen at its first `0.x` publication.

Before the first publish:

- Recheck that the unscoped npm name `select-all-matching` is available. It was unclaimed when checked on 2026-09-04, but that is not a reservation.
- Enable npm two-factor authentication and claim the name with the smallest correct package.
- Configure npm trusted publishing from GitHub Actions using OIDC and provenance.
- Restrict releases to reviewed tags or a manual release workflow from the protected default branch.
- Inspect the tarball and install it into fresh consumer fixtures before publishing.

Do not publish, tag, push, or change remote settings as part of ordinary implementation work without explicit approval.

## 18. Adoption with little ongoing promotion

The project should be easy to find at the moment a developer searches for the exact problem:

- Keep the repository and npm package names identical.
- Use a plain one-sentence GitHub and npm description.
- Add accurate npm keywords and GitHub topics for server pagination, row selection, bulk actions, React, and TanStack Table.
- Put the working demo and compact wire payload near the top of the README.
- Publish complete, indexable examples for the exact search phrases developers use.
- After a usable release exists, add a relevant answer to long-lived TanStack discussions or issues where maintainers permit solution links.
- Submit the library to a relevant ecosystem/resource page if it accepts community tools.
- Make one factual launch post with the demo; do not build a content schedule around it.

A new repository will not be picked up reliably by LLMs simply because it belongs to an older organization. Public documentation, npm metadata, links from relevant discussions, real dependents, and ordinary search indexing are the signals that can make it discoverable over time. This plan does not depend on LLM discovery.

## 19. Success and stop criteria

Technical success:

- The demo proves all-matching selection without fetching all IDs.
- Scoped commands and expected-key reconciliation cannot apply an old event to newer state, and the demo discards inactive network responses before reconciliation.
- The server example demonstrates reauthorization and fails closed.
- Consumers can install the tarball and integrate it without copying internal code.

Adoption evidence:

- At least one external developer completes an integration before version 1; seek a second independent validation.
- Within roughly 90 days of a stable release, aim for five verifiable external users or dependents. npm downloads and stars are supporting signals, not proof that the problem is solved.
- Issues and examples show that users understand scope and authorization without repeated maintainer explanation.

Pause or narrow the project if:

- no external application completes a beta integration after targeted distribution to relevant communities;
- integrations need more glue than a small local state machine would;
- most demand is for a full table component rather than a headless contract; or
- maintaining framework compatibility costs more than the core problem justifies.

If the core is useful but adapters create most of the burden, keep the core stable and move adapters to community ownership or separate repositories only after actual demand.

## 20. Main risks

| Risk | Response |
| --- | --- |
| The core is easy to reimplement | Win on precise semantics, codecs, tests, server guidance, and the working demo. Keep the API smaller than a custom implementation. |
| Scope tokens are mistaken for authorization | Repeat the boundary in types, docs, examples, and abuse tests. Never ship a helper named as if it “authorizes” a request. |
| Live datasets make counts or membership drift | Do not promise snapshots or exact client counts. Use server preview and document execution-time semantics. |
| Framework releases create maintenance churn | Depend on small public surfaces and claim only versions continuously tested from packed fixtures. |
| Numeric and string IDs collide in adapters | Preserve typed IDs from `row.original`; if a string-key bridge is required, use and test a reversible encoding. |
| A stale response changes a newer selection | Require action scope keys and expected-key reconciliation, and make the fetch layer discard responses for inactive requests. |
| Large exclusion lists become a denial-of-service vector | Require server limits and reject oversized input before expensive verification. |
| Feature requests turn it into a data grid | Keep the non-goals visible and add integrations only after a real example proves repeated need. |
| The npm name is taken before release | Recheck before publish; fall back to `@shielda-ai/select-all-matching` without changing the repository concept. |

## 21. Maintenance policy

- Use semantic versioning. During `0.x`, document public API breaks plainly. Preserve every published versioned wire shape from its first release; an incompatible encoding change always gets a new wire version.
- Support only the runtime and framework versions present in CI.
- Add a regression test before fixing a reported behavior bug.
- Review dependencies and compatibility at least quarterly, even if no features are planned.
- Keep runtime dependencies at zero unless a documented exception is approved.
- Treat serialized-format changes as protocol changes, not implementation details.
- Prefer issue-backed, demand-driven adapters over a broad integration matrix.
- Provide no implied SLA; document the maintenance level honestly.

## 22. Definition of done for the project

The initial project is complete when all of the following are true:

- The semantic contract, transition table, and implementation agree.
- Core, React, TanStack, and server entry points work from the packed npm artifact.
- The demo covers explicit, page, all-matching, exclusion, scope-change, token-expiry, and stale-response flows.
- The authorization boundary and live-versus-snapshot choice are clear in the README and server guide.
- Unit, property, abuse, adapter, browser, type, packaging, and size checks pass.
- The version 1 codec and bulk wire shapes are frozen deliberately.
- At least one external application has completed a real integration.
- Release automation can publish with provenance after an approved tag.

Anything beyond that is maintenance or a new, evidence-backed product decision.

## 23. Research references

- [TanStack Table v8 row selection guide](https://tanstack.com/table/v8/docs/guide/row-selection): manual-pagination selected-row models contain only supplied page rows, while row-selection state may hold IDs not present in the current data.
- [TanStack Table v9 migration guide](https://tanstack.com/table/latest/docs/framework/react/guide/migrating): current module and API changes that the adapter compatibility spike must account for.
- [MUI Data Grid row selection](https://mui.com/x/react-data-grid/row-selection/): include/exclude selection models and server-pagination selection behavior.
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/): OIDC-based publishing requirements and workflow guidance.
- [npm provenance statements](https://docs.npmjs.com/generating-provenance-statements/): package provenance behavior and release setup.
