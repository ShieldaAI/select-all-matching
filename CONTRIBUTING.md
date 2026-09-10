# Contributing

The API is preparing for 1.0. Keep changes small, and open an issue before adding an adapter
or changing the public contract.

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

`npm run example` starts the reference table with an installed tarball. `npm run example:check`
runs its HTTP and controller tests. For browser checks, install the test browsers once with
`npx playwright install chromium firefox webkit`, then run `npm run test:browser`.

Public declarations are compared with `etc/api`. For an intended API change, build and regenerate
the report with `npm run api:update`, review the diff, and explain compatibility in the changelog.
Do not rewrite version-1 JSON fixtures to make a regression pass.

## Change guidelines

- Test changed behavior through public exports, including stale-scope cases where relevant.
- Update public documentation and the changelog when behavior or compatibility changes.
- Discuss production dependencies and new compatibility claims before adding them.

## Pull requests

Describe the visible behavior, tests run, documentation impact, and anything intentionally left
out. Call out breaking prerelease changes plainly. A pull request is ready when `npm run check`
passes on a clean checkout and the diff contains no generated output.

`main` requires a pull request, resolved review conversations, and the CI checks from GitHub
Actions. Direct pushes, force pushes, and deletion are blocked. Reviews are welcome, but a second
maintainer's approval is not required to merge.

## Releases

Update the version and changelog in a pull request. Once it is merged, tag that commit with its
exact package version, for example `v1.0.0-rc.2`. Only repository administrators can create or
change `v*` release tags. Do not move a tag after publishing.

The release workflow verifies that the commit is on `main`, then builds and tests one tarball
without publishing credentials. It hands that artifact's ID and digest to a separate job. That
job checks the bytes and manifest before publishing; it does not check out the repository,
install development dependencies, or run package scripts.

Publishing waits for approval from `VODuda` in the `npm-publish` environment. The release author
can approve their own run; this is an explicit checkpoint, not independent review. Administrator
bypass is disabled. Approval should follow inspection of the commit and validation results.

The npm trusted publisher must name `ShieldaAI/select-all-matching`, `publish.yml`, and the exact
environment `npm-publish`, with direct publishing permitted. Do not retain a second publisher for
the same workflow without an environment: it would bypass the approval requirement. Changes to
this registry setting require the maintainer's npm authentication.

Prereleases publish to `next`; stable versions publish to `latest`. After release, verify an exact
version install, the dist-tags, and `npm audit signatures` in a fresh consumer. The signature and
provenance should match the released commit and workflow run.

By contributing, you agree that your contribution is licensed under this repository's MIT license.
