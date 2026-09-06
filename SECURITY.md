# Security policy

## Supported versions

The latest published prerelease and `main` receive security fixes. Once 1.0 is released, fixes for
supported 1.x behavior will ship in the latest 1.x patch. Older prereleases are unsupported.

## Reporting a vulnerability

Do not put vulnerability details, proof-of-concept payloads, tokens, or user data in a public
issue.

Use [GitHub's private reporting form](https://github.com/ShieldaAI/select-all-matching/security/advisories/new)
to send a report to the maintainers. If you cannot use that form, contact
[VODuda](https://github.com/VODuda) to arrange a private channel without sharing details publicly.

Include, when it is safe to do so:

- the affected version or commit;
- the entry point and configuration involved;
- impact and a minimal reproduction;
- whether a scope token or cross-tenant/resource boundary is involved; and
- any suggested mitigation.

There is no response-time SLA during early development. We will coordinate a fix as capacity allows
and credit reporters who want credit.

## Security boundary

This package models selection intent. It does not authenticate users or authorize bulk actions.
Treat browser-provided IDs and scope tokens as untrusted. Resolve scopes from server-owned data,
bind tokens to the current subject, tenant, and resource, and reauthorize the operation and rows
when it runs.

Defects in package state handling or decoding are in scope. Application-specific authorization,
database behavior, and token issuance are outside the package's implementation boundary.
