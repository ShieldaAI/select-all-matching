import { describe, expect, it } from "vitest";

import { DEFAULT_BULK_LIMITS, decodeSelection, toBulkSelection } from "../../src/index.js";
import { decodeBulkSelection } from "../../src/server/index.js";

describe("codec limits", () => {
  it.each([3, DEFAULT_BULK_LIMITS.maxIds])(
    "accepts exactly %i IDs and rejects one more in either mode",
    (maxIds) => {
      const ids = Array.from({ length: maxIds }, (_, index) => index);

      for (const mode of ["explicit", "allMatching"] as const) {
        const selection =
          mode === "explicit" ? { mode, ids } : { mode, scopeToken: "opaque", excludedIds: ids };
        const encoded = {
          stateVersion: 1,
          scopeKey: "customers:active",
          scopeRevision: 0,
          selection,
        };
        const wire = { protocolVersion: 1, ...selection };
        const decoded = decodeSelection(encoded, { limits: { maxIds } });
        expect(decoded.ok).toBe(true);
        if (!decoded.ok) throw new Error("Expected selection at the limit to decode");
        expect(toBulkSelection(decoded.value, { maxIds })).toEqual({ ok: true, value: wire });
        expect(decodeBulkSelection(wire, { limits: { maxIds } })).toEqual({
          ok: true,
          value: wire,
        });

        // The decoded state keeps its own copy of the input IDs.
        ids.push(maxIds);
        const listField = mode === "explicit" ? "ids" : "excludedIds";
        expect(decodeSelection(encoded, { limits: { maxIds } })).toEqual({
          ok: false,
          error: { code: "tooManyIds", path: `$.selection.${listField}` },
        });
        expect(decodeBulkSelection(wire, { limits: { maxIds } })).toEqual({
          ok: false,
          error: { code: "tooManyIds", path: `$.${listField}` },
        });
        expect(toBulkSelection(decoded.value, { maxIds })).toEqual({
          ok: true,
          value: { ...wire, [listField]: ids.slice(0, maxIds) },
        });
        expect(toBulkSelection(decoded.value, { maxIds: maxIds - 1 })).toEqual({
          ok: false,
          reason: "tooManyIds",
        });
        ids.pop();
      }
    },
  );

  it.each(["a", "é", "€", "😀", "\ud800", "\udfff", "a😀é"])(
    "matches TextEncoder at byte boundaries for %j",
    (text) => {
      const bytes = new TextEncoder().encode(text).byteLength;
      const limits = {
        maxScopeKeyBytes: bytes,
        maxScopeTokenBytes: bytes,
        maxStringIdBytes: bytes,
      };
      const encoded = {
        stateVersion: 1,
        scopeKey: text,
        scopeRevision: 0,
        selection: { mode: "allMatching", scopeToken: text, excludedIds: [text] },
      };
      const wire = { protocolVersion: 1, ...encoded.selection };
      const bulkLimits = { maxScopeTokenBytes: bytes, maxStringIdBytes: bytes };
      const decoded = decodeSelection(JSON.parse(JSON.stringify(encoded)), { limits });
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) throw new Error("Expected exact byte limits to pass");
      expect(toBulkSelection(decoded.value, bulkLimits)).toEqual({ ok: true, value: wire });
      expect(decodeBulkSelection(JSON.parse(JSON.stringify(wire)), { limits: bulkLimits })).toEqual(
        {
          ok: true,
          value: wire,
        },
      );

      expect(decodeSelection({ ...encoded, scopeKey: text + "a" }, { limits })).toEqual({
        ok: false,
        error: { code: "stringTooLong", path: "$.scopeKey" },
      });

      for (const selection of [
        { ...encoded.selection, scopeToken: text + "a" },
        { ...encoded.selection, excludedIds: [text + "a"] },
      ]) {
        const field = selection.scopeToken === text ? "excludedIds[0]" : "scopeToken";
        expect(decodeSelection({ ...encoded, selection }, { limits })).toEqual({
          ok: false,
          error: { code: "stringTooLong", path: `$.selection.${field}` },
        });
        expect(
          decodeBulkSelection({ protocolVersion: 1, ...selection }, { limits: bulkLimits }),
        ).toEqual({
          ok: false,
          error: { code: "stringTooLong", path: `$.${field}` },
        });

        const unbounded = decodeSelection({ ...encoded, selection });
        if (!unbounded.ok) throw new Error("Expected default limits to accept short strings");
        expect(toBulkSelection(unbounded.value, bulkLimits)).toEqual({
          ok: false,
          reason: field === "scopeToken" ? "tokenTooLong" : "idTooLong",
        });
      }
    },
  );
});
