# Paydirt

Paydirt is an opportunity-intelligence control plane for finding profitable gaps between public data and user demand.

> **Automation produces evidence and recommendations. The control plane owns decisions.**

A `BUILD_RECOMMENDED` score does not automatically become a product.

## Control plane

The architecture is documented in [`ARCHITECTURE.md`](./ARCHITECTURE.md). The UI has five operating surfaces:

1. **Command** — what needs attention now
2. **Inbox** — raw machine-found leads
3. **Pipeline** — lifecycle + recommendation + score
4. **Workspace** — evidence, decisions, rescoring, and build specs
5. **Portfolio** — explicitly approved products

Phase C writes are authenticated with the `PAYDIRT_ADMIN_TOKEN` Worker secret. The browser keeps that token in session storage only. Lead promotion/dismissal and opportunity lifecycle changes are D1 transactions; lifecycle changes append decision history. Score snapshots and generated build specs are immutable/versioned.

## Local setup

```bash
npm install
printf 'PAYDIRT_ADMIN_TOKEN="local-admin-token"\n' > .dev.vars
npm run validate
npm run dev
```

`.dev.vars` is ignored by git.

## Canonical state

D1 is the sole supported write authority for Paydirt opportunity lifecycle, decisions, score snapshots, build specs, and portfolio products. Legacy JSON/Markdown files are migration fixtures and provenance only. See [`docs/LEGACY_STATE.md`](./docs/LEGACY_STATE.md).

The former filesystem pipeline runners were removed because they created competing state. The scanner may still emit discovery exports, but those exports are not canonical Inbox or portfolio state until ingested by the control plane.

## Production deployment

The repository includes `.github/workflows/deploy-control-plane.yml`. Configure the GitHub **production** environment with:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `PAYDIRT_ADMIN_TOKEN`

The deployment workflow then:

1. finds or creates the `paydirt` D1 database in Western North America;
2. patches the real D1 UUID into an ephemeral deployment config;
3. applies all D1 migrations;
4. imports existing legacy state idempotently;
5. bootstraps the Worker in a mutation-locked state;
6. installs `PAYDIRT_ADMIN_TOKEN` as a Worker secret;
7. deploys the final Worker + Static Assets configuration.

The committed `wrangler.jsonc` deliberately retains a zero UUID so no account-specific database identifier is fabricated or required for local development.

## API writes

Authenticated endpoints:

```text
POST /api/leads/:id/promote
POST /api/leads/:id/dismiss
POST /api/opportunities/:id/decision
POST /api/opportunities/:id/rescore
POST /api/opportunities/:id/build-spec
```

`APPROVE` is the only opportunity decision that can create a portfolio product. A later rejection preserves that product record as `cancelled` rather than deleting history.

## Framework v3 policy

See [`config/scoring-policy.json`](./config/scoring-policy.json). Recommendation and lifecycle are deliberately separate.

## Historical framework

The original 679-line **Opportunity Discovery Framework v2** README is preserved in git history at main commit `a44b18dd4cd1ba93934126720a56ba27a9618c67`. [`docs/LEGACY_FRAMEWORK.md`](./docs/LEGACY_FRAMEWORK.md) records that reference.
