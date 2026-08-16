import { WorkflowEntrypoint, WorkflowStep } from "cloudflare:workers";
import type { WorkflowEvent } from "cloudflare:workers";

type ValidationParams = {
  opportunityId: string;
  triggerSource?: string;
};

type Opportunity = {
  id: string;
  name: string;
  lifecycle_state: string;
  data_source_name: string | null;
  data_source_url: string | null;
  data_format: string | null;
  update_frequency: string | null;
  entity_count: number | null;
  monetization_model: string | null;
  query_pattern: string | null;
  build_notes: string | null;
};

type DataProbe = {
  ok: boolean;
  status: number | null;
  contentType: string;
  finalUrl: string;
  sampleBytes: number;
  error: string | null;
};

type SearchProbe = {
  query: string;
  suggestions: string[];
  competitionResultCount: number | null;
  competitionDomains: string[];
  errors: string[];
};

const clamp = (n: number, min = 1, max = 10) => Math.max(min, Math.min(max, n));
const round = (n: number) => Math.round(n * 100) / 100;

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function probeDataSource(url: string | null): Promise<DataProbe> {
  if (!url) return { ok: false, status: null, contentType: "", finalUrl: "", sampleBytes: 0, error: "No source URL recorded" };
  try {
    let response = await fetchWithTimeout(url, { method: "HEAD", redirect: "follow", headers: { "user-agent": "PaydirtValidation/3.0" } });
    if (response.status === 405 || response.status === 403) {
      response = await fetchWithTimeout(url, { method: "GET", redirect: "follow", headers: { "user-agent": "PaydirtValidation/3.0", range: "bytes=0-4095" } });
    }
    const sample = response.body ? await response.clone().arrayBuffer().catch(() => new ArrayBuffer(0)) : new ArrayBuffer(0);
    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      finalUrl: response.url,
      sampleBytes: sample.byteLength,
      error: response.ok ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    return { ok: false, status: null, contentType: "", finalUrl: url, sampleBytes: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

function queryFor(opportunity: Opportunity) {
  if (opportunity.query_pattern && opportunity.query_pattern !== "—") return opportunity.query_pattern;
  const clean = opportunity.name.replace(/^\[[^\]]+\]\s*/, "").replace(/\b(dataset|data|database|records|registry)\b/gi, "").trim();
  return `${clean} lookup`.replace(/\s+/g, " ").trim();
}

async function probeSearch(query: string): Promise<SearchProbe> {
  const result: SearchProbe = { query, suggestions: [], competitionResultCount: null, competitionDomains: [], errors: [] };
  try {
    const suggestUrl = new URL("https://suggestqueries.google.com/complete/search");
    suggestUrl.searchParams.set("client", "firefox");
    suggestUrl.searchParams.set("q", query);
    const response = await fetchWithTimeout(suggestUrl.toString(), { headers: { "user-agent": "Mozilla/5.0 PaydirtValidation/3.0" } });
    if (!response.ok) throw new Error(`suggest HTTP ${response.status}`);
    const payload = await response.json() as unknown;
    if (Array.isArray(payload) && Array.isArray(payload[1])) result.suggestions = payload[1].filter(x => typeof x === "string").slice(0, 10) as string[];
  } catch (error) {
    result.errors.push(`suggest: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const searchUrl = new URL("https://html.duckduckgo.com/html/");
    searchUrl.searchParams.set("q", query);
    const response = await fetchWithTimeout(searchUrl.toString(), { headers: { "user-agent": "Mozilla/5.0 PaydirtValidation/3.0" } });
    if (!response.ok) throw new Error(`competition HTTP ${response.status}`);
    const html = await response.text();
    const links = [...html.matchAll(/class="result__a"[^>]*href="([^"]+)"/g)].map(m => m[1]);
    result.competitionResultCount = links.length;
    const domains = new Set<string>();
    for (const href of links) {
      try {
        const decoded = href.startsWith("//duckduckgo.com/l/?") ? new URL(`https:${href}`).searchParams.get("uddg") ?? href : href;
        domains.add(new URL(decoded).hostname.replace(/^www\./, ""));
      } catch { /* ignore malformed result links */ }
    }
    result.competitionDomains = [...domains].slice(0, 20);
  } catch (error) {
    result.errors.push(`competition: ${error instanceof Error ? error.message : String(error)}`);
  }
  return result;
}

function deriveScores(opportunity: Opportunity, data: DataProbe, search: SearchProbe) {
  const format = `${opportunity.data_format ?? ""} ${data.contentType}`.toLowerCase();
  const dataQuality = clamp((data.ok ? 6 : 2) + (/(json|csv|api|xml)/.test(format) ? 2 : 0) + (opportunity.entity_count && opportunity.entity_count > 1000 ? 1 : 0));

  const suggestionCount = search.suggestions.length;
  const searchDemand = clamp(suggestionCount === 0 ? 2 : 4 + Math.min(5, suggestionCount) * 0.8);

  const competitionCount = search.competitionResultCount;
  const competitionGap = competitionCount === null ? 4 : clamp(10 - Math.min(8, competitionCount) * 0.7 + (search.competitionDomains.length <= 5 ? 1 : 0));

  const moneyText = `${opportunity.name} ${opportunity.monetization_model ?? ""}`.toLowerCase();
  const highIntentHits = ["price","cost","lawyer","attorney","insurance","contractor","provider","facility","recall","inspection","license","permit","complaint","product"].filter(x => moneyText.includes(x)).length;
  const monetizationClarity = clamp((opportunity.monetization_model ? 6 : 4) + Math.min(3, highIntentHits));

  const buildFeasibility = clamp((data.ok ? 7 : 3) + (/(json|csv|api)/.test(format) ? 2 : 0) - (/pdf/.test(format) ? 1 : 0));

  const defensibility = clamp(3 + (opportunity.entity_count && opportunity.entity_count > 10_000 ? 2 : 0) + (opportunity.update_frequency ? 1 : 0) + (data.ok ? 1 : 0));
  const dimensions = { data_quality: round(dataQuality), search_demand: round(searchDemand), competition_gap: round(competitionGap), monetization_clarity: round(monetizationClarity), build_feasibility: round(buildFeasibility), defensibility: round(defensibility) };
  const composite = round(Object.values(dimensions).reduce((a,b) => a+b, 0) / 6);
  const recommendation = composite >= 7 ? "BUILD_RECOMMENDED" : composite >= 5 ? "BACKLOG" : "KILL_RECOMMENDED";
  const confidence = round(([data.ok, search.suggestions.length > 0, search.competitionResultCount !== null].filter(Boolean).length / 3) * 100) / 100;
  return { dimensions, composite, recommendation, confidence };
}

export class ValidationWorkflow extends WorkflowEntrypoint<Env, ValidationParams> {
  async run(event: WorkflowEvent<ValidationParams>, step: WorkflowStep) {
    const runId = event.instanceId;
    const opportunityId = event.payload?.opportunityId;
    if (!opportunityId) throw new Error("opportunityId is required");

    const opportunity = await step.do("load opportunity", async () => {
      const row = await this.env.DB.prepare("SELECT id,name,lifecycle_state,data_source_name,data_source_url,data_format,update_frequency,entity_count,monetization_model,query_pattern,build_notes FROM opportunities WHERE id=?").bind(opportunityId).first<Opportunity>();
      if (!row) throw new Error(`Opportunity ${opportunityId} not found`);
      return row;
    });

    await step.do("mark validating", async () => {
      const from = opportunity.lifecycle_state;
      if (["DISCOVERED","RESEARCHING"].includes(from)) {
        await this.env.DB.batch([
          this.env.DB.prepare("UPDATE opportunities SET lifecycle_state='VALIDATING',updated_at=CURRENT_TIMESTAMP WHERE id=? AND lifecycle_state=?").bind(opportunityId, from),
          this.env.DB.prepare("INSERT INTO decisions(id,opportunity_id,action,from_state,to_state,actor,reason) VALUES (?,?,'VALIDATION_STARTED',?,'VALIDATING','workflow',?)")
            .bind(crypto.randomUUID(), opportunityId, from, `Validation workflow ${runId}`),
        ]);
      }
      await this.env.DB.prepare("UPDATE runs SET status='running',started_at=COALESCE(started_at,CURRENT_TIMESTAMP),workflow_instance_id=?,opportunity_id=?,trigger_source=COALESCE(trigger_source,?) WHERE id=?")
        .bind(runId, opportunityId, event.payload?.triggerSource ?? "workflow", runId).run();
    });

    try {
      const dataProbe = await step.do("probe data accessibility", { retries: { limit: 2, delay: "10 seconds", backoff: "exponential" }, timeout: "1 minute" }, () => probeDataSource(opportunity.data_source_url));
      const query = queryFor(opportunity);
      const searchProbe = await step.do("probe search demand and competition", { retries: { limit: 2, delay: "10 seconds", backoff: "exponential" }, timeout: "1 minute" }, () => probeSearch(query));
      const scored = await step.do("derive evidence score", async () => deriveScores(opportunity, dataProbe, searchProbe));

      await step.do("persist evidence and score", async () => {
        const scoreId = crypto.randomUUID();
        const current = await this.env.DB.prepare("SELECT lifecycle_state FROM opportunities WHERE id=?").bind(opportunityId).first<{ lifecycle_state: string }>();
        const from = current?.lifecycle_state ?? "VALIDATING";
        await this.env.DB.batch([
          this.env.DB.prepare("INSERT INTO evidence(id,opportunity_id,run_id,kind,label,value_json,source_url,observed_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)")
            .bind(crypto.randomUUID(), opportunityId, runId, "data_accessibility", "Live source probe", JSON.stringify(dataProbe), opportunity.data_source_url),
          this.env.DB.prepare("INSERT INTO evidence(id,opportunity_id,run_id,kind,label,value_json,source_url,observed_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)")
            .bind(crypto.randomUUID(), opportunityId, runId, "search_demand", `Autocomplete: ${query}`, JSON.stringify({ query, suggestions: searchProbe.suggestions, errors: searchProbe.errors }), "https://suggestqueries.google.com/"),
          this.env.DB.prepare("INSERT INTO evidence(id,opportunity_id,run_id,kind,label,value_json,source_url,observed_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)")
            .bind(crypto.randomUUID(), opportunityId, runId, "competition", `SERP sample: ${query}`, JSON.stringify({ resultCount: searchProbe.competitionResultCount, domains: searchProbe.competitionDomains, errors: searchProbe.errors }), "https://html.duckduckgo.com/"),
          this.env.DB.prepare(`INSERT INTO score_snapshots(id,opportunity_id,run_id,framework_version,data_quality,search_demand,competition_gap,monetization_clarity,build_feasibility,defensibility,composite,recommendation,rationale_json)
            VALUES (?,?,?,'v3-validation',?,?,?,?,?,?,?,?,?)`)
            .bind(scoreId, opportunityId, runId, scored.dimensions.data_quality, scored.dimensions.search_demand, scored.dimensions.competition_gap, scored.dimensions.monetization_clarity, scored.dimensions.build_feasibility, scored.dimensions.defensibility, scored.composite, scored.recommendation, JSON.stringify({ confidence: scored.confidence, query, measured: ["data_accessibility","autocomplete","serp_sample"], heuristic: ["monetization_clarity","build_feasibility","defensibility"] })),
          this.env.DB.prepare("UPDATE opportunities SET lifecycle_state='SCORED',recommendation=?,query_pattern=COALESCE(NULLIF(query_pattern,''),?),updated_at=CURRENT_TIMESTAMP WHERE id=?")
            .bind(scored.recommendation, query, opportunityId),
          this.env.DB.prepare("INSERT INTO decisions(id,opportunity_id,action,from_state,to_state,actor,reason) VALUES (?,?,'VALIDATION_COMPLETED',?,'SCORED','workflow',?)")
            .bind(crypto.randomUUID(), opportunityId, from, `Score ${scored.composite}/10; confidence ${scored.confidence}`),
          this.env.DB.prepare("UPDATE runs SET status='complete',finished_at=CURRENT_TIMESTAMP,summary_json=?,error=NULL WHERE id=?")
            .bind(JSON.stringify({ opportunityId, scoreSnapshotId: scoreId, composite: scored.composite, recommendation: scored.recommendation, confidence: scored.confidence, query }), runId),
        ]);
      });

      return { opportunityId, composite: scored.composite, recommendation: scored.recommendation, confidence: scored.confidence, query };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await step.do("record validation failure", async () => {
        await this.env.DB.prepare("UPDATE runs SET status='failed',finished_at=CURRENT_TIMESTAMP,error=? WHERE id=?").bind(message, runId).run();
      });
      throw error;
    }
  }
}
