# Legacy state policy

D1 is the only supported write authority for Paydirt opportunity lifecycle, recommendations, decisions, build specs, and portfolio products.

The historical JSON and Markdown files in the repository are retained only as migration fixtures, exports, and provenance. They are not transactional state and must not be edited to change a Paydirt decision.

The former `full_discovery_run.py` and `run_full_workflow.py` runners were removed because they could generate competing pipeline/build state and, in the former case, mutate `portfolio_state.json` from an automated BUILD verdict.

`watchlist_scanner.py` may still emit discovery artifacts for legacy/manual experiments, but those files do not enter the canonical Inbox until imported or written through the control-plane ingestion path. Scanner files never approve products or change opportunity lifecycle.

Supported writes are now the authenticated Worker endpoints backed by D1:

- `POST /api/leads/:id/promote`
- `POST /api/leads/:id/dismiss`
- `POST /api/opportunities/:id/decision`
- `POST /api/opportunities/:id/rescore`
- `POST /api/opportunities/:id/build-spec`

Lifecycle mutations append audit records. Score snapshots and build specs are versioned/history-preserving. Product creation occurs only as part of an explicit `APPROVE` decision transaction.
