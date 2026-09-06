# Roadmap

## 1.0 scope

The stable package covers the headless selection state machine, indexed reads, state transfer,
bulk-request encoding, and server decoding. Scope-token storage, query execution, authentication,
authorization, and table components belong to the application.

The release candidate adds version-1 formats with version-0 decoder compatibility, fixed JSON
fixtures, a public declaration baseline, and a complete example using the packed package. The
example uses a browser and a Node HTTP server so the core can be exercised without committing to
a framework adapter API.

## Release checks

- Unit, property, type, coverage, and malformed-input tests pass.
- Packed consumers pass on Node 22 and 24, including minimum runtime imports.
- TypeScript 5.4 and the current compiler accept NodeNext and Bundler consumers.
- The HTTP example covers pagination, exclusions, token binding, expiry, permissions, and limits.
- Browser checks exercise selection, query races, checkboxes, and execution.
- The same tarball passes package and example checks before publishing.
- The publish workflow selects `next` for prereleases and `latest` for stable tags.

These are engineering checks. They do not establish that somebody has used the library in their
own application. Before declaring 1.0, run the RC through a real integration and fix any API
changes that trial exposes. A second developer should be able to complete the main flow from the
guides. There is no required star count, download count, or waiting period.

The first release through npm's configured trusted publisher still needs to succeed. Private
vulnerability reporting is enabled on GitHub; see the security policy for the reporting form.

## Later

Add React or table-library adapters when a real integration shows which repeated code is useful
to extract. Start with a tested recipe. Other frameworks, saved-query workflows, database-specific
examples, and richer server helpers should follow actual demand.

Table components, query builders, token services, authorization frameworks, job queues, progress
UI, undo, tree selection, and offline synchronization remain outside the core.
