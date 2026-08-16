type OpportunityRow = {
  id: string; name: string; lifecycle_state: string; recommendation: string;
  primary_vertical: string | null; query_pattern: string | null; monetization_model: string | null;
  data_source_name: string | null; data_source_url: string | null; data_format: string | null;
  update_frequency: string | null; entity_count: number | null; licensing: string | null;
  build_notes: string | null; created_at: string; updated_at: string;
  data_quality: number | null; search_demand: number | null; competition_gap: number | null;
  monetization_clarity: number | null; build_feasibility: number | null; defensibility: number | null;
  composite: number | null; framework_version: string | null; score_recommendation: string | null;
};

type LeadRow = {
  id: string; title: string; description: string | null; data_url: string | null;
  organization: string | null; formats_json: string; observed_at: string | null;
  entity_count_estimate: number | null; scanner_score: number | null; reserved: number;
  status: string; source_name: string | null;
};

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function mapOpportunity(row: OpportunityRow) {
  return {
    id: row.id,
    name: row.name,
    lifecycle_state: row.lifecycle_state,
    recommendation: row.score_recommendation ?? row.recommendation,
    primary_vertical: row.primary_vertical,
    query_pattern: row.query_pattern,
    monetization_model: row.monetization_model,
    data_source_name: row.data_source_name,
    data_source_url: row.data_source_url,
    data_format: row.data_format,
    update_frequency: row.update_frequency,
    entity_count: row.entity_count,
    licensing: row.licensing,
    build_notes: row.build_notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    latest_score: row.composite === null ? null : {
      framework_version: row.framework_version,
      data_quality: row.data_quality,
      search_demand: row.search_demand,
      competition_gap: row.competition_gap,
      monetization_clarity: row.monetization_clarity,
      build_feasibility: row.build_feasibility,
      defensibility: row.defensibility,
      composite: row.composite,
      recommendation: row.score_recommendation,
    },
  };
}

const opportunitySelect = `
  SELECT o.*,
    s.data_quality, s.search_demand, s.competition_gap, s.monetization_clarity,
    s.build_feasibility, s.defensibility, s.composite, s.framework_version,
    s.recommendation AS score_recommendation
  FROM opportunities o
  LEFT JOIN opportunity_current_scores s ON s.opportunity_id = o.id
`;

async function dashboard(env: Env) {
  const [leadCount, oppCount, buildCount, productCount, leads, opportunities, products, runs] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM leads WHERE status = 'NEW' AND reserved = 0").first<{ n: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM opportunities WHERE lifecycle_state NOT IN ('REJECTED','LAUNCHED')").first<{ n: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM opportunities WHERE recommendation = 'BUILD_RECOMMENDED' AND lifecycle_state NOT IN ('APPROVED','READY_TO_BUILD','BUILDING','LAUNCHED','REJECTED')").first<{ n: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM products").first<{ n: number }>(),
    env.DB.prepare(`SELECT l.*, s.name AS source_name FROM leads l LEFT JOIN sources s ON s.id=l.source_id WHERE l.status='NEW' ORDER BY l.reserved ASC, l.scanner_score DESC, l.created_at DESC LIMIT 20`).all<LeadRow>(),
    env.DB.prepare(`${opportunitySelect} ORDER BY COALESCE(s.composite, 0) DESC, o.updated_at DESC LIMIT 50`).all<OpportunityRow>(),
    env.DB.prepare("SELECT * FROM products ORDER BY updated_at DESC LIMIT 50").all(),
    env.DB.prepare("SELECT id, run_type, status, started_at, finished_at, error, created_at FROM runs ORDER BY created_at DESC LIMIT 10").all(),
  ]);

  return {
    meta: { frameworkVersion: "v3", generatedAt: new Date().toISOString(), sourceOfTruth: "d1" },
    counts: { leads: leadCount?.n ?? 0, opportunities: oppCount?.n ?? 0, buildRecommended: buildCount?.n ?? 0, products: productCount?.n ?? 0 },
    leads: leads.results.map((row) => ({ ...row, formats: parseJson<string[]>(row.formats_json, []), reserved: Boolean(row.reserved) })),
    opportunities: opportunities.results.map(mapOpportunity),
    products: products.results,
    runs: runs.results,
  };
}

async function opportunityDetail(env: Env, id: string) {
  const row = await env.DB.prepare(`${opportunitySelect} WHERE o.id = ? LIMIT 1`).bind(id).first<OpportunityRow>();
  if (!row) return null;
  const [evidence, decisions, scores] = await Promise.all([
    env.DB.prepare("SELECT id, kind, label, value_json, source_url, observed_at, run_id, created_at FROM evidence WHERE opportunity_id=? ORDER BY created_at DESC LIMIT 100").bind(id).all(),
    env.DB.prepare("SELECT id, action, from_state, to_state, actor, reason, created_at FROM decisions WHERE opportunity_id=? ORDER BY created_at DESC LIMIT 100").bind(id).all(),
    env.DB.prepare("SELECT * FROM score_snapshots WHERE opportunity_id=? ORDER BY created_at DESC LIMIT 25").bind(id).all(),
  ]);
  return {
    ...mapOpportunity(row),
    evidence: evidence.results.map((item) => {
      const e = item as { value_json?: string };
      return { ...item, value: parseJson(e.value_json ?? null, e.value_json ?? null) };
    }),
    decisions: decisions.results,
    score_history: scores.results,
  };
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method !== "GET") return jsonResponse({ error: "read_only_phase", message: "Mutation endpoints arrive in Phase C." }, 405);

    try {
      if (url.pathname === "/api/health") {
        const result = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
        return jsonResponse({ ok: result?.ok === 1, sourceOfTruth: "d1" });
      }
      if (url.pathname === "/api/dashboard") return jsonResponse(await dashboard(env));
      if (url.pathname === "/api/leads") {
        const status = (url.searchParams.get("status") ?? "NEW").toUpperCase();
        const rows = await env.DB.prepare(`SELECT l.*, s.name AS source_name FROM leads l LEFT JOIN sources s ON s.id=l.source_id WHERE l.status=? ORDER BY l.reserved ASC, l.scanner_score DESC, l.created_at DESC LIMIT 250`).bind(status).all<LeadRow>();
        return jsonResponse({ leads: rows.results.map((row) => ({ ...row, formats: parseJson<string[]>(row.formats_json, []), reserved: Boolean(row.reserved) })) });
      }
      if (url.pathname === "/api/opportunities") {
        const rows = await env.DB.prepare(`${opportunitySelect} ORDER BY COALESCE(s.composite,0) DESC, o.updated_at DESC LIMIT 250`).all<OpportunityRow>();
        return jsonResponse({ opportunities: rows.results.map(mapOpportunity) });
      }
      const match = url.pathname.match(/^\/api\/opportunities\/([^/]+)$/);
      if (match) {
        const detail = await opportunityDetail(env, decodeURIComponent(match[1]));
        return detail ? jsonResponse({ opportunity: detail }) : jsonResponse({ error: "not_found" }, 404);
      }
      if (url.pathname === "/api/portfolio") {
        const rows = await env.DB.prepare("SELECT * FROM products ORDER BY updated_at DESC").all();
        return jsonResponse({ products: rows.results });
      }
      if (url.pathname === "/api/runs") {
        const rows = await env.DB.prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT 100").all();
        return jsonResponse({ runs: rows.results });
      }
      return jsonResponse({ error: "not_found" }, 404);
    } catch (error) {
      console.error(JSON.stringify({ event: "api_error", path: url.pathname, error: error instanceof Error ? error.message : String(error) }));
      return jsonResponse({ error: "internal_error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
