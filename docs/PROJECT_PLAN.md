# Roadmap

Last updated: 2026-09-04

The state machine and draft codecs are implemented. The React/TanStack adapter, server
coordination API, and example application are still planned. Protocol and stored-state version `0`
remain experimental.

## The project

`select-all-matching` is a headless TypeScript library for selection across server-paginated
tables. It stores either a list of selected IDs or a server-defined result set with a list of
excluded IDs. The browser never has to fetch every matching ID.

## What is done

- Immutable empty, explicit, and all-matching state
- Single-row and page-sized mutations
- Scope revisions that reject old `A -> B -> A` events
- Compare-and-set scope-token refresh
- Scope-aware membership and page reads
- Draft version-0 state and bulk-request codecs
- Bounded server-side request decoding
- Unit, property, parser, type, coverage, and packed-package tests

## Next

### Validate the API

Try the current model with teams that own server-paginated tables. Settle scope-token shape,
explicit-selection filter drift, persisted-state demand, and framework support from those trials
before expanding the API.

### Finish one client path

- Add a controlled React hook that uses functional state updates.
- Add one TanStack Table adapter, for the major version trial users need.
- Test SSR imports, Strict Mode, two queued updates before rerender, accessible checkboxes, and the
  advertised peer-version range.
- Install the packed tarball in the example instead of importing source files.

TanStack's loaded-row selection is not the source of truth. The adapter should derive checkbox
state from this package and translate UI events back into scoped commands.

### Finish one server path

- Add small resolver and authorizer interfaces.
- Decode and limit the request before calling application code.
- Fail closed on expired scopes, callback errors, and resource or operation mismatches.
- Recheck the current user and row eligibility when the action runs.

The example can use a short-lived random handle in memory. It must say plainly that production
storage, token creation, queries, authentication, authorization, and jobs belong to the
application.

### Build the example

Use a large deterministic dataset, server-side filters and pagination, slow or reordered
responses, token expiry, permission changes, and one harmless bulk action. It should demonstrate:

1. selecting rows across pages;
2. selecting and deselecting a page;
3. selecting all matching rows;
4. excluding rows afterward;
5. changing filters and returning to an earlier filter; and
6. previewing the compact request before execution.

No example path may enumerate all matching IDs in the browser.

## Before the first beta

- Set the TypeScript, React, and TanStack support ranges from packed consumer tests.
- Review the public API and generated declarations.
- Add cross-tenant, cross-resource, cross-operation, expiry, and permission-revocation tests.
- Write a short quick start and server integration guide.
- Have someone unfamiliar with the code complete the main flow from the documentation.
- Test the exact tarball and configure private vulnerability reporting before publishing.

The first public version would be `0.1.0-beta.0` on npm's `next` tag. It stays private until there
is explicit approval to publish. [versioning.md](./versioning.md) contains the compatibility rules.

## Later, if users ask for it

- Stable wire protocol version 1
- A second TanStack major
- Other table or framework adapters
- Persisted-state migrations
- Database-specific examples

Table components, query builders, token services, authorization frameworks, job queues, progress
UI, undo, tree selection, and offline synchronization are outside the current project.

## References

- [TanStack Table row selection](https://tanstack.com/table/v8/docs/guide/row-selection)
- [TanStack issue #4781](https://github.com/TanStack/table/issues/4781)
- [MUI Data Grid row selection](https://mui.com/x/react-data-grid/row-selection/)
- [AG Grid server-side row selection](https://github.com/ag-grid/ag-grid/blob/latest/documentation/ag-grid-docs/src/content/docs/server-side-model-selection/index.mdoc)
- [`react-server-table`](https://github.com/Muhammad-UmairAli/react-server-table)
