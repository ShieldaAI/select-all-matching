import assert from "node:assert/strict";
import test from "node:test";
import { createTableController } from "./controller.mjs";

const filter = (status) => ({ status, search: "" });
const page = (scopeKey, rows = []) => ({
  scopeKey,
  rows,
  page: 1,
  pageSize: 25,
  total: rows.length,
});
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("A -> B -> A discards out-of-order pages and commands from the first A", async () => {
  const loads = [];
  const controller = createTableController({
    loadRows: () => {
      const next = deferred();
      loads.push(next);
      return next.promise;
    },
    createScope: () => {
      throw new Error("unused");
    },
  });
  const first = controller.load(filter("all"));
  loads[0].resolve(page("A"));
  await first;
  const firstContext = controller.snapshot().state;
  controller.selectIds(firstContext, ["row-1"], true);
  const second = controller.load(filter("paid"));
  const third = controller.load(filter("all"));
  loads[2].resolve(page("A"));
  await third;
  loads[1].resolve(page("B"));
  await second;
  assert.equal(controller.snapshot().state.scopeKey, "A");
  assert.equal(controller.snapshot().state.mode, "empty");
  assert.ok(controller.snapshot().state.scopeRevision > firstContext.scopeRevision);
  controller.selectIds(firstContext, ["row-1"], true);
  assert.equal(controller.snapshot().state.mode, "empty");
});

test("clearing an empty selection cancels a pending select-all request", async () => {
  const token = deferred();
  const controller = createTableController({
    loadRows: async () => page("A"),
    createScope: () => token.promise,
  });
  await controller.load();
  const request = controller.selectAll();
  assert.equal(controller.snapshot().requestingScope, true);
  controller.clear();
  token.resolve({ scopeKey: "A", scopeToken: "late-token" });
  await request;
  assert.equal(controller.snapshot().state.mode, "empty");
  assert.equal(controller.snapshot().requestingScope, false);
});

test("checkbox edits made while a scope loads survive the late response", async () => {
  const token = deferred();
  const controller = createTableController({
    loadRows: async () => page("A"),
    createScope: () => token.promise,
  });
  await controller.load();
  const request = controller.selectAll();
  controller.selectIds(controller.snapshot().state, ["row-1"], true);
  token.resolve({ scopeKey: "A", scopeToken: "late-token" });
  await request;
  assert.equal(controller.snapshot().state.mode, "explicit");
  assert.deepEqual(controller.snapshot().state.ids, ["row-1"]);
});

test("the newest scope request wins and late failures do not overwrite it", async () => {
  const scopes = [deferred(), deferred()];
  let index = 0;
  const controller = createTableController({
    loadRows: async () => page("A"),
    createScope: () => scopes[index++].promise,
  });
  await controller.load();
  const old = controller.selectAll();
  const fresh = controller.selectAll();
  scopes[1].resolve({ scopeKey: "A", scopeToken: "fresh-token" });
  await fresh;
  scopes[0].reject(new Error("old failure"));
  await old;
  assert.equal(controller.snapshot().state.scopeToken, "fresh-token");
  assert.equal(controller.snapshot().error, "");
});

test("pagination keeps selection but a new filter cancels token requests", async () => {
  const token = deferred();
  const controller = createTableController({
    loadRows: async ({ filter: current }) => page(current.status),
    createScope: () => token.promise,
  });
  await controller.load();
  controller.selectIds(controller.snapshot().state, ["row-1"], true);
  await controller.load(undefined, 2);
  assert.deepEqual(controller.snapshot().state.ids, ["row-1"]);
  const pending = controller.selectAll();
  await controller.load(filter("paid"), 1);
  token.resolve({ scopeKey: "all", scopeToken: "old-filter-token" });
  await pending;
  assert.equal(controller.snapshot().state.scopeKey, "paid");
  assert.equal(controller.snapshot().state.mode, "empty");
});

test("repeated select-all preserves exclusions", async () => {
  let scopeCalls = 0;
  const controller = createTableController({
    loadRows: async () => page("A"),
    createScope: async () => {
      scopeCalls += 1;
      return { scopeKey: "A", scopeToken: "token" };
    },
  });
  await controller.load();
  await controller.selectAll();
  controller.selectIds(controller.snapshot().state, ["row-1"], false);
  await controller.selectAll();
  assert.deepEqual(controller.snapshot().state.excludedIds, ["row-1"]);
  assert.equal(scopeCalls, 1);
});

test("a failed page request keeps the displayed rows and page number together", async () => {
  const controller = createTableController({
    loadRows: async ({ page: requestedPage }) => {
      if (requestedPage !== 1) throw new Error("connection lost");
      return page("A", [{ id: "row-1" }]);
    },
    createScope: () => {
      throw new Error("unused");
    },
  });
  await controller.load();
  await controller.load(undefined, 2);
  assert.equal(controller.snapshot().page, 1);
  assert.equal(controller.snapshot().data.page, 1);
  assert.equal(controller.snapshot().data.rows[0].id, "row-1");
  assert.equal(controller.snapshot().loading, false);
  assert.equal(controller.snapshot().error, "connection lost");
});

for (const command of ["clear", "selectIds"]) {
  test(`a stale ${command} event cannot cancel the current scope request after A -> B -> A`, async () => {
    const token = deferred();
    const controller = createTableController({
      loadRows: async ({ filter: current }) => page(current.status),
      createScope: () => token.promise,
    });
    await controller.load();
    const staleContext = controller.snapshot().state;
    await controller.load(filter("paid"));
    await controller.load(filter("all"));
    const request = controller.selectAll();
    if (command === "clear") controller.clear(staleContext);
    else controller.selectIds(staleContext, ["row-1"], true);
    assert.equal(controller.snapshot().requestingScope, true);
    token.resolve({ scopeKey: "all", scopeToken: "current-token" });
    await request;
    assert.equal(controller.snapshot().state.mode, "allMatching");
    assert.equal(controller.snapshot().state.scopeToken, "current-token");
  });
}
