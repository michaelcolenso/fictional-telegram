import { layout, escHtml } from "./layout";

export function homePage(pctFailing: number): string {
  const body = `
    <div style="text-align:center;padding:3rem 0 2rem;">
      <h1 style="font-size:2rem;margin-bottom:1rem;">Find honest nursing home grades</h1>
      <p style="font-size:1.15rem;color:#374151;max-width:600px;margin:0 auto 0.75rem;">
        <strong style="color:#dc2626;">${pctFailing}% of U.S. nursing homes</strong> fail the federal staffing minimum.
        We show you which ones — no commissions, no conflicts.
      </p>
      <p style="font-size:0.875rem;color:#6b7280;margin-bottom:2rem;">
        Data from CMS Nursing Home Compare. Updated monthly.
      </p>

      <form action="/search" method="GET" style="display:flex;gap:0.5rem;justify-content:center;flex-wrap:wrap;max-width:500px;margin:0 auto;">
        <input type="text" name="zip" placeholder="Enter ZIP code" maxlength="5" pattern="[0-9]{5}"
          style="flex:1;min-width:180px;padding:0.75rem 1rem;border:1px solid #d1d5db;border-radius:6px;font-size:1rem;">
        <button type="submit" style="background:#2563eb;color:#fff;padding:0.75rem 1.5rem;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:1rem;">
          Search
        </button>
      </form>
    </div>

    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:1.25rem;margin-bottom:2rem;">
      <strong>Why this site exists:</strong> A Place for Mom earns up to $3,500 per family they refer to a facility —
      paid by the facility. Their incentive is placement, not quality. We take no commissions. Ever.
      <a href="/about">Read more →</a>
    </div>
  `;
  return layout(
    "NursingHomeGrade — Honest Nursing Home Ratings",
    `${pctFailing}% of U.S. nursing homes fail the federal staffing minimum. Find unbiased nursing home grades based on CMS data — no commissions.`,
    body,
  );
}

export function searchResultsPage(
  zip: string,
  facilities: Array<{
    cms_id: string;
    name: string;
    city: string;
    state: string;
    grade_letter: string;
    grade_score: number;
    grade_summary: string;
    slug: string;
  }>,
): string {
  if (facilities.length === 0) {
    const body = `<h1>No facilities found for ZIP ${escHtml(zip)}</h1><p><a href="/">Try another ZIP</a></p>`;
    return layout(`Nursing Homes Near ${zip}`, "", body);
  }
  const items = facilities
    .map(
      (f) => `
    <div style="border-bottom:1px solid #e5e7eb;padding:1rem 0;">
      <div style="display:flex;align-items:baseline;gap:0.75rem;">
        <a href="/facility/${escHtml(f.cms_id)}-${escHtml(f.slug)}" style="font-weight:600;font-size:1.05rem;">${escHtml(f.name)}</a>
        <span class="grade-${f.grade_letter}" style="font-size:1.25rem;">${escHtml(f.grade_letter)}</span>
        <span style="color:#6b7280;font-size:0.875rem;">${f.grade_score}/100</span>
      </div>
      <p style="color:#6b7280;font-size:0.875rem;">${escHtml(f.city)}, ${escHtml(f.state)}</p>
      <p style="font-size:0.9rem;margin-top:0.25rem;">${escHtml(f.grade_summary)}</p>
    </div>
  `,
    )
    .join("");
  const body = `<h1 style="margin-bottom:1.5rem;">Nursing homes near ${escHtml(zip)}</h1>${items}`;
  return layout(
    `Nursing Homes Near ${zip} — NursingHomeGrade`,
    `Nursing home quality grades for facilities near ZIP code ${zip}.`,
    body,
  );
}
