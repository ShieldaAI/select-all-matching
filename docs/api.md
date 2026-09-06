# API reference

Import state, reads, and transfer codecs from `select-all-matching`. Import the untrusted bulk
decoder from `select-all-matching/server`. All ID-generic functions preserve `Id extends RowId`,
where `RowId = string | number`.

## State and context

`SelectionState<Id>` has three modes: `empty`, `explicit` with `ids`, or `allMatching` with
`scopeToken` and `excludedIds`. All modes have `scopeKey` and `scopeRevision`. States and their
arrays are frozen. Only states created by the current package instance are accepted.

`SelectionContext` is `{ scopeKey: string; scopeRevision: number }`.
`AllMatchingScope` adds `scopeToken: string`. Keys and tokens must be nonempty strings. Revisions
must be nonnegative safe integers. IDs must be nonempty strings or safe integers; `-0` becomes
`0`, and string/number identity is preserved.

## Create and change selection

| Function                       | Arguments after `state`                           | Behavior                                                                                 |
| ------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `emptySelection<Id>(scopeKey)` | No state argument                                 | Create empty state at revision 0.                                                        |
| `setIdSelected`                | `{ context, id, selected }`                       | Select or deselect one ID.                                                               |
| `setIdsSelected`               | `{ context, ids, selected }`                      | Apply a page or ID list in one transition.                                               |
| `selectAllMatching`            | `{ scopeKey, scopeRevision, scopeToken }`         | Store a scope with no exclusions. Repeated calls preserve existing exclusions and token. |
| `refreshScopeToken`            | `{ context, expectedScopeToken, nextScopeToken }` | Replace the expected token without changing exclusions.                                  |
| `clearSelection`               | `context`                                         | Clear within the current scope.                                                          |
| `reconcileScope`               | `{ expected, nextScopeKey }`                      | For a new key, clear and increment revision. Same key is a no-op.                        |
| `applySelectionCommand`        | `command`                                         | Dispatch the command union below.                                                        |

Except `emptySelection`, each function returns `TransitionResult<Id>`:

```ts
type TransitionResult<Id extends RowId> =
  | { applied: true; state: SelectionState<Id> }
  | { applied: false; reason: "staleScope" | "staleToken"; state: SelectionState<Id> };
```

No-op transitions are applied and keep the original state reference. Duplicate direct-API IDs
are removed in first-insertion order. Invalid arguments throw `TypeError`. Revision exhaustion
also throws; revisiting the same scope key at the maximum revision remains a no-op.

`SelectionCommand<Id>` supports `type: "setIdsSelected"`, `"selectAllMatching"`,
`"refreshScopeToken"`, and `"clear"`. Their corresponding types are `SetIdsSelectedCommand`,
`SelectAllMatchingCommand`, `RefreshScopeTokenCommand`, and `ClearSelectionCommand`.
Commands carry the same fields as the helpers, except select-all carries them inside `scope`.
The exported helper inputs are `SetIdSelectedInput<Id>`, `SetIdsSelectedInput<Id>`,
`ReconcileScopeInput`, and `RefreshScopeTokenInput`. Select-all uses `AllMatchingScope`;
clear uses `SelectionContext`.

## Read selection

| Function                                    | Result                          |
| ------------------------------------------- | ------------------------------- |
| `isIdSelected(state, context, id)`          | `ScopedRead<boolean>`           |
| `getPageSelection(state, context, pageIds)` | `ScopedRead<PageSelection>`     |
| `createSelectionView(state, context)`       | `ScopedRead<SelectionView<Id>>` |
| `summarizeSelectionState(state)`            | `SelectionStateSummary`         |

`ScopedRead<T>` is `{ scopeMatches: true; value: T } | { scopeMatches: false }`.
A `SelectionView` exposes `isIdSelected(id)` and `getPageSelection(pageIds)` without another
context argument. Build it once per state/context to index the stored IDs. Rebuild it after changes.

`PageSelection` is `"noRows" | "none" | "some" | "all"`. Deduplicated empty pages return
`noRows`. Callers supply IDs from the stated scope and omit disabled rows.

A summary is `{ kind: "empty", selectedCount: 0 }`, `{ kind: "explicit", selectedCount }`, or
`{ kind: "allMatching", excludedCount }`. Only the server can determine an authoritative
all-matching count.

## Encode and decode

| Function                               | Input                      | Success                                             |
| -------------------------------------- | -------------------------- | --------------------------------------------------- |
| `encodeSelection(state)`               | Current runtime state      | `EncodedSelection<Id>`, version 1                   |
| `decodeSelection(input, options?)`     | `unknown`, versions 0 or 1 | Runtime `SelectionState<Id>`                        |
| `toBulkSelection(state, limits?)`      | Current runtime state      | `BulkSelection<Id>`, version 1, or `null` for empty |
| `decodeBulkSelection(input, options?)` | `unknown`, versions 0 or 1 | `BulkSelection<Id>`, normalized to version 1        |

`encodeSelection` returns the value directly. It copies arrays but imposes no endpoint size
limit. Decode with limits large enough to accept it when round-tripping large in-memory states.
Encoded state may contain a sensitive token; see [transfer and restore](./client-guide.md#transfer-and-restore).

Both decoders return `PayloadDecodeResult<T>`:

```ts
{ ok: true, value: T }
{ ok: false, error: { code: PayloadErrorCode, path: string, decoderCode?: string } }
```

`toBulkSelection` returns `BulkConversionResult<Id>`: either `{ ok: true, value }` or
`{ ok: false, reason: "tooManyIds" | "tokenTooLong" | "idTooLong" }`.

Decoder options accept `limits` and optional `decodeId`. Without an ID decoder, output IDs are
`RowId`. Narrow or branded IDs require an `IdDecoder<Id>` returning
`DecodeResult<Id>`: `{ ok: true, value }` or `{ ok: false, code }`.
The decoder cannot change the ID's wire value. Callback exceptions or invalid results reject
the ID. Application diagnostic codes must be short, safe identifiers unrelated to the input.

Option types are `SelectionDecodeOptions`, `TypedSelectionDecodeOptions<Id>`,
`BulkDecodeOptions`, and `TypedBulkDecodeOptions<Id>`; bulk options are exported from `/server`.
Deprecated `Draft` types describe version 0 only. See [upgrading the beta](./versioning.md#wire-protocol-and-encoded-state).

## Limits and failures

| Limit                                    | Default |
| ---------------------------------------- | ------: |
| `maxIds`                                 |  10,000 |
| `maxStringIdBytes`                       |   1,024 |
| `maxScopeTokenBytes`                     |   4,096 |
| `maxScopeKeyBytes` (state decoding only) |     512 |

`DEFAULT_BULK_LIMITS` and `DEFAULT_STATE_DECODE_LIMITS` are frozen constants.
`BulkLimits` and `StateDecodeLimits` describe them; options accept partial overrides.
All limit values must be positive safe integers. Strings are measured in UTF-8 bytes.
These checks do not replace an HTTP body-size limit.

| Situation                                         | Outcome                                      |
| ------------------------------------------------- | -------------------------------------------- |
| Invalid direct API input or codec options         | Throws `TypeError`                           |
| Old query context or rotated token                | Unchanged state and a rejected transition    |
| Malformed external payload                        | `ok: false` with `PayloadError`              |
| Valid state exceeding endpoint limits             | `ok: false` with a conversion reason         |
| Valid payload but expired token or revoked access | Application server decides; outside decoding |

`PayloadErrorCode` includes `invalidType`, `missingField`, `unexpectedField`,
`unsupportedVersion`, `invalidMode`, `invalidValue`, `stringTooLong`, `tooManyIds`,
`emptyExplicitSelection`, `invalidId`, `duplicateId`, and `invalidPayload`.
Control flow should use codes, not diagnostic paths or exception messages.
