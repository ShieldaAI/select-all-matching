# Contributing

The project is still defining its prerelease API. Small, evidence-backed changes are easier to
review than broad abstractions or new integrations.

## Before starting

- Read [AGENTS.md](./AGENTS.md) for the repository's engineering and trust-boundary rules.
- Read the [technical specification](./docs/TECHNICAL_SPEC.md) before changing behavior.
- For a large API change or adapter, open an issue first so the scope and use case can be agreed.
- Report security problems using [SECURITY.md](./SECURITY.md), never in a public issue.

## Local setup

Use a current Node 22 or Node 24 release and the npm version recorded in `package.json`.

From a clean checkout:

```sh
npm ci
npm run check
```

The complete check formats, lints, type-checks, tests, builds, validates package metadata and
declarations, then installs the exact generated tarball in a temporary Node ESM consumer. To
inspect the files npm would publish without keeping an artifact, run:

```sh
npm run pack:dry-run
```

Generated `dist`, coverage, and tarball files are not committed.

## Change guidelines

- Keep the core deterministic, immutable, framework-independent, and free of runtime dependencies.
- Preserve string and number ID identity and test stale scope or token outcomes explicitly.
- Treat client filters, IDs, and tokens as untrusted at the server boundary.
- Test behavior through public exports. Add a regression test before fixing a reported bug.
- Use property tests for state-machine invariants where examples alone leave gaps.
- Update public documentation and the changelog when behavior or compatibility changes.
- Do not expand a support range until the packed package passes that runtime or peer tuple in CI.

A new production dependency needs a written rationale covering why local code is insufficient,
runtime and bundle cost, maintenance risk, and alternatives considered.

## Pull requests

Describe the user-visible behavior, tests run, documentation impact, and anything intentionally
left out. Breaking prerelease changes must be called out plainly. A pull request is ready for review
when `npm run check` passes on a clean checkout and the diff contains no generated output.

By contributing, you agree that your contribution is licensed under this repository's MIT license.
