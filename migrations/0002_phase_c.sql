PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS lead_decisions (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('PROMOTE','DISMISS','MERGE','RESERVE','UNRESERVE')),
  actor TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS build_specs (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  score_snapshot_id TEXT REFERENCES score_snapshots(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(opportunity_id, version)
);

CREATE INDEX IF NOT EXISTS idx_lead_decisions_lead ON lead_decisions(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_build_specs_opportunity ON build_specs(opportunity_id, version DESC);
