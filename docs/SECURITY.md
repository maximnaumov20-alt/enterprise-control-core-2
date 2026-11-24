# Security policy

## Development status

ECC is an early-development project. Authentication, role checks, organization-scoped data access and basic audit events are implemented, but this is not a production security certification. Do not expose it to the public internet or store real sensitive or business-critical information until the remaining controls and an independent security review are complete.

## Implemented controls

- The current TypeScript server hashes new passwords with Node.js scrypt and a per-password random salt. Password verification rejects legacy plaintext values; records using a non-scrypt password format require an explicit password reset or migration.
- API access uses short-lived signed bearer tokens. The signing key is supplied through `ECC_SECRET_KEY`; the API refuses authentication when it is missing. Keys shorter than 32 bytes are rejected.
- A per-user `token_version` claim is checked on authenticated requests. Changing a password or changing a user's active state increments the stored version and invalidates that user's previously issued access tokens.
- The API container runs as a non-root user, has a health check and is not published directly to the host in the Compose deployment; browser traffic reaches it through the Nginx gateway. The frontend gateway binds to `127.0.0.1` by default, so it is not directly exposed to external interfaces unless an operator explicitly changes the bind address.
- The production frontend is served by Nginx with a same-origin API reverse proxy and baseline content-type, frame, referrer and content-security-policy headers.
- Roles are `admin`, `editor` and `viewer`. The API enforces permissions server-side.
- Asset, software licence and maintenance request access is scoped to the authenticated user's organization. Maintenance records use composite foreign keys to prevent cross-organization asset and user references. Viewers can access only the maintenance requests they created. Organization IDs are never accepted from client request bodies.
- Software licence records store external contract references, not activation keys or other secrets. Employee directory access is restricted to administrators and editors.
- Asset inventory identifiers are unique within an organization rather than globally.
- Basic audit events are recorded for asset and user changes and are visible only to organization administrators.
- Users can change their password after authenticating; new passwords must be at least 12 characters.
- Initial administrator creation is a deployment/bootstrap operation, not a public registration endpoint.
- Login throttling allows 10 attempts per client IP in a 60-second fixed window, using Redis as a shared counter store in the Compose deployment.

## Important remaining limitations

- There is no refresh-token flow or individual-token revocation list. The per-user token version invalidates all of a user's existing access tokens after a password change or active-state change; it does not provide selective revocation for a single token. Otherwise, a stolen token can remain usable until expiry.
- Account lockout, MFA, password reset and email verification are not implemented.
- Audit events are application-level records, not tamper-proof or cryptographically chained. Database administrators can alter them.
- Organization provisioning is currently performed by the bootstrap command. There is no self-service tenant signup.
- There is no independent penetration test, formal threat model, production backup/restore certification or compliance assessment.
- Deployment still requires HTTPS at the public edge, secure secret storage, restrictive network rules, monitoring, dependency scanning and operational procedures. The Compose loopback binding is only a safer default, not a complete TLS or firewall configuration.

## JSON database integrity

- If the JSON database file cannot be read or parsed, the server must stop during startup. It must not silently replace an unreadable database with freshly seeded demo data.
- Keep verified backups before any manual database repair or migration. A failed startup is preferable to silently overwriting records.

## Known deployment blockers on the current default branch

- The current default branch still contains seeded demo accounts and a tracked runtime data file. Do not treat those credentials or records as production-safe. See [issue #3](https://github.com/maximnaumov20-alt/enterprise-control-core-2/issues/3).
- The current default branch still has a built-in authentication-token signing-key fallback. The proposed fail-closed remediation is under review in [PR #2](https://github.com/maximnaumov20-alt/enterprise-control-core-2/pull/2).
- These items are not considered remediated until the corresponding changes are reviewed, tested, and merged.

## Reporting a vulnerability

A private vulnerability reporting channel has not yet been configured. Do not publish exploit details in a public issue. Before inviting external users or contributors, the repository owner must enable GitHub private vulnerability reporting or publish a dedicated security contact.

## Minimum requirements before production

- Independent security review and penetration testing
- HTTPS at the deployment boundary and strict network access controls
- MFA and secure account recovery
- Refresh-token rotation or another suitable revocation strategy
- Tamper-evident audit retention and restricted database administration
- Encrypted off-host backups and regularly tested restores
- Dependency, container and application security scanning
- Documented incident response, monitoring and retention policies

## Login rate limiting

The login endpoint allows 10 attempts per client IP in a 60-second fixed window.

Compose runs Redis and the API uses it as a shared counter store, so limits apply across API workers and instances that share the same Redis database. If Redis is unavailable, login requests fail closed with HTTP 503 rather than silently disabling throttling.

The in-memory limiter is only a development/test fallback when `REDIS_URL` is not configured. Do not use that fallback with multiple workers or API replicas.

The API obtains the client address from `X-Real-IP` when present. This header is trusted only because the supplied Nginx gateway overwrites it with the TCP peer address. Keep the API on a private network, do not publish its port directly, and use a trusted reverse proxy that overwrites `X-Real-IP`. The application intentionally does not trust arbitrary `X-Forwarded-For` values.
