import type {
  PageSelection,
  RowId,
  ScopedRead,
  SelectionContext,
  SelectionState,
  SelectionStateSummary,
  SelectionView,
} from "./types.js";
import { assertNormalizedSelection } from "./state.js";
import { normalizeContext, normalizeRowId, normalizeRowIds } from "./validation.js";

function contextMatches(state: SelectionContext, context: SelectionContext): boolean {
  return state.scopeKey === context.scopeKey && state.scopeRevision === context.scopeRevision;
}

function scoped<Value>(value: Value): ScopedRead<Value> {
  return Object.freeze({ scopeMatches: true, value });
}

function scopeMismatch<Value>(): ScopedRead<Value> {
  return Object.freeze({ scopeMatches: false });
}

function classifyPage<Id extends RowId>(
  pageIds: readonly Id[],
  selected: (id: Id) => boolean,
): PageSelection {
  if (pageIds.length === 0) {
    return "noRows";
  }

  let selectedCount = 0;
  for (const id of pageIds) {
    if (selected(id)) {
      selectedCount += 1;
    }
  }

  if (selectedCount === 0) {
    return "none";
  }

  return selectedCount === pageIds.length ? "all" : "some";
}

export function createSelectionView<Id extends RowId>(
  state: SelectionState<Id>,
  context: SelectionContext,
): ScopedRead<SelectionView<Id>> {
  assertNormalizedSelection(state);
  const normalizedContext = normalizeContext(context);
  if (!contextMatches(state, normalizedContext)) {
    return scopeMismatch();
  }

  const indexedIds = new Set<RowId>(
    state.mode === "explicit" ? state.ids : state.mode === "allMatching" ? state.excludedIds : [],
  );

  const selected = (id: Id): boolean => {
    const normalizedId = normalizeRowId(id);
    switch (state.mode) {
      case "empty":
        return false;
      case "explicit":
        return indexedIds.has(normalizedId);
      case "allMatching":
        return !indexedIds.has(normalizedId);
    }
  };

  const view: SelectionView<Id> = Object.freeze({
    isIdSelected: selected,
    getPageSelection(pageIds: readonly Id[]): PageSelection {
      const normalizedIds = normalizeRowIds(pageIds, "pageIds");
      return classifyPage(normalizedIds, selected);
    },
  });

  return scoped(view);
}

export function isIdSelected<Id extends RowId>(
  state: SelectionState<Id>,
  context: SelectionContext,
  id: NoInfer<Id>,
): ScopedRead<boolean> {
  assertNormalizedSelection(state);
  const normalizedContext = normalizeContext(context);
  const normalizedId = normalizeRowId(id);
  if (!contextMatches(state, normalizedContext)) {
    return scopeMismatch();
  }

  switch (state.mode) {
    case "empty":
      return scoped(false);
    case "explicit":
      return scoped(state.ids.includes(normalizedId));
    case "allMatching":
      return scoped(!state.excludedIds.includes(normalizedId));
  }
}

export function getPageSelection<Id extends RowId>(
  state: SelectionState<Id>,
  context: SelectionContext,
  pageIds: readonly NoInfer<Id>[],
): ScopedRead<PageSelection> {
  assertNormalizedSelection(state);
  const normalizedContext = normalizeContext(context);
  const normalizedIds = normalizeRowIds(pageIds, "pageIds");
  if (!contextMatches(state, normalizedContext)) {
    return scopeMismatch();
  }

  const indexedIds = new Set<RowId>(
    state.mode === "explicit" ? state.ids : state.mode === "allMatching" ? state.excludedIds : [],
  );

  const selected = (id: Id): boolean => {
    switch (state.mode) {
      case "empty":
        return false;
      case "explicit":
        return indexedIds.has(id);
      case "allMatching":
        return !indexedIds.has(id);
    }
  };

  return scoped(classifyPage(normalizedIds, selected));
}

export function summarizeSelectionState<Id extends RowId>(
  state: SelectionState<Id>,
): SelectionStateSummary {
  assertNormalizedSelection(state);
  switch (state.mode) {
    case "empty":
      return Object.freeze({ kind: "empty", selectedCount: 0 });
    case "explicit":
      return Object.freeze({ kind: "explicit", selectedCount: state.ids.length });
    case "allMatching":
      return Object.freeze({
        kind: "allMatching",
        excludedCount: state.excludedIds.length,
      });
  }
}
