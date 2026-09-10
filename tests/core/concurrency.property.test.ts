import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  clearSelection,
  createSelectionView,
  decodeSelection,
  emptySelection,
  encodeSelection,
  getPageSelection,
  isIdSelected,
  reconcileScope,
  refreshScopeToken,
  selectAllMatching,
  setIdsSelected,
  type RowId,
  type SelectionContext,
  type SelectionState,
  type TransitionResult,
} from "../../src/index.js";

const PROPERTY_SEED = 0x5c0fec;
const editableIds = [-1, -0, 1, "1", "a", "__proto__", "é", "\ud800"] as const;
// The extra row is never explicitly selected, so it distinguishes all-matching from explicit.
const universe: readonly RowId[] = [...editableIds, "unseen-row"];
const rowId = fc.constantFrom(...editableIds);
const token = fc.constantFrom("token-0", "token-1", "token-2");

type Action =
  | { type: "set"; ids: RowId[]; selected: boolean }
  | { type: "all"; token: string }
  | { type: "clear" }
  | { type: "reconcile"; scopeKey: string }
  | { type: "refresh"; nextToken: string; expectedToken: string | null };

type Captured = { context: SelectionContext; token: string | undefined };

const action: fc.Arbitrary<Action> = fc.oneof(
  fc.record({
    type: fc.constant("set" as const),
    ids: fc.array(rowId, { maxLength: 8 }),
    selected: fc.boolean(),
  }),
  fc.record({ type: fc.constant("all" as const), token }),
  fc.record({ type: fc.constant("clear" as const) }),
  fc.record({
    type: fc.constant("reconcile" as const),
    scopeKey: fc.constantFrom("A", "B", "C"),
  }),
  fc.record({
    type: fc.constant("refresh" as const),
    nextToken: token,
    expectedToken: fc.option(token),
  }),
);

const event = fc.record({
  action,
  // Most events use the current render; others replay any earlier captured context/token.
  capturedAt: fc.oneof(fc.constant(null), fc.constant(null), fc.nat({ max: 60 })),
});

function applyAction(state: SelectionState, action: Action, captured: Captured): TransitionResult {
  switch (action.type) {
    case "set":
      return setIdsSelected(state, {
        context: captured.context,
        ids: action.ids,
        selected: action.selected,
      });
    case "all":
      return selectAllMatching(state, { ...captured.context, scopeToken: action.token });
    case "clear":
      return clearSelection(state, captured.context);
    case "reconcile":
      return reconcileScope(state, { expected: captured.context, nextScopeKey: action.scopeKey });
    case "refresh":
      return refreshScopeToken(state, {
        context: captured.context,
        expectedScopeToken: action.expectedToken ?? captured.token ?? "no-captured-token",
        nextScopeToken: action.nextToken,
      });
  }
}

describe("selection lifecycle model", () => {
  it("preserves selection intent across generated scope and token races", () => {
    fc.assert(
      fc.property(
        fc.array(event, { minLength: 1, maxLength: 60 }),
        fc.array(rowId, { maxLength: 12 }),
        (events, pageIds) => {
          let state = emptySelection("A");
          let modelContext: SelectionContext = { scopeKey: "A", scopeRevision: 0 };
          let modelToken: string | undefined;
          // Model the actual selected rows in a finite universe, without exclusion-list logic.
          const selected = new Set<RowId>();
          const captures: Captured[] = [];
          const priorStates: { state: SelectionState; encoded: string }[] = [];

          for (const current of events) {
            const latest = { context: modelContext, token: modelToken };
            captures.push(latest);
            const captured =
              current.capturedAt === null ? latest : captures[current.capturedAt % captures.length];
            if (captured === undefined) throw new Error("expected captured context");

            const previous = state;
            priorStates.push({ state: previous, encoded: JSON.stringify(previous) });
            const result = applyAction(state, current.action, captured);
            const staleScope =
              captured.context.scopeKey !== modelContext.scopeKey ||
              captured.context.scopeRevision !== modelContext.scopeRevision;
            const staleToken =
              current.action.type === "refresh" &&
              modelToken !== undefined &&
              (current.action.expectedToken ?? captured.token ?? "no-captured-token") !==
                modelToken;
            const rejection = staleScope ? "staleScope" : staleToken ? "staleToken" : undefined;

            expect(result.applied).toBe(rejection === undefined);
            if (rejection !== undefined) {
              expect(result).toEqual({ applied: false, reason: rejection, state: previous });
              expect(result.state).toBe(previous);
            } else {
              const action = current.action;
              if (action.type === "set") {
                for (const id of action.ids) {
                  if (action.selected) selected.add(id);
                  else selected.delete(id);
                }
              } else if (action.type === "all" && modelToken === undefined) {
                for (const id of universe) selected.add(id);
                modelToken = action.token;
              } else if (action.type === "clear") {
                selected.clear();
                modelToken = undefined;
              } else if (action.type === "reconcile" && action.scopeKey !== modelContext.scopeKey) {
                modelContext = {
                  scopeKey: action.scopeKey,
                  scopeRevision: modelContext.scopeRevision + 1,
                };
                selected.clear();
                modelToken = undefined;
              } else if (action.type === "refresh" && modelToken !== undefined) {
                modelToken = action.nextToken;
              }
            }

            state = result.state;
            expect(state).toMatchObject(modelContext);
            expect(Object.isFrozen(state)).toBe(true);
            if (modelToken !== undefined) {
              expect(state.mode).toBe("allMatching");
              if (state.mode !== "allMatching") throw new Error("expected all-matching state");
              expect(state.scopeToken).toBe(modelToken);
              expect(state.excludedIds.length).toBe(new Set(state.excludedIds).size);
              expect(new Set(state.excludedIds)).toEqual(
                new Set(universe.filter((id) => !selected.has(id))),
              );
              expect(Object.isFrozen(state.excludedIds)).toBe(true);
            } else if (selected.size === 0) {
              expect(state.mode).toBe("empty");
            } else {
              expect(state.mode).toBe("explicit");
              if (state.mode !== "explicit") throw new Error("expected explicit state");
              expect(state.ids.length).toBe(selected.size);
              expect(new Set(state.ids)).toEqual(selected);
              expect(Object.isFrozen(state.ids)).toBe(true);
            }

            const view = createSelectionView(state, modelContext);
            if (!view.scopeMatches) throw new Error("expected current scope view");
            for (const id of universe) {
              expect(isIdSelected(state, modelContext, id)).toEqual({
                scopeMatches: true,
                value: selected.has(id),
              });
              expect(view.value.isIdSelected(id)).toBe(selected.has(id));
            }
            const page = [...new Set(pageIds)];
            const selectedCount = page.filter((id) => selected.has(id)).length;
            const pageStatus =
              page.length === 0
                ? "noRows"
                : selectedCount === 0
                  ? "none"
                  : selectedCount === page.length
                    ? "all"
                    : "some";
            expect(getPageSelection(state, modelContext, pageIds)).toEqual({
              scopeMatches: true,
              value: pageStatus,
            });
            expect(view.value.getPageSelection(pageIds)).toBe(pageStatus);

            if (
              captured.context.scopeKey !== modelContext.scopeKey ||
              captured.context.scopeRevision !== modelContext.scopeRevision
            ) {
              expect(createSelectionView(state, captured.context)).toEqual({
                scopeMatches: false,
              });
              expect(isIdSelected(state, captured.context, "unseen-row")).toEqual({
                scopeMatches: false,
              });
              expect(getPageSelection(state, captured.context, pageIds)).toEqual({
                scopeMatches: false,
              });
            }

            const decoded = decodeSelection(JSON.parse(JSON.stringify(encodeSelection(state))));
            expect(decoded).toEqual({ ok: true, value: state });
          }

          for (const previous of priorStates) {
            expect(JSON.stringify(previous.state)).toBe(previous.encoded);
          }
        },
      ),
      { numRuns: 100, seed: PROPERTY_SEED },
    );
  });
});
