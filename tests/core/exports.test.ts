import { describe, expect, it } from "vitest";

import * as publicApi from "../../src/index.js";

describe("public runtime exports", () => {
  it("exports only the documented runtime API", () => {
    expect(Object.keys(publicApi).sort()).toEqual([
      "DEFAULT_BULK_LIMITS",
      "DEFAULT_STATE_DECODE_LIMITS",
      "applySelectionCommand",
      "clearSelection",
      "createSelectionView",
      "decodeSelection",
      "emptySelection",
      "encodeSelection",
      "getPageSelection",
      "isIdSelected",
      "reconcileScope",
      "refreshScopeToken",
      "selectAllMatching",
      "setIdSelected",
      "setIdsSelected",
      "summarizeSelectionState",
      "toBulkSelection",
    ]);
  });
});
