import type {
  AllMatchingScope,
  ReconcileScopeInput,
  RefreshScopeTokenInput,
  RowId,
  SelectionCommand,
  SelectionContext,
  SelectionState,
  SetIdSelectedInput,
  SetIdsSelectedInput,
  TransitionFailureReason,
  TransitionResult,
} from "./types.js";
import { normalizedSelection } from "./types.js";
import {
  assertBoolean,
  assertNonEmptyString,
  assertObject,
  normalizeContext,
  normalizeRowId,
  normalizeRowIds,
  normalizeScopeRevision,
} from "./validation.js";

export type NormalizedSelectionInput<Id extends RowId = RowId> =
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
    }>;

function freezeState<Id extends RowId>(
  value:
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
      },
): SelectionState<Id> {
  Object.defineProperty(value, normalizedSelection, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  return Object.freeze(value) as SelectionState<Id>;
}

/** Internal guard for every public operation that consumes package-owned state. */
export function assertNormalizedSelection<Id extends RowId>(
  value: SelectionState<Id>,
  name = "state",
): void {
  if (
    typeof value !== "object" ||
    value === null ||
    !Object.isFrozen(value) ||
    !Object.prototype.hasOwnProperty.call(value, normalizedSelection) ||
    (value as { [normalizedSelection]?: unknown })[normalizedSelection] !== true
  ) {
    throw new TypeError(`${name} must be a SelectionState created by this package`);
  }
}

function emptyAt<Id extends RowId>(scopeKey: string, scopeRevision: number): SelectionState<Id> {
  return freezeState({ mode: "empty", scopeKey, scopeRevision });
}

function explicitAt<Id extends RowId>(
  scopeKey: string,
  scopeRevision: number,
  ids: readonly Id[],
): SelectionState<Id> {
  return ids.length === 0
    ? emptyAt(scopeKey, scopeRevision)
    : freezeState({ mode: "explicit", scopeKey, scopeRevision, ids });
}

function allMatchingAt<Id extends RowId>(
  scopeKey: string,
  scopeRevision: number,
  scopeToken: string,
  excludedIds: readonly Id[],
): SelectionState<Id> {
  return freezeState({
    mode: "allMatching",
    scopeKey,
    scopeRevision,
    scopeToken,
    excludedIds,
  });
}

/**
 * Internal construction boundary used by trusted package codecs. It is exported
 * from this module for package-internal imports, but omitted from the public
 * core barrel.
 */
export function createNormalizedSelection<Id extends RowId = RowId>(
  input: NormalizedSelectionInput<Id>,
): SelectionState<Id> {
  assertObject(input, "selection");

  const scopeKey = input.scopeKey;
  const rawScopeRevision = input.scopeRevision;
  assertNonEmptyString(scopeKey, "selection.scopeKey");
  const scopeRevision = normalizeScopeRevision(rawScopeRevision, "selection.scopeRevision");

  switch (input.mode) {
    case "empty":
      return emptyAt(scopeKey, scopeRevision);
    case "explicit":
      return explicitAt(scopeKey, scopeRevision, normalizeRowIds(input.ids, "selection.ids"));
    case "allMatching": {
      const scopeToken = input.scopeToken;
      assertNonEmptyString(scopeToken, "selection.scopeToken");
      return allMatchingAt(
        scopeKey,
        scopeRevision,
        scopeToken,
        normalizeRowIds(input.excludedIds, "selection.excludedIds"),
      );
    }
    default:
      throw new TypeError("selection.mode must be empty, explicit, or allMatching");
  }
}

export function emptySelection<Id extends RowId = RowId>(scopeKey: string): SelectionState<Id> {
  assertNonEmptyString(scopeKey, "scopeKey");
  return emptyAt(scopeKey, 0);
}

function contextMatches<Id extends RowId>(
  state: SelectionState<Id>,
  context: SelectionContext,
): boolean {
  return state.scopeKey === context.scopeKey && state.scopeRevision === context.scopeRevision;
}

function applied<Id extends RowId>(state: SelectionState<Id>): TransitionResult<Id> {
  return Object.freeze({ applied: true, state });
}

function rejected<Id extends RowId>(
  reason: TransitionFailureReason,
  state: SelectionState<Id>,
): TransitionResult<Id> {
  return Object.freeze({ applied: false, reason, state });
}

function stableUnion<Id extends RowId>(
  current: readonly Id[],
  additions: readonly Id[],
): readonly Id[] {
  if (additions.length === 0) {
    return current;
  }

  const seen = new Set<RowId>(current);
  let result: Id[] | undefined;

  for (const id of additions) {
    if (!seen.has(id)) {
      seen.add(id);
      result ??= [...current];
      result.push(id);
    }
  }

  return result === undefined ? current : Object.freeze(result);
}

function stableSubtract<Id extends RowId>(
  current: readonly Id[],
  removals: readonly Id[],
): readonly Id[] {
  if (current.length === 0 || removals.length === 0) {
    return current;
  }

  const removed = new Set<RowId>(removals);
  if (!current.some((id) => removed.has(id))) {
    return current;
  }

  return Object.freeze(current.filter((id) => !removed.has(id)));
}

function applySetIdsSelected<Id extends RowId>(
  state: SelectionState<Id>,
  context: SelectionContext,
  ids: readonly Id[],
  selected: boolean,
): TransitionResult<Id> {
  if (!contextMatches(state, context)) {
    return rejected("staleScope", state);
  }

  if (ids.length === 0) {
    return applied(state);
  }

  if (state.mode === "empty") {
    return selected
      ? applied(explicitAt(state.scopeKey, state.scopeRevision, ids))
      : applied(state);
  }

  if (state.mode === "explicit") {
    const nextIds = selected ? stableUnion(state.ids, ids) : stableSubtract(state.ids, ids);

    if (nextIds === state.ids) {
      return applied(state);
    }

    return applied(explicitAt(state.scopeKey, state.scopeRevision, nextIds));
  }

  const nextExcludedIds = selected
    ? stableSubtract(state.excludedIds, ids)
    : stableUnion(state.excludedIds, ids);

  if (nextExcludedIds === state.excludedIds) {
    return applied(state);
  }

  return applied(
    allMatchingAt(state.scopeKey, state.scopeRevision, state.scopeToken, nextExcludedIds),
  );
}

function applySelectAllMatching<Id extends RowId>(
  state: SelectionState<Id>,
  scope: AllMatchingScope,
): TransitionResult<Id> {
  if (!contextMatches(state, scope)) {
    return rejected("staleScope", state);
  }

  if (state.mode === "allMatching") {
    if (state.excludedIds.length === 0) {
      return applied(state);
    }

    return applied(
      allMatchingAt(
        state.scopeKey,
        state.scopeRevision,
        state.scopeToken,
        Object.freeze([] as Id[]),
      ),
    );
  }

  return applied(
    allMatchingAt(state.scopeKey, state.scopeRevision, scope.scopeToken, Object.freeze([] as Id[])),
  );
}

function applyRefreshScopeToken<Id extends RowId>(
  state: SelectionState<Id>,
  context: SelectionContext,
  expectedScopeToken: string,
  nextScopeToken: string,
): TransitionResult<Id> {
  if (!contextMatches(state, context)) {
    return rejected("staleScope", state);
  }

  if (state.mode !== "allMatching") {
    return applied(state);
  }

  if (state.scopeToken !== expectedScopeToken) {
    return rejected("staleToken", state);
  }

  if (state.scopeToken === nextScopeToken) {
    return applied(state);
  }

  return applied(
    allMatchingAt(state.scopeKey, state.scopeRevision, nextScopeToken, state.excludedIds),
  );
}

function applyClear<Id extends RowId>(
  state: SelectionState<Id>,
  context: SelectionContext,
): TransitionResult<Id> {
  if (!contextMatches(state, context)) {
    return rejected("staleScope", state);
  }

  return state.mode === "empty"
    ? applied(state)
    : applied(emptyAt(state.scopeKey, state.scopeRevision));
}

export function applySelectionCommand<Id extends RowId>(
  state: SelectionState<Id>,
  command: SelectionCommand<NoInfer<Id>>,
): TransitionResult<Id> {
  assertNormalizedSelection(state);
  assertObject(command, "command");

  switch (command.type) {
    case "setIdsSelected": {
      const rawContext = command.context;
      const rawIds = command.ids;
      const selected = command.selected;
      const context = normalizeContext(rawContext, "command.context");
      const ids = normalizeRowIds(rawIds, "command.ids");
      assertBoolean(selected, "command.selected");
      return applySetIdsSelected(state, context, ids, selected);
    }
    case "selectAllMatching": {
      const scope = command.scope;
      const rawScopeToken = scope.scopeToken;
      const context = normalizeContext(scope, "command.scope");
      assertNonEmptyString(rawScopeToken, "command.scope.scopeToken");
      return applySelectAllMatching(state, {
        ...context,
        scopeToken: rawScopeToken,
      });
    }
    case "refreshScopeToken": {
      const rawContext = command.context;
      const expectedScopeToken = command.expectedScopeToken;
      const nextScopeToken = command.nextScopeToken;
      const context = normalizeContext(rawContext, "command.context");
      assertNonEmptyString(expectedScopeToken, "command.expectedScopeToken");
      assertNonEmptyString(nextScopeToken, "command.nextScopeToken");
      return applyRefreshScopeToken(state, context, expectedScopeToken, nextScopeToken);
    }
    case "clear": {
      const rawContext = command.context;
      return applyClear(state, normalizeContext(rawContext, "command.context"));
    }
    default:
      throw new TypeError("command.type is not supported");
  }
}

export function reconcileScope<Id extends RowId>(
  state: SelectionState<Id>,
  input: ReconcileScopeInput,
): TransitionResult<Id> {
  assertNormalizedSelection(state);
  assertObject(input, "input");

  const rawExpected = input.expected;
  const nextScopeKey = input.nextScopeKey;
  const expected = normalizeContext(rawExpected, "input.expected");
  assertNonEmptyString(nextScopeKey, "input.nextScopeKey");

  if (!contextMatches(state, expected)) {
    return rejected("staleScope", state);
  }

  if (state.scopeKey === nextScopeKey) {
    return applied(state);
  }

  if (state.scopeRevision === Number.MAX_SAFE_INTEGER) {
    throw new TypeError("scopeRevision cannot be incremented beyond Number.MAX_SAFE_INTEGER");
  }

  return applied(emptyAt(nextScopeKey, state.scopeRevision + 1));
}

export function refreshScopeToken<Id extends RowId>(
  state: SelectionState<Id>,
  input: RefreshScopeTokenInput,
): TransitionResult<Id> {
  assertObject(input, "input");
  return applySelectionCommand(state, {
    type: "refreshScopeToken",
    context: input.context,
    expectedScopeToken: input.expectedScopeToken,
    nextScopeToken: input.nextScopeToken,
  });
}

export function setIdSelected<Id extends RowId>(
  state: SelectionState<Id>,
  input: SetIdSelectedInput<NoInfer<Id>>,
): TransitionResult<Id> {
  assertObject(input, "input");

  const id = normalizeRowId(input.id, "input.id");
  return applySelectionCommand(state, {
    type: "setIdsSelected",
    context: input.context,
    ids: [id],
    selected: input.selected,
  });
}

export function setIdsSelected<Id extends RowId>(
  state: SelectionState<Id>,
  input: SetIdsSelectedInput<NoInfer<Id>>,
): TransitionResult<Id> {
  assertObject(input, "input");

  return applySelectionCommand(state, {
    type: "setIdsSelected",
    context: input.context,
    ids: input.ids,
    selected: input.selected,
  });
}

export function clearSelection<Id extends RowId>(
  state: SelectionState<Id>,
  context: SelectionContext,
): TransitionResult<Id> {
  return applySelectionCommand(state, { type: "clear", context });
}

export function selectAllMatching<Id extends RowId>(
  state: SelectionState<Id>,
  scope: AllMatchingScope,
): TransitionResult<Id> {
  return applySelectionCommand(state, { type: "selectAllMatching", scope });
}
