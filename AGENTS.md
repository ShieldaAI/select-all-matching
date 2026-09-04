# Repository instructions

These instructions apply to the entire repository. Explicit user instructions take precedence.

## Purpose

Build a small, headless TypeScript library for selecting records across server-side pagination. It must support both explicit selections and “all records in this server-defined scope except these IDs” without fetching every matching ID.

The library should make difficult selection behavior predictable. Keep the core independent of React, table libraries, databases, and web frameworks. Put integrations in separate adapters.

## Product boundaries

- Model selection state and transitions; do not become a table component, query builder, job runner, or authorization framework.
- Treat page membership and selection membership as different concepts.
- Represent “all matching” as a server-defined scope plus exclusions. Never expand it into every record ID on the client.
- Define what happens when the active filter, sort, tenant, or dataset changes. Do not silently carry a selection into a different scope.
- Keep scope tokens opaque to clients. Browser-provided filters and IDs are untrusted input.
- Require the server to recheck authorization when a bulk action executes. Possessing a scope token is not authorization by itself.
- Prefer a narrow, composable API over configuration that tries to cover every data-grid behavior.

## Engineering principles

- Correctness and clear semantics matter more than convenience or feature count.
- Keep state transitions deterministic and side-effect free in the core.
- Prefer immutable inputs and outputs.
- Keep the core free of runtime dependencies unless a dependency removes substantial, well-tested complexity.
- Support string and number row IDs without assuming a database or ORM.
- Make serialized state versioned, validated, and safe to reject.
- Keep framework-specific types out of the core package.
- Avoid premature abstractions. Add an integration only after a real example demonstrates the need.
- Preserve backward compatibility once a public API is released. Treat breaking changes deliberately.

## Testing

- Test behavior through the public API.
- Cover transitions between empty, explicit, and all-matching states.
- Cover page changes, scope changes, exclusions, stale state, duplicate IDs, invalid serialized input, and large counts.
- Use property-based tests where they clarify state-machine invariants.
- Add a regression test before fixing a reported bug.
- Run the relevant typecheck, tests, lint, and build before considering implementation work complete.

## Documentation

- Use plain language and concrete examples.
- Explain server-side trust boundaries wherever scope tokens or bulk actions appear.
- Do not claim that a successful client-side check makes an operation authorized or safe.
- Avoid hype, stock AI phrasing, invented benchmarks, and unsupported compatibility claims.
- Update examples and public API documentation whenever behavior changes.

## Working agreement

- Read the surrounding code and tests before editing.
- Make focused changes and leave unrelated files alone.
- Do not add production dependencies, change the package manager, or restructure the repository without a concrete reason.
- Record assumptions when requirements are ambiguous, then choose the smallest reversible implementation.
- Never publish packages, push commits, create releases, or change remote settings unless the user explicitly requests it.
- Report what changed, which checks ran, and any remaining uncertainty.
