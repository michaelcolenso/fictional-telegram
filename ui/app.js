const state = {
  opportunities: [],
  portfolio: [],
  selectedId: null,
  filter: "ALL",
  search: "",
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const scoreKeys = [
  ["Data quality", "data_quality"],
  ["Search demand", "search_demand"],
  ["Competition gap", "competition_gap"],
  ["Monetization", "monetization_clarity"],
  ["Build feasibility", "build_feasibility"],
  ["Defensibility", "defensibility"],
];

async function loadJson(paths) {
  let lastError;
  for (const path of paths) {
    try {
      const response = await fetch(path, { cache: "no-store" });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Unable to load JSON");
}

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function inferVerdict(item, composite) {
  const raw = String(item.verdict || item.status || item.phase4?.verdict || "").toUpperCase();
  if (raw === "SURVIVED") return composite >= 7 ? "BUILD" : composite >= 5 ? "BACKLOG" : "KILL";
  if (["BUILD", "BACKLOG", "KILL"].includes(raw)) return raw;
  if (raw === "KILLED") return "KILL";
  if (composite >= 7) return "BUILD";
  if (composite >= 5) return "BACKLOG";
  return "KILL";
}

function normalizeScores(item) {
  const score = item.score || item.scores || item.phase3?.score || item.phase3?.scores || {};
  const pull = (short, longKey) => {
    const candidates = [
      score[short], score[longKey],
      item[`score_${short}`], item[`score_${longKey}`],
      item.phase3?.[`score_${short}`], item.phase3?.[`score_${longKey}`],
    ];
    return number(candidates.find((v) => v !== undefined && v !== null), 0);
  };
  return {
    data_quality: pull("data", "data_quality"),
    search_demand: pull("demand", "search_demand"),
    competition_gap: pull("gap", "competition_gap"),
    monetization_clarity: pull("monetization", "monetization_clarity"),
    build_feasibility: pull("build", "build_feasibility"),
    defensibility: pull("defensibility", "defensibility"),
  };
}

function normalizeOpportunity(item, index) {
  const input = item.input || item;
  const dataSource = input.data_source || item.data_source || {};
  const scores = normalizeScores(item);
  const scoreValues = Object.values(scores).filter(Boolean);
  const computed = scoreValues.length ? scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length : 0;
  const composite = number(
    item.composite ?? item.score?.COMPOSITE ?? item.score?.composite ?? item.phase3?.composite ?? item.phase4?.composite,
    computed,
  );
  const phase2 = item.phase2 || {};
  const dataOk = item.data_accessible ?? phase2.data_ok ?? (phase2.data_status ? phase2.data_status < 400 : null);
  const demand = number(item.demand_signal_count ?? phase2.search_positive ?? phase2.demand_signal_count, 0);
  const verdict = inferVerdict(item, composite);
  const monetization = input.monetization_model || item.monetization_model || item.phase3?.monetization_model || item.monetization?.primary_model || "Not specified";
  const sourceName = typeof dataSource === "string"
    ? (item.source_detail || dataSource)
    : (dataSource.name || dataSource.source || item.source_detail || "Unknown data source");
  const sourceUrl = typeof dataSource === "string" ? dataSource : (dataSource.url || dataSource.sample_url || "");
  const queryPattern = input.query_pattern || item.query_pattern || input.search_demand?.primary_query_pattern || "—";
  const examples = input.example_queries || item.example_queries || input.search_demand?.example_queries || [];
  const killReason = item.kill_reason || item.phase2?.kill_reason || item.risks?.join?.(" · ") || "";
  const entityCount = typeof dataSource === "object" ? dataSource.entity_count : null;
  const updateFrequency = typeof dataSource === "object" ? dataSource.update_frequency : null;
  const buildNotes = input.build_notes || item.build_notes || item.build_plan?.MVP_scope || item.build_plan?.mvp_scope || "";
  const status = String(item.status || (verdict === "KILL" ? "killed" : "survived")).toLowerCase();

  return {
    id: `${slug(input.name || item.name || `opportunity-${index}`)}-${index}`,
    name: input.name || item.name || `Opportunity ${index + 1}`,
    verdict,
    status,
    composite: Math.round(composite * 100) / 100,
    scores,
    sourceName,
    sourceUrl,
    dataOk,
    demand,
    pain: number(item.pain_signal_count ?? item.phase3?.pain_signal_count, 0),
    competition: item.competition_signal || item.phase2?.competition_signal || item.competition?.vulnerability || "—",
    queryPattern,
    examples: Array.isArray(examples) ? examples : [examples],
    monetization,
    entityCount,
    updateFrequency,
    buildNotes,
    killReason,
  };
}

function normalizePipeline(payload) {
  const items = payload.candidates || payload.opportunities || payload.ranked_opportunities || [];
  const normalized = items.map(normalizeOpportunity);
  return {
    runDate: payload.run_timestamp_utc || payload.run_date || payload.generated_at || null,
    version: payload.framework_version || "v2",
    opportunities: normalized.sort((a, b) => b.composite - a.composite),
  };
}

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatCount(value) {
  const n = number(value, NaN);
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}K`;
  return n.toLocaleString();
}

function formatRunDate(value) {
  if (!value) return "Run date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return `Run ${value}`;
  return `Run ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date)}`;
}

function updateSummary(pipeline, portfolioPayload) {
  const opportunities = pipeline.opportunities;
  const survivors = opportunities.filter((item) => item.verdict !== "KILL");
  const build = opportunities.filter((item) => item.verdict === "BUILD");
  const average = survivors.length ? survivors.reduce((sum, item) => sum + item.composite, 0) / survivors.length : 0;
  const top = opportunities[0];

  $("#run-date").textContent = formatRunDate(pipeline.runDate);
  $("#metric-total").textContent = opportunities.length;
  $("#metric-build").textContent = build.length;
  $("#metric-average").textContent = average ? average.toFixed(2) : "—";
  $("#metric-portfolio").textContent = (portfolioPayload.products || []).length;
  $("#framework-version").textContent = `FRAMEWORK ${String(pipeline.version).toUpperCase()}`;

  if (top) {
    $("#top-score").textContent = top.composite.toFixed(2);
    $("#top-score-ring").style.setProperty("--score", Math.max(0, Math.min(10, top.composite)));
    $("#top-opportunity").textContent = top.name;
    $("#top-verdict").textContent = top.verdict;
    $("#top-verdict").dataset.verdict = top.verdict;
  }
}

function filteredOpportunities() {
  const needle = state.search.trim().toLowerCase();
  return state.opportunities.filter((item) => {
    const matchesFilter = state.filter === "ALL" || item.verdict === state.filter;
    const haystack = `${item.name} ${item.sourceName} ${item.queryPattern} ${item.monetization}`.toLowerCase();
    return matchesFilter && (!needle || haystack.includes(needle));
  });
}

function renderOpportunities() {
  const container = $("#opportunity-list");
  const template = $("#opportunity-template");
  const rows = filteredOpportunities();
  container.replaceChildren();

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "list-empty";
    empty.textContent = "No opportunities match this view.";
    container.append(empty);
    return;
  }

  rows.forEach((item) => {
    const fragment = template.content.cloneNode(true);
    const button = fragment.querySelector(".opportunity-row");
    const originalRank = state.opportunities.findIndex((opportunity) => opportunity.id === item.id) + 1;
    button.dataset.id = item.id;
    button.classList.toggle("selected", state.selectedId === item.id);
    button.setAttribute("aria-pressed", state.selectedId === item.id ? "true" : "false");
    fragment.querySelector(".rank").textContent = String(originalRank).padStart(2, "0");
    fragment.querySelector(".opportunity-name").textContent = item.name;
    fragment.querySelector(".opportunity-source").textContent = item.sourceName;
    fragment.querySelector(".demand-value").textContent = item.demand || "—";
    fragment.querySelector(".data-value").textContent = item.dataOk === true ? "LIVE" : item.dataOk === false ? "FAIL" : "—";
    const verdict = fragment.querySelector(".verdict");
    verdict.textContent = item.verdict;
    verdict.dataset.verdict = item.verdict;
    fragment.querySelector(".composite").textContent = item.composite ? item.composite.toFixed(2) : "—";
    button.addEventListener("click", () => selectOpportunity(item.id));
    container.append(fragment);
  });
}

function selectOpportunity(id) {
  state.selectedId = id;
  renderOpportunities();
  renderDetail();
}

function renderDetail() {
  const panel = $("#detail-panel");
  const item = state.opportunities.find((opportunity) => opportunity.id === state.selectedId);
  if (!item) return;

  const scoreBars = scoreKeys.map(([label, key]) => {
    const value = number(item.scores[key]);
    return `<div class="score-bar"><label>${escapeHtml(label)}</label><div class="score-track"><div class="score-fill" style="width:${Math.max(0, Math.min(100, value * 10))}%"></div></div><strong>${value || "—"}</strong></div>`;
  }).join("");

  const dataLink = item.sourceUrl
    ? `<a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(item.sourceName)} ↗</a>`
    : escapeHtml(item.sourceName);
  const exampleQueries = item.examples.filter(Boolean).slice(0, 3).map((query) => `<span class="query-chip">${escapeHtml(query)}</span>`).join(" ");
  const reason = item.verdict === "KILL" && item.killReason
    ? `<div class="detail-block"><h4>KILL REASON</h4><p>${escapeHtml(item.killReason)}</p></div>`
    : "";

  panel.innerHTML = `
    <div class="detail-content">
      <div class="detail-top">
        <div><span class="tag" data-verdict="${item.verdict}">${item.verdict}</span><h3>${escapeHtml(item.name)}</h3></div>
        <div class="detail-score">${item.composite ? item.composite.toFixed(2) : "—"}<small>COMPOSITE / 10</small></div>
      </div>
      <div class="detail-block"><h4>SCORE PROFILE</h4><div class="score-bars">${scoreBars}</div></div>
      <div class="detail-block"><h4>MARKET EVIDENCE</h4><div class="detail-kv">
        <div><span>DEMAND SIGNALS</span><strong>${item.demand || "—"}</strong></div>
        <div><span>PAIN SIGNALS</span><strong>${item.pain || "—"}</strong></div>
        <div><span>ENTITY COUNT</span><strong>${formatCount(item.entityCount)}</strong></div>
        <div><span>UPDATE CADENCE</span><strong>${escapeHtml(item.updateFrequency || "—")}</strong></div>
      </div></div>
      <div class="detail-block"><h4>PRIMARY QUERY</h4><span class="query-chip">${escapeHtml(item.queryPattern)}</span>${exampleQueries ? `<p style="margin-top:12px">${exampleQueries}</p>` : ""}</div>
      <div class="detail-block"><h4>DATA SOURCE</h4><p>${dataLink}</p></div>
      <div class="detail-block"><h4>MONETIZATION</h4><p>${escapeHtml(item.monetization)}</p></div>
      ${item.competition && item.competition !== "—" ? `<div class="detail-block"><h4>COMPETITION SIGNAL</h4><p>${escapeHtml(item.competition)}</p></div>` : ""}
      ${item.buildNotes ? `<div class="detail-block"><h4>BUILD NOTES</h4><p>${escapeHtml(item.buildNotes)}</p></div>` : ""}
      ${reason}
    </div>`;
}

function renderPortfolio(payload) {
  const container = $("#portfolio-grid");
  const products = payload.products || [];
  state.portfolio = products;
  container.replaceChildren();

  if (!products.length) {
    container.innerHTML = '<div class="list-empty">No portfolio products found.</div>';
    return;
  }

  products.forEach((product) => {
    const source = product.data_source || {};
    const card = document.createElement("article");
    card.className = "portfolio-card";
    card.innerHTML = `
      <div class="portfolio-card-head"><h3>${escapeHtml(product.name)}</h3><span class="status-dot" data-status="${escapeHtml(product.status || "unknown")}">${escapeHtml(product.status || "unknown")}</span></div>
      <p class="portfolio-source">${escapeHtml(source.name || "No data source recorded")}</p>
      <div class="portfolio-meta"><span>${formatCount(source.entity_count)} entities</span><span>${escapeHtml(source.update_frequency || "cadence —")}</span></div>`;
    container.append(card);
  });
}

function wireControls() {
  $("#search").addEventListener("input", (event) => {
    state.search = event.target.value;
    renderOpportunities();
  });

  $$(".filter").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      $$(".filter").forEach((candidate) => candidate.classList.toggle("active", candidate === button));
      renderOpportunities();
    });
  });
}

function renderLoadError(error) {
  console.error(error);
  $("#run-date").textContent = "Data unavailable";
  $("#opportunity-list").innerHTML = `<div class="list-empty">Could not load pipeline data. Serve this directory from the repository root or use the GitHub-hosted version.</div>`;
}

async function init() {
  wireControls();
  try {
    const [pipelineRaw, portfolioRaw] = await Promise.all([
      loadJson(["../pipeline.json", "./pipeline.json", "https://raw.githubusercontent.com/michaelcolenso/paydirt/main/pipeline.json"]),
      loadJson(["../portfolio_state.json", "./portfolio_state.json", "https://raw.githubusercontent.com/michaelcolenso/paydirt/main/portfolio_state.json"]),
    ]);
    const pipeline = normalizePipeline(pipelineRaw);
    state.opportunities = pipeline.opportunities;
    state.selectedId = state.opportunities[0]?.id || null;
    updateSummary(pipeline, portfolioRaw);
    renderOpportunities();
    renderDetail();
    renderPortfolio(portfolioRaw);
  } catch (error) {
    renderLoadError(error);
  }
}

init();
