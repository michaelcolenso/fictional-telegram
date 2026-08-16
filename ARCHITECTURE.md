# Paydirt Control Plane Architecture

## Implementation status

**Phases A-D are now represented in code on this branch.** D1 is canonical state, the Worker owns authenticated decisions, and Cloudflare Workflows now owns scheduled discovery execution. Legacy JSON remains migration/provenance material only.

## Core invariant

> Automation produces evidence and recommendations. The control plane owns decisions.

A machine score or discovery event can never create a portfolio product. Only an explicit `APPROVE` decision can do that.

## Domain model

```text
Source → Lead → Opportunity → Product
          │          │
          │          ├── Evidence
          │          ├── Score snapshots
          │          ├── Decision history
          │          └── Build specs
          └── Inbox triage

Every automated/manual operation → Run
```

### Source
An upstream scanner or dataset origin. Sources own cadence and last-scan metadata. Source-health observations are operational state, not Inbox leads.

### Lead
A machine-found **source event**. States: `NEW`, `PROMOTED`, `DISMISSED`, `MERGED`.

Phase D deliberately fingerprints the source + URL/title + observed timestamp. Exact workflow retries are idempotent, while a materially newer dataset update can become a new Inbox event.

### Opportunity
A promoted business thesis. Lifecycle:

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
History-preserving validation facts tied to an opportunity and, where applicable, a run.

### Score snapshot
Immutable six-factor result tied to a framework version. Current score is derived from the latest snapshot.

### Decision
Append-only lifecycle event: action, previous state, next state, actor, reason, timestamp.

### Product
An explicitly approved portfolio asset. Product creation is downstream from `APPROVE`, never from recommendation thresholds.

### Run
A durable/manual operation record. Discovery Workflow instance IDs are also run IDs, which makes Cloudflare execution and D1 state directly correlatable.

## Product surfaces

### Command
Fresh leads, active opportunities, BUILD recommendations awaiting decisions, and recent runs.

### Inbox
Raw machine-found lead events. Humans promote or dismiss them.

### Pipeline
Lifecycle, recommendation, and score shown independently.

### Workspace
Evidence, scores, economics, source data, build thesis, decision history, rescoring, lifecycle actions, and versioned build specs.

### Portfolio
Approved products only.

## Runtime

```text
                    ┌──────────────────────────┐
                    │ Cloudflare Workflow      │
                    │ paydirt-discovery        │
                    │ weekly + durable retries │
                    └────────────┬─────────────┘
                                 │
               source APIs ──────┼──────► score lead events
                                 │
                                 ▼
Browser ─────► Worker ───────────► D1
   │            │                 │
   │            ├─ static UI      ├─ sources
   │            ├─ read API       ├─ leads
   │            └─ auth writes    ├─ opportunities
   │                              ├─ evidence/scores
   │                              ├─ decisions/specs
   └─────────────────────────────►└─ products/runs
```

GitHub stores source code, migrations, scoring policy, deployment automation, exports, and implementation history. It is not the transactional database.

## Phase A — canonical model

Implemented in `migrations/0001_control_plane.sql` and `config/scoring-policy.json`:

- Source → Lead → Opportunity → Product separation
- immutable score history
- history-preserving evidence
- append-only decisions
- recommendation separated from lifecycle state
- D1 as canonical operational state

## Phase B — read control plane

The Worker exposes:

```text
GET /api/health
GET /api/dashboard
GET /api/leads
GET /api/opportunities
GET /api/opportunities/:id
GET /api/portfolio
GET /api/runs
```

## Phase C — authenticated decisions

Mutation endpoints require `PAYDIRT_ADMIN_TOKEN`:

```text
POST /api/leads/:id/promote
POST /api/leads/:id/dismiss
POST /api/opportunities/:id/decision
POST /api/opportunities/:id/rescore
POST /api/opportunities/:id/build-spec
GET  /api/opportunities/:id/build-spec/latest
```

Rules:

- lifecycle transitions are validated server-side
- related D1 writes use transactional batches
- rejection requires a reason
- rescoring creates a new immutable snapshot
- build specs are versioned D1 records
- only `APPROVE` creates a Product

## Phase D — durable discovery

Implemented in `src/workflows/discovery.ts` and exported by `src/entry.ts`.

`wrangler.jsonc` binds `DISCOVERY_WORKFLOW` to `paydirt-discovery` and schedules it weekly:

```text
0 14 * * 1
```

The workflow currently executes this graph:

```text
record run start
      │
      ├── scan Federal Register ──────────────┐
      │                                       │
      ├── scan state portal 1 ────────────────┤
      ├── scan state portal 2 ────────────────┤
      ├── scan state portal 3 ────────────────┤
      ├── scan state portal 4 ────────────────┤
      └── scan state portal 5 ────────────────┤
                                              ▼
                                      score candidate events
                                              │
                                      update source records
                                              │
                                      INSERT OR IGNORE leads
                                              │
                                      record run summary
```

### Why plain Workflows, not an Agent

Discovery is deterministic orchestration: fetch sources, normalize, score, persist. It does not need conversational state, autonomous planning, WebSockets, or per-agent Durable Object state. Native Cloudflare Workflows therefore provide the useful durability/retry boundary without adding an Agents SDK state layer.

### Source semantics

The old Python watchlist scanner mixed endpoint-health pings into the lead stream. Phase D changes that boundary:

- dataset and forward-looking regulatory events → `leads`
- scanner/source execution metadata → `sources` + `runs`
- lifecycle decisions → control-plane API only

### Idempotency

Workflow retries must never duplicate Inbox rows. New lead IDs are deterministic SHA-256 fingerprints of:

```text
source id + dataset/document URL (or title) + observed timestamp
```

Exact retries therefore converge on the same lead row. A new upstream update date is allowed to become a new lead event.

### Failure behavior

Each external source scan is an independently durable step with retry policy and timeout. A single exhausted source can be recorded in the run summary without discarding successful scans from other sources. Fatal persistence failures mark the D1 run failed and rethrow so the Workflow remains observably errored.

### State portal rotation

Five state portals run per weekly instance, rotating through the 15 configured portals. This bounds each run while covering the full set on a repeating cycle.

### Next Phase D increments

1. Add keyed `data.gov` and `govinfo` scanners as Worker secrets become available.
2. Add specialty API health checks that update Source health rather than generating leads.
3. Move opportunity validation into a separate `ValidationWorkflow` triggered after human lead promotion.
4. Move fresh external rescoring/enrichment into a `RescoreWorkflow`; keep Phase C manual rescore as policy-only recomputation.
5. Add a manual authenticated `POST /api/discovery/run` only if operator-triggered scans prove useful; recurring discovery itself does not require an HTTP trigger.

## Legacy migration

`scripts/import_legacy.py` remains the one-time/idempotent bridge from historical JSON into D1. Legacy generated artifacts are not production write paths.

Removed legacy write authorities:

- `full_discovery_run.py`
- `run_full_workflow.py`

See `docs/LEGACY_STATE.md`.

## Production deployment

`.github/workflows/deploy-control-plane.yml` provisions/fetches D1, patches the deployment config, migrates, imports legacy state, installs the admin secret, and deploys the Worker/Workflow bundle.

Required GitHub production secrets:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
PAYDIRT_ADMIN_TOKEN
```

## Phase E — calibration

Feed launched-product outcomes back into Paydirt: organic sessions, revenue, time-to-launch, build effort, indexing velocity, RPM/lead value, conversion, and maintenance burden. Compare predicted scores against observed outcomes and recalibrate the model so Paydirt becomes a predictive capital-allocation system.
