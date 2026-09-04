# Security policy

## Supported versions

The latest `0.1` prerelease and `main` receive security fixes. Older prereleases are unsupported.

## Reporting a vulnerability

Do not put vulnerability details, proof-of-concept payloads, tokens, or user data in a public
issue.

Private vulnerability reporting is not enabled yet. Until it is, use the contact listed on
[VODuda's GitHub profile](https://github.com/VODuda) to ask for a private channel. Do not include
security details in the first message.

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
