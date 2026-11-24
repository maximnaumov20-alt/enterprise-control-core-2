# Enterprise Control Center (ECC)

Source-available platform in development for managing company IT assets, software inventory and maintenance requests.

> **Status: early development.** This repository is a starter foundation, not a production-ready enterprise system. Authentication, role-based permissions, organization-scoped asset access, per-user access-token invalidation after password or account-state changes, login rate limiting and basic audit events are implemented. Production hardening, independent security review, MFA, refresh-token support, selective token revocation and tamper-evident audit storage remain outstanding. Do not use it with sensitive or production data.

## Community edition

The initial development scope is:
- IT asset inventory
- Employee and department directory
- Software and licence register
- Maintenance requests
- Audit history and reporting

## Architecture

- **Backend:** Python 3.12, FastAPI, SQLAlchemy
- **Database:** PostgreSQL (Docker Compose); SQLite can be used for local development
- **API:** REST, documented by OpenAPI at `/docs`
- **Deployment:** Docker Compose, non-root API container, Nginx static frontend and same-origin API proxy

The current development build includes tenant-scoped asset, software licence and maintenance request APIs, bearer-token authentication, admin/editor/viewer roles, organization user administration, basic audit history and a React interface with sign-in, password change and role-aware controls. Department and employee directory APIs and the administrator/operator interface are also included.

## Run locally

Requirements: Python 3.12+.

The repository maintains separate, hash-pinned Python dependency locks:
- `backend/requirements-runtime.lock`: production runtime dependencies, installed in the API Docker image.
- `backend/requirements-dev.lock`: runtime dependencies plus pytest and httpx for local development and CI.

For local development, install the development lock:

```bash
cd backend
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux:
source .venv/bin/activate
python -m pip install --require-hashes -r requirements-dev.lock
alembic upgrade head

# macOS/Linux: generate a signing key and set the initial admin credentials.
export ECC_SECRET_KEY="$(openssl rand -hex 32)"
export ECC_ADMIN_EMAIL="admin@example.com"
export ECC_ADMIN_PASSWORD="replace-with-a-unique-password-of-at-least-12-characters"
export ECC_ORGANIZATION_NAME="Example Organization"
python -m app.create_admin

uvicorn app.main:app --reload
```

On Windows PowerShell, set the same variables with `$env:NAME="value"` before running `python -m app.create_admin` and Uvicorn. Keep the signing key and administrator password private. The administrator bootstrap command is safe to rerun for an existing email; it does not reset the password.

The API will be available at http://127.0.0.1:8000 and interactive documentation at http://127.0.0.1:8000/docs.

For the full local development stack (PostgreSQL, API and web interface):

```bash
cp .env.example .env
# Replace all placeholders with unique secrets and administrator credentials.
docker compose up --build
```

The API requires a bearer token. Docker Compose applies migrations and creates the first organization administrator before starting the API. See [Access control and organization administration](docs/ACCESS_CONTROL.md), [Security policy](docs/SECURITY.md) and [Database migrations and backups](docs/DATABASE.md) for details.

Open the local web interface at http://127.0.0.1:5173. The frontend gateway binds to loopback by default; the API, PostgreSQL and Redis are kept off published host ports. Upstream proxy trust is disabled by default and can be enabled only for explicit source CIDRs using `ECC_TRUSTED_PROXY_CIDRS`. Its interactive documentation is available at http://127.0.0.1:5173/docs. For a future controlled deployment behind a same-host TLS reverse proxy, see [Production deployment checklist](docs/PRODUCTION-DEPLOYMENT.md).

Database schema changes are managed with Alembic. See [Database migrations and backups](docs/DATABASE.md) for migration, backup and restore instructions.

## Dependency lock maintenance

The source input files are `backend/requirements-runtime.in` and `backend/requirements-dev.in`. The GitHub Actions workflow `Python Dependency Locks` compiles both hash-pinned lock files with pinned pip-tools and opens or updates a dedicated pull request for review. To reproduce the generation locally, install the same pinned pip-tools version used by the workflow, then run:

```bash
python -m pip install pip-tools==7.5.1
pip-compile --resolver=backtracking --generate-hashes --output-file=backend/requirements-runtime.lock backend/requirements-runtime.in
pip-compile --resolver=backtracking --generate-hashes --output-file=backend/requirements-dev.lock backend/requirements-dev.in
```

Do not install the obsolete combined `requirements.txt` file; it has been removed.

## Project structure

```
backend/
  app/
  migrations/
  requirements-runtime.in
  requirements-runtime.lock
  requirements-dev.in
  requirements-dev.lock
frontend/
  src/
  nginx.conf
  Dockerfile
  package.json
docs/
  ROADMAP.md
  SECURITY.md
  DATABASE.md
  ACCESS_CONTROL.md
  licensing/
scripts/
  backup-postgres.sh
  restore-postgres.sh
  run-backup.sh
  upload-backup-s3.sh
.github/
  workflows/
docker-compose.yml
Dockerfile
```

## Development principles

1. Security and tenant isolation must be designed before multi-company features are introduced.
2. Every feature must include tests and migration considerations.
3. Secrets must never be committed to the repository.
4. Community and commercial components must have explicit, reviewed boundaries.
5. Production readiness requires independent security review and operational testing.
6. Compose publishes only the frontend gateway and binds it to loopback by default; public access must be provided through a separately managed HTTPS reverse proxy and firewall.

## Licensing

No binding software licence has been selected or published yet. Until one is approved, standard copyright applies; public visibility alone does not grant permission to reuse, modify or redistribute this code.

The intended direction is a source-available Community Edition for non-commercial use, with commercial use governed by a separate written licence. This is not an Open Source licence under the Open Source Definition. The documents below are planning drafts only and do not grant rights:

- [Licensing strategy](docs/licensing/LICENSING-STRATEGY.md)
- [Commercial licence agreement outline](docs/licensing/COMMERCIAL-LICENSE-DRAFT.md)
- [Copyright and contributions plan](docs/licensing/COPYRIGHT-AND-CONTRIBUTIONS-DRAFT.md)

Do not use these drafts as signed agreements. The legal rightsholder, third-party licences and final terms must be verified before publication.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the current contribution policy. Until licensing and contributor permissions are finalized, issues and discussions are welcome, but external code contributions are not accepted for merging.
