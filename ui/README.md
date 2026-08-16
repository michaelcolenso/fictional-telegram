# Paydirt Control Plane UI

The UI is the primary operating surface for Paydirt. It is intentionally zero-dependency HTML/CSS/JS and is served as Cloudflare Worker static assets.

## Product surfaces

- **Command** — decision queue, fresh leads, and recent system runs
- **Inbox** — raw machine-found dataset leads before they become opportunities
- **Pipeline** — opportunity lifecycle, recommendation, score, and recency
- **Workspace** — evidence, score snapshot, economics, build thesis, and future decision actions
- **Portfolio** — explicitly approved products only

A recommendation is never treated as a decision. `BUILD_RECOMMENDED` remains an opportunity state signal until a later mutation API records an explicit promotion.

## Data modes

The client tries `GET /api/dashboard` first.

When the Worker/D1 control plane is unavailable, it falls back to the repository's legacy JSON artifacts. The sidebar clearly labels this mode **LEGACY PREVIEW** so filesystem data cannot be mistaken for production state.

## Local control-plane setup

```bash
npm install
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

Wrangler serves `ui/` as static assets and routes `/api/*` through `src/index.ts`.

## Provision production D1

Create the database, then replace the zero UUID in `wrangler.jsonc` with the returned database ID:

```bash
npx wrangler d1 create paydirt
npm run db:migrate:remote
python scripts/import_legacy.py > .paydirt-legacy-import.sql
npx wrangler d1 execute paydirt --remote --file=.paydirt-legacy-import.sql
npm run deploy
```

## Phase boundary

This branch implements the canonical read model. The decision buttons are visible but intentionally disabled. Phase C adds authenticated mutation endpoints for promote, research, backlog, reject, rescore, and build-spec generation, with every lifecycle change appended to `decisions`.
