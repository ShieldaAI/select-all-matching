import assert from "node:assert/strict";
import { emptySelection, setIdsSelected, toBulkSelection } from "select-all-matching";
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
    value: { protocolVersion: 0, mode: "explicit", ids: [1, "1"] },
  });

  if (request.ok && request.value) {
    assert.deepEqual(decodeBulkSelection(request.value), request);
  }
}
