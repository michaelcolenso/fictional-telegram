# Paydirt Control Plane Architecture

## Decision

Paydirt becomes a control plane for opportunity discovery and portfolio decisions.

The UI is the primary operating surface. Automated discovery produces evidence and recommendations; only explicit control-plane actions change an opportunity's lifecycle or the portfolio.

This replaces the prototype model where scripts, generated JSON files, and BUILD verdicts could independently become state.

## Product model

Paydirt has five first-class objects:

1. **Source** — a dataset, portal, feed, registry, filing system, or community signal source worth scanning.
2. **Lead** — a raw discovery from a scanner before product-market validation.
3. **Opportunity** — a durable candidate being evaluated through gates and scored evidence.
4. **Run** — an immutable execution record for scanning, validation, rescoring, or enrichment.
5. **Product** — an opportunity explicitly promoted into the portfolio.

Build specs are derived artifacts attached to opportunities/products, not independent state.

## Core rule

**Automation produces evidence. Humans/control-plane actions produce state transitions.**

A score of 7.0 may produce a `BUILD_RECOMMENDED` recommendation. It must not automatically add a product to the portfolio.

Likewise, scanner output must never overwrite opportunity decisions. Re-runs append evidence and recompute recommendations while preserving lifecycle state and decision history.

## Target lifecycle

```text
SOURCE
  ↓ scan
LEAD
  ↓ promote / auto-promote above configurable evidence threshold
DISCOVERED
  ↓ data + demand gates
VALIDATING
  ├─ failed gate → REJECTED
  └─ passed gate → SCORED
                     ├─ < 5.0 → REJECTED_RECOMMENDED
                     ├─ 5.0–6.99 → BACKLOG_RECOMMENDED
                     └─ ≥ 7.0 → BUILD_RECOMMENDED

Control-plane decision from SCORED:
  ├─ Reject → REJECTED
  ├─ Backlog → BACKLOG
  ├─ Investigate → RESEARCHING
  └─ Promote → APPROVED
                  ↓ generate build spec
                READY_TO_BUILD
                  ↓ attach repo / implementation
                BUILDING
                  ↓
                LAUNCHED
```

Recommendations and lifecycle state are deliberately separate. `BUILD_RECOMMENDED` is evidence; `APPROVED` is a decision.

## Source of truth

### Production

Use Cloudflare D1 as the canonical state store.

The repository is source code and configuration, not a mutable production database.

D1 owns:

- sources
- scanner cursors
- leads
- opportunities
- opportunity evidence
- score snapshots
- decisions / transitions
- runs and run events
- products
- generated artifact metadata

### Derived/exported state

JSON and Markdown remain useful, but become exports only:

```text
exports/
  latest.json
  portfolio.json
  runs/<run-id>.json
  opportunities/<slug>.json
  specs/<slug>.md
```

These files can be generated for Git history, backup, agent handoff, or static publishing. They are never read back as canonical mutable state in production.

### Migration

Current files map as follows:

- `pipeline.json` and `output/pipeline.json` → imported as historical Run + Opportunity evidence snapshots
- `portfolio_state.json` → imported into Product records
- `state/scan_state.json` → imported into scanner cursor state
- `state/seen_datasets.json` → imported into source/lead fingerprints
- root `scan_state.json` / `seen_datasets.json` → deprecated duplicate state
- `build-spec-*.md` → imported as Opportunity artifacts

After migration, remove root/output state duplication.

## Cloudflare architecture

```text
Browser
  │
  ▼
Cloudflare Worker — Paydirt API + static assets
  │
  ├── D1               canonical relational state
  ├── Workflows        discovery/validation orchestration
  ├── Queues           fan-out validation/enrichment jobs
  ├── KV (optional)    short-lived read-model cache only
  └── R2 (optional)    large raw evidence snapshots / downloaded datasets

Scheduled Trigger
  │
  └── starts watchlist workflow
```

### Why Worker + D1 + Workflows

Paydirt's work is long-running and multi-step: scan sources, deduplicate leads, validate data access, query search evidence, gather pain signals, calculate scores, and generate artifacts. That is orchestration, not one HTTP request.

The Worker handles UI/API requests. Cloudflare Workflows owns durable multi-step runs. D1 owns state. Queues are only necessary where a run benefits from bounded parallelism.

Do not introduce Durable Objects for v1. Paydirt has no real-time collaborative state or strong per-entity coordination requirement.

## Repository layout

Target layout:

```text
paydirt/
  apps/
    web/
      index.html
      src/
      public/
    api/
      src/index.ts
      wrangler.jsonc
  packages/
    domain/
      models.ts
      lifecycle.ts
      scoring.ts
      schemas.ts
    discovery/
      sources/
      scanners/
      dedupe.ts
    validation/
      data-source.ts
      demand.ts
      competition.ts
      pain.ts
      monetization.ts
    workflows/
      discovery.ts
      rescore.ts
      build-spec.ts
  migrations/
  scripts/
    import-legacy.py
    export-state.ts
  fixtures/
  docs/
  ARCHITECTURE.md
```

The existing Python scanners can remain during migration. They should become isolated adapters that emit normalized Lead/Evidence payloads rather than owning files or lifecycle state.

## Domain schema

### sources

```text
id
name
kind
base_url
scanner_key
enabled
reserved
scan_cadence
config_json
created_at
updated_at
```

### scanner_state

```text
source_id
cursor_json
last_started_at
last_completed_at
last_success_at
last_error
```

### leads

```text
id
source_id
fingerprint
external_id
name
description
url
organization
formats_json
source_updated_at
raw_metadata_json
status        NEW | PROMOTED | DISMISSED
first_seen_at
last_seen_at
```

`fingerprint` is the stable dedupe key. It must not depend only on title text.

### opportunities

```text
id
slug
name
lifecycle_state
recommendation
primary_vertical
query_pattern
monetization_model
owner_notes
created_from_lead_id
created_at
updated_at
```

### evidence

Append-only evidence records:

```text
id
opportunity_id
run_id
type
source
status
value_json
observed_at
expires_at
```

Evidence types initially:

- DATA_ACCESS
- DATA_SCHEMA
- ENTITY_COUNT
- UPDATE_FRESHNESS
- SEARCH_DEMAND
- SERP
- PAIN_SIGNAL
- COMPETITION
- MONETIZATION
- BUILD_COMPLEXITY
- DEFENSIBILITY

### score_snapshots

```text
id
opportunity_id
run_id
framework_version
data_quality
search_demand
competition_gap
monetization_clarity
build_feasibility
defensibility
composite
recommendation
created_at
```

Never overwrite historical scores. The latest score is a read-model query.

### decisions

Append-only audit trail:

```text
id
opportunity_id
action
from_state
to_state
reason
actor
created_at
```

Actions include PROMOTE, BACKLOG, REJECT, RESTORE, REQUEST_RESEARCH, START_BUILD, MARK_LAUNCHED.

### runs

```text
id
type          WATCHLIST | DISCOVERY | VALIDATE | RESCORE | BUILD_SPEC | EXPORT
status        QUEUED | RUNNING | SUCCEEDED | FAILED | CANCELLED
trigger       SCHEDULE | USER | SYSTEM
scope_json
started_at
completed_at
error_json
created_at
```

### run_events

This powers live progress in the UI without requiring WebSockets initially.

```text
id
run_id
sequence
stage
level
message
metadata_json
created_at
```

The browser can poll an active run every 2–3 seconds.

### products

```text
id
opportunity_id
name
status
repo_url
domain
launch_date
monthly_traffic
monthly_revenue
notes
created_at
updated_at
```

A Product cannot be created except through an explicit promotion action from an Opportunity.

## API surface

### Read

```text
GET /api/dashboard
GET /api/opportunities
GET /api/opportunities/:id
GET /api/opportunities/:id/evidence
GET /api/opportunities/:id/scores
GET /api/runs
GET /api/runs/:id
GET /api/runs/:id/events
GET /api/leads
GET /api/portfolio
GET /api/sources
```

### Actions

Commands are explicit endpoints rather than generic record mutation:

```text
POST /api/runs/discovery
POST /api/runs/watchlist
POST /api/opportunities/:id/rescore
POST /api/opportunities/:id/research
POST /api/opportunities/:id/backlog
POST /api/opportunities/:id/reject
POST /api/opportunities/:id/promote
POST /api/opportunities/:id/build-spec
POST /api/products/:id/start-build
POST /api/products/:id/launch
```

Every command writes a decision/run record before work starts. All commands should be idempotent or accept an idempotency key.

Avoid `PATCH /opportunity` for lifecycle transitions. Explicit commands make the product logic auditable and hard to misuse.

## UI information architecture

The primary navigation should become:

### 1. Command Center

Default home screen.

Shows:

- active run status
- new leads since last review
- opportunities needing decisions
- top BUILD recommendations
- stale evidence needing refresh
- portfolio health
- recent decisions

This is the daily operating surface.

### 2. Pipeline

Kanban/list hybrid organized by lifecycle state rather than only score:

```text
New → Validating → Scored → Researching → Backlog → Approved → Building
```

Rejected is a filtered archive, not a main column.

Ranking remains available inside states.

### 3. Opportunity Workspace

This replaces the current detail drawer as the core analysis screen.

Header:

- name
- lifecycle state
- latest recommendation
- latest composite
- evidence freshness
- decision actions

Tabs:

- Overview
- Evidence
- Search / SERP
- Economics
- Data
- Runs
- Build Spec
- Decision History

The six-factor score must show the evidence that caused each score, not just a bar.

### 4. Inbox

Raw scanner leads requiring review.

Actions:

- promote to opportunity
- dismiss
- merge duplicate
- reserve source/query space

The scanner should be allowed to create many leads without polluting the opportunity pipeline.

### 5. Runs

Operational observability:

- current stage
- elapsed progress
- per-stage output
- failures and retries
- linked opportunities/leads
- rerun failed stage

### 6. Portfolio

Only explicitly promoted products.

Tracks:

- planning/building/launched/paused/retired
- repo/domain
- current traffic and revenue
- original opportunity thesis
- latest validation date
- overlap/reservation rules

### 7. Sources

Scanner/source registry:

- health
- cadence
- last scan
- yield
- actionable lead rate
- reserved status
- enable/disable

## Dashboard metrics

Replace prototype vanity totals with operational metrics:

- New leads awaiting review
- Opportunities awaiting decision
- BUILD recommendations
- Evidence stale > configured TTL
- Active / failed runs
- Median time Lead → Decision
- Promotion rate Lead → Opportunity
- Approval rate Opportunity → Product
- 30-day scanner yield by source
- Portfolio products by stage
- Launched revenue / traffic when available

The old average composite can remain secondary; it is not a useful top-level operating metric.

## Scoring redesign

Keep the six current dimensions, but separate three things that are conflated today:

1. **Evidence** — observed facts.
2. **Score** — deterministic mapping from evidence to 1–10 dimensions.
3. **Recommendation** — framework policy based on scores and hard gates.

Example:

```text
Evidence:
  data endpoint: HTTP 200
  entity count: 2.9M
  update cadence: daily

Score rule:
  structured API + >100k entities + fresh <7d = data_quality 9

Recommendation policy:
  hard gates passed + composite >= 7.0 = BUILD_RECOMMENDED
```

Scoring rules belong in versioned domain code, not inline in runners.

Each score snapshot stores its `framework_version` so future scoring changes do not rewrite history.

## Hard gates

Phase 2 should become named gate records rather than one boolean:

- `DATA_ACCESSIBLE`
- `DATA_USABLE`
- `QUERY_INTENT_PRESENT`
- `MINIMUM_DEMAND_EVIDENCE`
- `NOT_RESERVED_OR_DUPLICATE`
- `BUILD_SCOPE_ACCEPTABLE`

Each gate has PASS / FAIL / UNKNOWN and supporting evidence.

Unknown should not silently equal fail. It should route the opportunity to `RESEARCHING` where appropriate.

## Evidence freshness

Evidence has a TTL by type:

- endpoint accessibility: 7 days
- dataset freshness: 7 days
- SERP/competition: 30 days
- demand signals: 30–90 days
- monetization assumptions: 90 days
- entity count/schema: until source update or 90 days

A rescore first refreshes only stale evidence. This prevents expensive full re-validation every time.

## Discovery redesign

### Scheduled watchlist

1. Scheduled trigger creates a WATCHLIST Run.
2. Workflow scans enabled Sources.
3. Results normalize into Leads.
4. Fingerprints dedupe against prior Leads.
5. New/changed Leads enter Inbox.
6. High-confidence leads may be auto-promoted to `DISCOVERED`, but never APPROVED.
7. UI shows run summary and new-lead count.

### Manual discovery

`Run Discovery` opens a small scope dialog:

- open exploration vs domain focus
- source groups
- lookback period
- maximum candidates

The API creates a Run immediately and the UI follows its events.

### Validation

Opportunity validation is independent per opportunity and produces evidence records. A discovery run may validate several opportunities, but one failure must not destroy the run's other results.

### Rescore

Rescore reads current evidence, refreshes stale evidence, writes a new score snapshot, and updates recommendation only.

## Build handoff

`Generate Build Spec` should create a versioned artifact from the opportunity's actual evidence and decisions.

The spec should contain:

- validated problem/query space
- canonical datasets and schemas
- evidence citations/URLs
- page/entity model
- enrichment joins
- monetization assumptions
- architecture recommendation
- MVP boundaries
- risks
- acceptance criteria
- unanswered questions

A spec gets an immutable version and checksum. Starting implementation links a repo/issue/PR back to that spec version.

Do not auto-generate generic build skeletons merely because a numeric threshold was crossed.

## Authentication

For a private personal control plane, put the application behind Cloudflare Access rather than building application auth.

The API should still protect mutation endpoints from cross-site requests and validate the authenticated Access identity when available.

## GitHub's role

GitHub remains:

- source code
- versioned framework/scoring policy
- migrations
- exported snapshots
- build specs
- implementation repos/issues/PRs

GitHub is not the transactional database.

Scheduled automation should no longer commit mutable scanner state to `main` after every run. Instead, export snapshots deliberately or on a lower-frequency backup schedule.

## Migration phases

### Phase A — normalize without behavior change

- define canonical TypeScript/Pydantic schemas
- choose one workflow runner
- move scoring rules into one module
- remove auto-append-to-portfolio behavior
- stop generating duplicate root/output state
- give every opportunity, lead, and run a stable ID

### Phase B — D1 control-plane backend

- add D1 schema/migrations
- import legacy state
- implement read API
- update UI to use `/api/*`
- preserve static JSON fallback only for development fixtures

### Phase C — mutations and lifecycle

- implement decision endpoints
- add decision history
- implement promotion/rejection/backlog actions
- generate build specs on explicit request

### Phase D — orchestration

- port watchlist/discovery into Cloudflare Workflows
- record run events
- add active-run UI and retry behavior
- convert scanner files into adapters

### Phase E — portfolio feedback loop

- connect launched product metrics
- compare predicted vs actual outcomes
- use observed results to calibrate scoring weights and monetization assumptions

This final phase turns Paydirt from an opportunity finder into a learning portfolio system.

## Explicit deprecations

Once migration is complete, delete or archive:

- duplicate root `scan_state.json`
- duplicate root `seen_datasets.json`
- one of `full_discovery_run.py` / `run_full_workflow.py`
- mutable root `pipeline.json`
- mutable `output/pipeline.json`
- auto-mutated `portfolio_state.json`
- generic auto-generated build specs created solely from BUILD recommendation

## What not to build yet

- React migration solely for framework consistency
- WebSockets
- multi-user roles/permissions
- Durable Objects
- vector database
- agent chat UI
- automatic repo creation on BUILD recommendation
- autonomous product promotion

Those are complexity without leverage at the current stage.

## Success condition

Paydirt is successful when a normal operating session can happen entirely in the control plane:

1. Open Command Center.
2. See what changed since the last visit.
3. Inspect new leads and evidence.
4. Trigger or observe validation runs.
5. Make explicit opportunity decisions.
6. Promote a winner.
7. Generate a build-ready implementation spec.
8. Track that product into build and launch.

The scripts become implementation details. The UI becomes Paydirt.
