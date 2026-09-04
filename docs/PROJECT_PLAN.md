# Project plan

- Status: ready for problem validation and Phase 0 spikes
- Last updated: 2026-09-04
- Owner: ShieldaAI maintainers
- Repository: `ShieldaAI/select-all-matching`
- Planned npm package: `select-all-matching`
- Proposed behavior: [TECHNICAL_SPEC.md](./TECHNICAL_SPEC.md)

This is the operating plan: who the first user is, what must ship, which decisions remain open, how work is gated, and when to stop. The technical specification owns the proposed state machine, protocol, adapters, server boundary, and detailed tests.

## 1. Product call

Build a small TypeScript library for selection across server-side pagination.

It represents either a finite list of selected IDs or every candidate row in a server-defined scope minus exclusions. It never fetches every matching ID and never mistakes the current page for the complete selection.

The honest constraint is that the reducer alone is easy to copy. The project is worth adopting only if the complete vertical slice—scope semantics, compact client/server request, stale-event handling, framework adapter, tests, and working demo—costs less than implementing and reviewing those pieces locally.

The first public prerelease must therefore show the whole vertical slice. A core-only package is an internal development artifact, not the launchable product.

## 2. Initial user and promise

### Initial wedge

Start with frontend or platform engineers who maintain React applications using TanStack Table with server-side pagination and cross-page bulk actions.

Typical actions are export, archive, label, assign, or delete across a filtered result set. These engineers already know how to render checkboxes; they need correct state and a server contract.

Generic TypeScript consumers and authors of other grid adapters are later audiences. They should influence the core boundaries, but they do not drive the first beta.

### Promise

> Add explicit, page-wide, and all-matching selection to a server-paginated TanStack table without loading every row ID or trusting browser filters at execution time.

### Activation test

A non-author, using only public documentation and exports, must be able to wire the packed package into the clean sample application and complete these flows in no more than 60 minutes:

1. select explicit rows across two pages;
2. select and deselect the current page;
3. select all matching rows;
4. exclude one row;
5. change scope without carrying selection;
6. preview the compact server request.

This is a controlled usability gate, not a promise that an application's production authorization and query layer can be built in an hour.

## 3. Evidence and remaining uncertainty

There is visible problem evidence:

- TanStack users have repeatedly asked how select-all should work with manual/server pagination. The framework can store IDs that are not loaded, but its selected-row model only knows supplied rows.
- MUI uses include/exclude selection for large sets, confirming the representation, while still leaving server-pagination cleanup to the application.
- AG Grid's Server-Side Row Model represents select-all plus toggled row IDs inside its Enterprise grid.
- `react-server-table` handles server fetching, stale responses, and explicit selection across loaded pages, but not symbolic all-matching execution.

This proves the behavior is real, not that developers will add another dependency. The unanswered questions are:

- Is the server-scope contract easier than each team's local reducer and endpoint shape?
- Will teams accept opaque scope tokens, or do they prefer sending a query descriptor?
- Must explicit requests remain tied to the original filter?
- Which TanStack major contains the first likely adopters?
- Is persisted selection state needed, or is runtime state enough?

Those questions are tested before the full build.

## 4. Alternatives and differentiation

Snapshot checked on 2026-09-04; framework behavior and package scope must be rechecked before public positioning.

| Option | Off-page explicit IDs | All matching minus exclusions | Stale-scope protection | Server-owned scope | Framework lock-in | Who owns hard cases |
| --- | --- | --- | --- | --- | --- | --- |
| Small local reducer | If implemented | If implemented | Usually ad hoc | Application-specific | None | Each application |
| Raw TanStack selection | State may retain IDs | No server-wide intent | No scope incarnation | No | TanStack | Application |
| MUI X selection model | Yes with configuration | Include/exclude model | Application cleanup | Not a reusable protocol | MUI Data Grid | Grid plus application |
| AG Grid SSRM | Yes | Select-all plus toggled IDs | Grid-owned lifecycle, not a portable scope incarnation | Not a reusable bulk protocol | AG Grid Enterprise | Grid plus application |
| `react-server-table` | Yes for known/loaded IDs | No | Fetch-response handling | No bulk protocol | Its React hook | Hook plus application |
| This package | Yes | Yes | Key, local revision, and token CAS | Opaque server reference | Core is independent; first adapter is TanStack | Package for semantics; application for auth/query/jobs |

The differentiator is not the include/exclude idea. It is a small, table-independent contract that handles scope incarnation races, uses a compact server-owned reference, keeps authorization boundaries explicit, and ships with executable abuse tests.

Phase A design partners must confirm that this difference removes enough code or review risk to justify a dependency.

## 5. Beta scope

The first public beta contains one complete path:

- dependency-free TypeScript core;
- empty, explicit, and all-matching states;
- scoped single-ID and page operations;
- `A → B → A` stale-event protection;
- compare-and-set token renewal;
- bounded bulk-request conversion and server decoding;
- narrow resolver and authorizer contracts;
- controlled React integration;
- one evidence-selected TanStack major;
- one realistic client/server demo;
- public semantics, server-boundary, quick-start, and versioning documentation;
- property, abuse, adapter, packed-consumer, and Chromium tests; and
- an exact-artifact prerelease workflow.

Conditional beta item:

- Persisted client-state encoding ships only if a design partner needs restore/resume behavior. The bulk protocol is required.

Deferred until evidence supports it:

- the second TanStack major if it needs separate implementation code;
- Vue, Svelte, MUI, AG Grid, or other adapters;
- ORM, database, web-framework, or job-queue adapters;
- production token signing or storage;
- snapshot creation;
- disabled-row policy in the core;
- tree, group, range, or shift-click selection;
- cross-tab, collaborative, or offline state;
- progress tracking, retries, partial-failure UI, or undo; and
- a table or checkbox component.

## 6. Acceptance map

Each requirement has observable evidence. An issue is not complete until its evidence exists.

| ID | Requirement | Beta evidence |
| --- | --- | --- |
| R1 | Explicit selection survives page navigation | Public transition tests and demo flow |
| R2 | All matching uses compact state independent of total rows | Property/complexity test and request inspector |
| R3 | Page select/deselect works in explicit and all-matching modes | Transition matrix and real table test |
| R4 | Scope changes and `A → B → A` reject stale events | Reordered command/response fixtures |
| R5 | Existing all-matching state cannot regain an older token | Compare-and-set and select-all/refresh interleaving tests |
| R6 | External payloads are versioned, bounded, and non-throwing | Codec corpus, fuzz properties, golden fixtures |
| R7 | Browser state cannot authorize a bulk action | Responsibility matrix, threat model, abuse suite |
| R8 | The adapter does not treat TanStack state as global truth | Packed real-table integration test |
| R9 | Package output works outside the repository | Node/Vite consumers install the exact tarball |
| R10 | A new user can complete the golden path from docs | Recorded clean-project usability exercise |
| R11 | Pre-selection token responses cannot revive superseded or cancelled intent | Demo request-generation and response-reordering tests |

## 7. Phase A: demand validation

Budget: 1–2 focused days spread over at most two calendar weeks. The package and compatibility spikes may run in parallel, but feature implementation does not begin until this gate is reviewed.

Work:

- Ask 5–8 engineers who currently own server-paginated React tables to review the problem and API sketch.
- Include maintainers or commenters from relevant public issues where direct contact is appropriate; do not spam.
- Record their current implementation, failure cases, approximate glue code, and strongest objection to adding a dependency.
- Ask whether explicit selections should still act on a row that no longer matches the original filter.
- Ask which TanStack/React versions they run.
- Obtain two concrete agreements to trial the beta against a real backend.

Pass gate:

- at least three engineers confirm the problem in current work;
- at least two consider the proposed contract materially better than their workaround and agree to a trial; and
- no repeated objection invalidates the server-scope design.

If the gate fails, do not continue automatically. Narrow the API, reposition it as a reference implementation, or stop.

## 8. Decision register

“Due” is the latest gate at which the decision can remain open.

| Decision | Current position | Owner | Due | Evidence required | Consequence if disproved |
| --- | --- | --- | --- | --- | --- |
| Initial TanStack major | Pending | Maintainer | End of Phase A | Design-partner versions and adapter spike | Support the higher-signal major only |
| React peer range | Pending | Maintainer | End of Phase 0 | Packed tuple fixtures | Advertise only passing versions |
| TypeScript floor | Pending | Maintainer | End of Phase 0 | Declaration consumers at candidate floors | Raise floor or change emitted types |
| ESM-only/ES2022 | Proposed | Maintainer | End of Phase 0 | Node/Vite package spike and partner objections | Add dual output only with evidence |
| Package name | Unscoped name was available on 2026-09-04 | Maintainer | Before first publish | npm ownership check | Use a verified ShieldaAI-owned scope |
| Scope key plus local revision | Locked for the spike | Maintainer | End of Phase 0 | `A → B → A` executable model | Replace before feature work |
| Action-neutral scope token | Proposed | Maintainer | Threat-model review | Wrong-resource/action abuse cases | Bind or mint per operation |
| Explicit request omits original scope | Proposed | Maintainer | End of external beta | Two integrations exercise filter drift | Add a new scoped explicit wire variant before v1 |
| Persisted state codec | Conditional | Maintainer | End of Phase A | At least one concrete restore/resume use case | Defer beyond beta |
| Stable wire version 1 | Open | Maintainer | RC gate | Server demo, abuse suite, golden fixtures, beta feedback | Keep protocol at draft version 0 |

Decision results are recorded in the pull request or issue that closes the gate and reflected in the technical specification.

## 9. Delivery plan

### Forecast

One-maintainer estimate, excluding external waiting time:

| Phase | Deliverable | Depends on | Owner | Confidence | Focused days |
| --- | --- | --- | --- | --- | ---: |
| A | Demand evidence and two trial commitments | None | Maintainer + design partners | Medium | 1–2 |
| 0 | Frozen beta semantics, threat model, package/adapter spikes | A evidence | Maintainer | Medium | 2–3 |
| 1 | Repository scaffold, CI, public API report | Phase 0 choices | Maintainer | High | 1–2 |
| 2 | Core, draft bulk codec, property tests | 0–1 | Maintainer | Medium-high | 3–5 |
| 3 | React and selected TanStack adapter | 2 | Maintainer | Medium | 2–4 |
| 4 | Server contract, abuse harness, full demo | 2–3 | Maintainer | Medium | 4–7 |
| 5 | Docs, exact-artifact release workflow, beta hardening | 2–4 | Maintainer | Medium-high | 3–4 |

After Phase A, expected beta-readiness is 15–25 focused engineering days; including validation, the phase ranges total 16–27 days. Use 20–30 focused days as the P80 planning range after integration and rework contingency. External beta feedback is a separate 2–6 calendar weeks and is not under maintainer control.

If a second TanStack major needs separate code, add 2–4 days and make it a later milestone.

### Phase 0: decisions and spikes

Before feature implementation:

- enumerate every public state/action result;
- settle the decoder error taxonomy and deterministic precedence;
- settle default and maximum ID, key, token, and payload limits;
- settle separate persisted-state and bulk endpoint limits;
- settle selection-view mismatch behavior;
- decide the beta TanStack major and exact tested peer tuples;
- decide TypeScript floor, `engines`, ESM/CJS, and browser claims;
- define server resolution versus authorization ownership;
- write `A → B → A`, refresh/select-all token interleaving, pre-selection token cancellation, explicit-filter-drift, and wrong-operation fixtures;
- prove subpath exports and declarations from a tarball; and
- write the first threat model.

Exit: all open behavior has an expected result and planned test; unresolved items carry a release-blocker issue.

### Phase 1: foundation

- Add package metadata, strict TypeScript, test/lint/format tools, npm scripts, and lockfile.
- Add CI tiers, public API reporting, coverage, package validation, and dependency review.
- Add `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, and `docs/versioning.md`.
- Document one clean-checkout command sequence.

Exit: a clean checkout builds and validates a minimal tarball in the required PR matrix.

### Phase 2: core vertical logic

- Implement branded normalized state, scope revision, transitions, and indexed views.
- Implement bounded draft bulk conversion and decoding.
- Add example, property, parser, concurrency, and mutation-safety tests.
- Record package-size and complexity baselines.

Exit: R1–R6 pass through public APIs. Nothing depends on total matching rows.

### Phase 3: first adapter

- Implement the controlled React hook with pure functional updaters.
- Implement the selected TanStack adapter without treating its state as authority.
- Add SSR, peer-tuple, real-table, accessibility, and packed-consumer tests.

Exit: R1–R5 and R8 pass against a real table installed from the tarball.

### Phase 4: server path and demo

- Implement resolver/authorizer contracts and fail-closed coordination.
- Build a short-lived reference scope store and list/preview/execute endpoints.
- Add cross-tenant/resource/operation, expiry, revocation, body-limit, and fallback abuse cases.
- Build the complete demo, including slow responses and live-scope preview drift.

Exit: R7 and R11 pass, and the demo exercises every advertised mode without fetching all IDs.

### Phase 5: beta readiness

- Finish quick start, semantics, server boundary, adapter guide, API report, and versioning policy.
- Run the clean-project activation test with a non-author.
- Build, hash, install, and validate the exact release tarball.
- Resolve every open release-blocker issue.
- Publish only after explicit approval.

Exit: all beta-ready criteria in section 16 are evidenced.

## 10. Initial issue order

1. Record Phase A evidence and adoption objections.
2. Freeze semantics, responsibility matrix, and threat model.
3. Spike package output, support floor, and selected TanStack adapter.
4. Scaffold tooling, CI tiers, API report, and exact-tarball fixtures.
5. Implement normalized state and scope-incarnation transitions.
6. Implement views, bulk conversion, decoder, and draft golden fixtures.
7. Add reference-model, concurrency, parser, and fuzz tests.
8. Implement the React hook and selected TanStack adapter.
9. Implement server contracts and abuse harness.
10. Build the end-to-end demo and request inspector.
11. Finish user and maintainer documentation.
12. Run activation exercise and prepare `0.1.0-beta.0`.
13. Run bounded external beta and decide the stable API/protocol.
14. Prepare `0.9.0-rc.0`, then `1.0.0` when its evidence exists.

Each issue names its requirement IDs, deliverable, owner, dependency, tests, documentation impact, and explicit exclusions.

## 11. CI and evidence tiers

| Tier | Required work | Operating rule |
| --- | --- | --- |
| Pull request | Pinned toolchain; strict types; lint/format; core tests; deterministic property budget; pairwise adapter fixtures; packed Node/Vite consumers; Chromium smoke; API report | Fixed regression seeds plus a commit-derived reproducible seed; per-job timeout; target under 10 minutes |
| Nightly | Full declared React/TanStack matrix; extended property/parser fuzzing; Node 26 current-runtime check; dependency and link checks | Failures open or update a tracked issue; Node 26 is not claimed until promoted to required CI |
| Release candidate | Clean checkout; full matrix; docs snippets/links; abuse suite; size budget; Publint; Are the Types Wrong; exact tarball installed everywhere | Build once, hash once, and approve that artifact |
| Stable release | Version-bumped stable candidate plus changelog, API report, wire fixtures, provenance, protected-environment approval | Build the stable `.tgz` once, run the full RC suite on it, then publish it unchanged |

Fixture configuration is the source for the public support matrix; CI verifies documentation against it.

## 12. Release plan

Release sequence:

- Internal tarballs through Phase 4. They are not announced or published.
- `0.1.0-beta.0` under npm tag `next`: first public vertical slice using experimental protocol version 0.
- Further `0.x` betas under `next`: incorporate design-partner feedback without pretending the wire format is stable.
- `0.9.0-rc.0` under `next`: candidate public API, frozen protocol version 1 and, if shipped, persisted-state version 1, after the server abuse suite and beta integrations. Stable encoder defaults then remain pinned for the package major; newer wire formats are explicit opt-ins.
- `1.0.0` under `latest`: a distinct version-bumped artifact, built only after the RC evidence and section 16 are complete.

Every prerelease command explicitly uses `--tag next`; npm's `latest` tag is reserved for stable releases.

The release workflow runs for every published version, including a fresh run after changing package metadata from the prerelease to `1.0.0`:

1. checks out the approved commit;
2. uses Node 24 and pins npm to at least 11.5.1;
3. builds one `.tgz` containing that exact release version;
4. records its SHA-256 hash and contents;
5. installs that exact file in every release fixture;
6. runs the complete release-candidate suite;
7. waits for protected-environment approval; and
8. publishes that same `.tgz` with provenance.

Before the first publish, recheck the unscoped name and verify ownership of any scoped fallback. If npm trusted publishing cannot claim a new package initially, make one reviewed 2FA publication, configure OIDC immediately, and revoke any temporary token afterward.

Do not publish, tag, push, or change remote settings without explicit approval.

## 13. Bounded adoption plan

This project does not require continuous content marketing, but zero distribution is not a plan.

### Before beta

- Complete the 5–8 Phase A conversations.
- Keep two design partners informed with a short API/demo update at the beta gate.

### Six weeks after beta

- Invite at most 15 well-matched engineers or maintainers who have publicly described this problem.
- Offer two assisted trials, mainly to observe setup friction.
- Seek one independent integration and a second validation.
- Add one factual solution link to a relevant TanStack discussion or issue if community rules allow it.
- Submit the package to one relevant ecosystem/resource list if it accepts community projects.
- Make one concise launch post showing the request payload and working demo.
- Follow up once after 30 days; do not create an ongoing outreach sequence.

A verifiable integration means a non-author runs explicit, page, all-matching, exclusion, scope-change, and server-preview flows against their own backend, confirmed directly or by a public dependent.

The repository's organization history does not make new code reliably discoverable by LLMs. Searchable documentation, npm metadata, relevant links, and real usage are the durable signals. The plan does not depend on model pickup.

## 14. Success and stop criteria

Beta success:

- two design partners start a trial;
- a non-author passes the activation exercise;
- the full demo proves the compact selection flow; and
- no user mistakes a scope token for authorization after reading the quick start.

Version 1 success:

- at least one independent external application completes every core flow; two are preferred;
- integration feedback no longer changes the state or wire model;
- exact packed artifacts pass the declared compatibility matrix; and
- maintainers can explain the client/server boundary without undocumented caveats.

Ninety-day signal:

- aim for five verifiable users or dependents;
- treat npm downloads and stars as supporting indicators, not proof of use; and
- review issue quality, integration completion, and repeated support questions.

Pause, narrow, or stop when any trigger fires:

- fewer than three of the Phase A participants confirm the pain;
- nobody agrees to trial after the initial validation outreach;
- no integration completes after the bounded beta outreach;
- correct integration needs more glue than a reviewed local implementation;
- most demand is for a full table component; or
- adapter maintenance costs more than the framework-independent core is worth.

## 15. Operational risks

| Risk | Likelihood | Impact | Trigger | Owner | Response and review gate |
| --- | --- | --- | --- | --- | --- |
| Developers prefer local code | Medium-high | High | Fewer than two trial commitments | Maintainer | Compare real implementations in Phase A; stop or narrow before Phase 1 |
| Scope-token setup outweighs value | Medium | High | Repeated objection or activation test misses target | Maintainer | Support lazy token issuance, simplify server contract, review before beta |
| Wire shape is wrong | Medium | High | Beta needs scoped explicit requests or different errors | Maintainer | Keep protocol at draft 0; freeze v1 only at RC |
| Scope races remain | Low-medium | High | `A → B → A`, token reorder, or select-all cancellation fixture fails | Maintainer | Local revision, token CAS, and pre-selection generation are Phase 0 blockers |
| Security boundary is misunderstood | Medium | High | Trial implementation trusts browser filter/token | Maintainer + design partner | Rewrite docs/API names; block release until abuse review passes |
| Framework matrix grows | Medium | Medium-high | Second major requires branches or duplicate adapter | Maintainer | Ship one evidence-selected major; review after beta |
| Plan/spec/docs drift | Medium | Medium | Duplicate normative statements disagree | Maintainer | Technical spec is authoritative; compiled snippets and link checks in CI |
| Package name is taken | Low | Medium | npm ownership check fails | Maintainer | Use a verified ShieldaAI-owned scope; decide before release workflow |
| Maintainer capacity drops | Medium | Medium | Two missed maintenance reviews or release-blocking queue ages 30 days | Maintainer | Reduce adapter surface and publish support status honestly |

Risks are reviewed at each phase gate. A release blocker is an open issue labelled `release-blocker`; “no known blocker” means that queue is empty after the named CI, threat-model, and review evidence runs.

## 16. Definitions of done

### Beta-ready

- Phase A pass gate is recorded.
- Every beta decision in section 8 is closed or explicitly deferred.
- R1–R11 have linked test, fixture, document, or usability evidence.
- The selected framework matrix passes from the exact tarball.
- The demo covers explicit, page, all-matching, exclusions, scope changes, `A → B → A`, token expiry/reorder, permission revocation, and preview drift.
- The threat model and responsibility matrix have no open `release-blocker` issue.
- The quick start, server guide, API report, support matrix, and prerelease compatibility warning are present.
- `0.1.0-beta.0` can be published under `next` with provenance after approval.

### Version 1-ready

- At least one independent external integration is documented; two are preferred.
- API review finds no unresolved beta-only naming or behavior.
- Protocol and any persisted-state version 1 shapes are frozen with permanent golden fixtures.
- Cached old-client/new-server and new-client/old-server deployment tests follow the documented decoder-first rollout.
- The committed public API report is approved.
- Runtime, framework, deprecation, and emergency-release policies are documented.
- After the stable version bump, the exact `1.0.0` tarball passed every release-candidate check and the staged workflow succeeded; the `0.9.0-rc.0` tarball is never republished as `1.0.0`.
- The release-blocker queue is empty.

## 17. Maintenance policy

- Support only versions exercised in required or nightly CI, and distinguish those levels in documentation.
- After 1.0, dropping a supported Node, React, or TanStack range is a package-major change unless that range was explicitly experimental.
- Announce planned support drops at least one minor release or 90 days ahead when practical.
- Keep current and previous adapter majors only while one branch-free implementation remains maintainable.
- Run the full compatibility suite weekly and review dependencies monthly.
- Handle credible security updates immediately rather than waiting for the monthly review.
- Keep the core free of runtime dependencies unless a recorded decision proves the benefit.
- Commit a public API report and permanent golden fixture for every stable wire revision.
- Deploy decoders before encoders when protocols change.
- For an emergency release, patch from the affected supported line, run the exact-artifact release suite, publish with provenance, and document impact and upgrade path.
- Add a regression test before fixing a reported behavior bug.
- Provide no implied SLA; state the actual maintenance level in the README.

## 18. Documentation ownership

- [TECHNICAL_SPEC.md](./TECHNICAL_SPEC.md) is the normative proposed behavior until implementation-specific public guides replace a section.
- This project plan becomes historical/non-normative once implementation begins; progress lives in issues and milestones.
- `README.md` is the concise entry point and must not redefine edge cases.
- `docs/versioning.md` owns protocol and support policy.
- Migration documentation is created when an actual migration exists, not in advance.
- Code snippets compile in CI and internal links are checked.
- The public support matrix is generated from or verified against fixture configuration.

## 19. Research references

- [TanStack Table row-selection guide](https://tanstack.com/table/v8/docs/guide/row-selection)
- [TanStack pagination and row-selection issue #4781](https://github.com/TanStack/table/issues/4781)
- [MUI Data Grid row selection](https://mui.com/x/react-data-grid/row-selection/)
- [AG Grid server-side row-selection documentation source](https://github.com/ag-grid/ag-grid/blob/latest/documentation/ag-grid-docs/src/content/docs/server-side-model-selection/index.mdoc)
- [`react-server-table`](https://github.com/Muhammad-UmairAli/react-server-table)
- [npm dist-tags](https://docs.npmjs.com/adding-dist-tags-to-packages/)
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
- [npm provenance](https://docs.npmjs.com/generating-provenance-statements/)
- [Node release schedule](https://nodejs.org/en/about/previous-releases)
