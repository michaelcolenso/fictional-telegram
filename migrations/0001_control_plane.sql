PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  url TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  scan_cadence TEXT,
  last_scanned_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  run_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','complete','failed','cancelled')),
  workflow_instance_id TEXT,
  started_at TEXT,
  finished_at TEXT,
  summary_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL DEFAULT 'DISCOVERED' CHECK (lifecycle_state IN ('DISCOVERED','VALIDATING','SCORED','RESEARCHING','BACKLOG','APPROVED','READY_TO_BUILD','BUILDING','LAUNCHED','REJECTED')),
  recommendation TEXT NOT NULL DEFAULT 'UNSCORED' CHECK (recommendation IN ('UNSCORED','BUILD_RECOMMENDED','BACKLOG','KILL_RECOMMENDED')),
  primary_vertical TEXT,
  query_pattern TEXT,
  monetization_model TEXT,
  data_source_name TEXT,
  data_source_url TEXT,
  data_format TEXT,
  update_frequency TEXT,
  entity_count INTEGER,
  licensing TEXT,
  build_notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  data_url TEXT,
  organization TEXT,
  formats_json TEXT NOT NULL DEFAULT '[]',
  observed_at TEXT,
  entity_count_estimate INTEGER,
  scanner_score REAL,
  reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved IN (0,1)),
  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','PROMOTED','DISMISSED','MERGED')),
  promoted_opportunity_id TEXT REFERENCES opportunities(id) ON DELETE SET NULL,
  raw_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  label TEXT,
  value_json TEXT NOT NULL,
  source_url TEXT,
  observed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS score_snapshots (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  framework_version TEXT NOT NULL,
  data_quality REAL NOT NULL,
  search_demand REAL NOT NULL,
  competition_gap REAL NOT NULL,
  monetization_clarity REAL NOT NULL,
  build_feasibility REAL NOT NULL,
  defensibility REAL NOT NULL,
  composite REAL NOT NULL,
  recommendation TEXT NOT NULL CHECK (recommendation IN ('BUILD_RECOMMENDED','BACKLOG','KILL_RECOMMENDED')),
  rationale_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT,
  actor TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  origin_opportunity_id TEXT UNIQUE REFERENCES opportunities(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  domain TEXT,
  repo TEXT,
  data_source_name TEXT,
  data_source_url TEXT,
  entity_count INTEGER,
  update_frequency TEXT,
  monetization TEXT,
  monthly_traffic INTEGER,
  monthly_revenue REAL,
  launch_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS legacy_imports (
  source_path TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_leads_status_score ON leads(status, scanner_score DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_state ON opportunities(lifecycle_state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_recommendation ON opportunities(recommendation, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_opportunity ON evidence(opportunity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scores_opportunity ON score_snapshots(opportunity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decisions_opportunity ON decisions(opportunity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at DESC);

CREATE VIEW IF NOT EXISTS opportunity_current_scores AS
SELECT s.*
FROM score_snapshots s
JOIN (
  SELECT opportunity_id, MAX(created_at) AS created_at
  FROM score_snapshots
  GROUP BY opportunity_id
) latest
ON latest.opportunity_id = s.opportunity_id AND latest.created_at = s.created_at;
