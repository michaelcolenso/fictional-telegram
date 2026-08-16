# Paydirt UI

A zero-dependency command center for the Opportunity Discovery Framework.

## What it shows

- Ranked opportunity pipeline
- BUILD / BACKLOG / KILL verdicts
- Composite and six-factor score profile
- Data-source health and entity count
- Demand and pain signals
- Query pattern, competition evidence, monetization, and build notes
- Existing portfolio state to prevent discovery overlap

The client normalizes both pipeline formats currently present in this repository:

1. `pipeline.json` with `opportunities[]` and phase-specific evidence
2. Runner output with `candidates[]` from `run_full_workflow.py`

## Preview locally

Serve the repository root so the UI can read the adjacent JSON files:

```bash
python -m http.server 8788
```

Then open:

```text
http://localhost:8788/ui/
```

Opening `ui/index.html` directly with `file://` will not work because browsers block local JSON fetches.

## Hosting

The UI is intentionally static and can be deployed without a framework. For Cloudflare Pages, use the repository as the source and publish the repository root (or add a tiny build step that copies `pipeline.json`, `portfolio_state.json`, and `ui/` into a dedicated output directory).

For a public deployment, the client also includes read-only fallbacks to the `main` branch JSON files on GitHub.

## Next architecture step

Keep this UI static until Paydirt needs mutations. When actions such as **Run discovery**, **Advance to build**, **Kill**, **Rescore**, or **Edit portfolio state** become real product requirements, add a small Cloudflare Worker API in front of the runner/state rather than introducing a frontend framework prematurely.
