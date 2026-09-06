import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  decodeSelection,
  encodeSelection,
  emptySelection,
  selectAllMatching,
  setIdsSelected,
  toBulkSelection,
  type PayloadDecodeResult,
  type RowId,
  type SelectionState,
} from "../../src/index.js";

const PROPERTY_SEED = 0xc0dec;

function valueOf<Value>(result: PayloadDecodeResult<Value>): Value {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Expected a successful decode at ${result.error.path}`);
  }
  return result.value;
}

function appliedState<Id extends RowId>(
  result:
    { applied: true; state: SelectionState<Id> } | { applied: false; state: SelectionState<Id> },
): SelectionState<Id> {
  expect(result.applied).toBe(true);
  return result.state;
}

describe("state codec", () => {
  it("preserves the version 1 storage fixtures through JSON", () => {
    const fixtures = JSON.parse(
      readFileSync(new URL("./fixtures/state-v1.json", import.meta.url), "utf8"),
    ) as unknown[];

    for (const fixture of fixtures) {
      const decoded = valueOf(decodeSelection(fixture));
      expect(JSON.parse(JSON.stringify(encodeSelection(decoded)))).toEqual(fixture);
    }
  });

  it("migrates beta state when it is decoded and encoded again", () => {
    for (const selection of [
      { mode: "empty" },
      { mode: "explicit", ids: [1, "1"] },
      { mode: "allMatching", scopeToken: "opaque", excludedIds: [2] },
    ]) {
      const draft = {
        stateVersion: 0,
        scopeKey: "customers:active",
        scopeRevision: 7,
        selection,
      };
      expect(encodeSelection(valueOf(decodeSelection(draft)))).toEqual({
        ...draft,
        stateVersion: 1,
      });
    }
  });

  it("restores package ownership after structured clone through encode/decode", () => {
    const state = appliedState(
      setIdsSelected(emptySelection("customers:active"), {
        context: { scopeKey: "customers:active", scopeRevision: 0 },
        ids: [1, "1"],
        selected: true,
      }),
    );

    expect(() => toBulkSelection(structuredClone(state))).toThrow(TypeError);
    expect(() => toBulkSelection(Object.freeze(structuredClone(state)))).toThrow(TypeError);

    const cloned = valueOf(decodeSelection(structuredClone(encodeSelection(state))));
    expect(toBulkSelection(cloned)).toEqual(toBulkSelection(state));
  });

  it("rejects structurally forged states instead of serializing broken invariants", () => {
    const valid = emptySelection<number>("scope-a");
    const forged = {
      ...valid,
      mode: "explicit" as const,
      ids: Object.freeze([Number.NaN]),
    };

    for (const symbol of Object.getOwnPropertySymbols(valid)) {
      const descriptor = Object.getOwnPropertyDescriptor(valid, symbol);
      if (descriptor !== undefined) {
        Object.defineProperty(forged, symbol, descriptor);
      }
    }
    Object.freeze(forged);

    expect(() => encodeSelection(forged)).toThrow(
      "state must be a SelectionState created by this package",
    );
    expect(() => toBulkSelection(forged)).toThrow(
      "state must be a SelectionState created by this package",
    );
  });

  it("round trips each state mode with a separate state version", () => {
    const empty = emptySelection("customers:v1");
    const explicit = appliedState(
      setIdsSelected(empty, {
        context: { scopeKey: "customers:v1", scopeRevision: 0 },
        ids: [1, "1", -0, "alpha"],
        selected: true,
      }),
    );
    const allMatching = appliedState(
      selectAllMatching(explicit, {
        scopeKey: "customers:v1",
        scopeRevision: 0,
        scopeToken: "opaque-token",
      }),
    );
    const excluded = appliedState(
      setIdsSelected(allMatching, {
        context: { scopeKey: "customers:v1", scopeRevision: 0 },
        ids: [2, "2"],
        selected: false,
      }),
    );

    for (const state of [empty, explicit, excluded]) {
      const encoded = encodeSelection(state);
      expect(encoded.stateVersion).toBe(1);
      expect(valueOf(decodeSelection(JSON.parse(JSON.stringify(encoded))))).toEqual(state);
    }

    expect(encodeSelection(explicit)).toEqual({
      stateVersion: 1,
      scopeKey: "customers:v1",
      scopeRevision: 0,
      selection: { mode: "explicit", ids: [1, "1", 0, "alpha"] },
    });
  });

  it("round trips unbounded core state when matching decode limits are supplied", () => {
    const longId = "x".repeat(1_025);
    const empty = emptySelection("customers:v1");
    const state = appliedState(
      setIdsSelected(empty, {
        context: { scopeKey: "customers:v1", scopeRevision: 0 },
        ids: [longId],
        selected: true,
      }),
    );
    const encoded = encodeSelection(state);

    expect(decodeSelection(encoded)).toEqual({
      ok: false,
      error: { code: "stringTooLong", path: "$.selection.ids[0]" },
    });
    expect(
      valueOf(decodeSelection(encoded, { limits: { maxStringIdBytes: longId.length } })),
    ).toEqual(state);
  });

  it("decodes an arbitrary valid scope revision into frozen normalized state", () => {
    const decoded = valueOf(
      decodeSelection({
        stateVersion: 1,
        scopeKey: "scope-a",
        scopeRevision: 42,
        selection: { mode: "explicit", ids: [-0, "row"] },
      }),
    );

    expect(decoded).toEqual({
      mode: "explicit",
      scopeKey: "scope-a",
      scopeRevision: 42,
      ids: [0, "row"],
    });
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(decoded.mode === "explicit" && Object.isFrozen(decoded.ids)).toBe(true);
  });

  it("supports branded IDs only through an application decoder", () => {
    type Uuid = string & { readonly uuid: unique symbol };
    const rawUuid = "550e8400-e29b-41d4-a716-446655440000";
    const decoded = decodeSelection(
      {
        stateVersion: 1,
        scopeKey: "scope-a",
        scopeRevision: 0,
        selection: { mode: "explicit", ids: [rawUuid] },
      },
      {
        decodeId(value) {
          return typeof value === "string" && /^[0-9a-f-]{36}$/.test(value)
            ? { ok: true, value: value as Uuid }
            : { ok: false, code: "notUuid" };
        },
      },
    );

    expectTypeOf(decoded).toEqualTypeOf<PayloadDecodeResult<SelectionState<Uuid>>>();
    expect(valueOf(decoded)).toMatchObject({ ids: [rawUuid] });
  });

  it("reports a typed decoder rejection without echoing the rejected value", () => {
    const decoded = decodeSelection(
      {
        stateVersion: 1,
        scopeKey: "scope-a",
        scopeRevision: 0,
        selection: { mode: "explicit", ids: ["not-a-number"] },
      },
      {
        decodeId(value) {
          return typeof value === "number"
            ? { ok: true, value }
            : { ok: false, code: "numberRequired" };
        },
      },
    );

    expect(decoded).toEqual({
      ok: false,
      error: {
        code: "invalidId",
        path: "$.selection.ids[0]",
        decoderCode: "numberRequired",
      },
    });
    expect(JSON.stringify(decoded)).not.toContain("not-a-number");
  });

  it("omits unsafe application decoder codes", () => {
    const payload = {
      stateVersion: 1,
      scopeKey: "scope-a",
      scopeRevision: 0,
      selection: { mode: "explicit", ids: ["payload-derived-code"] },
    };

    const echoed = decodeSelection(payload, {
      decodeId(value) {
        return { ok: false, code: String(value) };
      },
    });
    const oversized = decodeSelection(payload, {
      decodeId() {
        return { ok: false, code: "x".repeat(65) };
      },
    });

    expect(echoed).toEqual({
      ok: false,
      error: { code: "invalidId", path: "$.selection.ids[0]" },
    });
    expect(oversized).toEqual(echoed);
  });

  it("catches a custom decoder exception as a payload error", () => {
    const decoded = decodeSelection(
      {
        stateVersion: 1,
        scopeKey: "scope-a",
        scopeRevision: 0,
        selection: { mode: "explicit", ids: ["row"] },
      },
      {
        decodeId() {
          throw new Error("decoder internals");
        },
      },
    );

    expect(decoded).toEqual({
      ok: false,
      error: { code: "invalidId", path: "$.selection.ids[0]" },
    });
  });

  it("preserves number/string identity and rejects duplicates after decoding", () => {
    expect(
      decodeSelection({
        stateVersion: 1,
        scopeKey: "scope-a",
        scopeRevision: 0,
        selection: { mode: "explicit", ids: [1, "1"] },
      }).ok,
    ).toBe(true);

    expect(
      decodeSelection({
        stateVersion: 1,
        scopeKey: "scope-a",
        scopeRevision: 0,
        selection: { mode: "explicit", ids: [-0, 0] },
      }),
    ).toEqual({
      ok: false,
      error: { code: "duplicateId", path: "$.selection.ids[1]" },
    });

    const transformed = decodeSelection(
      {
        stateVersion: 1,
        scopeKey: "scope-a",
        scopeRevision: 0,
        selection: { mode: "explicit", ids: ["A", "a"] },
      },
      {
        decodeId(value) {
          return typeof value === "string"
            ? { ok: true, value: value.toLowerCase() }
            : { ok: false, code: "stringRequired" };
        },
      },
    );
    expect(transformed).toEqual({
      ok: false,
      error: { code: "invalidId", path: "$.selection.ids[0]" },
    });
  });

  it("uses the documented deterministic validation order", () => {
    expect(
      decodeSelection({
        stateVersion: 2,
        extra: true,
      }),
    ).toEqual({
      ok: false,
      error: { code: "unsupportedVersion", path: "$.stateVersion" },
    });

    expect(
      decodeSelection({
        stateVersion: 1,
        scopeRevision: 0,
        selection: { mode: "empty" },
        zExtra: true,
      }),
    ).toEqual({
      ok: false,
      error: { code: "missingField", path: "$.scopeKey" },
    });

    expect(
      decodeSelection({
        stateVersion: 1,
        scopeKey: "scope-a",
        scopeRevision: 0,
        selection: { mode: "explicit", ids: [], surprise: true },
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "unexpectedField",
        path: "$.selection.surprise",
      },
    });

    expect(
      decodeSelection(
        {
          stateVersion: 1,
          scopeKey: 123,
          scopeRevision: 0,
          selection: { mode: "explicit", ids: [false, false] },
        },
        { limits: { maxIds: 1 } },
      ),
    ).toEqual({
      ok: false,
      error: { code: "tooManyIds", path: "$.selection.ids" },
    });

    expect(
      decodeSelection({
        stateVersion: 1,
        scopeKey: "scope-a",
        scopeRevision: 0,
        selection: { mode: "explicit", ids: ["same", "same", false] },
      }),
    ).toEqual({
      ok: false,
      error: { code: "invalidId", path: "$.selection.ids[2]" },
    });
  });

  it("enforces exact UTF-8 byte limits", () => {
    const payload = {
      stateVersion: 1,
      scopeKey: "é",
      scopeRevision: 0,
      selection: { mode: "explicit", ids: ["😀"] },
    };

    expect(
      decodeSelection(payload, {
        limits: { maxScopeKeyBytes: 2, maxStringIdBytes: 4 },
      }).ok,
    ).toBe(true);
    expect(decodeSelection(payload, { limits: { maxScopeKeyBytes: 1 } })).toEqual({
      ok: false,
      error: { code: "stringTooLong", path: "$.scopeKey" },
    });
    expect(decodeSelection(payload, { limits: { maxStringIdBytes: 3 } })).toEqual({
      ok: false,
      error: { code: "stringTooLong", path: "$.selection.ids[0]" },
    });
  });

  it("rejects empty explicit state and unknown fields", () => {
    expect(
      decodeSelection({
        stateVersion: 1,
        scopeKey: "scope-a",
        scopeRevision: 0,
        selection: { mode: "explicit", ids: [] },
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "emptyExplicitSelection",
        path: "$.selection.ids",
      },
    });

    expect(
      decodeSelection({
        stateVersion: 1,
        scopeKey: "scope-a",
        scopeRevision: 0,
        selection: { mode: "empty" },
        filters: { browserControlled: true },
      }),
    ).toEqual({
      ok: false,
      error: { code: "unexpectedField", path: "$.filters" },
    });
  });

  it("does not throw for hostile payload contents", () => {
    const throwingProxy = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error("trap");
        },
      },
    );

    expect(() => decodeSelection(throwingProxy)).not.toThrow();
    expect(decodeSelection(throwingProxy)).toEqual({
      ok: false,
      error: { code: "invalidPayload", path: "$" },
    });
  });

  it("is total over arbitrary JSON-compatible payloads", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (payload) => {
        expect(() => decodeSelection(payload)).not.toThrow();
      }),
      { numRuns: 200, seed: PROPERTY_SEED },
    );
  });

  it("does not read missing IDs or field names from array prototypes", () => {
    const inheritedIds = new Array(1);
    Object.setPrototypeOf(inheritedIds, { 0: "inherited-id" });

    expect(
      decodeSelection({
        stateVersion: 1,
        scopeKey: "scope-a",
        scopeRevision: 0,
        selection: { mode: "explicit", ids: inheritedIds },
      }),
    ).toEqual({
      ok: false,
      error: { code: "missingField", path: "$.selection.ids[0]" },
    });

    const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, "0");
    let result: ReturnType<typeof decodeSelection> | undefined;
    try {
      Object.defineProperty(Array.prototype, "0", {
        configurable: true,
        value: "polluted",
        writable: true,
      });
      result = decodeSelection({
        stateVersion: 1,
        scopeKey: "scope-a",
        scopeRevision: 0,
        selection: { mode: "empty" },
      });
    } finally {
      if (descriptor === undefined) {
        Reflect.deleteProperty(Array.prototype, "0");
      } else {
        Object.defineProperty(Array.prototype, "0", descriptor);
      }
    }

    expect(result).toEqual({
      ok: true,
      value: emptySelection("scope-a"),
    });
  });

  it("throws TypeError only for invalid programmer configuration", () => {
    expect(() => decodeSelection({}, { limits: { maxIds: 0 } })).toThrow(TypeError);
    expect(() => decodeSelection({}, { limits: { maxIds: null } } as never)).toThrow(TypeError);
    expect(() => decodeSelection({}, { decodeId: "not-a-function" } as never)).toThrow(TypeError);
    expect(() => decodeSelection({}, { limits: { maxId: 1 } } as never)).toThrow(
      /limits\.maxId is not supported/,
    );
    expect(() => decodeSelection({}, { unexpected: true } as never)).toThrow(
      /options\.unexpected is not supported/,
    );
  });

  it("rejects codec configuration inherited from custom prototypes", () => {
    const payload = {
      stateVersion: 1,
      scopeKey: "scope-a",
      scopeRevision: 0,
      selection: { mode: "explicit", ids: [1, 2] },
    };
    const inheritedDecoder = Object.create({
      decodeId: () => ({ ok: false, code: "inherited" }),
    }) as {
      decodeId: () => { ok: false; code: string };
    };
    const inheritedLimits = Object.create({ maxIds: 1 }) as Record<string, never>;

    expect(() => decodeSelection(payload, inheritedDecoder)).toThrow(
      "Codec options must be a plain object",
    );
    expect(() => decodeSelection(payload, { limits: inheritedLimits })).toThrow(
      "limits must be a plain object",
    );
  });
});

describe("bulk conversion", () => {
  it("converts empty, explicit, and all-matching states without scope UI data", () => {
    const empty = emptySelection("scope-a");
    const explicit = appliedState(
      setIdsSelected(empty, {
        context: { scopeKey: "scope-a", scopeRevision: 0 },
        ids: [1, "1"],
        selected: true,
      }),
    );
    const allMatching = appliedState(
      selectAllMatching(explicit, {
        scopeKey: "scope-a",
        scopeRevision: 0,
        scopeToken: "opaque",
      }),
    );

    expect(toBulkSelection(empty)).toEqual({ ok: true, value: null });
    expect(toBulkSelection(explicit)).toEqual({
      ok: true,
      value: { protocolVersion: 1, mode: "explicit", ids: [1, "1"] },
    });
    expect(toBulkSelection(allMatching)).toEqual({
      ok: true,
      value: {
        protocolVersion: 1,
        mode: "allMatching",
        scopeToken: "opaque",
        excludedIds: [],
      },
    });
  });

  it("returns bounded conversion failures in list, token, then ID order", () => {
    let state = emptySelection("scope-a");
    state = appliedState(
      setIdsSelected(state, {
        context: { scopeKey: "scope-a", scopeRevision: 0 },
        ids: ["😀", "second"],
        selected: true,
      }),
    );

    expect(toBulkSelection(state, { maxIds: 1, maxStringIdBytes: 1 })).toEqual({
      ok: false,
      reason: "tooManyIds",
    });
    expect(toBulkSelection(state, { maxStringIdBytes: 3 })).toEqual({
      ok: false,
      reason: "idTooLong",
    });

    const allMatching = appliedState(
      selectAllMatching(state, {
        scopeKey: "scope-a",
        scopeRevision: 0,
        scopeToken: "long-token",
      }),
    );
    expect(toBulkSelection(allMatching, { maxScopeTokenBytes: 4 })).toEqual({
      ok: false,
      reason: "tokenTooLong",
    });
    expect(() => toBulkSelection(allMatching, { maxTokenBytes: 4 } as never)).toThrow(
      /limits\.maxTokenBytes is not supported/,
    );
  });

  it("does not alias state arrays in encoded output", () => {
    const state = appliedState(
      setIdsSelected(emptySelection("scope-a"), {
        context: { scopeKey: "scope-a", scopeRevision: 0 },
        ids: [1],
        selected: true,
      }),
    );
    const encoded = encodeSelection(state);
    const bulk = toBulkSelection(state);

    if (state.mode !== "explicit" || encoded.selection.mode !== "explicit") {
      throw new Error("expected explicit state");
    }
    expect(encoded.selection.ids).not.toBe(state.ids);
    if (!bulk.ok || bulk.value?.mode !== "explicit") throw new Error("expected explicit bulk");
    expect(bulk.value.ids).not.toBe(state.ids);
  });
});
