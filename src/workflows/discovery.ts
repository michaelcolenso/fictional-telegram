import { WorkflowEntrypoint, WorkflowStep } from "cloudflare:workers";
import type { WorkflowEvent } from "cloudflare:workers";

type DiscoveryParams = {
  lookbackDays?: number;
  source?: "manual" | "scheduled";
};

type LeadCandidate = {
  sourceId: string;
  sourceName: string;
  sourceKind: string;
  sourceUrl: string;
  title: string;
  description: string;
  dataUrl: string;
  organization: string;
  formats: string[];
  observedAt: string;
  entityCountEstimate: number | null;
  reserved: boolean;
  notes: string;
  raw: unknown;
};

type ScoredLead = LeadCandidate & { scannerScore: number };

type ScanResult = {
  sourceId: string;
  sourceName: string;
  sourceKind: string;
  sourceUrl: string;
  leads: LeadCandidate[];
};

const SIGNAL_TERMS = [
  "data", "reporting", "disclosure", "registry", "public access", "transparency",
  "database", "records", "filing", "information collection", "electronic submission",
  "machine-readable", "open data",
];

const ENTITY_TERMS = [
  "records", "entries", "facilities", "permits", "inspections", "transactions",
  "complaints", "incidents", "licenses", "cases", "providers", "schools",
  "companies", "businesses", "properties",
];

const HIGH_VALUE_TERMS = [
  "safety", "recall", "inspection", "health", "violation", "spending", "procurement",
  "license", "permit", "complaint", "price", "cost", "salary", "outcome", "rating",
  "score", "environmental", "pollution", "enforcement", "penalty",
];

const RESERVED_TERMS = ["nhtsa", "micro-purchase", "college scorecard", "collegescorecard"];

const STATE_PORTALS = [
  ["Washington", "data.wa.gov"], ["New York", "data.ny.gov"], ["California", "data.ca.gov"],
  ["Texas", "data.texas.gov"], ["Illinois", "data.illinois.gov"], ["Michigan", "data.michigan.gov"],
  ["Georgia", "data.georgia.gov"], ["Colorado", "data.colorado.gov"], ["Oregon", "data.oregon.gov"],
  ["Pennsylvania", "data.pa.gov"], ["Massachusetts", "data.mass.gov"], ["Virginia", "data.virginia.gov"],
  ["Ohio", "data.ohio.gov"], ["Minnesota", "data.mn.gov"], ["Connecticut", "data.ct.gov"],
] as const;

const PORTALS_PER_RUN = 5;

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function asText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function scoreLead(lead: LeadCandidate, now: Date): ScoredLead {
  const text = `${lead.title} ${lead.description}`.toLowerCase();
  const entity = Math.min(5, Math.max(1, ENTITY_TERMS.filter(term => text.includes(term)).length + 1));
  const format = lead.formats.join(" ").toUpperCase();
  const accessibility = format.includes("API") || format.includes("JSON") ? 5
    : format.includes("CSV") || format.includes("SOCRATA") ? 4
    : format.includes("XML") ? 3 : format.includes("REGULATION") ? 2 : 2;
  const relevance = Math.min(5, Math.max(1, HIGH_VALUE_TERMS.filter(term => text.includes(term)).length));
  let novelty = 2;
  const observed = Date.parse(lead.observedAt);
  if (Number.isFinite(observed)) {
    const daysOld = Math.max(0, Math.floor((now.getTime() - observed) / 86_400_000));
    novelty = daysOld <= 7 ? 5 : daysOld <= 30 ? 4 : daysOld <= 90 ? 3 : 2;
  }
  if (lead.sourceKind === "regulatory_signal") novelty = Math.max(novelty, 4);
  const scannerScore = Math.round(((entity + accessibility + relevance + novelty) / 4) * 100) / 100;
  return { ...lead, reserved: lead.reserved || RESERVED_TERMS.some(term => text.includes(term)), scannerScore };
}

async function sha256(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function leadId(lead: LeadCandidate) {
  // A lead is an observed source event, not the underlying dataset identity. A materially
  // newer source observation therefore becomes a new Inbox item while exact workflow
  // retries remain idempotent.
  const fingerprint = [lead.sourceId, lead.dataUrl || lead.title, lead.observedAt || "unknown"].join("|");
  return `lead_${(await sha256(fingerprint)).slice(0, 40)}`;
}

async function fetchJson(url: URL): Promise<unknown> {
  const response = await fetch(url, { headers: { "user-agent": "PaydirtDiscovery/3.0" } });
  if (!response.ok) throw new Error(`${url.hostname} returned HTTP ${response.status}`);
  return response.json();
}

async function scanFederalRegister(since: string): Promise<ScanResult> {
  const sourceId = "scanner:federal-register";
  const sourceUrl = "https://www.federalregister.gov/api/v1/documents.json";
  const url = new URL(sourceUrl);
  url.searchParams.set("conditions[publication_date][gte]", since);
  url.searchParams.append("conditions[type][]", "RULE");
  url.searchParams.append("conditions[type][]", "NOTICE");
  for (const field of ["title", "abstract", "agencies", "publication_date", "html_url", "type"]) {
    url.searchParams.append("fields[]", field);
  }
  url.searchParams.set("per_page", "100");
  url.searchParams.set("order", "newest");
  const payload = await fetchJson(url) as { results?: Array<Record<string, unknown>> };
  const leads: LeadCandidate[] = [];
  for (const doc of payload.results ?? []) {
    const title = asText(doc.title);
    const description = asText(doc.abstract) || title;
    const combined = `${title} ${description}`.toLowerCase();
    const matching = SIGNAL_TERMS.filter(term => combined.includes(term));
    if (matching.length < 2) continue;
    const agencies = Array.isArray(doc.agencies)
      ? doc.agencies.map(a => asText((a as Record<string, unknown>).name)).filter(Boolean).join(", ")
      : "Unknown";
    leads.push({
      sourceId, sourceName: "Federal Register", sourceKind: "regulatory_signal", sourceUrl,
      title: `[${asText(doc.type) || "NOTICE"}] ${title}`,
      description: description.slice(0, 500), dataUrl: asText(doc.html_url), organization: agencies || "Unknown",
      formats: ["regulation"], observedAt: asText(doc.publication_date), entityCountEstimate: null,
      reserved: false, notes: `Signal terms: ${matching.join(", ")}`, raw: doc,
    });
  }
  return { sourceId, sourceName: "Federal Register", sourceKind: "regulatory_signal", sourceUrl, leads };
}

async function scanStatePortal(state: string, domain: string): Promise<ScanResult> {
  const sourceId = `scanner:state:${state.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const sourceUrl = `https://${domain}/api/catalog/v1`;
  const url = new URL(sourceUrl);
  url.searchParams.set("order", "updatedAt");
  url.searchParams.set("limit", "20");
  url.searchParams.set("domains", domain);
  const payload = await fetchJson(url) as { results?: Array<Record<string, unknown>> };
  const leads: LeadCandidate[] = [];
  for (const item of payload.results ?? []) {
    const resource = (item.resource ?? {}) as Record<string, unknown>;
    const title = asText(resource.name) || "Untitled";
    const description = asText(resource.description).slice(0, 500);
    const updated = asText(resource.updatedAt) || asText(resource.data_updated_at);
    const id = asText(resource.id);
    const dataUrl = asText(item.link) || (id ? `https://${domain}/d/${id}` : `https://${domain}`);
    const columns = Array.isArray(resource.columns_field_name) ? resource.columns_field_name.length : 0;
    leads.push({
      sourceId, sourceName: `${state} Open Data`, sourceKind: "open_data_portal", sourceUrl,
      title: `[${state}] ${title}`, description, dataUrl, organization: `${state} State Government`,
      formats: ["Socrata", "CSV", "JSON"], observedAt: updated || isoDate(new Date()),
      entityCountEstimate: null, reserved: false, notes: columns ? `Columns: ${columns}` : "", raw: item,
    });
  }
  return { sourceId, sourceName: `${state} Open Data`, sourceKind: "open_data_portal", sourceUrl, leads };
}

async function persistSource(env: Env, scan: ScanResult) {
  await env.DB.prepare(`INSERT INTO sources(id,name,kind,url,enabled,scan_cadence,last_scanned_at)
    VALUES (?,?,?,?,1,'weekly',CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,url=excluded.url,
      enabled=1,scan_cadence='weekly',last_scanned_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`)
    .bind(scan.sourceId, scan.sourceName, scan.sourceKind, scan.sourceUrl).run();
}

async function persistLeads(env: Env, leads: ScoredLead[]) {
  let inserted = 0;
  for (let offset = 0; offset < leads.length; offset += 60) {
    const chunk = leads.slice(offset, offset + 60);
    const statements = [];
    for (const lead of chunk) {
      const id = await leadId(lead);
      statements.push(env.DB.prepare(`INSERT OR IGNORE INTO leads
        (id,source_id,title,description,data_url,organization,formats_json,observed_at,entity_count_estimate,scanner_score,reserved,status,raw_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'NEW',?)`)
        .bind(id, lead.sourceId, lead.title, lead.description, lead.dataUrl || null, lead.organization,
          JSON.stringify(lead.formats), lead.observedAt || null, lead.entityCountEstimate, lead.scannerScore,
          lead.reserved ? 1 : 0, JSON.stringify({ notes: lead.notes, source: lead.raw })));
    }
    const results = await env.DB.batch(statements);
    inserted += results.reduce((total, result) => total + Number(result.meta?.changes ?? 0), 0);
  }
  return inserted;
}

export class DiscoveryWorkflow extends WorkflowEntrypoint<Env, DiscoveryParams> {
  async run(event: WorkflowEvent<DiscoveryParams>, step: WorkflowStep) {
    const runId = event.instanceId;
    const lookbackDays = Math.max(1, Math.min(90, Number(event.payload?.lookbackDays ?? 30)));
    const triggeredBy = event.schedule ? "schedule" : (event.payload?.source ?? "manual");
    const sinceDate = new Date(event.timestamp.getTime() - lookbackDays * 86_400_000);
    const since = isoDate(sinceDate);

    await step.do("record run start", async () => {
      await this.env.DB.prepare(`INSERT INTO runs(id,run_type,status,workflow_instance_id,started_at,summary_json)
        VALUES (?,'discovery','running',?,CURRENT_TIMESTAMP,?)
        ON CONFLICT(id) DO UPDATE SET status='running',workflow_instance_id=excluded.workflow_instance_id,
          started_at=COALESCE(runs.started_at,CURRENT_TIMESTAMP),error=NULL`)
        .bind(runId, event.instanceId, JSON.stringify({ triggeredBy, lookbackDays, since })).run();
    });

    try {
      const scans: ScanResult[] = [];
      const errors: Array<{ source: string; error: string }> = [];

      try {
        scans.push(await step.do("scan federal register", {
          retries: { limit: 3, delay: "10 seconds", backoff: "exponential" }, timeout: "2 minutes",
        }, () => scanFederalRegister(since)));
      } catch (error) {
        errors.push({ source: "Federal Register", error: error instanceof Error ? error.message : String(error) });
      }

      const rotation = Math.floor(event.timestamp.getTime() / (7 * 86_400_000)) % STATE_PORTALS.length;
      for (let i = 0; i < PORTALS_PER_RUN; i++) {
        const [state, domain] = STATE_PORTALS[(rotation * PORTALS_PER_RUN + i) % STATE_PORTALS.length];
        try {
          const scan = await step.do(`scan state portal ${state}`, {
            retries: { limit: 2, delay: "10 seconds", backoff: "exponential" }, timeout: "2 minutes",
          }, () => scanStatePortal(state, domain));
          scans.push(scan);
        } catch (error) {
          errors.push({ source: state, error: error instanceof Error ? error.message : String(error) });
        }
      }

      const scored = await step.do("score candidate leads", async () => {
        const now = new Date(event.timestamp);
        return scans.flatMap(scan => scan.leads).map(lead => scoreLead(lead, now));
      });

      await step.do("record source scans", async () => {
        for (const scan of scans) await persistSource(this.env, scan);
      });

      const inserted = await step.do("persist leads to D1", async () => persistLeads(this.env, scored));
      const summary = {
        triggeredBy, since, lookbackDays, sourcesAttempted: 1 + PORTALS_PER_RUN,
        sourcesSucceeded: scans.length, candidateEvents: scored.length, newLeads: inserted, errors,
      };

      await step.do("record run complete", async () => {
        await this.env.DB.prepare("UPDATE runs SET status='complete',finished_at=CURRENT_TIMESTAMP,summary_json=?,error=NULL WHERE id=?")
          .bind(JSON.stringify(summary), runId).run();
      });
      return summary;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await step.do("record run failure", async () => {
        await this.env.DB.prepare("UPDATE runs SET status='failed',finished_at=CURRENT_TIMESTAMP,error=? WHERE id=?")
          .bind(message, runId).run();
      });
      throw error;
    }
  }
}
