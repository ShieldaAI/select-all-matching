import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  clearSelection,
  decodeSelection,
  emptySelection,
  encodeSelection,
  getPageSelection,
  isIdSelected,
  selectAllMatching,
  setIdsSelected,
  toBulkSelection,
  type RowId,
  type SelectionContext,
  type SelectionState,
} from "../../src/index.js";
import { decodeBulkSelection } from "../../src/server/index.js";

const PROPERTY_SEED = 0x5e1ec7;

const rowId = fc.oneof(
  fc.integer({ min: -100, max: 100 }),
  fc.string({ minLength: 1, maxLength: 8 }),
);

type ModelOperation =
  | { type: "set"; ids: RowId[]; selected: boolean }
  | { type: "all"; token: string }
  | { type: "clear" };

const operation: fc.Arbitrary<ModelOperation> = fc.oneof(
  fc.record({
    type: fc.constant("set" as const),
    ids: fc.array(rowId, { maxLength: 20 }),
    selected: fc.boolean(),
  }),
  fc.record({
    type: fc.constant("all" as const),
    token: fc.string({ minLength: 1, maxLength: 12 }),
  }),
  fc.record({ type: fc.constant("clear" as const) }),
);

function context<Id extends RowId>(state: SelectionState<Id>): SelectionContext {
  return { scopeKey: state.scopeKey, scopeRevision: state.scopeRevision };
}

function selectedByModel(allMatching: boolean, ids: ReadonlySet<RowId>, id: RowId): boolean {
  return allMatching ? !ids.has(id) : ids.has(id);
}

function applyOperation(state: SelectionState, operation: ModelOperation): SelectionState {
  const result =
    operation.type === "set"
      ? setIdsSelected(state, {
          context: context(state),
          ids: operation.ids,
          selected: operation.selected,
        })
      : operation.type === "all"
        ? selectAllMatching(state, {
            ...context(state),
            scopeToken: operation.token,
          })
        : clearSelection(state, context(state));

  if (!result.applied) throw new Error(`unexpected ${result.reason}`);
  return result.state;
}

describe("selection model properties", () => {
  it("matches a finite Set model across generated command sequences", () => {
    fc.assert(
      fc.property(
        fc.array(operation, { minLength: 1, maxLength: 200 }),
        fc.array(rowId, { maxLength: 30 }),
        (operations, observedIds) => {
          let state: SelectionState = emptySelection("generated-scope");
          let allMatching = false;
          const modeledIds = new Set<RowId>();

          for (const current of operations) {
            state = applyOperation(state, current);

            if (current.type === "set") {
              for (const rawId of current.ids) {
                const id = Object.is(rawId, -0) ? 0 : rawId;
                if (allMatching) {
                  if (current.selected) modeledIds.delete(id);
                  else modeledIds.add(id);
                } else if (current.selected) {
                  modeledIds.add(id);
                } else {
                  modeledIds.delete(id);
                }
              }
            } else if (current.type === "all") {
              if (!allMatching) {
                allMatching = true;
                modeledIds.clear();
              }
            } else {
              allMatching = false;
              modeledIds.clear();
            }

            if (allMatching) {
              expect(state.mode).toBe("allMatching");
              if (state.mode === "allMatching") {
                expect(new Set(state.excludedIds)).toEqual(modeledIds);
                expect(new Set(state.excludedIds).size).toBe(state.excludedIds.length);
              }
            } else if (modeledIds.size === 0) {
              expect(state.mode).toBe("empty");
            } else {
              expect(state.mode).toBe("explicit");
              if (state.mode === "explicit") {
                expect(new Set(state.ids)).toEqual(modeledIds);
                expect(new Set(state.ids).size).toBe(state.ids.length);
              }
            }
          }

          for (const rawId of observedIds) {
            const id = Object.is(rawId, -0) ? 0 : rawId;
            expect(isIdSelected(state, context(state), id)).toEqual({
              scopeMatches: true,
              value: selectedByModel(allMatching, modeledIds, id),
            });
          }
        },
      ),
      { numRuns: 100, seed: PROPERTY_SEED },
    );
  });

  it("round trips states produced by generated commands", () => {
    fc.assert(
      fc.property(fc.array(operation, { maxLength: 200 }), (operations) => {
        let state: SelectionState = emptySelection("generated-scope");
        for (const current of operations) {
          state = applyOperation(state, current);
        }

        const decoded = decodeSelection(encodeSelection(state));
        expect(decoded.ok).toBe(true);
        if (decoded.ok) expect(decoded.value).toEqual(state);
      }),
      { numRuns: 100, seed: PROPERTY_SEED },
    );
  });

  it("round trips generated bulk requests through the server decoder", () => {
    fc.assert(
      fc.property(
        fc.array(rowId, { minLength: 1, maxLength: 100 }),
        fc.boolean(),
        (ids, allMatching) => {
          const initial = emptySelection("scope");
          const base = allMatching
            ? selectAllMatching(initial, { ...context(initial), scopeToken: "token" })
            : { applied: true as const, state: initial };
          if (!base.applied) throw new Error("expected setup to apply");
          const selected = setIdsSelected(base.state, {
            context: context(base.state),
            ids,
            selected: !allMatching,
          });
          if (!selected.applied) throw new Error("expected setup to apply");

          const bulk = toBulkSelection(selected.state);
          expect(bulk.ok).toBe(true);
          if (!bulk.ok || bulk.value === null) throw new Error("expected a bulk request");
          expect(decodeBulkSelection(bulk.value)).toEqual({ ok: true, value: bulk.value });
        },
      ),
      { numRuns: 100, seed: PROPERTY_SEED },
    );
  });

  it("makes set-selected operations idempotent", () => {
    fc.assert(
      fc.property(fc.array(rowId, { maxLength: 100 }), fc.boolean(), (ids, selected) => {
        const initial = emptySelection("scope");
        const first = setIdsSelected(initial, {
          context: context(initial),
          ids,
          selected,
        });
        expect(first.applied).toBe(true);
        if (!first.applied) throw new Error(`unexpected ${first.reason}`);

        const second = setIdsSelected(first.state, {
          context: context(first.state),
          ids,
          selected,
        });
        expect(second).toEqual({ applied: true, state: first.state });
        expect(second.state).toBe(first.state);
      }),
      { numRuns: 100, seed: PROPERTY_SEED },
    );
  });

  it("keeps page classification invariant under permutation", () => {
    fc.assert(
      fc.property(
        fc.array(rowId, { maxLength: 100 }),
        fc.array(rowId, { maxLength: 100 }),
        fc.boolean(),
        (storedIds, pageIds, allMatching) => {
          const initial = emptySelection("scope");
          const base = allMatching
            ? selectAllMatching(initial, { ...context(initial), scopeToken: "token" })
            : { applied: true as const, state: initial };
          expect(base.applied).toBe(true);
          if (!base.applied) throw new Error("expected setup to apply");
          const configured = setIdsSelected(base.state, {
            context: context(base.state),
            ids: storedIds,
            selected: !allMatching,
          });
          expect(configured.applied).toBe(true);
          if (!configured.applied) throw new Error("expected setup to apply");

          const forward = getPageSelection(configured.state, context(configured.state), pageIds);
          const reversed = getPageSelection(
            configured.state,
            context(configured.state),
            [...pageIds].reverse(),
          );
          expect(reversed).toEqual(forward);
        },
      ),
      { numRuns: 100, seed: PROPERTY_SEED },
    );
  });

  it("rejects generated stale contexts without changing state", () => {
    fc.assert(
      fc.property(
        fc.array(rowId, { maxLength: 100 }),
        fc.array(rowId, { maxLength: 20 }),
        fc.boolean(),
        (selectedIds, nextIds, staleByKey) => {
          const initial = emptySelection("scope");
          const selected = setIdsSelected(initial, {
            context: context(initial),
            ids: selectedIds,
            selected: true,
          });
          expect(selected.applied).toBe(true);
          if (!selected.applied) throw new Error("expected setup to apply");
          const staleContext = staleByKey
            ? { scopeKey: "other-scope", scopeRevision: selected.state.scopeRevision }
            : {
                scopeKey: selected.state.scopeKey,
                scopeRevision: selected.state.scopeRevision + 1,
              };

          const result = setIdsSelected(selected.state, {
            context: staleContext,
            ids: nextIds,
            selected: false,
          });
          expect(result).toEqual({
            applied: false,
            reason: "staleScope",
            state: selected.state,
          });
          expect(result.state).toBe(selected.state);
        },
      ),
      { numRuns: 100, seed: PROPERTY_SEED },
    );
  });
});
