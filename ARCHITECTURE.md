# Paydirt Control Plane Architecture

## Implementation status

**Phase A + Phase B are implemented on this branch.** The canonical D1 schema, v3 scoring policy, deterministic legacy importer, Worker read API, static Worker assets, and redesigned Command / Inbox / Pipeline / Workspace / Portfolio UI now exist in code. Mutation endpoints and durable workflow orchestration remain the next phases.

## Decision

Paydirt becomes a control plane for opportunity discovery and portfolio decisions.

The UI is the primary operating surface. Automated discovery produces evidence and recommendations; only explicit control-plane actions change an opportunity's lifecycle or the portfolio.

This replaces the prototype model where scripts, generated JSON files, and BUILD verdicts could independently become state.

## Core invariant

> Automation produces evidence and recommendations. The control plane owns decisions.

A `BUILD_RECOMMENDED` result does not create a product. It remains an opportunity until a later explicit decision records approval.

## Canonical domain model

```text
Source → Lead → Opportunity → Product
          │          │
          │          ├── Evidence
          │          ├── Score snapshots
          │          ├── Decision history
          │          └── Runs
          └── Inbox triage
```

### Source
A scanner or upstream dataset origin with health, cadence, and enablement state.

### Lead
A high-volume machine-found signal. States: `NEW`, `PROMOTED`, `DISMISSED`, `MERGED`.

### Opportunity
A promoted business thesis worthy of validation. Lifecycle:

```text
DISCOVERED
  → VALIDATING
  → SCORED
  → RESEARCHING | BACKLOG | APPROVED | REJECTED
  → READY_TO_BUILD
  → BUILDING
  → LAUNCHED
```

Recommendation is independent:

```text
UNSCORED | BUILD_RECOMMENDED | BACKLOG | KILL_RECOMMENDED
```

### Evidence
Observed facts and validation artifacts. Evidence is history-preserving and tied to a run when applicable.

### Score snapshot
Immutable six-factor result tied to a framework version. Current score is derived from the latest snapshot, not overwritten.

### Decision
Append-only record of lifecycle mutation: action, previous state, next state, actor, reason, timestamp.

### Product
An explicitly approved portfolio asset. Product creation is downstream from a decision, never directly from a score threshold.

### Run
A scan, discovery, validation, rescore, import, or future build-spec workflow instance.

## Product surfaces

### Command Center
Answers **what needs attention now?** with fresh leads, active opportunities, BUILD recommendations awaiting decisions, recent runs, and the highest-value queue.

### Inbox
Raw scanner discoveries live here before becoming opportunities. Phase C actions: promote, dismiss, merge, reserve.

### Pipeline
Tracks lifecycle and recommendation separately. Example:

```text
STATE: SCORED
RECOMMENDATION: BUILD_RECOMMENDED
```

That opportunity is not approved.

### Opportunity Workspace
Evidence, current score snapshot, query thesis, economics, source data, build thesis, score history, and decision history. Phase C enables Promote / Approve, Research, Backlog, Reject, Rescore, and Generate Build Spec.

### Portfolio
Approved products only. Discovery cannot write here directly.

## Runtime

```text
Browser
   │
   ▼
Cloudflare Worker
   ├── static ui/ assets
   └── /api/*
          │
          ▼
          D1 — canonical operational state

Future:
Worker → Workflow binding → scan / validate / enrich / rescore
```

GitHub remains source code, migrations, scoring policy, exports, build specs, and implementation history. It is not the transactional database.

## Phase B API

```text
GET /api/health
GET /api/dashboard
GET /api/leads
GET /api/opportunities
GET /api/opportunities/:id
GET /api/portfolio
GET /api/runs
```

Any non-GET API call returns `405 read_only_phase` until Phase C.

## Canonical storage

`migrations/0001_control_plane.sql` defines `sources`, `leads`, `opportunities`, `evidence`, `score_snapshots`, `decisions`, `products`, `runs`, `legacy_imports`, and the deterministic `opportunity_current_scores` view.

## Scoring policy

`config/scoring-policy.json` owns framework v3 policy rather than embedding it in UI code.

The initial six equal-weight dimensions are data quality, search demand, competition gap, monetization clarity, build feasibility, and defensibility.

Initial recommendations:

- composite ≥ 7.0 + hard gates → `BUILD_RECOMMENDED`
- composite ≥ 5.0 + hard gates → `BACKLOG`
- otherwise → `KILL_RECOMMENDED`

Recommendations explicitly do not mutate lifecycle state.

## Legacy migration

`scripts/import_legacy.py` imports existing watchlist, pipeline, and portfolio JSON into D1 using deterministic UUIDv5 identifiers and idempotent inserts.

Important migration behavior:

- legacy BUILD → `SCORED` + `BUILD_RECOMMENDED`
- legacy KILL → `SCORED` + `KILL_RECOMMENDED`
- phase evidence is preserved as evidence records
- historical scores become immutable snapshots
- import decisions record that recommendations were not converted into approvals
- existing portfolio records are preserved

## Deployment

Local:

```bash
npm install
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

Remote:

```bash
npx wrangler d1 create paydirt
# replace the placeholder D1 UUID in wrangler.jsonc
npm run db:migrate:remote
python scripts/import_legacy.py > .paydirt-legacy-import.sql
npx wrangler d1 execute paydirt --remote --file=.paydirt-legacy-import.sql
npm run deploy
```

## Phase C — explicit writes

Add authenticated mutation endpoints:

```text
POST /api/leads/:id/promote
POST /api/leads/:id/dismiss
POST /api/opportunities/:id/decision
POST /api/opportunities/:id/rescore
POST /api/opportunities/:id/build-spec
```

Every lifecycle write must validate the transition, append a decision event, then update current state. Only an explicit approval may create a Product.

## Phase D — durable orchestration

Move scanning, validation, enrichment, and rescoring behind Cloudflare Workflows. The request path only starts or queries durable work; workflow steps write evidence and score snapshots to D1.

## Phase E — calibration

Feed launched-product outcomes back into Paydirt: organic sessions, revenue, time-to-launch, build effort, indexing velocity, RPM/lead value, conversion, and maintenance burden. Compare predicted scores against actual outcomes and recalibrate weights and thresholds so Paydirt becomes a genuinely predictive capital-allocation system.
