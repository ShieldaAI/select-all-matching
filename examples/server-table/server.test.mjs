import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import test from "node:test";
import {
  emptySelection,
  selectAllMatching,
  setIdsSelected,
  toBulkSelection,
} from "select-all-matching";
import { BODY_LIMIT, createDemoServer } from "./server.mjs";

const basePath = "/api/tenants/north/invoices";
const bulkPath = `${basePath}/mark-reviewed`;
const explicit = (ids) => {
  const state = emptySelection("test");
  return toBulkSelection(setIdsSelected(state, { context: state, ids, selected: true }).state)
    .value;
};

async function fixture(t) {
  let time = 1_000;
  const server = createDemoServer({ now: () => time, tokenTtlMs: 100 });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  async function call(path, { body, raw, session = "north-alex", headers = {} } = {}) {
    const response = await fetch(`${origin}${path}`, {
      method: body !== undefined || raw !== undefined ? "POST" : "GET",
      headers: {
        ...(session ? { cookie: `demo-session=${session}` } : {}),
        "Content-Type": "application/json",
        "X-Demo-Request": "1",
        ...headers,
      },
      ...(body !== undefined || raw !== undefined ? { body: raw ?? JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  }

  async function scope(filter = { status: "all", search: "" }) {
    const page = await call(`${basePath}?${new URLSearchParams(filter)}`);
    assert.equal(page.status, 200);
    const result = await call(`${bulkPath}/scope`, {
      body: { filter, expectedScopeKey: page.body.scopeKey },
    });
    assert.equal(result.status, 200);
    const state = emptySelection(page.body.scopeKey);
    const selection = selectAllMatching(state, {
      ...state,
      scopeToken: result.body.scopeToken,
    }).state;
    return { selection, page: page.body, token: result.body.scopeToken };
  }
  return {
    server,
    origin,
    call,
    scope,
    advance: (milliseconds) => {
      time += milliseconds;
    },
  };
}

test("lists only a bounded server page with counts and action eligibility", async (t) => {
  const { call } = await fixture(t);
  const first = await call(basePath);
  assert.equal(first.status, 200);
  assert.equal(first.body.total, 40_000);
  assert.equal(first.body.rows.length, 25);
  assert.equal(first.body.rows[0].id, "row-1");
  assert.equal(first.body.rows.find((row) => row.id === "row-11").selectable, false);
  const second = await call(`${basePath}?page=2`);
  assert.equal(second.body.scopeKey, first.body.scopeKey);
  assert.notEqual(second.body.rows[0].id, first.body.rows[0].id);
  const filtered = await call(`${basePath}?status=paid&pageSize=100`);
  assert.equal(filtered.body.rows.length, 100);
  assert.ok(filtered.body.rows.every((row) => row.status === "paid"));
  assert.notEqual(filtered.body.scopeKey, first.body.scopeKey);
  assert.equal((await call(`${basePath}?pageSize=101`)).status, 400);
  assert.equal((await call(`${basePath}?status=unknown`)).status, 400);
});

test("explicit selection crosses pages and apply checks eligibility again", async (t) => {
  const { call } = await fixture(t);
  const selection = explicit(["row-1", "row-97"]);
  assert.deepEqual(await call(`${bulkPath}/preview`, { body: selection }), {
    status: 200,
    body: { count: 2, applied: false },
  });
  assert.deepEqual(await call(`${bulkPath}/apply`, { body: selection }), {
    status: 200,
    body: { count: 2, applied: true },
  });
  assert.deepEqual(await call(`${bulkPath}/apply`, { body: selection }), {
    status: 403,
    body: { error: "selection_unavailable" },
  });
});

test("all matching uses a server scope minus exclusions, with no included ID list", async (t) => {
  const { call, scope } = await fixture(t);
  const { selection, page } = await scope({ status: "open", search: "" });
  const excluded = setIdsSelected(selection, {
    context: selection,
    ids: ["row-1"],
    selected: false,
  }).state;
  const body = toBulkSelection(excluded).value;
  assert.equal(Object.hasOwn(body, "ids"), false);
  assert.equal(JSON.stringify(body).length < 200, true);
  const preview = await call(`${bulkPath}/preview`, { body });
  assert.equal(preview.body.count, page.eligibleCount - 1);
  const result = await call(`${bulkPath}/apply`, { body });
  assert.equal(result.body.count, preview.body.count);
  assert.equal((await call(`${bulkPath}/preview`, { body })).body.count, 0);
  const first = await call(basePath);
  assert.equal(first.body.rows.find((row) => row.id === "row-1").reviewed, false);
  assert.equal(first.body.rows.find((row) => row.id === "row-7").reviewed, true);
});

test("token binding rejects another subject, tenant, resource, and operation", async (t) => {
  const { call, scope } = await fixture(t);
  const { selection } = await scope();
  const body = toBulkSelection(selection).value;
  for (const [path, session] of [
    [`${bulkPath}/preview`, "north-sam"],
    ["/api/tenants/south/invoices/mark-reviewed/preview", "south-alex"],
    ["/api/tenants/north/credits/mark-reviewed/preview", "north-alex"],
    [`${basePath}/mark-follow-up/preview`, "north-alex"],
  ]) {
    assert.deepEqual(await call(path, { body, session }), {
      status: 403,
      body: { error: "selection_unavailable" },
    });
  }
  assert.equal((await call(`${bulkPath}/preview`, { body, session: null })).status, 401);
  assert.equal((await call(`${bulkPath}/preview`, { body, session: "unknown" })).status, 401);
});

test("expiry and permission revocation are checked between preview and execution", async (t) => {
  const { call, scope, advance } = await fixture(t);
  const { selection } = await scope();
  const body = toBulkSelection(selection).value;
  assert.equal((await call(`${bulkPath}/preview`, { body })).status, 200);
  advance(100);
  assert.equal((await call(`${bulkPath}/apply`, { body })).status, 403);
  const fresh = toBulkSelection((await scope()).selection).value;
  await call("/api/demo/permission", { body: { allowed: false } });
  assert.equal((await call(`${bulkPath}/apply`, { body: fresh })).status, 403);
  assert.equal((await call(`${bulkPath}/apply`, { body: explicit(["row-1"]) })).status, 403);
  await call("/api/demo/permission", { body: { allowed: true } });
  assert.equal((await call(`${bulkPath}/apply`, { body: fresh })).status, 403);
  assert.equal(
    (await call(`${bulkPath}/preview`, { body: toBulkSelection((await scope()).selection).value }))
      .status,
    200,
  );
});

test("unknown, cross-tenant, wrong-resource and locked explicit IDs share a rejection", async (t) => {
  const { call } = await fixture(t);
  for (const id of ["row-100001", "row-2", "row-5", "row-11"]) {
    assert.deepEqual(await call(`${bulkPath}/preview`, { body: explicit(["row-1", id]) }), {
      status: 403,
      body: { error: "selection_unavailable" },
    });
  }
  assert.equal((await call(`${bulkPath}/preview`, { body: explicit(["row-1"]) })).body.count, 1);
});

test("rejects malformed bodies and endpoint limits before applying anything", async (t) => {
  const { call } = await fixture(t);
  assert.equal((await call(`${bulkPath}/apply`, { raw: "{" })).body.error, "invalid_json");
  assert.equal((await call(`${bulkPath}/apply`, { raw: "x".repeat(BODY_LIMIT + 1) })).status, 413);
  assert.equal(
    (
      await call(`${bulkPath}/apply`, {
        body: explicit(["row-1"]),
        headers: { "Content-Type": "text/plain" },
      })
    ).status,
    415,
  );
  const valid = explicit(["row-1"]);
  for (const [body, code] of [
    [
      { ...valid, ids: Array.from({ length: 101 }, (_, index) => `row-${index + 1}`) },
      "tooManyIds",
    ],
    [{ ...valid, ids: ["row-1", "row-1"] }, "duplicateId"],
    [{ ...valid, ids: [1] }, "invalidId"],
    [{ ...valid, ids: [] }, "emptyExplicitSelection"],
    [{ ...valid, operation: "delete" }, "unexpectedField"],
    [{ ...valid, protocolVersion: 99 }, "unsupportedVersion"],
    [{ ...valid, ids: ["row-" + "1".repeat(33)] }, "stringTooLong"],
    [
      {
        protocolVersion: valid.protocolVersion,
        mode: "allMatching",
        scopeToken: "x".repeat(65),
        excludedIds: [],
      },
      "stringTooLong",
    ],
  ]) {
    const result = await call(`${bulkPath}/apply`, { body });
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, code);
  }
  assert.equal((await call(`${bulkPath}/preview`, { body: valid })).body.count, 1);
});

test("chunked requests cannot evade the whole-body limit", async (t) => {
  const { origin } = await fixture(t);
  const status = await new Promise((resolve, reject) => {
    const request = httpRequest(
      `${origin}${bulkPath}/apply`,
      {
        method: "POST",
        headers: {
          Cookie: "demo-session=north-alex",
          "Content-Type": "application/json",
          "X-Demo-Request": "1",
        },
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      },
    );
    request.on("error", reject);
    request.write(" ".repeat(BODY_LIMIT));
    request.end("{}");
  });
  assert.equal(status, 413);
});

test("permission revoked while a body streams is rechecked before apply", async (t) => {
  const { server, origin, call } = await fixture(t);
  const payload = JSON.stringify(explicit(["row-1"]));
  const bodyStarted = once(server, "request");
  let finishBody;
  const result = new Promise((resolve, reject) => {
    const request = httpRequest(
      `${origin}${bulkPath}/apply`,
      {
        method: "POST",
        headers: {
          Cookie: "demo-session=north-alex",
          "Content-Type": "application/json",
          "X-Demo-Request": "1",
        },
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      },
    );
    request.on("error", reject);
    request.write(payload.slice(0, -1));
    finishBody = () => request.end(payload.slice(-1));
  });
  // A second request changes the same session before the incomplete body can be parsed.
  await bodyStarted;
  assert.equal((await call("/api/demo/permission", { body: { allowed: false } })).status, 200);
  finishBody();
  assert.equal(await result, 403);
  await call("/api/demo/permission", { body: { allowed: true } });
  assert.equal((await call(`${bulkPath}/preview`, { body: explicit(["row-1"]) })).body.count, 1);
});

test("scope requests reject stale filters and mutations require same-origin JSON", async (t) => {
  const { call } = await fixture(t);
  const filter = { status: "all", search: "" };
  assert.equal(
    (await call(`${bulkPath}/scope`, { body: { filter, expectedScopeKey: "stale" } })).status,
    409,
  );
  assert.equal(
    (
      await call(`${bulkPath}/apply`, {
        body: explicit(["row-1"]),
        headers: { Origin: "https://other.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(`${bulkPath}/apply`, {
        body: explicit(["row-1"]),
        headers: { "X-Demo-Request": "" },
      })
    ).status,
    403,
  );
});

test("an already displayed preview does not freeze a live query's eligible set", async (t) => {
  const { call, scope } = await fixture(t);
  const all = toBulkSelection((await scope()).selection).value;
  const before = await call(`${bulkPath}/preview`, { body: all });
  await call(`${bulkPath}/apply`, { body: explicit(["row-1"]) });
  const after = await call(`${bulkPath}/apply`, { body: all });
  assert.equal(after.body.count, before.body.count - 1);
});
