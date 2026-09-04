import fc from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";

import * as publicServerApi from "../../src/server/index.js";

const PROPERTY_SEED = 0x5e2be2;
const { decodeBulkSelection } = publicServerApi;

describe("decodeBulkSelection", () => {
  it("exports only the documented runtime API", () => {
    expect(Object.keys(publicServerApi).sort()).toEqual([
      "DEFAULT_BULK_LIMITS",
      "decodeBulkSelection",
    ]);
  });

  it("decodes explicit and all-matching draft requests", () => {
    expect(
      decodeBulkSelection({
        protocolVersion: 0,
        mode: "explicit",
        ids: [1, "1", -0],
      }),
    ).toEqual({
      ok: true,
      value: {
        protocolVersion: 0,
        mode: "explicit",
        ids: [1, "1", 0],
      },
    });

    expect(
      decodeBulkSelection({
        protocolVersion: 0,
        mode: "allMatching",
        scopeToken: "opaque-token",
        excludedIds: [4, "4"],
      }),
    ).toEqual({
      ok: true,
      value: {
        protocolVersion: 0,
        mode: "allMatching",
        scopeToken: "opaque-token",
        excludedIds: [4, "4"],
      },
    });
  });

  it("infers a branded result only when a decoder is supplied", () => {
    type CustomerId = string & { readonly customerId: unique symbol };
    const result = decodeBulkSelection(
      { protocolVersion: 0, mode: "explicit", ids: ["cus_1"] },
      {
        decodeId(value) {
          return typeof value === "string" && value.startsWith("cus_")
            ? { ok: true, value: value as CustomerId }
            : { ok: false, code: "invalidCustomerId" };
        },
      },
    );

    expectTypeOf(result).toEqualTypeOf<
      publicServerApi.PayloadDecodeResult<publicServerApi.BulkSelectionDraft<CustomerId>>
    >();
    expect(result.ok).toBe(true);
  });

  it("rejects versions, fields, modes, and empty explicit requests", () => {
    expect(decodeBulkSelection({ protocolVersion: 2, mode: "explicit", ids: [] })).toEqual({
      ok: false,
      error: { code: "unsupportedVersion", path: "$.protocolVersion" },
    });
    expect(decodeBulkSelection({ protocolVersion: 0, mode: "page", ids: [1] })).toEqual({
      ok: false,
      error: { code: "invalidMode", path: "$.mode" },
    });
    expect(
      decodeBulkSelection({
        protocolVersion: 0,
        mode: "explicit",
        ids: [],
        scopeKey: "browser-scope",
      }),
    ).toEqual({
      ok: false,
      error: { code: "unexpectedField", path: "$.scopeKey" },
    });
    expect(decodeBulkSelection({ protocolVersion: 0, mode: "explicit", ids: [] })).toEqual({
      ok: false,
      error: { code: "emptyExplicitSelection", path: "$.ids" },
    });
  });

  it("checks list length, token, IDs, and duplicates in deterministic order", () => {
    expect(
      decodeBulkSelection(
        {
          protocolVersion: 0,
          mode: "allMatching",
          scopeToken: 123,
          excludedIds: [false, false],
        },
        { limits: { maxIds: 1 } },
      ),
    ).toEqual({
      ok: false,
      error: { code: "tooManyIds", path: "$.excludedIds" },
    });

    expect(
      decodeBulkSelection({
        protocolVersion: 0,
        mode: "allMatching",
        scopeToken: 123,
        excludedIds: [false],
      }),
    ).toEqual({
      ok: false,
      error: { code: "invalidType", path: "$.scopeToken" },
    });

    expect(
      decodeBulkSelection({
        protocolVersion: 0,
        mode: "explicit",
        ids: ["same", "same", null],
      }),
    ).toEqual({
      ok: false,
      error: { code: "invalidId", path: "$.ids[2]" },
    });

    expect(
      decodeBulkSelection({
        protocolVersion: 0,
        mode: "explicit",
        ids: ["same", "same"],
      }),
    ).toEqual({
      ok: false,
      error: { code: "duplicateId", path: "$.ids[1]" },
    });
  });

  it("uses UTF-8 bytes for token and string-ID limits", () => {
    expect(
      decodeBulkSelection(
        {
          protocolVersion: 0,
          mode: "allMatching",
          scopeToken: "😀",
          excludedIds: ["é"],
        },
        { limits: { maxScopeTokenBytes: 4, maxStringIdBytes: 2 } },
      ).ok,
    ).toBe(true);

    expect(
      decodeBulkSelection(
        {
          protocolVersion: 0,
          mode: "allMatching",
          scopeToken: "😀",
          excludedIds: [],
        },
        { limits: { maxScopeTokenBytes: 3 } },
      ),
    ).toEqual({
      ok: false,
      error: { code: "stringTooLong", path: "$.scopeToken" },
    });
  });

  it("rejects holes even when an array prototype supplies an ID", () => {
    const ids = new Array(1);
    Object.setPrototypeOf(ids, { 0: "inherited-id" });

    expect(decodeBulkSelection({ protocolVersion: 0, mode: "explicit", ids })).toEqual({
      ok: false,
      error: { code: "missingField", path: "$.ids[0]" },
    });
  });

  it("turns decoder exceptions and malformed output into invalid-ID errors", () => {
    const payload = { protocolVersion: 0, mode: "explicit", ids: ["id"] };

    expect(
      decodeBulkSelection(payload, {
        decodeId() {
          throw new Error("private failure");
        },
      }),
    ).toEqual({
      ok: false,
      error: { code: "invalidId", path: "$.ids[0]" },
    });

    expect(
      decodeBulkSelection(payload, {
        decodeId: (() => ({ ok: true, value: "" })) as never,
      }),
    ).toEqual({
      ok: false,
      error: { code: "invalidId", path: "$.ids[0]" },
    });

    expect(
      decodeBulkSelection(payload, {
        decodeId: () => ({ ok: false, code: "unsafe\ncode" }),
      }),
    ).toEqual({
      ok: false,
      error: { code: "invalidId", path: "$.ids[0]" },
    });
  });

  it("never throws for payload contents but rejects invalid limits", () => {
    const throwingProxy = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error("trap");
        },
      },
    );

    expect(() => decodeBulkSelection(throwingProxy)).not.toThrow();
    expect(decodeBulkSelection(throwingProxy)).toEqual({
      ok: false,
      error: { code: "invalidPayload", path: "$" },
    });
    expect(() => decodeBulkSelection({}, { limits: { maxScopeTokenBytes: -1 } })).toThrow(
      TypeError,
    );
  });

  it("is total over arbitrary JSON-compatible requests", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (payload) => {
        expect(() => decodeBulkSelection(payload)).not.toThrow();
      }),
      { numRuns: 200, seed: PROPERTY_SEED },
    );
  });
});
