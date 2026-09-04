import { describe, expect, it } from "vitest";

import {
  createSelectionView,
  emptySelection,
  getPageSelection,
  isIdSelected,
  selectAllMatching,
  setIdsSelected,
  summarizeSelectionState,
  type RowId,
  type SelectionContext,
  type SelectionState,
} from "../../src/index.js";

declare const accountIdBrand: unique symbol;
type AccountId = string & { readonly [accountIdBrand]: true };

function context(state: SelectionState): SelectionContext {
  return { scopeKey: state.scopeKey, scopeRevision: state.scopeRevision };
}

function appliedState<Id extends RowId>(
  result: ReturnType<typeof setIdsSelected<Id>>,
): SelectionState<Id> {
  if (!result.applied) throw new Error(`unexpected ${result.reason}`);
  return result.state;
}

describe("scope-aware selection reads", () => {
  it("reports no selected IDs for empty state", () => {
    const state = emptySelection("scope");

    expect(isIdSelected(state, context(state), "row-1")).toEqual({
      scopeMatches: true,
      value: false,
    });
    expect(getPageSelection(state, context(state), [])).toEqual({
      scopeMatches: true,
      value: "noRows",
    });
    expect(getPageSelection(state, context(state), [1, 2])).toEqual({
      scopeMatches: true,
      value: "none",
    });
  });

  it("classifies explicit pages as none, some, or all", () => {
    const initial = emptySelection("scope");
    const state = appliedState(
      setIdsSelected(initial, {
        context: context(initial),
        ids: [1, "2", 3],
        selected: true,
      }),
    );

    expect(getPageSelection(state, context(state), [8, 9])).toMatchObject({ value: "none" });
    expect(getPageSelection(state, context(state), [1, 8])).toMatchObject({ value: "some" });
    expect(getPageSelection(state, context(state), [3, 1, 3])).toMatchObject({ value: "all" });
    expect(isIdSelected(state, context(state), 1)).toMatchObject({ value: true });
    expect(isIdSelected(state, context(state), "1")).toMatchObject({ value: false });
  });

  it("classifies all-matching pages by their exclusions", () => {
    const initial = emptySelection("scope");
    const all = selectAllMatching(initial, {
      ...context(initial),
      scopeToken: "token",
    });
    if (!all.applied) throw new Error("expected select all to apply");
    const state = appliedState(
      setIdsSelected(all.state, {
        context: context(all.state),
        ids: ["excluded", 4],
        selected: false,
      }),
    );

    expect(getPageSelection(state, context(state), [1, 2])).toMatchObject({ value: "all" });
    expect(getPageSelection(state, context(state), [1, 4])).toMatchObject({ value: "some" });
    expect(getPageSelection(state, context(state), [4, "excluded", 4])).toMatchObject({
      value: "none",
    });
  });

  it("refuses reads from another key or another incarnation of the same key", () => {
    const state = emptySelection("A");

    expect(isIdSelected(state, { scopeKey: "B", scopeRevision: 0 }, "x")).toEqual({
      scopeMatches: false,
    });
    expect(getPageSelection(state, { scopeKey: "A", scopeRevision: 1 }, ["x"])).toEqual({
      scopeMatches: false,
    });
    expect(createSelectionView(state, { scopeKey: "A", scopeRevision: 9 })).toEqual({
      scopeMatches: false,
    });
  });

  it("normalizes negative zero while preserving numeric/string and Unicode identity", () => {
    const composed = "é";
    const combining = "e\u0301";
    const initial = emptySelection("scope");
    const state = appliedState(
      setIdsSelected(initial, {
        context: context(initial),
        ids: [-0, "0", composed, "🦀", "constructor"],
        selected: true,
      }),
    );

    expect(isIdSelected(state, context(state), 0)).toMatchObject({ value: true });
    expect(isIdSelected(state, context(state), "0")).toMatchObject({ value: true });
    expect(isIdSelected(state, context(state), combining)).toMatchObject({ value: false });
    expect(isIdSelected(state, context(state), "🦀")).toMatchObject({ value: true });
    expect(isIdSelected(state, context(state), "constructor")).toMatchObject({ value: true });
  });
});

describe("indexed selection views", () => {
  it("provides membership and page reads from one immutable index", () => {
    const initial = emptySelection<number>("scope");
    const state = appliedState(
      setIdsSelected(initial, {
        context: context(initial),
        ids: [2, 4, 6],
        selected: true,
      }),
    );
    const result = createSelectionView(state, context(state));

    expect(result.scopeMatches).toBe(true);
    if (!result.scopeMatches) throw new Error("expected scope match");
    expect(result.value.isIdSelected(4)).toBe(true);
    expect(result.value.isIdSelected(5)).toBe(false);
    expect(result.value.getPageSelection([2, 6])).toBe("all");
    expect(result.value.getPageSelection([2, 3])).toBe("some");
    expect(result.value.getPageSelection([])).toBe("noRows");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.value)).toBe(true);
  });

  it("supports branded application IDs without losing their type", () => {
    const one = "account-1" as AccountId;
    const two = "account-2" as AccountId;
    const initial = emptySelection<AccountId>("accounts");
    const state = appliedState(
      setIdsSelected(initial, {
        context: context(initial),
        ids: [one],
        selected: true,
      }),
    );
    const result = createSelectionView(state, context(state));

    if (!result.scopeMatches) throw new Error("expected scope match");
    expect(result.value.isIdSelected(one)).toBe(true);
    expect(result.value.isIdSelected(two)).toBe(false);
  });

  it("does not mutate frozen page arrays", () => {
    const initial = emptySelection<number>("scope");
    const state = appliedState(
      setIdsSelected(initial, {
        context: context(initial),
        ids: [2],
        selected: true,
      }),
    );
    const page = Object.freeze([3, 2, 3]);
    const result = getPageSelection(state, context(state), page);

    expect(result).toMatchObject({ scopeMatches: true, value: "some" });
    expect(page).toEqual([3, 2, 3]);
  });

  it("validates IDs supplied to both direct and indexed reads", () => {
    const state = emptySelection("scope");
    const view = createSelectionView(state, context(state));
    if (!view.scopeMatches) throw new Error("expected scope match");

    expect(() => isIdSelected(state, context(state), "")).toThrow(TypeError);
    expect(() => view.value.isIdSelected(Number.NaN)).toThrow(TypeError);
    expect(() => view.value.getPageSelection(new Set([1]) as unknown as readonly number[])).toThrow(
      TypeError,
    );
  });
});

describe("state summaries", () => {
  it("summarizes state without implying that a page scope matches", () => {
    const empty = emptySelection("scope");
    const explicit = appliedState(
      setIdsSelected(empty, {
        context: context(empty),
        ids: [1, "1", 2],
        selected: true,
      }),
    );
    const all = selectAllMatching(explicit, {
      ...context(explicit),
      scopeToken: "token",
    });
    if (!all.applied) throw new Error("expected select all to apply");
    const excluded = appliedState(
      setIdsSelected(all.state, {
        context: context(all.state),
        ids: [5, 6],
        selected: false,
      }),
    );

    const emptySummary = summarizeSelectionState(empty);
    const explicitSummary = summarizeSelectionState(explicit);
    const allSummary = summarizeSelectionState(excluded);

    expect(emptySummary).toEqual({ kind: "empty", selectedCount: 0 });
    expect(explicitSummary).toEqual({ kind: "explicit", selectedCount: 3 });
    expect(allSummary).toEqual({ kind: "allMatching", excludedCount: 2 });
    expect(Object.isFrozen(emptySummary)).toBe(true);
    expect(Object.isFrozen(explicitSummary)).toBe(true);
    expect(Object.isFrozen(allSummary)).toBe(true);
  });
});
