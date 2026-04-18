import { describe, expect, it } from "vitest";
import { facilityPage } from "../src/templates/facility";
import type { FacilityPageData } from "../src/types";

const baseFacility: FacilityPageData = {
  cms_id: "015001",
  name: "Sunrise Care Center",
  address: "123 Main St",
  city: "Birmingham",
  state: "AL",
  zip: "35201",
  latitude: 33.5186,
  longitude: -86.8104,
  overall_rating: 3,
  quality_rating: 4,
  staffing_rating: 2,
  inspection_rating: 3,
  rn_hours_per_resident_day: 0.48,
  total_deficiencies: 7,
  grade_score: 62,
  grade_letter: "C",
  grade_summary: "Staffing is slightly below ideal but quality is mixed.",
  slug: "sunrise-care-center",
  updated_at: "2026-01-01T00:00:00.000Z",
  complaint_deficiencies_cycle_1: 2,
};

describe("facilityPage", () => {
  it("renders complaint-based inspection deficiencies when available", () => {
    const html = facilityPage(baseFacility);
    expect(html).toContain("Complaint-based inspection deficiencies (Cycle 1)");
    expect(html).toContain(">2<");
  });

  it("renders Not reported when complaint deficiencies are missing", () => {
    const html = facilityPage({ ...baseFacility, complaint_deficiencies_cycle_1: null });
    expect(html).toContain("Complaint-based inspection deficiencies (Cycle 1)");
    expect(html).toContain("Not reported");
  });
});
