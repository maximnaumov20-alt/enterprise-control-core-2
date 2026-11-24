# AI Collaboration Protocol

## Purpose

This file is the shared coordination note for work on Enterprise Control Core (ECC) by the repository owner, ChatGPT, and Google AI Studio (Gemini). It does not grant either AI access to the other's private session, tools, credentials, or unsaved work.

## Repository facts verified on 2026-11-24

- Repository: https://github.com/maximnaumov20-alt/enterprise-control-core-2
- Default branch: `main`
- Current application source is TypeScript: Express server, React/Vite frontend, and JSON-backed persistence in the checked source.
- `package.json` includes `@google/genai`.
- `.env.example` documents `GEMINI_API_KEY` and `APP_URL` as values injected by Google AI Studio.
- `metadata.json` declares a server-side Gemini capability.
- A static scan of `server.ts`, `src/App.tsx`, and `src/api.ts` did not find calls to the Google GenAI SDK, `GEMINI_API_KEY`, or Gemini generation methods. Therefore, SDK presence and AI Studio configuration are confirmed, but a working Gemini feature in the application is **not yet verified**.
- The README and roadmap describe a Python/FastAPI/PostgreSQL/Docker architecture that does not match the TypeScript/Express/JSON source currently present. Treat this as a documentation/architecture discrepancy to resolve before large refactors.
- The repository has a test script (`npm test`), but its passing status must not be claimed until it is run in a suitable environment.

These are source-inspection observations, not a runtime security review or proof that the application is production-ready.

## Work ownership

### ChatGPT
- Maintain the cross-project technical plan and review proposed architecture changes.
- Audit security boundaries, tenant isolation, data integrity, and API contracts.
- Review Gemini contributions for correctness, consistency, and regressions.
- Keep progress reports explicit about what was inspected, changed, and actually tested.

### Gemini (Google AI Studio)
- First inspect the current repository and this protocol.
- Provide focused code reviews, test proposals, and implementation proposals.
- Implement only a clearly assigned task on a dedicated feature branch.
- Do not assume that a dependency or environment variable means a feature is implemented.
- Do not perform broad rewrites or change persistence/framework architecture without an agreed migration plan.

### Repository owner
- Decide priorities and approve merges/releases.
- Keep Google AI Studio secrets and production credentials in the platform's Secrets facility; never commit them.

## Git workflow

1. `main` is the shared stable baseline. Do not push experimental work directly to `main`.
2. Each contributor uses a separate branch, for example `ai/chatgpt-<task>` or `ai/gemini-<task>`.
3. Before editing, fetch the latest `main` and inspect recent commits and existing branches.
4. Keep each branch focused on one task. Avoid overlapping file ownership; if overlap is unavoidable, coordinate first.
5. Open a pull request into `main`. Include purpose, changed files, risks, test commands, and actual test results.
6. Never merge automatically. The repository owner reviews and approves the pull request.
7. If the branch is behind or conflicts with newer work, stop and reconcile; do not force-push over another contributor's work.

## Engineering rules

- Preserve existing behavior unless the task explicitly changes it.
- Do not invent test results. Distinguish static inspection, tests executed, and tests not run.
- Add or update tests for behavior changes.
- Validate authorization and organization scoping on every affected API route.
- Do not log passwords, API keys, bearer tokens, or sensitive business records.
- Do not commit `.env`, API keys, access tokens, customer data, or real backups.
- Avoid destructive data migrations. Include a rollback or recovery plan for schema/storage changes.
- Update documentation when behavior or setup changes.
- Do not add new dependencies without explaining why and checking compatibility.

## Required task handoff format

Every contributor must report:

1. **Task:** one-sentence objective.
2. **Baseline:** branch and commit SHA used.
3. **Files changed:** exact paths.
4. **Implementation:** concise summary of behavior changes.
5. **Validation:** exact commands run and their results.
6. **Not verified:** tests, environments, or assumptions not checked.
7. **Risks / follow-up:** remaining issues.
8. **Pull request:** URL, or state that no PR has been opened.

## First Gemini assignment

Do not modify files yet. Inspect the current default branch and report:

1. The actual runtime architecture, based on source files rather than README claims.
2. Whether Gemini API calls are implemented, and the exact file/function evidence.
3. The mismatch between README/roadmap and the current source.
4. The highest-priority security and data-integrity risks, with file paths and relevant functions.
5. A proposed, small first implementation task with acceptance criteria and tests.

Wait for the repository owner to approve the task before editing.
