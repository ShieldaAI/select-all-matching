import assert from "node:assert/strict";
import { once } from "node:events";
import { Worker } from "node:worker_threads";
import {
  decodeSelection,
  emptySelection,
  encodeSelection,
  selectAllMatching,
  setIdsSelected,
  toBulkSelection,
} from "select-all-matching";
import * as copy from "selection-copy";
import { decodeBulkSelection } from "select-all-matching/server";

const empty = emptySelection("customers:active");
const explicit = setIdsSelected(empty, {
  context: { scopeKey: "customers:active", scopeRevision: 0 },
  ids: [1, "1"],
  selected: true,
});

assert.equal(explicit.applied, true, "selection transition must apply");

if (explicit.applied) {
  const request = toBulkSelection(explicit.state);
  assert.deepEqual(request, {
    ok: true,
    value: { protocolVersion: 1, mode: "explicit", ids: [1, "1"] },
  });

  if (request.ok && request.value) {
    assert.deepEqual(decodeBulkSelection(request.value), request);
  }

  const encoded = encodeSelection(explicit.state);
  assert.equal(encoded.stateVersion, 1);
  assert.throws(() => copy.encodeSelection(explicit.state), TypeError);
  const fromOtherCopy = copy.decodeSelection(JSON.parse(JSON.stringify(encoded)));
  assert.equal(fromOtherCopy.ok, true);
  assert.deepEqual(copy.encodeSelection(fromOtherCopy.value), encoded);

  const worker = new Worker(new URL("./worker.mjs", import.meta.url), { workerData: encoded });
  try {
    const [returned] = await once(worker, "message", {
      signal: AbortSignal.timeout(10_000),
    });
    const restored = decodeSelection(returned);
    assert.equal(restored.ok, true);
    assert.deepEqual(toBulkSelection(restored.value), request);
  } finally {
    await worker.terminate();
  }
}

const allMatching = selectAllMatching(empty, {
  scopeKey: "customers:active",
  scopeRevision: 0,
  scopeToken: "server-scope",
});
assert.equal(allMatching.applied, true);
const excluded = setIdsSelected(allMatching.state, {
  context: { scopeKey: "customers:active", scopeRevision: 0 },
  ids: [1, "1"],
  selected: false,
});
assert.equal(excluded.applied, true);
const bulk = toBulkSelection(excluded.state);
assert.deepEqual(bulk, {
  ok: true,
  value: {
    protocolVersion: 1,
    mode: "allMatching",
    scopeToken: "server-scope",
    excludedIds: [1, "1"],
  },
});
assert.deepEqual(decodeBulkSelection(JSON.parse(JSON.stringify(bulk.value))), bulk);
