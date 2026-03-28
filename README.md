# Opportunity Discovery Framework v2

**Last updated:** March 2026
**Purpose:** Systematic identification and scoring of profitable micro-product opportunities for a solo developer operating a portfolio of automated digital businesses.

-----

## 1. Thesis

Find datasets that are **free, public, and underserved** — then build programmatic SEO sites that surface that data in high-intent search contexts where no adequate answer currently exists. The money is in the gap between *data that exists* and *data that’s findable*.

Secondary lens: find communities where people are demonstrably spending time or money on painful manual workflows that AI/automation could collapse into a product.

-----

## 2. System Prompt

Use this as the system message when running discovery sessions against any frontier model.

```
You are a ruthless opportunity evaluator. You think like an indie hacker with a data-arbitrage thesis: free public datasets → programmatic SEO sites → monetization via ads, affiliates, or gated tooling.

You also scan for SaaS/tool opportunities where AI collapses a painful manual workflow into something a solo developer can ship in under 90 days.

YOUR EVALUATION LENS:

1. DATA SOURCE — Is there a free, structured, regularly-updated public dataset? (Government APIs, FOIA, open data portals, public filings, registries.) Score the entity count — you need 10K+ indexable pages to make pSEO viable.

2. SEARCH DEMAND — Are real humans typing queries that this data would answer? Look for long-tail patterns: "[entity] + [attribute]" queries. Use search volume signals, autocomplete patterns, People Also Ask, Reddit threads, forum posts.

3. COMPETITIVE LANDSCAPE — Who currently ranks for these queries? If it's only the raw government portal (bad UX, no SEO), aggregator sites with thin content, or nobody at all — that's a green light. If established players with strong domain authority own the SERP, move on.

4. MONETIZATION PATH — What's the revenue model? Display ads (Mediavine/Raptive threshold?), affiliate (adjacent purchase?), lead gen, freemium tool upsell? Be specific about $/visitor math.

5. BUILD COMPLEXITY — Can this ship on Cloudflare Workers + D1 + KV with a static-first architecture? One developer, 90 days max for MVP. No complex auth, no user-generated content, no real-time features for v1.

6. DEFENSIBILITY — What makes this hard to replicate? Data processing pipeline complexity, unique data joins, proprietary scoring, brand/domain authority over time.

YOUR STYLE:
- Adversarial but fair. Kill weak opportunities early.
- Money-first framing. Every opportunity needs a credible path to $1K/mo within 6 months.
- Pain signals > feature wishlists. "Spent 3 hours trying to find..." beats "would be nice if..."
- No hand-waving. Cite specific datasets, specific query patterns, specific competitors.
- No enterprise sales. No B2B with >30 day sales cycles. No markets requiring trust/credentials to enter.
```

-----

## 3. Discovery Prompt

Use this as the user message. Swap the `[DOMAIN FOCUS]` placeholder or remove it for open exploration.

```
Find 3-5 specific product opportunities matching these criteria. Focus area: [DOMAIN FOCUS or "open exploration across all domains"].

For each opportunity, provide:

<opportunity>
  <name>[Working name]</name>

  <data_source>
    Source: [Exact dataset name, URL, API endpoint]
    Format: [API / bulk download / scrape required]
    Update frequency: [Real-time / daily / monthly / annual]
    Entity count: [Approximate number of indexable entities]
    Licensing: [Public domain / open license / terms restrictions]
  </data_source>

  <search_demand>
    Primary query pattern: ["[entity] + [attribute]" template]
    Example queries: [3-5 specific queries real humans type]
    Volume signals: [Autocomplete present? PAA boxes? Reddit threads? Forum posts?]
    Intent type: [Informational / transactional / navigational]
  </search_demand>

  <competition>
    Current SERP holders: [Who ranks now, with domain authority estimate]
    SERP quality: [Are current results actually good? What's missing?]
    Vulnerability: [Why can a new entrant win?]
  </competition>

  <pain_signals>
    Direct intent: [Exact quotes or paraphrased signals — "would pay for...", "can't believe there isn't...", "wish someone would build..."]
    Indirect intent: [Frustration signals — "spent hours trying to...", "so tired of manually...", "keep having to..."]
    Source: [Where these signals were observed — Reddit, forums, X, Quora, HN]
  </pain_signals>

  <monetization>
    Primary model: [Ads / affiliate / lead gen / freemium tool / data licensing]
    Revenue math: [Estimated $/visitor × estimated monthly traffic = projected monthly revenue]
    Adjacent purchases: [What do these users also buy?]
    Upsell path: [Premium tier, API access, alerts, reports]
  </monetization>

  <build_plan>
    Stack: [Specific technical approach]
    MVP scope: [Core features only — what ships in 2-4 weeks]
    Data pipeline: [Ingestion → transformation → storage → serving]
    Pages generated: [Template types × entity count]
    Timeline: [Weeks to first indexable pages]
  </build_plan>

  <score>
    Data quality: [1-10]
    Search demand: [1-10]
    Competition gap: [1-10]
    Monetization clarity: [1-10]
    Build feasibility: [1-10]
    Defensibility: [1-10]
    COMPOSITE: [Average, with kill threshold at 5.0]
  </score>

  <risks>
    [Top 2-3 reasons this fails]
  </risks>

  <verdict>
    [BUILD / INVESTIGATE FURTHER / KILL — with one-sentence rationale]
  </verdict>
</opportunity>

DISCOVERY RULES:
- Only present opportunities scoring ≥5.0 composite.
- At least one opportunity must use a federal/state government data source.
- At least one must target a non-obvious niche (not real estate, not crypto, not generic SaaS).
- Every opportunity must have a credible path to $1K/mo within 6 months of launch.
- Kill anything requiring enterprise sales, complex auth, real-time infra, or regulatory approval.
- Cite real datasets, real URLs, real query patterns. No hypotheticals.

INTENT SIGNAL PATTERNS TO HUNT:

Direct pay-intent:
- "Would pay for..."
- "Wish someone would make..."
- "Can't believe there isn't..."
- "Take my money if..."
- "Need a better way to..."
- "Is there a tool that..."
- "I'd subscribe to..."

Indirect pain:
- "Spent hours trying to..."
- "So tired of manually..."
- "Keep having to..."
- "Frustrated with current..."
- "Hate how expensive..."
- "Why is it so hard to..."
- "Every time I need to... I have to..."

Search for these signals in: Reddit, Hacker News, X/Twitter, niche forums, Stack Exchange, Quora, Product Hunt comments, G2/Capterra reviews, GitHub issues, government data user forums.
```

-----

## 4. Validation Workflow

After initial discovery, run these follow-up prompts in sequence:

### 4a. Data Source Audit

```
For [OPPORTUNITY NAME], I need you to validate the data source:

1. Hit the API/download URL. Is it actually accessible? What auth is required?
2. What's the actual schema? List the fields available.
3. How many unique entities exist? Count or estimate.
4. What's the update latency? When was the most recent record?
5. Are there rate limits, terms of service restrictions, or attribution requirements?
6. What data cleaning/transformation is needed before it's usable?
7. Can you identify 3 "interesting joins" — other public datasets that enrich this one?

Be concrete. Show me actual API responses or data samples.
```

### 4b. SERP Audit

```
For the query pattern "[EXAMPLE QUERY]" associated with [OPPORTUNITY NAME]:

1. What currently ranks in positions 1-10?
2. For each result: domain authority estimate, content quality (1-10), UX quality (1-10)
3. Is there a featured snippet? Knowledge panel? PAA box?
4. What's the weakest result on page 1? Could a purpose-built page beat it?
5. Check 5 variations of this query pattern. Is the gap consistent?
6. Estimate monthly search volume for the primary pattern and top 10 variations.
7. What's the keyword difficulty estimate?
```

### 4c. Monetization Stress Test

```
For [OPPORTUNITY NAME], stress-test the revenue model:

1. If display ads: What RPM is realistic for this niche? (Use Mediavine/Raptive benchmarks for the vertical.)
2. If affiliate: What specific products/services would you link to? What are their commission rates?
3. If lead gen: Who's buying these leads? What do they pay per lead?
4. Model three scenarios:
   - Bear: 5K monthly organic sessions, lowest realistic RPM
   - Base: 25K monthly organic sessions, average RPM
   - Bull: 100K monthly organic sessions, optimized RPM
5. Time to Mediavine threshold (50K sessions/mo)?
6. What's the CAC for non-organic channels if SEO stalls?
```

-----

## 5. Agent Architecture

This framework is designed to run inside a single agent harness — Claude Code, Codex, or any orchestrator with tool access. The agent owns the entire pipeline. No manual model-switching. No copy-pasting between chat windows.

### 5.1 Core Principle

The orchestrator agent is the brain. It reasons through the workflow, decides what to do next, calls tools to gather evidence, scores based on what it finds, and kills or advances opportunities autonomously. The model powering the agent is interchangeable — what matters is the tool surface and the decision logic.

### 5.2 Required Tool Surface

The agent needs access to these capabilities. Most are available natively in Claude Code, Codex, or via MCP servers:

**Web & Search**

- Web search (query → results with snippets)
- Web fetch (URL → full page content)
- SERP analysis (query → ranking positions, featured snippets, PAA)

**Data Validation & Watchlist Scanning**

- HTTP requests (hit API endpoints, check status codes, inspect response schemas)
- Code execution (Python/Node — parse datasets, count entities, validate schemas, run CKAN/Socrata/Federal Register API queries)
- File system (write intermediate results, build scoring artifacts, persist scan state across runs)

**SEO Intelligence** *(via Ahrefs MCP, or web search fallback)*

- Keyword volume and difficulty estimates
- Domain authority for competing URLs
- Backlink profiles for SERP incumbents
- Content gap analysis

**Community Signal Mining**

- Reddit search / scrape
- Hacker News search
- Forum / Stack Exchange search
- X/Twitter search
- Product Hunt, G2, Capterra review search

**Output**

- Structured file output (JSON, Markdown) for scored pipeline
- GitHub integration (commit scored opportunities to a tracking repo)

### 5.3 Agent Workflow

The agent executes this as a single autonomous run. Each phase has explicit entry criteria, actions, and exit gates.

```
PHASE 0: WATCHLIST SCAN (proactive dataset discovery)
─────────────────────────────────────────────────────
Entry: Scheduled run (weekly) or manual trigger
Purpose: Surface newly-published or recently-updated government datasets
         before brainstorming — so Phase 1 starts with real leads, not guesses.

Actions:
  1. SCAN DATA.GOV CATALOG FOR NEW/UPDATED DATASETS
     → Hit the CKAN API: GET https://api.gsa.gov/technology/datagov/v3/action/package_search
       ?sort=metadata_modified+desc
       &rows=50
       &fq=metadata_modified:[{LAST_SCAN_DATE} TO NOW]
     → For each result, extract:
       - title, notes (description), organization
       - resources[] (format, url) — flag any with format=API or format=JSON/CSV
       - metadata_modified date
       - num_resources, num_tags
     → Filter to datasets with: ≥1 API or bulk-download resource,
       ≥1000 implied records (heuristic from description keywords),
       updated within last 30 days
     → Log: new_datasets.json

  2. SCAN FEDERAL REGISTER FOR NEW DATA-ADJACENT RULES/NOTICES
     → Hit: GET https://www.federalregister.gov/api/v1/documents.json
       ?conditions[publication_date][gte]={LAST_SCAN_DATE}
       &conditions[type][]=RULE
       &conditions[type][]=NOTICE
       &fields[]=title
       &fields[]=abstract
       &fields[]=agencies
       &fields[]=publication_date
       &fields[]=html_url
       &per_page=100
     → Filter to entries whose title or abstract contains:
       "data", "reporting", "disclosure", "registry", "public access",
       "transparency", "database", "records", "filing"
     → These signal new or expanded mandatory reporting = new datasets incoming
     → Log: new_regulations.json

  3. SCAN GOVINFO COLLECTIONS FOR NEW BULK DATA
     → Hit: GET https://api.govinfo.gov/collections
       ?api_key={GOVINFO_API_KEY}
     → Check for recently-added collections or updated packages in:
       CFR (Code of Federal Regulations), FR (Federal Register),
       ECFR (Electronic CFR), BUDGET, PLAW
     → Log: new_govinfo.json

  4. SCAN STATE OPEN DATA PORTALS (rotating — pick 5 states per run)
     → Most state portals use Socrata (SODA API) or CKAN
     → Socrata discovery: GET https://{portal}/api/views/metadata/v1
       ?sortBy=most_recent  (or /api/catalog/v1?order=relevance)
     → Target portals:
       - data.wa.gov (Washington — home state)
       - data.ny.gov (New York — largest)
       - data.ca.gov (California)
       - data.texas.gov (Texas)
       - data.illinois.gov (Illinois)
       + rotate through remaining ~40 state portals over 8 weeks
     → Filter same criteria: API/bulk access, large entity count, recent updates
     → Log: new_state_datasets.json

  5. SCAN SPECIALTY FEDERAL DATA SOURCES (direct API checks)
     → Check "last updated" timestamps on known high-value sources:
       - SAM.gov entity data (https://api.sam.gov)
       - NHTSA recalls (https://api.nhtsa.gov)
       - FDA adverse events (https://api.fda.gov)
       - SEC EDGAR full-text search (https://efts.sec.gov/LATEST/search-index)
       - CPSC recalls (https://www.saferproducts.gov/RestWebServices)
       - CMS provider data (https://data.cms.gov)
       - College Scorecard (https://api.data.gov/ed/collegescorecard)
       - EPA ECHO (https://echo.epa.gov/tools/web-services)
       - OSHA inspections (https://enforcedata.dol.gov/views/data_catalogs.php)
       - BLS (https://api.bls.gov/publicAPI/v2)
       - FMCSA carrier data (https://mobile.fmcsa.dot.gov/qc/services)
     → Flag any with: new endpoints, expanded fields, schema changes,
       or significant record count increases since last scan
     → Log: source_updates.json

  6. AGGREGATE AND SCORE RAW LEADS
     → Merge all logs into watchlist_leads.json
     → For each lead, auto-score (1-5) on:
       - Entity count potential (can we estimate 10K+ pages?)
       - Data format accessibility (API > CSV > PDF)
       - Topical relevance to known demand patterns
       - Novelty (brand new dataset > minor update)
     → Sort by score descending
     → Top 10 leads become seed inputs for Phase 1

Exit: watchlist_leads.json with scored raw leads
      watchlist_report.md with human-readable summary of what's new
Gate: If no leads score ≥3/5, skip to Phase 1 brainstorm-only mode
      If ≥3 leads score ≥4/5, prioritize these in Phase 1

Persistence: Save LAST_SCAN_DATE to scan_state.json for next run.
             Maintain seen_datasets.json to avoid re-processing known sources.

PHASE 1: GENERATE CANDIDATES
─────────────────────────────
Entry: Domain focus area (or "open exploration") + Phase 0 watchlist leads (if available)
Actions:
  1. If Phase 0 produced leads: start by evaluating the top 10 watchlist leads
     against the full discovery prompt criteria. Each lead gets a preliminary
     opportunity hypothesis with data source URL, 3 example queries, and
     monetization guess.
  2. Brainstorm 10-15 additional raw opportunity hypotheses using the system
     prompt + discovery prompt (fewer if Phase 0 already supplied strong leads)
  3. Deduplicate against seen_datasets.json and existing portfolio
     (RecallRadar=NHTSA, FedPurchase=micro-purchase, CollegeROI=Scorecard)
Exit: List of 15-20 raw candidates with metadata
Gate: None — all candidates advance to Phase 2

PHASE 2: QUICK KILL (binary gates)
──────────────────────────────────
Entry: Raw candidate list
Actions — for each candidate:
  1. GATE: Data accessible?
     → HTTP GET the data source URL
     → Check: returns 200? Has API docs? Bulk download available?
     → If unreachable or requires paid access → KILL

  2. GATE: Search demand exists?
     → Web search the 3 example queries
     → Check: Do results exist? Are there PAA boxes? Autocomplete suggestions?
     → If no evidence of search activity → KILL

  3. GATE: SERP is beatable?
     → Examine top 5 results for primary query
     → Check: Are they raw gov portals, thin aggregators, or forums?
     → If page 1 is dominated by high-DA purpose-built competitors → KILL

Exit: 3-7 survivors with kill/pass rationale logged
Gate: Any candidate failing any binary gate is permanently killed

PHASE 3: DEEP VALIDATION
─────────────────────────
Entry: Surviving candidates
Actions — for each survivor:

  3a. Data Source Audit
     → Fetch actual API response or download sample
     → Parse schema, count unique entities
     → Check update frequency (most recent record timestamp)
     → Identify rate limits, ToS restrictions, attribution requirements
     → Score: data_quality [1-10]

  3b. SERP Audit
     → Search 10 query variations
     → For each: log top 5 results, DA estimates, content quality
     → Check for featured snippets, knowledge panels, PAA
     → Identify weakest page-1 result as displacement target
     → If Ahrefs MCP available: pull keyword difficulty + volume
     → Score: search_demand [1-10], competition_gap [1-10]

  3c. Pain Signal Mining
     → Search Reddit, HN, forums for direct/indirect intent signals
     → Collect exact quotes with source URLs
     → Classify as direct pay-intent vs. indirect frustration
     → If <3 credible signals found → flag as weak demand
     → Score: (feeds into search_demand score)

  3d. Monetization Stress Test
     → Identify specific ad network RPM benchmarks for vertical
     → Find specific affiliate programs with commission rates
     → Model bear/base/bull revenue scenarios
     → Calculate months to $1K/mo at base-case traffic
     → Score: monetization_clarity [1-10]

  3e. Build Feasibility Assessment
     → Write pseudocode for data pipeline (ingest → transform → store → serve)
     → Estimate pages generated (template types × entity count)
     → Identify technical risks (data cleaning complexity, schema instability)
     → Score: build_feasibility [1-10]

  3f. Defensibility Assessment
     → Evaluate: unique data joins, processing complexity, brand moat potential
     → Check if competitor could replicate in <30 days
     → Score: defensibility [1-10]

Exit: Each survivor has a completed <opportunity> block with all 6 scores
Gate: Composite score <5.0 → KILL

PHASE 4: RANK AND DECIDE
─────────────────────────
Entry: Scored survivors
Actions:
  1. Calculate composite score (average of 6 dimensions)
  2. Rank opportunities by composite score
  3. For each, assign verdict:
     - Composite ≥7.0 → BUILD (write agentic build spec)
     - Composite 5.0-6.9 → BACKLOG (revisit in 30 days)
     - Composite <5.0 → KILL
  4. Write final output:
     - pipeline.json — machine-readable scored pipeline
     - pipeline-report.md — human-readable summary with verdicts
     - For BUILD verdicts: generate skeleton build-instruction doc

Exit: Artifacts committed to repo or output directory
```

### 5.4 Agent Instructions (paste into harness)

This is the meta-prompt you give the agent harness to kick off a run:

```
You are executing the Opportunity Discovery Framework. Your job is to autonomously find, validate, and score product opportunities following the pipeline defined below.

CONSTRAINTS:
- You have tool access: web search, web fetch, HTTP requests, code execution, file system.
- Run the entire pipeline without asking me questions. Make judgment calls.
- If a tool call fails, retry once with modified parameters, then log the failure and move on.
- Kill aggressively. It's better to surface 2 strong opportunities than 5 mediocre ones.
- Every claim must be backed by evidence from a tool call. No hallucinated datasets, no estimated volumes without search evidence, no assumed competitors.

PHASE 0 — WATCHLIST SCAN:
- Before brainstorming, scan for newly-published datasets using the data.gov CKAN API, Federal Register API, and specialty source APIs defined in the Phase 0 spec.
- Check scan_state.json for LAST_SCAN_DATE. If missing, use 30 days ago.
- Write watchlist_leads.json and watchlist_report.md to the working directory.
- Feed high-scoring leads into Phase 1 as seed candidates.
- Update scan_state.json with today's date when complete.

OUTPUT:
- Write watchlist_leads.json and watchlist_report.md (Phase 0 output).
- Write pipeline.json to the working directory with the full scored pipeline.
- Write pipeline-report.md with human-readable verdicts.
- For any BUILD verdict, write a skeleton build-instruction doc.

DOMAIN FOCUS: [DOMAIN FOCUS or "open exploration"]

[PASTE SYSTEM PROMPT FROM SECTION 2]
[PASTE DISCOVERY PROMPT FROM SECTION 3]
[PASTE VALIDATION PROMPTS FROM SECTION 4]

Begin.
```

### 5.5 Harness-Specific Notes

**Claude Code:** Native tool access to web search, web fetch, bash, file system. Can hit APIs directly via `curl` or Python `requests`. Ahrefs MCP available if connected. This is the default harness — the framework runs as-is.

**OpenAI Codex:** Similar tool surface. Uses `computer use` for browser-based validation. Structured outputs API can enforce the `<opportunity>` schema as JSON. Collapse system + user prompt into a single message for o3-backed agents.

**Custom harness (Python/Node orchestrator):** Implement the Phase 2-4 logic as a state machine. Each phase is a function that takes candidates in and returns survivors + kill log. Model calls are abstracted behind an LLM client interface — swap models without changing workflow logic. Use a cheap model (Sonnet, Flash, GPT-4o) for Phase 2 binary gates, frontier model for Phase 3 deep validation.

**Multi-model routing (advanced):** If your harness supports model routing, the cost-optimal pattern is:

- Phase 1 (generation): frontier model — needs creative breadth
- Phase 2 (binary gates): cheapest model with tool access — these are yes/no checks
- Phase 3 (deep validation): frontier model — needs nuanced scoring
- Phase 4 (ranking): any model — arithmetic and formatting

This is an optimization, not a requirement. A single frontier model running the whole pipeline works fine and is simpler to debug.

-----

## 6. Domain Focus Areas Worth Scanning

These are high-probability hunting grounds for the data-arbitrage thesis:

- **Federal procurement** — SAM.gov, FPDS, USAspending gaps, micro-purchase data
- **Regulatory filings** — SEC EDGAR, state-level corporate filings, professional license registries
- **Education outcomes** — College Scorecard, IPEDS, state-level teacher/school data
- **Consumer safety** — NHTSA recalls, CPSC, FDA adverse events, food inspection scores
- **Environmental / permits** — EPA TRI, state DEQ, building permit data, air quality
- **Healthcare transparency** — CMS provider data, hospital pricing, Medicare spending
- **Labor / employment** — BLS OEWS, H-1B disclosure, OSHA inspection data
- **Real property** — County assessor data, zoning records, property tax rolls
- **Transportation** — FAA, FMCSA carrier data, state DMV records, bridge inspection data
- **Courts / legal** — PACER, state court records, lien filings, UCC filings

For non-pSEO (tool/SaaS) opportunities, hunt in:

- **Niche professional workflows** — appraisers, adjusters, inspectors, notaries, court reporters
- **Hobbyist communities with spend** — aquariums, woodworking, ham radio, genealogy, astrophotography
- **Small-business back-office pain** — contractor compliance, permit tracking, fleet management, inventory for micro-retailers

-----

## 7. Anti-Patterns (Kill Signals)

Immediately disqualify any opportunity that:

- Requires enterprise sales or contracts with >30-day cycles
- Depends on user-generated content for value (cold-start problem)
- Needs real-time data infrastructure for v1
- Competes directly with a well-funded vertical SaaS incumbent
- Has no clear query pattern (users don’t search for it)
- Requires regulatory approval, professional credentials, or liability exposure
- Has <5,000 potential indexable pages (too small for pSEO)
- Monetizes only via a product you’d also have to build (double build problem)
- Depends on a single data source that could be paywalled or deprecated
- Targets a market where the user’s willingness to pay is unproven and unobservable

-----

## 8. Portfolio State (`portfolio_state.json`)

The agent loads this file at the start of every run. It prevents cannibalization, enables cross-product synergy detection, and grounds the agent in what already exists.

### Schema

```json
{
  "last_updated": "2026-03-28",
  "products": [
    {
      "name": "RecallRadar",
      "status": "active",
      "domain": "recallradar.com",
      "repo": "github.com/michaelcolenso/recallradar",
      "data_source": {
        "name": "NHTSA Recalls API",
        "url": "https://api.nhtsa.gov/recalls",
        "entity_type": "vehicle recall",
        "entity_count": 30000,
        "update_frequency": "daily"
      },
      "query_patterns": [
        "[year] [make] [model] recalls",
        "[make] [model] recall history",
        "is my [make] [model] recalled"
      ],
      "stack": "Cloudflare Workers, Hono, D1, KV",
      "monetization": "display ads, affiliate (auto parts)",
      "monthly_traffic": null,
      "monthly_revenue": null,
      "launch_date": null,
      "notes": "Build spec complete. Pre-launch."
    },
    {
      "name": "FedPurchase",
      "status": "active",
      "domain": null,
      "repo": "github.com/michaelcolenso/fedpurchase",
      "data_source": {
        "name": "Federal micro-purchase card transaction data",
        "url": "https://sam.gov",
        "entity_type": "micro-purchase transaction",
        "entity_count": null,
        "update_frequency": "quarterly",
        "notes": "FAR micro-purchase threshold changed from $10K to $15K effective Oct 2025"
      },
      "query_patterns": [
        "[agency] micro-purchase spending",
        "federal purchase card transactions [agency]",
        "government micro-purchases [category]"
      ],
      "stack": "Cloudflare Workers, Hono, D1, KV",
      "monetization": "display ads, lead gen (gov contractors)",
      "monthly_traffic": null,
      "monthly_revenue": null,
      "launch_date": null,
      "notes": "Threshold update needed. pSEO site surfacing data outside FPDS/USAspending."
    },
    {
      "name": "CollegeROI",
      "status": "planning",
      "domain": null,
      "repo": null,
      "data_source": {
        "name": "College Scorecard API",
        "url": "https://api.data.gov/ed/collegescorecard",
        "entity_type": "institution × major outcome",
        "entity_count": 200000,
        "update_frequency": "annual"
      },
      "query_patterns": [
        "[major] salary at [school]",
        "is [major] worth it at [school]",
        "[school] [major] earnings after graduation"
      ],
      "stack": "Cloudflare Workers, Hono, D1, KV",
      "monetization": "display ads, affiliate (student loans, test prep)",
      "monthly_traffic": null,
      "monthly_revenue": null,
      "launch_date": null,
      "notes": "Domain candidates: majorroi.com, worththedegree.com. Build spec exists."
    }
  ],
  "reserved_data_sources": [
    "NHTSA Recalls API",
    "Federal micro-purchase card data",
    "College Scorecard API"
  ],
  "reserved_query_spaces": [
    "vehicle recalls",
    "federal micro-purchase spending",
    "college major ROI / earnings by school"
  ]
}
```

### Agent Usage Rules

The agent MUST load `portfolio_state.json` and follow these rules:

1. **No cannibalization:** Never recommend an opportunity whose primary query patterns overlap with `reserved_query_spaces`. If a candidate targets the same SERP territory as an existing product, KILL it.
1. **No duplicate data sources:** Never recommend an opportunity whose primary data source is in `reserved_data_sources`. Adjacent data from the same agency is fine (e.g., NHTSA complaints are different from NHTSA recalls).
1. **Synergy detection:** When scoring an opportunity, check if its data could be joined with any existing product’s data source to create compound value. Flag these explicitly in the opportunity block:
- Cross-link potential (e.g., a vehicle complaints site linking to RecallRadar recall pages)
- Shared audience (users who search for X also search for Y)
- Data enrichment (one dataset adds context to another)
- Shared infrastructure (same stack, same deployment pattern, shared components)
1. **Portfolio balance:** Prefer opportunities that diversify across:
- Traffic source (don’t over-index on Google organic — consider direct, social, referral)
- Monetization model (if all 3 existing products are display ads, prefer affiliate or tool upsell)
- Data update frequency (mix of daily, monthly, annual to distribute maintenance load)
- Audience (government contractors, consumers, students are the current three — add a new segment)
1. **Status tracking:** After a BUILD verdict, the agent should append the new opportunity to `portfolio_state.json` with `status: "planning"` and populate the schema.

-----

## 9. Standalone Watchlist Scanner

Phase 0 can run independently of the full pipeline as a scheduled job. See `watchlist_scanner.py` — a standalone Python script designed for:

- **GitHub Actions:** Weekly cron, commits `watchlist_leads.json` and `watchlist_report.md` to your tracking repo
- **Cloudflare Workers (scheduled):** Convert to a Worker with KV-backed state persistence
- **Local cron:** `0 9 * * 1 python watchlist_scanner.py` (Monday 9am)

The scanner accumulates leads between full pipeline runs. When you kick off a discovery session, the agent reads `watchlist_leads.json` as seed input for Phase 1.

-----

*Framework version 2.3 — designed for autonomous agent execution with proactive dataset discovery and portfolio-aware scoring. One orchestrator, one pipeline, zero manual model-switching. Core thesis: the opportunity isn’t building AI, it’s building the interface between public data and human search intent.*
