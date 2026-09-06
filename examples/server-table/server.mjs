import { randomBytes, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { decodeBulkSelection } from "select-all-matching/server";

export const BODY_LIMIT = 16_384;
export const BULK_LIMITS = { maxIds: 100, maxScopeTokenBytes: 64, maxStringIdBytes: 32 };
const directory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = dirname(fileURLToPath(import.meta.resolve("select-all-matching")));
const operations = new Set(["mark-reviewed", "mark-follow-up"]);
const resources = new Set(["invoices", "credits"]);

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function send(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  if (request.headers["content-type"]?.split(";")[0] !== "application/json") {
    throw new HttpError(415, "json_required");
  }
  if (Number(request.headers["content-length"]) > BODY_LIMIT) {
    request.resume();
    throw new HttpError(413, "body_too_large");
  }
  let size = 0;
  const chunks = [];
  // Drain an oversized chunked request without retaining it or parsing any JSON.
  for await (const chunk of request) {
    size += chunk.length;
    if (size <= BODY_LIMIT) chunks.push(chunk);
  }
  if (size > BODY_LIMIT) throw new HttpError(413, "body_too_large");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

function exactObject(value, fields) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field))
  );
}

function readFilter(value) {
  if (
    !exactObject(value, ["status", "search"]) ||
    !["all", "open", "paid"].includes(value.status) ||
    typeof value.search !== "string" ||
    value.search.length > 80
  ) {
    throw new HttpError(400, "invalid_filter");
  }
  return { status: value.status, search: value.search.trim().toLowerCase() };
}

function decodeId(value) {
  return typeof value === "string" && /^row-[1-9][0-9]{0,5}$/.test(value)
    ? { ok: true, value }
    : { ok: false, code: "invalid_row_id" };
}

function makeRows() {
  return Array.from({ length: 100_000 }, (_, index) => {
    const number = index + 1;
    return {
      id: `row-${number}`,
      name: `Invoice ${String(number).padStart(6, "0")}`,
      tenant: number % 2 ? "north" : "south",
      resource: number % 5 ? "invoices" : "credits",
      status: number % 3 ? "open" : "paid",
      locked: number % 11 === 0,
      reviewed: false,
      followUp: false,
    };
  });
}

export function createDemoServer({ now = Date.now, tokenTtlMs = 60_000 } = {}) {
  const rows = makeRows();
  const byId = new Map(rows.map((row) => [row.id, row]));
  const scopes = new Map();
  const sessions = new Map([
    ["north-alex", { subject: "alex", tenant: "north", allowed: true, revision: 0 }],
    ["north-sam", { subject: "sam", tenant: "north", allowed: true, revision: 0 }],
    ["south-alex", { subject: "alex", tenant: "south", allowed: true, revision: 0 }],
  ]);

  function authenticate(request) {
    const cookie = request.headers.cookie
      ?.split(";")
      .find((item) => item.trim().startsWith("demo-session="));
    const session = sessions.get(cookie?.trim().slice("demo-session=".length));
    if (!session) throw new HttpError(401, "sign_in_required");
    return session;
  }

  function authorize(session, tenant) {
    if (session.tenant !== tenant || !session.allowed) {
      throw new HttpError(403, "selection_unavailable");
    }
  }

  function scopeKey(session, resource, filter) {
    return createHash("sha256")
      .update(JSON.stringify([session.subject, session.tenant, resource, filter, session.revision]))
      .digest("hex");
  }

  function matches(row, session, resource, filter) {
    return (
      row.tenant === session.tenant &&
      row.resource === resource &&
      (filter.status === "all" || row.status === filter.status) &&
      (!filter.search || row.name.toLowerCase().includes(filter.search))
    );
  }

  function eligible(row, operation) {
    return !row.locked && !(operation === "mark-reviewed" ? row.reviewed : row.followUp);
  }

  function resolveSelection(selection, session, resource, operation) {
    let candidates;
    if (selection.mode === "explicit") {
      // Missing, unauthorized and ineligible IDs have the same failure policy.
      candidates = selection.ids.map((id) => byId.get(id));
      if (
        candidates.some(
          (row) =>
            !row ||
            row.tenant !== session.tenant ||
            row.resource !== resource ||
            !eligible(row, operation),
        )
      ) {
        throw new HttpError(403, "selection_unavailable");
      }
    } else {
      const scope = scopes.get(selection.scopeToken);
      if (
        !scope ||
        scope.expiresAt <= now() ||
        scope.subject !== session.subject ||
        scope.tenant !== session.tenant ||
        scope.resource !== resource ||
        scope.operation !== operation ||
        scope.revision !== session.revision
      ) {
        throw new HttpError(403, "selection_unavailable");
      }
      const excluded = new Set(selection.excludedIds);
      candidates = rows.filter(
        (row) =>
          matches(row, session, resource, scope.filter) &&
          eligible(row, operation) &&
          !excluded.has(row.id),
      );
    }
    return candidates;
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      if (request.method === "GET" && !url.pathname.startsWith("/api/")) {
        const assets = new Map([
          ["/", ["index.html", "text/html; charset=utf-8"]],
          ["/client.mjs", ["client.mjs", "text/javascript; charset=utf-8"]],
          ["/controller.mjs", ["controller.mjs", "text/javascript; charset=utf-8"]],
          ["/style.css", ["style.css", "text/css; charset=utf-8"]],
        ]);
        let path;
        let contentType;
        if (url.pathname.startsWith("/vendor/") && url.pathname.endsWith(".js")) {
          path = resolve(packageDirectory, url.pathname.slice("/vendor/".length));
          if (!path.startsWith(`${packageDirectory}${sep}`)) throw new HttpError(404, "not_found");
          contentType = "text/javascript; charset=utf-8";
        } else {
          const asset = assets.get(url.pathname);
          if (!asset) throw new HttpError(404, "not_found");
          path = resolve(directory, asset[0]);
          contentType = asset[1];
        }
        const content = await readFile(path);
        response.writeHead(200, {
          "Content-Type": contentType,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          ...(url.pathname === "/" && !request.headers.cookie?.includes("demo-session=")
            ? { "Set-Cookie": "demo-session=north-alex; HttpOnly; SameSite=Strict; Path=/" }
            : {}),
        });
        response.end(content);
        return;
      }

      const session = authenticate(request);
      if (request.method === "POST") {
        // JSON + this header requires a same-origin request; no CORS is enabled.
        if (
          request.headers["x-demo-request"] !== "1" ||
          (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`)
        ) {
          throw new HttpError(403, "origin_rejected");
        }
      }
      if (request.method === "POST" && url.pathname === "/api/demo/permission") {
        const input = await readJson(request);
        if (!exactObject(input, ["allowed"]) || typeof input.allowed !== "boolean")
          throw new HttpError(400, "invalid_permission");
        session.allowed = input.allowed;
        session.revision += 1;
        send(response, 200, { allowed: session.allowed });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/demo/expire-scopes") {
        const input = await readJson(request);
        if (!exactObject(input, [])) throw new HttpError(400, "invalid_request");
        for (const scope of scopes.values()) {
          if (scope.subject === session.subject && scope.tenant === session.tenant)
            scope.expiresAt = now();
        }
        send(response, 200, { expired: true });
        return;
      }

      const route =
        /^\/api\/tenants\/(north|south)\/(invoices|credits)(?:\/(mark-reviewed|mark-follow-up)\/(scope|preview|apply))?$/.exec(
          url.pathname,
        );
      if (!route) throw new HttpError(404, "not_found");
      const [, tenant, resource, operation, action] = route;
      if (!resources.has(resource)) throw new HttpError(404, "not_found");
      if (session.tenant !== tenant) throw new HttpError(403, "selection_unavailable");

      if (request.method === "GET" && !action) {
        const filter = readFilter({
          status: url.searchParams.get("status") ?? "all",
          search: url.searchParams.get("search") ?? "",
        });
        const page = Number(url.searchParams.get("page") ?? 1);
        const pageSize = Number(url.searchParams.get("pageSize") ?? 25);
        if (
          !Number.isSafeInteger(page) ||
          page < 1 ||
          !Number.isSafeInteger(pageSize) ||
          pageSize < 1 ||
          pageSize > 100
        )
          throw new HttpError(400, "invalid_page");
        const candidates = rows.filter((row) => matches(row, session, resource, filter));
        send(response, 200, {
          scopeKey: scopeKey(session, resource, filter),
          total: candidates.length,
          eligibleCount: session.allowed
            ? candidates.filter((row) => eligible(row, "mark-reviewed")).length
            : 0,
          page,
          pageSize,
          canReview: session.allowed,
          rows: candidates.slice((page - 1) * pageSize, page * pageSize).map((row) => ({
            id: row.id,
            name: row.name,
            status: row.status,
            locked: row.locked,
            reviewed: row.reviewed,
            selectable: session.allowed && eligible(row, "mark-reviewed"),
          })),
        });
        return;
      }

      if (request.method !== "POST" || !operations.has(operation))
        throw new HttpError(404, "not_found");
      authorize(session, tenant);
      const input = await readJson(request);
      // Reading a streamed body can outlast a permission change.
      authorize(session, tenant);
      if (action === "scope") {
        if (!exactObject(input, ["filter", "expectedScopeKey"]))
          throw new HttpError(400, "invalid_scope_request");
        const filter = readFilter(input.filter);
        const key = scopeKey(session, resource, filter);
        if (input.expectedScopeKey !== key) throw new HttpError(409, "scope_changed");
        for (const [token, scope] of scopes) if (scope.expiresAt <= now()) scopes.delete(token);
        if (scopes.size >= 1_000) throw new HttpError(429, "too_many_scopes");
        const token = randomBytes(32).toString("base64url");
        const expiresAt = now() + tokenTtlMs;
        scopes.set(token, {
          subject: session.subject,
          tenant,
          resource,
          operation,
          filter,
          revision: session.revision,
          expiresAt,
        });
        send(response, 200, { scopeToken: token, scopeKey: key, expiresAt });
        return;
      }

      const decoded = decodeBulkSelection(input, { decodeId, limits: BULK_LIMITS });
      if (!decoded.ok) {
        send(response, 400, decoded);
        return;
      }
      const selected = resolveSelection(decoded.value, session, resource, operation);
      // No await between current authorization, resolution and this in-memory update.
      if (action === "apply") {
        for (const row of selected) {
          if (operation === "mark-reviewed") row.reviewed = true;
          else row.followUp = true;
        }
      }
      send(response, 200, { count: selected.length, applied: action === "apply" });
    } catch (error) {
      send(response, error instanceof HttpError ? error.status : 500, {
        error: error instanceof HttpError ? error.code : "server_error",
      });
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT ?? 4173);
  createDemoServer().listen(port, "127.0.0.1", () => {
    process.stdout.write(`Table example: http://127.0.0.1:${port}\n`);
  });
}
