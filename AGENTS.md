# Repository notes

These notes apply to the whole repository. Follow a user's explicit instructions when they differ.

## Scope

This package models row selection across server-side pagination. Keep the core independent of UI
frameworks, table libraries, databases, and web servers. Integrations belong in separate entry
points.

The important boundaries are:

- “all matching” means a server-defined scope minus exclusions; never fetch every matching ID;
- changing scope clears selection, and old events must not apply after `A -> B -> A`;
- scope tokens are opaque selection references, not proof of authorization; and
- the server rechecks the user, operation, resource, and affected rows when an action runs.

Do not turn this into a table component, query builder, job runner, or authorization framework.

## Code

- Keep core transitions deterministic and immutable.
- Preserve the difference between string and number IDs.
- Keep framework types out of the root entry point.
- Avoid production dependencies in the core. Discuss any new one before adding it.
- Prefer a small concrete API over options for cases the example does not need.
- Treat serialized state and bulk requests as untrusted, versioned input.

## Tests and docs

Test public behavior, especially scope changes, exclusions, duplicate IDs, limits, and malformed
payloads. Use property tests where they make a state invariant easier to trust, and add a regression
test with each bug fix.

Keep documentation concise and tied to behavior that exists. When scope tokens or bulk actions are
shown, state the server-side checks nearby. Do not claim support for a runtime or framework version
until the packed package has been tested with it.

Run `npm run check` before considering a change complete. Do not commit generated `dist`, coverage,
or tarball files.

Make focused changes and leave unrelated files alone. Do not publish packages, push commits, create
releases, or change remote settings without explicit approval.
