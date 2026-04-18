import { describe, it, expect } from "vitest";
import {
  mapCMSFacility,
  buildFacilitySlugId,
  buildFacilityRawInsertBatches,
  buildFacilitiesInsertBatches,
} from "../scripts/ingest";
import type { CMSFacility } from "../src/types";

const SAMPLE_CMS: CMSFacility = {
  cms_certification_number_ccn: "015001",
  provider_name: "Sunrise Care Center",
  provider_address: "123 Main St",
  citytown: "Birmingham",
  state: "AL",
  zip_code: "35201",
  latitude: "33.5186",
  longitude: "-86.8104",
  overall_rating: "3",
  qm_rating: "4",
  staffing_rating: "2",
  health_inspection_rating: "3",
  reported_rn_staffing_hours_per_resident_per_day: "0.48",
  reported_total_nurse_staffing_hours_per_resident_per_day: "3.2",
  rating_cycle_1_total_number_of_health_deficiencies: "7",
  total_weighted_health_survey_score: "45",
};

describe("mapCMSFacility", () => {
  it("maps cms_id from cms_certification_number_ccn", () => {
    const facility = mapCMSFacility(SAMPLE_CMS);
    expect(facility.cms_id).toBe("015001");
  });

  it("parses numeric strings to numbers", () => {
    const facility = mapCMSFacility(SAMPLE_CMS);
    expect(facility.rn_hours_per_resident_day).toBe(0.48);
    expect(facility.total_deficiencies).toBe(7);
    expect(facility.latitude).toBe(33.5186);
  });

  it("assigns a grade_letter based on score", () => {
    const facility = mapCMSFacility(SAMPLE_CMS);
    expect(["A", "B", "C", "D", "F"]).toContain(facility.grade_letter);
  });

  it("generates a slug from the facility name", () => {
    const facility = mapCMSFacility(SAMPLE_CMS);
    expect(facility.slug).toBe("sunrise-care-center");
  });

  it("sets updated_at to a valid ISO date string", () => {
    const facility = mapCMSFacility(SAMPLE_CMS);
    expect(() => new Date(facility.updated_at)).not.toThrow();
  });

  it("handles empty string fields by returning null", () => {
    const emptyCMS: CMSFacility = {
      ...SAMPLE_CMS,
      latitude: "",
      longitude: "",
      overall_rating: "",
      qm_rating: "",
      staffing_rating: "",
      health_inspection_rating: "",
      reported_rn_staffing_hours_per_resident_per_day: "",
      rating_cycle_1_total_number_of_health_deficiencies: "",
    };
    const facility = mapCMSFacility(emptyCMS);
    expect(facility.latitude).toBeNull();
    expect(facility.longitude).toBeNull();
    expect(facility.overall_rating).toBeNull();
    expect(facility.rn_hours_per_resident_day).toBeNull();
    expect(facility.total_deficiencies).toBeNull();
  });
});

describe("buildFacilitySlugId", () => {
  it("concatenates cms_id and slug with a hyphen", () => {
    expect(buildFacilitySlugId("015001", "sunrise-care-center")).toBe("015001-sunrise-care-center");
  });
});

describe("SQL batch generation", () => {
  it("keeps facilities insert shape stable", () => {
    const mapped = mapCMSFacility(SAMPLE_CMS);
    const sqlBatches = buildFacilitiesInsertBatches([mapped], 100);
    expect(sqlBatches).toHaveLength(1);
    expect(sqlBatches[0]).toContain("INSERT OR REPLACE INTO facilities");
    expect(sqlBatches[0]).toContain("'015001'");
  });

  it("stores JSON-stringified raw rows that round-trip via JSON.parse", () => {
    const raw: CMSFacility = {
      ...SAMPLE_CMS,
      processing_date: "2026-04-17",
      provider_name: "O'Malley Home",
    };
    const sqlBatches = buildFacilityRawInsertBatches([raw], 100);
    expect(sqlBatches).toHaveLength(1);
    expect(sqlBatches[0]).toContain("INSERT OR REPLACE INTO facility_raw");

    expect(sqlBatches[0]).toContain("source_processing_date");
    expect(sqlBatches[0]).toContain("ingested_at");

    const rawJsonMatch = sqlBatches[0].match(/,\s*'(\{.*\})',\s*'2026-04-17'/s);
    expect(rawJsonMatch?.[1]).toBeTruthy();
    const unescapedJson = rawJsonMatch![1].replace(/''/g, "'");
    const parsed = JSON.parse(unescapedJson) as CMSFacility;
    expect(parsed).toEqual(raw);
  });
});
