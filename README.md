# Paydirt

Paydirt is an opportunity-intelligence control plane for finding profitable gaps between public data and user demand.

The system scans public datasets, captures evidence, scores opportunities, and helps decide which ideas deserve build capital. The operating rule is simple:

> **Automation produces evidence and recommendations. The control plane owns decisions.**

A `BUILD_RECOMMENDED` score does not automatically become a product.

## Control plane

The current architecture is documented in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

The UI provides five operating surfaces:

1. **Command** — what needs attention now
2. **Inbox** — raw machine-found leads
3. **Pipeline** — lifecycle + recommendation + score
4. **Workspace** — evidence and decision context
5. **Portfolio** — explicitly approved products

## Local setup

```bash
npm install
npm run validate
npm run dev
```

The Worker serves the zero-dependency UI from `ui/` and routes `/api/*` to the D1-backed read API in `src/index.ts`.

## Production D1

`wrangler.jsonc` contains a zero UUID placeholder for local development. Before the first remote migration/deploy:

```bash
npx wrangler d1 create paydirt
# replace database_id in wrangler.jsonc with the returned UUID
npm run db:migrate:remote
python scripts/import_legacy.py > .paydirt-legacy-import.sql
npx wrangler d1 execute paydirt --remote --file=.paydirt-legacy-import.sql
npm run deploy
```

## Canonical state

D1 stores sources, leads, opportunities, evidence, immutable score snapshots, append-only decisions, products, and runs. Legacy JSON is import/export material rather than the production transactional model.

## Framework v3 policy

See [`config/scoring-policy.json`](./config/scoring-policy.json). The first v3 policy keeps the familiar six scoring dimensions while separating recommendation from lifecycle state.

## Historical framework

The original 679-line **Opportunity Discovery Framework v2** README is preserved in git history at main commit `a44b18dd4cd1ba93934126720a56ba27a9618c67`. [`docs/LEGACY_FRAMEWORK.md`](./docs/LEGACY_FRAMEWORK.md) records that reference.
