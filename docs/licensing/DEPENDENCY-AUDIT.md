# Third-party dependency and asset audit

**Status: incomplete. This is an audit register and release checklist, not a third-party licence notice or legal clearance.**

## Current evidence

The repository currently declares direct dependencies in:
- backend/requirements.txt
- frontend/package.json

At the time of this review, the repository has no committed Python lock/constraints file or npm lock file. Python requirements use version ranges, and frontend dependencies use semver ranges, so the exact transitive dependency graph can change between builds. A GitHub Actions workflow now resolves the frontend dependency graph with Node.js 22/npm and opens a reviewable pull request containing `frontend/package-lock.json`; the lockfile is validated with `npm ci` before the pull request is created. Until that pull request is reviewed and merged, the lockfile is not part of the `main` branch and regular CI/Docker builds still use `npm install`.

The GitHub Security Scan checks known vulnerabilities with pip-audit, npm audit and Trivy. It also generates CycloneDX SBOM artifacts for the API and frontend container images using Syft; artifacts are retained by GitHub Actions for 30 days. These image SBOMs are useful inventories of the built containers, but they are not yet a complete release SBOM for all source and bundled assets. None of these automated checks establishes copyright provenance, licence compatibility, attribution compliance, or permission to redistribute every dependency.

## Inventory status

| Area | Source of truth | Current status |
|---|---|---|
| Direct Python packages | backend/requirements.txt | Declared; exact resolved versions and licence texts not recorded here |
| Transitive Python packages | Resolved installation graph | Not pinned or fully inventoried |
| Direct frontend packages | frontend/package.json | Declared; exact resolved versions and licence texts not recorded here |
| Transitive frontend packages | `frontend/package-lock.json` (pending bootstrap PR) | Resolver-generated lockfile is validated in the automation workflow; reproducible installation is not yet enabled on `main` |
| Container base images and OS packages | Dockerfiles and CI-generated image SBOMs | Provisional CycloneDX artifacts generated for CI images; release-specific review and archival still required |
| Fonts, icons, images and other bundled assets | Frontend source and build output | Requires source/provenance review before release |
| Generated or copied code | Repository history and source files | Requires provenance review |

No package licence is inferred from its name. Verify the actual package metadata, licence expression, included licence files, notices and any exceptions against the exact version shipped.

## Required release procedure

Before publishing a Community or Enterprise release:
1. Review and merge the resolver-generated frontend lockfile pull request, then switch frontend CI and Docker installation to `npm ci`. Generate and commit an appropriate Python lock/constraints file before claiming fully reproducible dependency resolution.
2. Generate and archive an SPDX or CycloneDX SBOM for the exact release and container images. CI currently publishes provisional CycloneDX image SBOM artifacts; regenerate and retain SBOMs for the final release artefacts.
3. Record each direct and transitive component, exact version, supplier, package URL, declared licence and evidence location.
4. Review licence texts and compatibility for the intended distribution model, including bundled binaries and container OS packages.
5. Record required copyright notices, attribution, source-offer or corresponding-source obligations, and modification notices.
6. Trace fonts, icons, images, templates, copied snippets and generated assets to their origin and permitted use.
7. Resolve unknown, custom, missing, dual or conflicting licence expressions before distribution.
8. Publish a release-specific third-party notices file derived from the verified SBOM and legal review.
9. Archive the SBOM, notices, lockfiles and review record with the release.

## Release gate

Do not describe the dependency audit as complete until the exact release artefacts have been scanned and every shipped component has a reviewed licence/provenance record. Vulnerability scan success is not a substitute for this review.
