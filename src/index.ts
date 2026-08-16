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

type DecisionAction = "RESEARCH" | "BACKLOG" | "APPROVE" | "REJECT" | "READY_TO_BUILD" | "START_BUILD" | "LAUNCH";

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try { return (await request.json()) as Record<string, unknown>; } catch { return {}; }
}

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function authorized(request: Request, env: Env) {
  const header = request.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!supplied || !env.PAYDIRT_ADMIN_TOKEN) return false;
  const [a, b] = await Promise.all([digest(supplied), digest(env.PAYDIRT_ADMIN_TOKEN)]);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
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
  const [leadCount, oppCount, buildCount, productCount, leads, opportunities, products, runs, sources] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM leads WHERE status='NEW' AND reserved=0").first<{ n: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM opportunities WHERE lifecycle_state NOT IN ('REJECTED','LAUNCHED')").first<{ n: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM opportunities WHERE recommendation='BUILD_RECOMMENDED' AND lifecycle_state NOT IN ('APPROVED','READY_TO_BUILD','BUILDING','LAUNCHED','REJECTED')").first<{ n: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM products WHERE status != 'cancelled'").first<{ n: number }>(),
    env.DB.prepare("SELECT l.*,s.name AS source_name FROM leads l LEFT JOIN sources s ON s.id=l.source_id WHERE l.status='NEW' ORDER BY l.reserved ASC,l.scanner_score DESC,l.created_at DESC LIMIT 20").all<LeadRow>(),
    env.DB.prepare(`${opportunitySelect} ORDER BY COALESCE(s.composite,0) DESC,o.updated_at DESC LIMIT 50`).all<OpportunityRow>(),
    env.DB.prepare("SELECT * FROM products ORDER BY updated_at DESC LIMIT 50").all(),
    env.DB.prepare("SELECT id,run_type,status,workflow_instance_id,opportunity_id,trigger_source,started_at,finished_at,summary_json,error,created_at FROM runs ORDER BY created_at DESC LIMIT 20").all(),
    env.DB.prepare("SELECT id,name,kind,url,health_status,last_scanned_at,last_error,last_result_json,updated_at FROM sources ORDER BY updated_at DESC LIMIT 30").all(),
  ]);
  return {
    meta: { frameworkVersion: "v3", generatedAt: new Date().toISOString(), sourceOfTruth: "d1", mutations: true, workflows: true },
    counts: { leads: leadCount?.n ?? 0, opportunities: oppCount?.n ?? 0, buildRecommended: buildCount?.n ?? 0, products: productCount?.n ?? 0 },
    leads: leads.results.map(row => ({ ...row, formats: parseJson<string[]>(row.formats_json, []), reserved: Boolean(row.reserved) })),
    opportunities: opportunities.results.map(mapOpportunity),
    products: products.results,
    runs: runs.results.map(row => ({ ...row, summary: parseJson((row as {summary_json?: string | null}).summary_json ?? null, null) })),
    sources: sources.results.map(row => ({ ...row, last_result: parseJson((row as {last_result_json?: string | null}).last_result_json ?? null, null) })),
  };
}

async function opportunityDetail(env: Env, id: string) {
  const row = await env.DB.prepare(`${opportunitySelect} WHERE o.id=? LIMIT 1`).bind(id).first<OpportunityRow>();
  if (!row) return null;
  const [evidence, decisions, scores, specs, runs] = await Promise.all([
    env.DB.prepare("SELECT id,kind,label,value_json,source_url,observed_at,run_id,created_at FROM evidence WHERE opportunity_id=? ORDER BY created_at DESC LIMIT 100").bind(id).all(),
    env.DB.prepare("SELECT id,action,from_state,to_state,actor,reason,created_at FROM decisions WHERE opportunity_id=? ORDER BY created_at DESC LIMIT 100").bind(id).all(),
    env.DB.prepare("SELECT * FROM score_snapshots WHERE opportunity_id=? ORDER BY created_at DESC LIMIT 25").bind(id).all(),
    env.DB.prepare("SELECT id,version,score_snapshot_id,created_by,created_at FROM build_specs WHERE opportunity_id=? ORDER BY version DESC LIMIT 25").bind(id).all(),
    env.DB.prepare("SELECT id,run_type,status,workflow_instance_id,trigger_source,started_at,finished_at,summary_json,error,created_at FROM runs WHERE opportunity_id=? ORDER BY created_at DESC LIMIT 25").bind(id).all(),
  ]);
  return {
    ...mapOpportunity(row),
    evidence: evidence.results.map(item => {
      const e = item as { value_json?: string };
      return { ...item, value: parseJson(e.value_json ?? null, e.value_json ?? null) };
    }),
    decisions: decisions.results,
    score_history: scores.results,
    build_specs: specs.results,
    runs: runs.results.map(item => ({ ...item, summary: parseJson((item as {summary_json?: string | null}).summary_json ?? null, null) })),
  };
}

async function startValidation(env: Env, opportunityId: string, triggerSource: string) {
  const opportunity = await env.DB.prepare("SELECT id,lifecycle_state FROM opportunities WHERE id=?").bind(opportunityId).first<{ id: string; lifecycle_state: string }>();
  if (!opportunity) throw new Error("opportunity_not_found");
  if (["APPROVED","READY_TO_BUILD","BUILDING","LAUNCHED","REJECTED"].includes(opportunity.lifecycle_state)) throw new Error(`validation_not_allowed_from_${opportunity.lifecycle_state}`);
  const runId = `val_${crypto.randomUUID()}`;
  await env.DB.prepare("INSERT INTO runs(id,run_type,status,workflow_instance_id,opportunity_id,trigger_source,summary_json) VALUES (?,'validation','queued',?,?,?,?)")
    .bind(runId, runId, opportunityId, triggerSource, JSON.stringify({ opportunityId, triggerSource })).run();
  try {
    const instance = await env.VALIDATION_WORKFLOW.create({ id: runId, params: { opportunityId, triggerSource } });
    return instance.id;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare("UPDATE runs SET status='failed',finished_at=CURRENT_TIMESTAMP,error=? WHERE id=?").bind(message, runId).run();
    throw error;
  }
}

async function startDiscovery(env: Env, lookbackDays = 30, triggerSource = "manual") {
  const runId = `disc_${crypto.randomUUID()}`;
  await env.DB.prepare("INSERT INTO runs(id,run_type,status,workflow_instance_id,trigger_source,summary_json) VALUES (?,'discovery','queued',?,?,?)")
    .bind(runId, runId, triggerSource, JSON.stringify({ triggerSource, lookbackDays })).run();
  try {
    const instance = await env.DISCOVERY_WORKFLOW.create({ id: runId, params: { lookbackDays, source: triggerSource } });
    return instance.id;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare("UPDATE runs SET status='failed',finished_at=CURRENT_TIMESTAMP,error=? WHERE id=?").bind(message, runId).run();
    throw error;
  }
}

async function promoteLead(env: Env, id: string, reason: string) {
  const lead = await env.DB.prepare("SELECT l.*,s.name AS source_name FROM leads l LEFT JOIN sources s ON s.id=l.source_id WHERE l.id=?").bind(id).first<LeadRow>();
  if (!lead) return jsonResponse({ error: "not_found" }, 404);
  if (lead.status !== "NEW") return jsonResponse({ error: "invalid_state", status: lead.status }, 409);
  if (lead.reserved) return jsonResponse({ error: "reserved_lead" }, 409);
  const opportunityId = crypto.randomUUID();
  const decisionId = crypto.randomUUID();
  const leadDecisionId = crypto.randomUUID();
  const formats = parseJson<string[]>(lead.formats_json, []);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO opportunities
      (id,name,lifecycle_state,recommendation,data_source_name,data_source_url,data_format,entity_count,build_notes)
      VALUES (?,?,'DISCOVERED','UNSCORED',?,?,?,?,?)`)
      .bind(opportunityId, lead.title, lead.source_name ?? lead.organization ?? "Unknown source", lead.data_url, formats.join(" / ") || null, lead.entity_count_estimate, lead.description),
    env.DB.prepare("UPDATE leads SET status='PROMOTED',promoted_opportunity_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='NEW'").bind(opportunityId, id),
    env.DB.prepare("INSERT INTO lead_decisions(id,lead_id,action,actor,reason) VALUES (?,?,'PROMOTE','owner',?)").bind(leadDecisionId, id, reason || null),
    env.DB.prepare("INSERT INTO decisions(id,opportunity_id,action,from_state,to_state,actor,reason) VALUES (?,?,'PROMOTE_LEAD',NULL,'DISCOVERED','owner',?)").bind(decisionId, opportunityId, reason || null),
  ]);
  let validationRunId: string | null = null;
  let validationError: string | null = null;
  try { validationRunId = await startValidation(env, opportunityId, "lead_promotion"); }
  catch (error) { validationError = error instanceof Error ? error.message : String(error); }
  return jsonResponse({ ok: true, opportunity_id: opportunityId, validation_run_id: validationRunId, validation_error: validationError }, 201);
}

async function dismissLead(env: Env, id: string, reason: string) {
  const lead = await env.DB.prepare("SELECT id,status FROM leads WHERE id=?").bind(id).first<{ id: string; status: string }>();
  if (!lead) return jsonResponse({ error: "not_found" }, 404);
  if (lead.status !== "NEW") return jsonResponse({ error: "invalid_state", status: lead.status }, 409);
  await env.DB.batch([
    env.DB.prepare("UPDATE leads SET status='DISMISSED',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='NEW'").bind(id),
    env.DB.prepare("INSERT INTO lead_decisions(id,lead_id,action,actor,reason) VALUES (?,?,'DISMISS','owner',?)").bind(crypto.randomUUID(), id, reason || null),
  ]);
  return jsonResponse({ ok: true });
}

const transitions: Record<DecisionAction, { from: string[]; to: string }> = {
  RESEARCH: { from: ["DISCOVERED","VALIDATING","SCORED","BACKLOG"], to: "RESEARCHING" },
  BACKLOG: { from: ["DISCOVERED","VALIDATING","SCORED","RESEARCHING"], to: "BACKLOG" },
  APPROVE: { from: ["SCORED","RESEARCHING","BACKLOG"], to: "APPROVED" },
  REJECT: { from: ["DISCOVERED","VALIDATING","SCORED","RESEARCHING","BACKLOG","APPROVED","READY_TO_BUILD","BUILDING"], to: "REJECTED" },
  READY_TO_BUILD: { from: ["APPROVED"], to: "READY_TO_BUILD" },
  START_BUILD: { from: ["READY_TO_BUILD"], to: "BUILDING" },
  LAUNCH: { from: ["BUILDING"], to: "LAUNCHED" },
};

async function decideOpportunity(env: Env, id: string, action: DecisionAction, reason: string) {
  const opportunity = await env.DB.prepare("SELECT * FROM opportunities WHERE id=?").bind(id).first<Record<string, unknown>>();
  if (!opportunity) return jsonResponse({ error: "not_found" }, 404);
  const rule = transitions[action];
  if (!rule) return jsonResponse({ error: "invalid_action" }, 400);
  const from = String(opportunity.lifecycle_state);
  if (!rule.from.includes(from)) return jsonResponse({ error: "invalid_transition", from, action, allowed_from: rule.from }, 409);
  if (action === "REJECT" && !reason.trim()) return jsonResponse({ error: "reason_required" }, 400);

  const statements = [
    env.DB.prepare("UPDATE opportunities SET lifecycle_state=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND lifecycle_state=?").bind(rule.to, id, from),
    env.DB.prepare("INSERT INTO decisions(id,opportunity_id,action,from_state,to_state,actor,reason) VALUES (?,?,?,?,?,'owner',?)")
      .bind(crypto.randomUUID(), id, action, from, rule.to, reason || null),
  ];

  if (action === "APPROVE") {
    statements.push(env.DB.prepare(`INSERT INTO products
      (id,origin_opportunity_id,name,status,data_source_name,data_source_url,entity_count,update_frequency,monetization,notes)
      VALUES (?,?,?,'planning',?,?,?,?,?,?)
      ON CONFLICT(origin_opportunity_id) DO UPDATE SET status='planning',updated_at=CURRENT_TIMESTAMP`)
      .bind(crypto.randomUUID(), id, opportunity.name, opportunity.data_source_name, opportunity.data_source_url, opportunity.entity_count, opportunity.update_frequency, opportunity.monetization_model, "Created by explicit APPROVE decision."));
  } else if (action === "READY_TO_BUILD") {
    statements.push(env.DB.prepare("UPDATE products SET status='ready_to_build',updated_at=CURRENT_TIMESTAMP WHERE origin_opportunity_id=?").bind(id));
  } else if (action === "START_BUILD") {
    statements.push(env.DB.prepare("UPDATE products SET status='building',updated_at=CURRENT_TIMESTAMP WHERE origin_opportunity_id=?").bind(id));
  } else if (action === "LAUNCH") {
    statements.push(env.DB.prepare("UPDATE products SET status='active',launch_date=COALESCE(launch_date,date('now')),updated_at=CURRENT_TIMESTAMP WHERE origin_opportunity_id=?").bind(id));
  } else if (action === "REJECT" && ["APPROVED","READY_TO_BUILD","BUILDING"].includes(from)) {
    statements.push(env.DB.prepare("UPDATE products SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE origin_opportunity_id=?").bind(id));
  }

  await env.DB.batch(statements);
  return jsonResponse({ ok: true, from, to: rule.to, action });
}

function recommendationFor(composite: number) {
  return composite >= 7 ? "BUILD_RECOMMENDED" : composite >= 5 ? "BACKLOG" : "KILL_RECOMMENDED";
}

async function rescoreOpportunity(env: Env, id: string) {
  const current = await env.DB.prepare("SELECT * FROM opportunity_current_scores WHERE opportunity_id=?").bind(id).first<Record<string, unknown>>();
  if (!current) return jsonResponse({ error: "no_score_snapshot" }, 409);
  const values = ["data_quality","search_demand","competition_gap","monetization_clarity","build_feasibility","defensibility"].map(k => Number(current[k] ?? 0));
  const composite = Math.round((values.reduce((a,b) => a+b, 0) / values.length) * 100) / 100;
  const recommendation = recommendationFor(composite);
  const runId = crypto.randomUUID();
  const scoreId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO runs(id,run_type,status,started_at,finished_at,summary_json,opportunity_id,trigger_source) VALUES (?,'manual_rescore','complete',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,?,?, 'manual')")
      .bind(runId, JSON.stringify({ mode: "policy_recompute", framework: "v3", source_snapshot: current.id }), id),
    env.DB.prepare(`INSERT INTO score_snapshots
      (id,opportunity_id,run_id,framework_version,data_quality,search_demand,competition_gap,monetization_clarity,build_feasibility,defensibility,composite,recommendation,rationale_json)
      VALUES (?,?,?,'v3',?,?,?,?,?,?,?,?,?)`)
      .bind(scoreId,id,runId,...values,composite,recommendation,JSON.stringify({ mode: "policy_recompute", source_snapshot: current.id })),
    env.DB.prepare("UPDATE opportunities SET recommendation=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(recommendation,id),
  ]);
  return jsonResponse({ ok: true, score_snapshot_id: scoreId, composite, recommendation, mode: "policy_recompute" }, 201);
}

async function generateBuildSpec(env: Env, id: string) {
  const detail = await opportunityDetail(env, id);
  if (!detail) return jsonResponse({ error: "not_found" }, 404);
  const latest = (detail as { latest_score?: Record<string, unknown> | null }).latest_score;
  const versionRow = await env.DB.prepare("SELECT COALESCE(MAX(version),0)+1 AS version FROM build_specs WHERE opportunity_id=?").bind(id).first<{ version: number }>();
  const version = versionRow?.version ?? 1;
  const evidence = ((detail as { evidence?: Array<Record<string, unknown>> }).evidence ?? []).slice(0, 12);
  const lines = [
    `# Build Spec: ${detail.name}`, "", `Version: ${version}`, `Lifecycle: ${detail.lifecycle_state}`, `Recommendation: ${detail.recommendation}`,
    latest ? `Composite score: ${latest.composite}/10` : "Composite score: unavailable", "", "## Opportunity thesis", detail.build_notes || "No build thesis recorded.",
    "", "## Search intent", detail.query_pattern || "No primary query recorded.", "", "## Data source", `- Source: ${detail.data_source_name || "Unknown"}`,
    `- URL: ${detail.data_source_url || "Not recorded"}`, `- Format: ${detail.data_format || "Unknown"}`, `- Update cadence: ${detail.update_frequency || "Unknown"}`,
    `- Entity count: ${detail.entity_count ?? "Unknown"}`, `- Licensing: ${detail.licensing || "Not recorded"}`, "", "## Monetization", detail.monetization_model || "Not recorded.",
    "", "## Current score", ...(latest ? [`- Data quality: ${latest.data_quality}`, `- Search demand: ${latest.search_demand}`, `- Competition gap: ${latest.competition_gap}`,
      `- Monetization clarity: ${latest.monetization_clarity}`, `- Build feasibility: ${latest.build_feasibility}`, `- Defensibility: ${latest.defensibility}`] : ["No score snapshot recorded."]),
    "", "## Evidence snapshot", ...evidence.map(e => `- **${String(e.kind ?? "evidence")}** ${String(e.label ?? "")}: ${JSON.stringify(e.value ?? null)}`), "", "## MVP guardrails",
    "- Ship the smallest indexable/useful surface that validates demand.", "- Keep source data provenance visible and reproducible.", "- Treat monetization assumptions as hypotheses until measured.",
    "- Do not expand scope until the initial query space shows traction.",
  ];
  const content = lines.join("\n");
  const specId = crypto.randomUUID();
  const scoreSnapshotId = latest && typeof latest === "object" ? String((latest as Record<string, unknown>).id ?? "") || null : null;
  await env.DB.prepare("INSERT INTO build_specs(id,opportunity_id,version,score_snapshot_id,content,created_by) VALUES (?,?,?,?,?,'owner')").bind(specId,id,version,scoreSnapshotId,content).run();
  return jsonResponse({ ok: true, id: specId, version, filename: `build-spec-${id}-v${version}.md`, content }, 201);
}

async function latestBuildSpec(env: Env, id: string) {
  return env.DB.prepare("SELECT id,version,content,created_by,created_at FROM build_specs WHERE opportunity_id=? ORDER BY version DESC LIMIT 1").bind(id).first();
}

async function handleMutation(request: Request, env: Env, url: URL) {
  if (!(await authorized(request, env))) return jsonResponse({ error: "unauthorized" }, 401);
  const body = await readBody(request);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (url.pathname === "/api/workflows/discovery") {
    const lookbackDays = Math.max(1, Math.min(90, Number(body.lookback_days ?? 30)));
    const id = await startDiscovery(env, lookbackDays, "manual");
    return jsonResponse({ ok: true, workflow_instance_id: id }, 202);
  }

  let match = url.pathname.match(/^\/api\/leads\/([^/]+)\/(promote|dismiss)$/);
  if (match) return match[2] === "promote" ? promoteLead(env, decodeURIComponent(match[1]), reason) : dismissLead(env, decodeURIComponent(match[1]), reason);

  match = url.pathname.match(/^\/api\/opportunities\/([^/]+)\/(decision|rescore|build-spec|validate)$/);
  if (match) {
    const id = decodeURIComponent(match[1]);
    if (match[2] === "decision") return decideOpportunity(env, id, String(body.action ?? "").toUpperCase() as DecisionAction, reason);
    if (match[2] === "rescore") return rescoreOpportunity(env, id);
    if (match[2] === "validate") {
      try { return jsonResponse({ ok: true, workflow_instance_id: await startValidation(env, id, "manual") }, 202); }
      catch (error) { return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 409); }
    }
    return generateBuildSpec(env, id);
  }
  return jsonResponse({ error: "not_found" }, 404);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      if (request.method === "POST") return handleMutation(request, env, url);
      if (request.method !== "GET") return jsonResponse({ error: "method_not_allowed" }, 405);
      if (url.pathname === "/api/health") {
        const result = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
        return jsonResponse({ ok: result?.ok === 1, sourceOfTruth: "d1", mutations: true, workflows: true });
      }
      if (url.pathname === "/api/dashboard") return jsonResponse(await dashboard(env));
      if (url.pathname === "/api/leads") {
        const status = (url.searchParams.get("status") ?? "NEW").toUpperCase();
        const rows = await env.DB.prepare("SELECT l.*,s.name AS source_name FROM leads l LEFT JOIN sources s ON s.id=l.source_id WHERE l.status=? ORDER BY l.reserved ASC,l.scanner_score DESC,l.created_at DESC LIMIT 250").bind(status).all<LeadRow>();
        return jsonResponse({ leads: rows.results.map(row => ({ ...row, formats: parseJson<string[]>(row.formats_json, []), reserved: Boolean(row.reserved) })) });
      }
      if (url.pathname === "/api/opportunities") {
        const rows = await env.DB.prepare(`${opportunitySelect} ORDER BY COALESCE(s.composite,0) DESC,o.updated_at DESC LIMIT 250`).all<OpportunityRow>();
        return jsonResponse({ opportunities: rows.results.map(mapOpportunity) });
      }
      if (url.pathname === "/api/sources") {
        const rows = await env.DB.prepare("SELECT id,name,kind,url,enabled,scan_cadence,last_scanned_at,health_status,last_error,last_result_json,updated_at FROM sources ORDER BY updated_at DESC").all();
        return jsonResponse({ sources: rows.results.map(row => ({ ...row, last_result: parseJson((row as {last_result_json?: string | null}).last_result_json ?? null, null) })) });
      }
      let match = url.pathname.match(/^\/api\/opportunities\/([^/]+)\/build-spec\/latest$/);
      if (match) {
        const spec = await latestBuildSpec(env, decodeURIComponent(match[1]));
        return spec ? jsonResponse({ build_spec: spec }) : jsonResponse({ error: "not_found" }, 404);
      }
      match = url.pathname.match(/^\/api\/opportunities\/([^/]+)$/);
      if (match) {
        const detail = await opportunityDetail(env, decodeURIComponent(match[1]));
        return detail ? jsonResponse({ opportunity: detail }) : jsonResponse({ error: "not_found" }, 404);
      }
      if (url.pathname === "/api/portfolio") {
        const rows = await env.DB.prepare("SELECT * FROM products ORDER BY updated_at DESC").all();
        return jsonResponse({ products: rows.results });
      }
      if (url.pathname === "/api/runs") {
        const rows = await env.DB.prepare("SELECT id,run_type,status,workflow_instance_id,opportunity_id,trigger_source,started_at,finished_at,summary_json,error,created_at FROM runs ORDER BY created_at DESC LIMIT 100").all();
        return jsonResponse({ runs: rows.results.map(row => ({ ...row, summary: parseJson((row as {summary_json?: string | null}).summary_json ?? null, null) })) });
      }
      return jsonResponse({ error: "not_found" }, 404);
    } catch (error) {
      console.error(JSON.stringify({ event: "api_error", path: url.pathname, method: request.method, error: error instanceof Error ? error.message : String(error) }));
      return jsonResponse({ error: "internal_error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
