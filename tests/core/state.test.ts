import { describe, expect, it } from "vitest";

import {
  applySelectionCommand,
  clearSelection,
  emptySelection,
  reconcileScope,
  refreshScopeToken,
  selectAllMatching,
  setIdSelected,
  setIdsSelected,
  type RowId,
  type SelectionContext,
  type SelectionState,
} from "../../src/index.js";

function context(state: SelectionState): SelectionContext {
  return { scopeKey: state.scopeKey, scopeRevision: state.scopeRevision };
}

function expectApplied<Id extends RowId>(
  result: ReturnType<typeof setIdsSelected<Id>>,
): SelectionState<Id> {
  expect(result.applied).toBe(true);
  if (!result.applied) {
    throw new Error(`Expected an applied transition, got ${result.reason}`);
  }

  return result.state;
}

describe("selection state transitions", () => {
  it("starts with an immutable empty state at revision zero", () => {
    const state = emptySelection("customers:active");

    expect(state).toEqual({
      mode: "empty",
      scopeKey: "customers:active",
      scopeRevision: 0,
    });
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.keys(state)).toEqual(["mode", "scopeKey", "scopeRevision"]);
  });

  it("rejects a frozen object-spread imitation of package-owned state", () => {
    const valid = emptySelection<number>("scope");
    const forged = Object.freeze({
      ...valid,
      mode: "explicit" as const,
      ids: Object.freeze([1]),
    });

    expect(() =>
      setIdSelected(forged, {
        context: context(valid),
        id: 2,
        selected: true,
      }),
    ).toThrow("state must be a SelectionState created by this package");
  });

  it("creates explicit state and keeps IDs normalized in first-insertion order", () => {
    const supplied = Object.freeze<RowId[]>(["__proto__", 1, "1", -0, 0, "__proto__", -7]);
    const initial = emptySelection("scope");

    const state = expectApplied(
      setIdsSelected(initial, {
        context: context(initial),
        ids: supplied,
        selected: true,
      }),
    );

    expect(state).toEqual({
      mode: "explicit",
      scopeKey: "scope",
      scopeRevision: 0,
      ids: ["__proto__", 1, "1", 0, -7],
    });
    expect(supplied).toEqual(["__proto__", 1, "1", -0, 0, "__proto__", -7]);
    expect(Object.isFrozen(state)).toBe(true);
    expect(state.mode === "explicit" && Object.isFrozen(state.ids)).toBe(true);
  });

  it("unions and subtracts explicit IDs without reordering existing IDs", () => {
    const initial = emptySelection("scope");
    const first = expectApplied(
      setIdsSelected(initial, {
        context: context(initial),
        ids: [3, 1, 2],
        selected: true,
      }),
    );
    const second = expectApplied(
      setIdsSelected(first, {
        context: context(first),
        ids: [2, 4, 1, 5],
        selected: true,
      }),
    );
    const third = expectApplied(
      setIdsSelected(second, {
        context: context(second),
        ids: [1, 4],
        selected: false,
      }),
    );

    expect(first.mode === "explicit" && first.ids).toEqual([3, 1, 2]);
    expect(second.mode === "explicit" && second.ids).toEqual([3, 1, 2, 4, 5]);
    expect(third.mode === "explicit" && third.ids).toEqual([3, 2, 5]);
  });

  it("turns explicit selection back into empty when its final ID is removed", () => {
    const initial = emptySelection<number>("scope");
    const selected = expectApplied(
      setIdSelected(initial, {
        context: context(initial),
        id: 42,
        selected: true,
      }),
    );
    const cleared = setIdSelected(selected, {
      context: context(selected),
      id: 42,
      selected: false,
    });

    expect(cleared).toEqual({ applied: true, state: initial });
    if (cleared.applied) {
      expect(cleared.state).toEqual(initial);
      expect(cleared.state).not.toBe(initial);
    }
  });

  it("treats empty ID commands and already-satisfied updates as applied no-ops", () => {
    const initial = emptySelection("scope");
    const empty = setIdsSelected(initial, {
      context: context(initial),
      ids: [],
      selected: true,
    });
    const deselected = setIdSelected(initial, {
      context: context(initial),
      id: "missing",
      selected: false,
    });

    expect(empty).toEqual({ applied: true, state: initial });
    expect(deselected).toEqual({ applied: true, state: initial });
    expect(empty.state).toBe(initial);
    expect(deselected.state).toBe(initial);
  });

  it("does not let extra input fields override helper command types", () => {
    const initial = emptySelection("scope");
    const input = {
      type: "clear",
      context: context(initial),
      ids: [1],
      selected: true,
    } as const;

    const result = setIdsSelected(initial, input);

    expect(result.applied && result.state).toMatchObject({ mode: "explicit", ids: [1] });
  });

  it("moves empty and explicit state into all-matching mode", () => {
    const empty = emptySelection("scope");
    const fromEmpty = selectAllMatching(empty, {
      ...context(empty),
      scopeToken: "token-1",
    });

    expect(fromEmpty).toEqual({
      applied: true,
      state: {
        mode: "allMatching",
        scopeKey: "scope",
        scopeRevision: 0,
        scopeToken: "token-1",
        excludedIds: [],
      },
    });

    const explicit = expectApplied(
      setIdsSelected(empty, {
        context: context(empty),
        ids: [1, 2],
        selected: true,
      }),
    );
    const fromExplicit = selectAllMatching(explicit, {
      ...context(explicit),
      scopeToken: "token-2",
    });

    expect(fromExplicit.applied && fromExplicit.state).toMatchObject({
      mode: "allMatching",
      scopeToken: "token-2",
      excludedIds: [],
    });
  });

  it("adds exclusions on deselect and removes them on select", () => {
    const initial = emptySelection("scope");
    const all = selectAllMatching(initial, {
      ...context(initial),
      scopeToken: "token",
    });
    if (!all.applied) throw new Error("expected select all to apply");

    const excluded = expectApplied(
      setIdsSelected(all.state, {
        context: context(all.state),
        ids: ["a", 1, "a", "1"],
        selected: false,
      }),
    );
    const reselected = expectApplied(
      setIdsSelected(excluded, {
        context: context(excluded),
        ids: [1, "not-excluded"],
        selected: true,
      }),
    );

    expect(excluded.mode === "allMatching" && excluded.excludedIds).toEqual(["a", 1, "1"]);
    expect(reselected.mode === "allMatching" && reselected.excludedIds).toEqual(["a", "1"]);
  });

  it("clears exclusions on repeated select-all but preserves the current token", () => {
    const initial = emptySelection("scope");
    const first = selectAllMatching(initial, {
      ...context(initial),
      scopeToken: "old-token",
    });
    if (!first.applied) throw new Error("expected select all to apply");
    const excluded = setIdSelected(first.state, {
      context: context(first.state),
      id: "x",
      selected: false,
    });
    if (!excluded.applied) throw new Error("expected exclusion to apply");

    const repeated = selectAllMatching(excluded.state, {
      ...context(excluded.state),
      scopeToken: "delayed-token-that-must-not-win",
    });

    expect(repeated.applied && repeated.state).toMatchObject({
      mode: "allMatching",
      scopeToken: "old-token",
      excludedIds: [],
    });
  });

  it("clears every mode while keeping its current scope incarnation", () => {
    const initial = emptySelection("scope");
    const explicit = expectApplied(
      setIdSelected(initial, {
        context: context(initial),
        id: "x",
        selected: true,
      }),
    );
    const cleared = clearSelection(explicit, context(explicit));

    expect(cleared).toEqual({
      applied: true,
      state: { mode: "empty", scopeKey: "scope", scopeRevision: 0 },
    });
    expect(clearSelection(cleared.state, context(cleared.state)).state).toBe(cleared.state);
  });
});

describe("scope lifecycle and concurrency", () => {
  it("keeps state for the same key and clears with an incremented revision for a new key", () => {
    const initial = emptySelection("A");
    const selected = expectApplied(
      setIdSelected(initial, {
        context: context(initial),
        id: 1,
        selected: true,
      }),
    );

    const same = reconcileScope(selected, {
      expected: context(selected),
      nextScopeKey: "A",
    });
    expect(same.state).toBe(selected);

    const changed = reconcileScope(selected, {
      expected: context(selected),
      nextScopeKey: "B",
    });
    expect(changed).toEqual({
      applied: true,
      state: { mode: "empty", scopeKey: "B", scopeRevision: 1 },
    });
  });

  it("rejects a delayed event from the first A after A to B to A", () => {
    const firstA = emptySelection("A");
    const pageAContext = context(firstA);
    const secondB = reconcileScope(firstA, {
      expected: pageAContext,
      nextScopeKey: "B",
    });
    if (!secondB.applied) throw new Error("expected B adoption");
    const secondA = reconcileScope(secondB.state, {
      expected: context(secondB.state),
      nextScopeKey: "A",
    });
    if (!secondA.applied) throw new Error("expected second A adoption");

    const delayed = setIdSelected(secondA.state, {
      context: pageAContext,
      id: "row-from-first-A",
      selected: true,
    });

    expect(secondA.state).toEqual({ mode: "empty", scopeKey: "A", scopeRevision: 2 });
    expect(delayed).toEqual({
      applied: false,
      reason: "staleScope",
      state: secondA.state,
    });
    expect(delayed.state).toBe(secondA.state);
  });

  it.each(["set", "selectAll", "refresh", "clear"] as const)(
    "rejects stale context for %s without changing state",
    (operation) => {
      const initial = emptySelection("current");
      const stale = { scopeKey: "old", scopeRevision: 0 };

      const result =
        operation === "set"
          ? setIdSelected(initial, { context: stale, id: 1, selected: true })
          : operation === "selectAll"
            ? selectAllMatching(initial, { ...stale, scopeToken: "token" })
            : operation === "refresh"
              ? refreshScopeToken(initial, {
                  context: stale,
                  expectedScopeToken: "before",
                  nextScopeToken: "after",
                })
              : clearSelection(initial, stale);

      expect(result).toEqual({
        applied: false,
        reason: "staleScope",
        state: initial,
      });
      expect(Object.isFrozen(result)).toBe(true);
    },
  );

  it("uses compare-and-set token renewal and rejects responses arriving out of order", () => {
    const initial = emptySelection("scope");
    const all = selectAllMatching(initial, {
      ...context(initial),
      scopeToken: "token-1",
    });
    if (!all.applied) throw new Error("expected select all to apply");
    const excluded = setIdSelected(all.state, {
      context: context(all.state),
      id: 9,
      selected: false,
    });
    if (!excluded.applied) throw new Error("expected exclusion to apply");

    const newest = refreshScopeToken(excluded.state, {
      context: context(excluded.state),
      expectedScopeToken: "token-1",
      nextScopeToken: "token-3",
    });
    if (!newest.applied) throw new Error("expected token refresh to apply");
    const delayed = refreshScopeToken(newest.state, {
      context: context(newest.state),
      expectedScopeToken: "token-1",
      nextScopeToken: "token-2",
    });

    expect(newest.state).toMatchObject({ scopeToken: "token-3", excludedIds: [9] });
    expect(delayed).toEqual({
      applied: false,
      reason: "staleToken",
      state: newest.state,
    });
  });

  it("does not let delayed select-all overwrite a renewed token", () => {
    const initial = emptySelection("scope");
    const all = selectAllMatching(initial, {
      ...context(initial),
      scopeToken: "token-1",
    });
    if (!all.applied) throw new Error("expected select all to apply");
    const refreshed = refreshScopeToken(all.state, {
      context: context(all.state),
      expectedScopeToken: "token-1",
      nextScopeToken: "token-2",
    });
    if (!refreshed.applied) throw new Error("expected refresh to apply");

    const delayed = selectAllMatching(refreshed.state, {
      ...context(refreshed.state),
      scopeToken: "token-1",
    });

    expect(delayed.applied && delayed.state).toMatchObject({ scopeToken: "token-2" });
  });

  it("lets a later token refresh win after a delayed repeated select-all", () => {
    const initial = emptySelection("scope");
    const all = selectAllMatching(initial, {
      ...context(initial),
      scopeToken: "token-1",
    });
    if (!all.applied) throw new Error("expected select all to apply");

    const delayed = selectAllMatching(all.state, {
      ...context(all.state),
      scopeToken: "older-response-token",
    });
    if (!delayed.applied) throw new Error("expected repeated select all to apply");
    const refreshed = refreshScopeToken(delayed.state, {
      context: context(delayed.state),
      expectedScopeToken: "token-1",
      nextScopeToken: "token-2",
    });

    expect(delayed.state).toMatchObject({ scopeToken: "token-1" });
    expect(refreshed.applied && refreshed.state).toMatchObject({ scopeToken: "token-2" });
  });

  it("treats same-context refresh as an applied no-op before all-matching exists", () => {
    const initial = emptySelection("scope");
    const result = refreshScopeToken(initial, {
      context: context(initial),
      expectedScopeToken: "not-stored",
      nextScopeToken: "also-not-stored",
    });

    expect(result).toEqual({ applied: true, state: initial });
    expect(result.state).toBe(initial);
  });

  it("rejects stale reconciliation without adopting the response scope", () => {
    const state = emptySelection("A");
    const result = reconcileScope(state, {
      expected: { scopeKey: "A", scopeRevision: 8 },
      nextScopeKey: "B",
    });

    expect(result).toEqual({ applied: false, reason: "staleScope", state });
  });
});

describe("public input validation and immutability", () => {
  it.each(["", Number.NaN, Number.POSITIVE_INFINITY, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid row ID %p",
    (id) => {
      const state = emptySelection("scope");
      expect(() =>
        setIdSelected(state, {
          context: context(state),
          id,
          selected: true,
        }),
      ).toThrow(TypeError);
    },
  );

  it("rejects invalid contexts, tokens, booleans, and commands", () => {
    const state = emptySelection("scope");

    expect(() => emptySelection("")).toThrow(TypeError);
    expect(() =>
      setIdSelected(state, {
        context: { scopeKey: "scope", scopeRevision: -1 },
        id: 1,
        selected: true,
      }),
    ).toThrow(TypeError);
    expect(() =>
      setIdsSelected(state, {
        context: context(state),
        ids: [1],
        selected: "yes" as unknown as boolean,
      }),
    ).toThrow(TypeError);
    expect(() => selectAllMatching(state, { ...context(state), scopeToken: "" })).toThrow(
      TypeError,
    );
    expect(() => reconcileScope(state, { expected: context(state), nextScopeKey: "" })).toThrow(
      TypeError,
    );
    expect(() => applySelectionCommand(state, { type: "unknown" } as never)).toThrow(TypeError);
  });

  it("validates malformed arrays at runtime", () => {
    const state = emptySelection("scope");
    expect(() =>
      setIdsSelected(state, {
        context: context(state),
        ids: new Set([1, 2]) as unknown as readonly number[],
        selected: true,
      }),
    ).toThrow(TypeError);
  });

  it("never mutates frozen commands, contexts, states, or caller-owned arrays", () => {
    const state = emptySelection<number>("scope");
    const ids = Object.freeze([1, 2, 2]);
    const selectionContext = Object.freeze(context(state));
    const command = Object.freeze({
      type: "setIdsSelected" as const,
      context: selectionContext,
      ids,
      selected: true,
    });

    const result = applySelectionCommand(state, command);

    expect(result.applied).toBe(true);
    expect(ids).toEqual([1, 2, 2]);
    expect(command).toEqual({
      type: "setIdsSelected",
      context: { scopeKey: "scope", scopeRevision: 0 },
      ids: [1, 2, 2],
      selected: true,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.state)).toBe(true);
    expect(result.state.mode === "explicit" && Object.isFrozen(result.state.ids)).toBe(true);
  });
});
