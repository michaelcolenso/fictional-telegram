import type { Facility, Env } from "./types";

export async function getFacilityById(env: Env, cmsId: string): Promise<Facility | null> {
  const result = await env.DB.prepare("SELECT * FROM facilities WHERE cms_id = ?").bind(cmsId).first<Facility>();
  return result ?? null;
}

export async function getFacilityBySlugId(env: Env, slugId: string): Promise<Facility | null> {
  // slugId is "cms_id-slug", e.g. "015001-sunrise-care-center"
  const cmsId = slugId.split("-")[0];
  if (!cmsId) return null;
  return getFacilityById(env, cmsId);
}

export async function searchByZip(env: Env, zip: string, limit = 10): Promise<Facility[]> {
  const results = await env.DB.prepare("SELECT * FROM facilities WHERE zip = ? ORDER BY grade_score DESC LIMIT ?")
    .bind(zip, limit)
    .all<Facility>();
  return results.results ?? [];
}

export async function getStatePctFailing(env: Env, state: string): Promise<number> {
  const result = await env.DB.prepare(
    `SELECT ROUND(100.0 * SUM(CASE WHEN rn_hours_per_resident_day < 0.55 THEN 1 ELSE 0 END) / COUNT(*), 1) as pct
         FROM facilities WHERE state = ?`,
  )
    .bind(state)
    .first<{ pct: number }>();
  return result?.pct ?? 0;
}

export async function getNationalPctFailing(env: Env): Promise<number> {
  const result = await env.DB.prepare(
    `SELECT ROUND(100.0 * SUM(CASE WHEN rn_hours_per_resident_day < 0.55 THEN 1 ELSE 0 END) / COUNT(*), 1) as pct
         FROM facilities`,
  ).first<{ pct: number }>();
  return result?.pct ?? 0;
}
