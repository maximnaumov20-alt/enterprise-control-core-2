# Production deployment checklist

ECC is not production-ready. This document records the minimum deployment boundary expected for a future controlled pilot; completing these steps does not replace an independent security review.

## Network boundary

- The Compose frontend port binds to `127.0.0.1:5173` by default. Keep it loopback-only when a TLS reverse proxy runs on the same host.
- Terminate HTTPS at a maintained reverse proxy or load balancer. Redirect HTTP to HTTPS and enable HSTS only after HTTPS is confirmed for the entire hostname.
- Configure the proxy to forward requests to the loopback frontend port. Do not expose the API (8000), PostgreSQL (5432), or Redis (6379) to the public network.
- If the reverse proxy is on another host, use a private network or VPN and firewall the frontend listener to that proxy's source addresses. Only then set `ECC_FRONTEND_BIND_ADDRESS` to an appropriate private interface address. Do not bind to all interfaces without matching firewall rules.
- Set `CORS_ORIGINS` to the exact HTTPS origin(s) used by the browser. Do not use wildcard origins with authenticated requests.
- The frontend Nginx gateway overwrites `X-Real-IP` before forwarding it to the API. By default it trusts no upstream proxy headers and uses the direct TCP peer address.
- If another reverse proxy or load balancer connects directly to the frontend, set `ECC_TRUSTED_PROXY_CIDRS` to the exact source IP/CIDR ranges of those proxy hops. The gateway only trusts `X-Forwarded-For` from those configured networks; it recursively resolves the client address and then replaces the identity headers sent to the API.
- Configure every trusted upstream proxy to sanitize/overwrite `X-Forwarded-For`, and restrict network access to the frontend listener so only the intended proxy can connect. Never trust `0.0.0.0/0`, `::/0`, arbitrary client networks, or ranges shared with untrusted workloads. If the proxy source range cannot be pinned down, leave the setting empty and accept that rate limiting will see the proxy address rather than individual clients.

## Secrets and identity

- Generate unique random values for `POSTGRES_PASSWORD` and `ECC_SECRET_KEY`; the signing key must contain at least 32 bytes.
- Use a unique administrator password and protect the `.env` file with restrictive filesystem permissions (for example, owner read/write only).
- Prefer a secrets manager or protected deployment secret store over a long-lived plaintext environment file.
- Never commit `.env`, credentials, database dumps, age private identities or cloud access keys.
- Keep the age backup private identity outside the application host where practical; store and test recovery access separately.

## Operations

- Pin container images to reviewed versions or immutable digests as part of release management; apply updates through reviewed pull requests.
- Configure host firewalling, OS patching, Docker daemon access restrictions and log rotation.
- Monitor application, proxy, database and Redis health; alert on failed backup jobs, failed restore drills, repeated authentication failures and storage exhaustion.
- Configure encrypted off-host backups, retention and access controls. Perform scheduled download, decrypt and isolated restore drills.
- Define and measure RPO/RTO, incident response, data retention, account provisioning/deprovisioning and security contact procedures.
- Run independent penetration testing and review tenant isolation before any real sensitive or business-critical data is loaded.

## Compose usage

For a same-host reverse proxy, retain the defaults in `.env`:

```dotenv
ECC_FRONTEND_BIND_ADDRESS=127.0.0.1
ECC_FRONTEND_PORT=5173
CORS_ORIGINS=https://ecc.example.com
# Optional: only if the TLS proxy's source address is fixed and verified.
# ECC_TRUSTED_PROXY_CIDRS=172.20.0.1/32
```

The reverse proxy should connect to `http://127.0.0.1:5173` and provide HTTPS to clients. The application itself does not configure certificates or TLS. Determine the source address that the frontend container actually sees before configuring `ECC_TRUSTED_PROXY_CIDRS`; do not copy the illustrative address above without verifying the Docker network and firewall topology. The upstream proxy must overwrite incoming `X-Forwarded-For` with a sanitized client/proxy chain.

For local development, `CORS_ORIGINS=http://localhost:5173` remains suitable. The frontend is reachable at `http://127.0.0.1:5173` on the Docker host.

## Explicit non-goals of this checklist

This file does not provision TLS, cloud networking, a secrets manager, monitoring, a backup schedule, immutable storage, MFA, or disaster recovery. Those require environment-specific infrastructure and validation. Do not interpret a successful Compose start as production certification.
