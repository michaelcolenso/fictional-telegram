import { describe, it, expect } from "vitest";
import { mapCMSFacility, buildFacilitySlugId } from "../scripts/ingest";
import type { CMSFacility } from "../src/types";

const SAMPLE_CMS: CMSFacility = {
  provnum: "015001",
  provname: "Sunrise Care Center",
  address: "123 Main St",
  city: "Birmingham",
  state: "AL",
  zip: "35201",
  latitude: "33.5186",
  longitude: "-86.8104",
  overall_rating: "3",
  quality_rating: "4",
  staffing_rating: "2",
  health_inspection_rating: "3",
  reported_rn_staffing_hours_per_resident_per_day: "0.48",
  reported_total_nurse_staffing_hours_per_resident_per_day: "3.2",
  number_of_deficiencies: "7",
  total_weighted_health_survey_score: "45",
};

describe("mapCMSFacility", () => {
  it("maps cms_id from provnum", () => {
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
      quality_rating: "",
      staffing_rating: "",
      health_inspection_rating: "",
      reported_rn_staffing_hours_per_resident_per_day: "",
      number_of_deficiencies: "",
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
