# Security policy

## Supported versions

There is no published release yet. Until the first prerelease is available, code on `main` is
development code and does not have a supported security-stable version.

After publishing begins, this table will list the maintained release lines. A prerelease can
change without a compatibility promise, but credible security defects in the latest prerelease
will still be investigated.

## Reporting a vulnerability

Do not put vulnerability details, proof-of-concept payloads, tokens, or user data in a public
issue.

Private vulnerability reporting is not enabled for this repository yet. Until a private reporting
channel is configured, contact a ShieldaAI maintainer through their GitHub profile and ask for a
private channel without including sensitive details. Maintainers should enable GitHub private
vulnerability reporting before the first public package release and update this section with the
direct reporting link.

Include, when it is safe to do so:

- the affected version or commit;
- the entry point and configuration involved;
- impact and a minimal reproduction;
- whether a scope token or cross-tenant/resource boundary is involved; and
- any suggested mitigation.

No response-time SLA is promised while the project is in early development. We will acknowledge
and coordinate a fix as maintainer capacity allows, and we will credit reporters who want credit.

## Security boundary

This package models selection intent. It does not authenticate users or authorize bulk actions.
Applications must treat browser-provided IDs and scope tokens as untrusted, resolve scopes from
server-owned data, bind tokens to the current subject, tenant, and resource, and reauthorize the
endpoint operation and affected rows at execution time.

Reports about a way to bypass those documented checks in package-owned decoding or coordination
are in scope. Application-specific authorization policy, database behavior, and token issuance are
outside the package's implementation boundary unless the defect is in an example maintained here.
