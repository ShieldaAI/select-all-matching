# Server integration

`decodeBulkSelection` validates selection syntax. Your endpoint resolves what those IDs or the
scope mean for the current caller. The [reference server](https://github.com/ShieldaAI/select-all-matching/blob/main/examples/server-table/server.mjs)
implements the full path using in-memory data and a fixed local demo session.

## Before decoding

Authenticate the request and apply your normal CSRF protection. Require the expected content type
and enforce a whole-body byte limit while reading the stream, before `JSON.parse`. The decoder's
ID and string limits do not prevent a huge HTTP body from being buffered first.

```ts
import { decodeBulkSelection } from "select-all-matching/server";

const decoded = decodeBulkSelection(body, {
  limits: { maxIds: 1_000 },
  decodeId(value) {
    return typeof value === "string" && /^cus_[0-9]+$/.test(value)
      ? { ok: true, value }
      : { ok: false, code: "invalid_customer_id" };
  },
});
if (!decoded.ok) {
  return Response.json({ error: "Invalid selection" }, { status: 400 });
}
```

The application's ID decoder may narrow the type but cannot convert the value. String `"1"` and
number `1` remain different. Use the same list limits when the client calls `toBulkSelection`.
Do not return token values, untrusted field paths, or raw decoder diagnostics in routine logs.

## Issue an all-matching scope

The list endpoint applies read access and supplies an opaque scope key. A token endpoint can
create a random handle referencing a server record containing:

- subject and tenant;
- resource and allowed operation;
- validated, normalized candidate filters;
- expiry and any consistency revision your application needs.

Use sufficient random entropy, bounded storage, and expiry. The token is a lookup reference, not
permission. Do not encode a trusted query directly from client JSON. Do not reuse a handle for a
different tenant, operation, or candidate set.

The library also works with an application-owned signed token, but provides no signer or token
storage. A signed token still needs binding, expiry, query validation, and current authorization.

## Resolve and authorize the operation

For explicit mode, authorize each supplied ID against the authenticated tenant, resource, operation,
and current row eligibility. Explicit requests deliberately omit the old filter: an authorized row
can still be acted on after it stops matching that filter. If your product needs explicit IDs to
remain in their original query, enforce a separate server-owned query constraint.

For all-matching mode:

1. Look up the token and reject unknown, expired, revoked, or mismatched bindings.
2. Recover the candidate query from the server record.
3. Apply the current caller's authorization and row eligibility to that query.
4. Apply the excluded-ID predicate and preview or execute the operation.

The operation comes from the route or server code. A selection payload must not select its own
privileged operation. Use one external error for failed token bindings when more detailed errors
could disclose another user's resources. Decide whether missing or ineligible explicit IDs fail
the whole action or are skipped, and use that policy consistently.

Do this in the database or on the server. Do not return all matching IDs to the browser. Exclusions
are a bounded predicate on the authorized query; they must never widen it.

## Data changes between preview and execution

The reference app uses live-query semantics: execution sees current rows and permissions. A preview
is advisory and execution repeats resolution and authorization. The final count may differ.

If your product promises an exact snapshot, store a server snapshot or enforce a dataset revision.
That is an application contract, not something an opaque token automatically provides. Use a
transaction or other suitable consistency mechanism so checks still hold when the write commits.

For operations with external effects, also choose an idempotency and partial-failure policy. This
library does not retry actions, manage transactions, or run background jobs.

## Upgrading the beta

The 1.x decoder accepts protocol versions 0 and 1 and returns a version-1 value. Deploy it before
clients that emit version 1. See [versioning](./versioning.md) for format retention and state transfer.
