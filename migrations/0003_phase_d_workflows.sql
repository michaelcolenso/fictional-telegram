ALTER TABLE sources ADD COLUMN health_status TEXT NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('unknown','healthy','degraded','down','skipped'));
ALTER TABLE sources ADD COLUMN last_error TEXT;
ALTER TABLE sources ADD COLUMN last_result_json TEXT;

ALTER TABLE runs ADD COLUMN opportunity_id TEXT REFERENCES opportunities(id) ON DELETE SET NULL;
ALTER TABLE runs ADD COLUMN trigger_source TEXT;

CREATE INDEX IF NOT EXISTS idx_runs_status_created ON runs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_opportunity_created ON runs(opportunity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sources_health ON sources(health_status, updated_at DESC);
