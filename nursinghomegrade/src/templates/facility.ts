import type { FacilityPageData } from "../types";
import { layout, escHtml } from "./layout";

export function facilityPage(f: FacilityPageData): string {
  const rnHours = f.rn_hours_per_resident_day;
  const meetsMinimum = rnHours !== null && rnHours >= 0.55;
  const rnDisplay =
    rnHours !== null
      ? `${rnHours.toFixed(2)} ${meetsMinimum ? "✓ Meets federal minimum" : "✗ Below federal minimum (0.55)"}`
      : "Not reported";

  const qualityStars =
    f.quality_rating !== null
      ? `${"★".repeat(f.quality_rating)}${"☆".repeat(5 - f.quality_rating)} (${f.quality_rating}/5)`
      : "Not rated";
  const staffingStars =
    f.staffing_rating !== null
      ? `${"★".repeat(f.staffing_rating)}${"☆".repeat(5 - f.staffing_rating)} (${f.staffing_rating}/5)`
      : "Not rated";

  const complaintDeficienciesCycle1 =
    f.complaint_deficiencies_cycle_1 !== null ? String(f.complaint_deficiencies_cycle_1) : "Not reported";

  const body = `
    <nav style="font-size:0.875rem;color:#6b7280;margin-bottom:1.5rem;">
      <a href="/">Home</a> › ${escHtml(f.state)} › ${escHtml(f.city)} › ${escHtml(f.name)}
    </nav>

    <div style="display:flex;align-items:baseline;gap:1rem;margin-bottom:0.5rem;">
      <h1 style="font-size:1.75rem;">${escHtml(f.name)}</h1>
      <span class="grade-${f.grade_letter}" style="font-size:2.5rem;">${escHtml(f.grade_letter)}</span>
    </div>

    <p style="color:#6b7280;margin-bottom:1.5rem;">${escHtml(f.address)}, ${escHtml(f.city)}, ${escHtml(f.state)} ${escHtml(f.zip)}</p>

    <p style="font-size:1.05rem;margin-bottom:2rem;">${escHtml(f.grade_summary)}</p>

    <h2 style="font-size:1.1rem;margin-bottom:1rem;">Quality Breakdown</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:2rem;">
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:0.6rem 0;">RN Staffing Hours / Resident / Day</td>
        <td style="padding:0.6rem 0;font-weight:600;color:${meetsMinimum ? "#16a34a" : "#dc2626"}">
          ${escHtml(rnDisplay)}
        </td>
      </tr>
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:0.6rem 0;">Health Inspection Deficiencies</td>
        <td style="padding:0.6rem 0;font-weight:600;">${f.total_deficiencies ?? "Not reported"}</td>
      </tr>
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:0.6rem 0;">Complaint-based inspection deficiencies (Cycle 1)</td>
        <td style="padding:0.6rem 0;font-weight:600;">${complaintDeficienciesCycle1}</td>
      </tr>
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:0.6rem 0;">CMS Quality Rating</td>
        <td style="padding:0.6rem 0;font-weight:600;">${qualityStars}</td>
      </tr>
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:0.6rem 0;">CMS Staffing Rating</td>
        <td style="padding:0.6rem 0;font-weight:600;">${staffingStars}</td>
      </tr>
      <tr>
        <td style="padding:0.6rem 0;">NursingHomeGrade Score</td>
        <td style="padding:0.6rem 0;font-weight:600;">${f.grade_score}/100 (${f.grade_letter})</td>
      </tr>
    </table>

    <div class="cta-box">
      <h3 style="margin-bottom:0.5rem;">Need help choosing a facility?</h3>
      <p style="margin-bottom:1rem;color:#374151;">Get free, unbiased guidance from senior living advisors. We earn nothing from this referral.</p>
      <a class="btn" href="https://www.caring.com/local/nursing-homes" rel="nofollow noopener" target="_blank">Get free help →</a>
      <a class="btn" href="https://www.senioradvisor.com/nursing-homes" rel="nofollow noopener" target="_blank" style="background:#059669;margin-left:0.5rem;">Compare nearby →</a>
    </div>

    <div style="margin-top:2rem;">
      <h3 style="margin-bottom:0.5rem;">Get score alerts for this facility</h3>
      <p style="margin-bottom:0.75rem;font-size:0.9rem;color:#6b7280;">We'll email you when ${escHtml(f.name)}'s staffing score changes.</p>
      <form action="/subscribe" method="POST" style="display:flex;gap:0.5rem;flex-wrap:wrap;">
        <input type="hidden" name="cms_id" value="${escHtml(f.cms_id)}">
        <input type="hidden" name="facility_name" value="${escHtml(f.name)}">
        <input type="email" name="email" placeholder="your@email.com" required
          style="flex:1;min-width:200px;padding:0.5rem 0.75rem;border:1px solid #d1d5db;border-radius:6px;">
        <button type="submit" style="background:#2563eb;color:#fff;padding:0.5rem 1rem;border:none;border-radius:6px;cursor:pointer;font-weight:600;">Notify me</button>
      </form>
    </div>
  `;
  return layout(
    `${f.name} — NursingHomeGrade ${f.grade_letter} | ${f.city}, ${f.state}`,
    `${f.name} in ${f.city}, ${f.state} earns a grade of ${f.grade_letter} (${f.grade_score}/100). ${f.grade_summary}`,
    body,
  );
}
