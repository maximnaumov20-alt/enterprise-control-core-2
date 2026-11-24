# Product roadmap

## Phase 0 - foundation
- [x] Public repository and initial project structure
- [x] FastAPI service and health endpoint
- [x] Basic asset CRUD API
- [x] Local PostgreSQL Docker Compose stack
- [x] Automated tests and CI workflow
- [x] Versioned database migrations

## Phase 1 - usable Community Edition
- [x] Authentication and secure password handling
- [x] Organization and user foundation
- [x] Departments and employee directory foundation
- [x] Tenant isolation and role-based access control
- [x] Tenant-scoped asset CSV import/export with validation and spreadsheet-formula protection
- [x] Tenant-scoped software licence register
- [x] Maintenance request workflow
- [x] Basic audit events
- [x] Asset inventory web interface with sign-in and role-aware controls
- [x] Administrator UI for user accounts and audit history
- [x] Authenticated password change
- [x] Per-user access-token invalidation after password or account-active-state changes

## Phase 2 - operational readiness
- [ ] Backup and restore procedures (SHA-256 signed JSON backup/restore, non-destructive Dry-Run verification, local snapshot store with `.sha256` sidecar & retention rotation, and audited RTO/RPO recovery drill reports implemented; external host cron scheduling and off-site S3 replication depend on target infrastructure)
- [x] Structured logs and monitoring
- [x] Baseline frontend security headers
- [x] Login rate limiting with shared Redis counters
- [x] Additional API security headers and deployment hardening
- [x] Python and npm dependency vulnerability scanning in GitHub Actions (`pip-audit`, `npm audit`)
- [x] Container image vulnerability scanning for unfixed critical vulnerabilities with Trivy
- [x] Automated PostgreSQL integration coverage in Docker Compose CI (API smoke tests, tenant-backed records, and encrypted backup/restore recovery)
- [x] Installation and upgrade documentation
- [ ] Independent security review

## Licensing and release governance
- [ ] Complete third-party dependency and bundled-asset licence/provenance audit (initial audit register and release checklist added; lockfiles, release SBOM and verified notices still pending)
- [ ] Complete dependency and release SBOM governance (hashed runtime and development Python lockfiles are generated; Docker, CI and security audit consume the split locks; CI publishes provisional CycloneDX SBOM artifacts for both container images; source inventory, verified notices and release archival remain pending)
- [ ] Finalize Community licence, commercial agreement and contributor terms with qualified legal review

## Phase 3 - commercial edition
- [x] Define and document Community/Enterprise boundaries (`docs/EDITION-BOUNDARIES.md`)
- [x] Separate private commercial modules (`server/licensing.ts`)
- [x] Licence service and offline activation design (signed `ECC1` tokens, expiry & org-binding enforcement, runtime quotas)
- [ ] Enterprise integrations and reporting (SLA & compliance report JSON/CSV implemented; external ERP/ITSM/billing connectors pending)
- [ ] Support and subscription operations (sanitized Support Bundle export implemented; external billing portal & commercial operations pending)

Commercial functionality must not be represented as implemented until it exists, is tested and is documented.
