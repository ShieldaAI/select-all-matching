# Contributing

The API is still prerelease. Please keep changes small, and open an issue before adding an adapter
or changing the public API.

## Before starting

- Read the [technical design](./docs/TECHNICAL_SPEC.md) before changing behavior.
- Report security problems using [SECURITY.md](./SECURITY.md), never in a public issue.

## Local setup

Use a current Node 22 or Node 24 release and the npm version recorded in `package.json`.

From a clean checkout:

```sh
npm ci
npm run check
```

`npm run check` runs formatting, linting, type checks, tests, the build, and package smoke tests. To
inspect the files npm would publish without keeping a tarball, run:

```sh
npm run pack:dry-run
```

Generated `dist`, coverage, and tarball files are not committed.

## Change guidelines

- Test changed behavior through public exports, including stale-scope cases where relevant.
- Update public documentation and the changelog when behavior or compatibility changes.
- Discuss production dependencies and new compatibility claims before adding them.

## Pull requests

Describe the visible behavior, tests run, documentation impact, and anything intentionally left
out. Call out breaking prerelease changes plainly. A pull request is ready when `npm run check`
passes on a clean checkout and the diff contains no generated output.

By contributing, you agree that your contribution is licensed under this repository's MIT license.
