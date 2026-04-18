import type { CMSFacility, Facility } from "../src/types";
import { computeGradeScore, scoreToGrade, scoreToSummary, toSlug } from "../src/scoring";

const CMS_API_URL = "https://data.cms.gov/provider-data/api/1/datastore/query/4pq5-n9py/0";
const PAGE_SIZE = 500;

function parseNum(val: string): number | null {
  if (val === "" || val === null || val === undefined) return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function parseIntOrNull(val: string): number | null {
  if (val === "" || val === null || val === undefined) return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

export function mapCMSFacility(raw: CMSFacility): Facility {
  const rnHours = parseNum(raw.reported_rn_staffing_hours_per_resident_per_day);
  const deficiencies = parseIntOrNull(raw.rating_cycle_1_total_number_of_health_deficiencies);
  const qualityRating = parseIntOrNull(raw.qm_rating);
  const staffingRating = parseIntOrNull(raw.staffing_rating);

  const grade_score = computeGradeScore({
    rnHoursPerResidentDay: rnHours ?? 0,
    totalDeficiencies: deficiencies ?? 0,
    qualityRating: qualityRating ?? 1,
    staffingRating: staffingRating ?? 1,
  });
  const safeScore = Number.isFinite(grade_score) ? grade_score : 0;
  const grade_letter = scoreToGrade(safeScore);
  const grade_summary = scoreToSummary(safeScore, grade_letter, rnHours);

  return {
    cms_id: raw.cms_certification_number_ccn,
    name: raw.provider_name,
    address: raw.provider_address,
    city: raw.citytown,
    state: raw.state,
    zip: raw.zip_code,
    latitude: parseNum(raw.latitude),
    longitude: parseNum(raw.longitude),
    overall_rating: parseIntOrNull(raw.overall_rating),
    quality_rating: qualityRating,
    staffing_rating: staffingRating,
    inspection_rating: parseIntOrNull(raw.health_inspection_rating),
    rn_hours_per_resident_day: rnHours,
    total_deficiencies: deficiencies,
    grade_score: safeScore,
    grade_letter,
    grade_summary,
    slug: toSlug(raw.provider_name ?? raw.cms_certification_number_ccn ?? "unknown"),
    updated_at: new Date().toISOString(),
  };
}

export function buildFacilitySlugId(cmsId: string, slug: string): string {
  return `${cmsId}-${slug}`;
}

export function buildFacilitiesInsertBatches(mapped: Facility[], batchSize = 100): string[] {
  const sqls: string[] = [];
  for (let i = 0; i < mapped.length; i += batchSize) {
    const batch = mapped.slice(i, i + batchSize);
    const values = batch
      .map(
        (f) =>
          `('${esc(f.cms_id)}','${esc(f.name)}','${esc(f.address)}','${esc(f.city)}','${esc(f.state)}','${esc(f.zip)}',${f.latitude ?? "NULL"},${f.longitude ?? "NULL"},${f.overall_rating ?? "NULL"},${f.quality_rating ?? "NULL"},${f.staffing_rating ?? "NULL"},${f.inspection_rating ?? "NULL"},${f.rn_hours_per_resident_day ?? "NULL"},${f.total_deficiencies ?? "NULL"},${f.grade_score},'${esc(f.grade_letter)}','${esc(f.grade_summary)}','${esc(f.slug)}','${esc(f.updated_at)}')`,
      )
      .join(",\n");
    sqls.push(
      `INSERT OR REPLACE INTO facilities (cms_id,name,address,city,state,zip,latitude,longitude,overall_rating,quality_rating,staffing_rating,inspection_rating,rn_hours_per_resident_day,total_deficiencies,grade_score,grade_letter,grade_summary,slug,updated_at) VALUES\n${values};`,
    );
  }
  return sqls;
}

export function buildFacilityRawInsertBatches(allFacilities: CMSFacility[], batchSize = 100): string[] {
  const ingestedAt = new Date().toISOString();
  const sqls: string[] = [];
  for (let i = 0; i < allFacilities.length; i += batchSize) {
    const batch = allFacilities.slice(i, i + batchSize);
    const values = batch
      .map((raw) => {
        const sourceProcessingDate =
          typeof raw.processing_date === "string" && raw.processing_date.length > 0
            ? `'${esc(raw.processing_date)}'`
            : "NULL";
        return `('${esc(raw.cms_certification_number_ccn)}','${esc(JSON.stringify(raw))}',${sourceProcessingDate},'${esc(ingestedAt)}')`;
      })
      .join(",\n");
    sqls.push(
      `INSERT OR REPLACE INTO facility_raw (cms_id, raw_json, source_processing_date, ingested_at) VALUES\n${values};`,
    );
  }
  return sqls;
}

async function fetchPage(offset: number): Promise<CMSFacility[]> {
  const url = `${CMS_API_URL}?limit=${PAGE_SIZE}&offset=${offset}&sort_order=ASC&sort_by=cms_certification_number_ccn`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CMS API error: ${res.status} at offset ${offset}`);
  const json = (await res.json()) as { results: CMSFacility[] };
  return json.results ?? [];
}

async function main() {
  console.log("Starting CMS ingest...");

  // Verify API field names against first record before full load
  const firstPage = await fetchPage(0);
  if (firstPage.length === 0) throw new Error("CMS API returned no results");

  const sample = firstPage[0];
  const requiredFields: (keyof CMSFacility)[] = [
    "cms_certification_number_ccn",
    "provider_name",
    "provider_address",
    "citytown",
    "state",
    "zip_code",
    "reported_rn_staffing_hours_per_resident_per_day",
    "rating_cycle_1_total_number_of_health_deficiencies",
    "qm_rating",
    "staffing_rating",
  ];
  for (const field of requiredFields) {
    if (!(field in (sample as object))) {
      throw new Error(
        `CMS API response missing field: ${field}. Available: ${Object.keys(sample as object).join(", ")}`,
      );
    }
  }
  console.log(`Field validation passed. Sample cms_certification_number_ccn: ${sample!.cms_certification_number_ccn}`);

  // Fetch all pages
  const allFacilities: CMSFacility[] = [...firstPage];
  let offset = PAGE_SIZE;
  while (true) {
    const page = await fetchPage(offset);
    if (page.length === 0) break;
    allFacilities.push(...page);
    console.log(`Fetched ${allFacilities.length} facilities...`);
    offset += PAGE_SIZE;
    if (page.length < PAGE_SIZE) break;
  }

  console.log(`Total fetched: ${allFacilities.length} facilities`);

  // Map + score
  const mapped = allFacilities.map(mapCMSFacility);

  // Build INSERT statements in batches of 100
  const BATCH = 100;
  const facilitySqls = buildFacilitiesInsertBatches(mapped, BATCH);
  const facilityRawSqls = buildFacilityRawInsertBatches(allFacilities, BATCH);

  // Write SQL file
  const { writeFileSync } = await import("fs");
  writeFileSync("scripts/seed.sql", [...facilitySqls, ...facilityRawSqls].join("\n\n"));
  console.log(
    `Wrote scripts/seed.sql (${mapped.length} facilities rows in ${facilitySqls.length} batches; ${allFacilities.length} facility_raw rows in ${facilityRawSqls.length} batches)`,
  );
  console.log("Run: npx wrangler d1 execute nursinghomegrade --local --file=scripts/seed.sql");
  console.log("Then for remote: npx wrangler d1 execute nursinghomegrade --file=scripts/seed.sql");
}

function esc(s: string): string {
  return String(s).replace(/'/g, "''");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
