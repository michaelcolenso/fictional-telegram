CREATE TABLE IF NOT EXISTS facility_raw (
  cms_id TEXT PRIMARY KEY,
  raw_json TEXT NOT NULL,
  source_processing_date TEXT,
  ingested_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_facility_raw_source_processing_date
  ON facility_raw(source_processing_date);
