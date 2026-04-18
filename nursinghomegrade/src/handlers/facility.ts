import type { Env } from "../types";
import { getFacilityBySlugId, getFacilityInspectionDetails } from "../db";
import { facilityPage } from "../templates/facility";

export async function handleFacility(request: Request, env: Env, slugId: string): Promise<Response> {
  try {
    const cached = await env.CACHE.get(`facility:${slugId}`);
    if (cached)
      return new Response(cached, {
        headers: {
          "Content-Type": "text/html;charset=UTF-8",
          "Cache-Control": "public, max-age=86400",
        },
      });

    const facility = await getFacilityBySlugId(env, slugId);
    if (!facility) return new Response("Not found", { status: 404 });

    const inspectionDetails = await getFacilityInspectionDetails(env, facility.cms_id);
    const html = facilityPage({ ...facility, ...inspectionDetails });
    await env.CACHE.put(`facility:${slugId}`, html, { expirationTtl: 86400 });
    return new Response(html, {
      headers: {
        "Content-Type": "text/html;charset=UTF-8",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    console.error("handleFacility error", err);
    return new Response("Service unavailable", { status: 503 });
  }
}
