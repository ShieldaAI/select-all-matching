# Server-paginated invoice table

A browser table backed by a real HTTP server and 100,000 deterministic records. The browser gets
25 rows at a time. Its bulk request contains either explicit IDs or a random server handle and
excluded IDs. The table and server import the installed package's public exports.

From the repository root:

```sh
npm install
npm run example
```

The runner packs the current library, installs that tarball into a temporary copy of this example,
and starts it at <http://127.0.0.1:4173>. The example has no runtime dependencies besides the library.
For a standalone copy, install a library tarball here and run `npm start`.

Try selecting a page, moving to the next page, and selecting all matching. Uncheck a row to add an
exclusion. Changing the filter clears selection; changing the page preserves it. Locked and reviewed
rows are disabled. A preview reports the current eligible count from the server. Mark reviewed
checks again and changes only in-memory flags.

Open **Request and server checks** to expire scope tokens or revoke the current user's permission.
The next bulk request fails even though the browser still holds the selection. Restore permission,
apply the filter again, and select again to continue. Scope tokens also expire after 60 seconds.

## Where to look

- `controller.mjs`: scope changes, stale page responses, lazy token cancellation, and checkbox state.
- `client.mjs`: native checkbox rendering, mixed page selection, and JSON requests.
- `server.mjs`: paging, authoritative filters, token storage, ID decoding, and current authorization.
- `server.test.mjs` and `controller.test.mjs`: HTTP boundaries and deterministic response races.

Run `npm test` from an installed copy of the example. The repository's example checks run the same
tests against its packed library.

## Server rules in this example

North workspace has 40,000 invoices in the 100,000-record dataset. Other records belong to South or
to a separate credits resource. Tokens are 256-bit random handles stored with subject, tenant,
resource, operation, normalized filter, permission revision, and expiry. They never grant access.

Every bulk endpoint takes its operation from the route. It authenticates the session, checks current
permission, bounds the body before JSON parsing, decodes up to 100 IDs or exclusions, and resolves
the selection. Token binding or explicit-ID authorization failures share one response. Explicit
selection fails as a whole if any row is missing, inaccessible, locked, or already reviewed. All
matching intersects its live filter with current eligible rows before subtracting exclusions.

An explicit request acts on its IDs even if they no longer match the filter where they were selected.
Preview is advisory: an invoice reviewed after preview is excluded from a later all-matching action.
An explicit action containing that invoice fails as a whole. The server sends only counts after bulk
operations, so the client never receives every matching ID.

## Demo limitations

This server is for localhost. It sets a fixed `demo-session=north-alex` cookie on the first page load;
tests also use `north-sam` and `south-alex`. Those cookie values are deliberately guessable, and the
permission/expiry endpoints are demonstration controls. Replace them with real authentication and
administrator-only controls before adapting this code. JSON, a required custom header, same-origin
checks, and no CORS protect browser mutations in this example; review CSRF policy for your own app.

Rows, permissions, and tokens live in one process. Restarting resets everything. For production,
use persistent, bounded token storage with rate limits, database filtering, and transactional
authorization/update behavior. This example does not implement jobs, retries, or idempotency keys.
The synchronous in-memory apply has no asynchronous gap between authorization and update; a database
implementation needs its own concurrency policy.
