"""
Opportunity Discovery Framework — Phase 0 Watchlist Scanner
Standalone script for proactive dataset discovery.

Run weekly via cron, GitHub Actions, or manually.
Scans government data portals for newly-published or updated datasets
and outputs scored leads for the full discovery pipeline.

Usage:
    python watchlist_scanner.py [--state-dir ./state] [--output-dir ./output] [--verbose]

Environment variables:
    DATAGOV_API_KEY     — api.gsa.gov key (get free at https://api.data.gov/signup/)
    GOVINFO_API_KEY     — govinfo.gov key (get free at https://api.govinfo.gov/docs)

Both are optional — the scanner will skip those sources if keys are missing.
"""

import argparse
import json
import logging
import os
import sys
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import urlencode

import httpx

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DATAGOV_API_KEY = os.getenv("DATAGOV_API_KEY", "")
GOVINFO_API_KEY = os.getenv("GOVINFO_API_KEY", "")

REQUEST_TIMEOUT = 30  # seconds
MAX_RETRIES = 1

# Federal Register filter terms — presence in a rule/notice title or abstract
# signals that a new or expanded mandatory reporting requirement is coming,
# which means a new dataset is likely incoming.
FR_SIGNAL_TERMS = [
    "data", "reporting", "disclosure", "registry", "public access",
    "transparency", "database", "records", "filing", "information collection",
    "electronic submission", "machine-readable", "open data",
]

# Specialty federal API endpoints to check for freshness
SPECIALTY_SOURCES = [
    {
        "name": "NHTSA Recalls",
        "check_url": "https://api.nhtsa.gov/recalls/recallsByMake?make=toyota",
        "reserved": True,
    },
    {
        "name": "FDA Adverse Events (Drugs)",
        "check_url": "https://api.fda.gov/drug/event.json?limit=1&sort=receivedate:desc",
        "reserved": False,
    },
    {
        "name": "FDA Adverse Events (Devices)",
        "check_url": "https://api.fda.gov/device/event.json?limit=1&sort=date_received:desc",
        "reserved": False,
    },
    {
        "name": "CPSC Recalls",
        "check_url": "https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=2026-01-01",
        "reserved": False,
    },
    {
        "name": "College Scorecard",
        "check_url": f"https://api.data.gov/ed/collegescorecard/v1/schools.json?api_key={DATAGOV_API_KEY}&per_page=1&fields=id,school.name" if DATAGOV_API_KEY else None,
        "reserved": True,
    },
    {
        "name": "EPA ECHO",
        "check_url": "https://echo.epa.gov/api/echo_rest_services.metadata?output=JSON",
        "reserved": False,
    },
    {
        "name": "BLS Public Data",
        "check_url": "https://api.bls.gov/publicAPI/v2/timeseries/data/LNS14000000",
        "reserved": False,
    },
    {
        "name": "SEC EDGAR Full-Text Search",
        "check_url": "https://efts.sec.gov/LATEST/search-index?q=%22annual+report%22&forms=10-K",
        "reserved": False,
    },
]

# State open data portals (Socrata-based). Rotate 5 per run.
STATE_PORTALS = [
    {"name": "Washington", "domain": "data.wa.gov"},
    {"name": "New York", "domain": "data.ny.gov"},
    {"name": "California", "domain": "data.ca.gov"},
    {"name": "Texas", "domain": "data.texas.gov"},
    {"name": "Illinois", "domain": "data.illinois.gov"},
    {"name": "Michigan", "domain": "data.michigan.gov"},
    {"name": "Georgia", "domain": "data.georgia.gov"},
    {"name": "Colorado", "domain": "data.colorado.gov"},
    {"name": "Oregon", "domain": "data.oregon.gov"},
    {"name": "Pennsylvania", "domain": "data.pa.gov"},
    {"name": "Massachusetts", "domain": "data.mass.gov"},
    {"name": "Virginia", "domain": "data.virginia.gov"},
    {"name": "Ohio", "domain": "data.ohio.gov"},
    {"name": "Minnesota", "domain": "data.mn.gov"},  # may differ
    {"name": "Connecticut", "domain": "data.ct.gov"},
]

PORTALS_PER_RUN = 5

# Reserved data sources from portfolio — skip these
RESERVED_SOURCE_NAMES = [
    "nhtsa",
    "micro-purchase",
    "college scorecard",
    "collegescorecard",
]

# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class Lead:
    source_scanner: str  # which scanner found it
    title: str
    description: str
    data_url: str
    organization: str
    format_types: list[str] = field(default_factory=list)
    last_updated: str = ""
    entity_count_estimate: Optional[int] = None
    score_entity_potential: int = 0      # 1-5
    score_format_accessibility: int = 0  # 1-5
    score_topical_relevance: int = 0     # 1-5
    score_novelty: int = 0              # 1-5
    composite_score: float = 0.0
    is_reserved: bool = False
    notes: str = ""


# ---------------------------------------------------------------------------
# HTTP helper
# ---------------------------------------------------------------------------

def fetch_json(
    client: httpx.Client,
    url: str,
    params: Optional[dict] = None,
    headers: Optional[dict] = None,
    label: str = "",
) -> Optional[dict | list]:
    """GET a URL, return parsed JSON or None on failure."""
    try:
        resp = client.get(url, params=params, headers=headers, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPStatusError as e:
        logging.warning(f"[{label}] HTTP {e.response.status_code} for {url}")
    except httpx.RequestError as e:
        logging.warning(f"[{label}] Request failed for {url}: {e}")
    except json.JSONDecodeError:
        logging.warning(f"[{label}] Non-JSON response from {url}")
    return None


# ---------------------------------------------------------------------------
# Scanners
# ---------------------------------------------------------------------------

def scan_datagov(client: httpx.Client, since: str) -> list[Lead]:
    """Scan data.gov CKAN API for recently modified datasets."""
    if not DATAGOV_API_KEY:
        logging.info("[data.gov] No DATAGOV_API_KEY set, skipping.")
        return []

    logging.info(f"[data.gov] Scanning for datasets modified since {since}...")
    url = "https://api.gsa.gov/technology/datagov/v3/action/package_search"
    params = {
        "sort": "metadata_modified desc",
        "rows": 50,
        "fq": f"metadata_modified:[{since}T00:00:00Z TO NOW]",
    }
    headers = {"x-api-key": DATAGOV_API_KEY}

    data = fetch_json(client, url, params=params, headers=headers, label="data.gov")
    if not data:
        # Fallback: try without date filter
        logging.info("[data.gov] Trying without date filter...")
        params.pop("fq")
        data = fetch_json(client, url, params=params, headers=headers, label="data.gov-fallback")

    if not data or "result" not in data:
        logging.warning("[data.gov] No results returned.")
        return []

    results = data.get("result", {}).get("results", [])
    logging.info(f"[data.gov] Found {len(results)} datasets.")

    leads = []
    for ds in results:
        resources = ds.get("resources", [])
        formats = list({r.get("format", "").upper() for r in resources if r.get("format")})
        has_api = any(f in ("API", "JSON", "CSV", "GEOJSON") for f in formats)
        if not has_api:
            continue

        title = ds.get("title", "Untitled")
        desc = ds.get("notes", "") or ""
        org = ds.get("organization", {}).get("title", "Unknown") if ds.get("organization") else "Unknown"
        modified = ds.get("metadata_modified", "")
        url_val = ds.get("url", "") or ""
        if not url_val and resources:
            url_val = resources[0].get("url", "")

        lead = Lead(
            source_scanner="data.gov",
            title=title,
            description=desc[:500],
            data_url=url_val,
            organization=org,
            format_types=formats,
            last_updated=modified[:10] if modified else "",
        )
        leads.append(lead)

    return leads


def scan_federal_register(client: httpx.Client, since: str) -> list[Lead]:
    """Scan Federal Register for new rules/notices signaling upcoming datasets."""
    logging.info(f"[FedReg] Scanning for data-adjacent rules/notices since {since}...")

    url = "https://www.federalregister.gov/api/v1/documents.json"
    params = {
        "conditions[publication_date][gte]": since,
        "conditions[type][]": ["RULE", "NOTICE"],
        "fields[]": ["title", "abstract", "agencies", "publication_date", "html_url", "type"],
        "per_page": 100,
        "order": "newest",
    }

    data = fetch_json(client, url, params=params, label="FedReg")
    if not data or "results" not in data:
        logging.warning("[FedReg] No results returned.")
        return []

    results = data.get("results", [])
    logging.info(f"[FedReg] Retrieved {len(results)} documents, filtering for data signals...")

    leads = []
    for doc in results:
        title = doc.get("title", "")
        abstract = doc.get("abstract", "") or ""
        combined = f"{title} {abstract}".lower()

        # Check for signal terms
        matching_terms = [t for t in FR_SIGNAL_TERMS if t in combined]
        if len(matching_terms) < 2:
            continue  # Require at least 2 signal terms to reduce noise

        agencies = doc.get("agencies", [])
        agency_names = ", ".join(a.get("name", "") for a in agencies) if agencies else "Unknown"
        pub_date = doc.get("publication_date", "")
        html_url = doc.get("html_url", "")
        doc_type = doc.get("type", "")

        lead = Lead(
            source_scanner="federal_register",
            title=f"[{doc_type}] {title}",
            description=abstract[:500] if abstract else title,
            data_url=html_url,
            organization=agency_names,
            format_types=["regulation"],
            last_updated=pub_date,
            notes=f"Signal terms: {', '.join(matching_terms)}",
        )
        leads.append(lead)

    logging.info(f"[FedReg] {len(leads)} data-adjacent documents found.")
    return leads


def scan_govinfo(client: httpx.Client, since: str) -> list[Lead]:
    """Scan govinfo collections API for recently updated packages."""
    if not GOVINFO_API_KEY:
        logging.info("[govinfo] No GOVINFO_API_KEY set, skipping.")
        return []

    logging.info(f"[govinfo] Scanning for updated collections since {since}...")

    target_collections = ["FR", "CFR", "ECFR", "BUDGET", "PLAW", "COMPS"]
    leads = []

    for coll in target_collections:
        url = f"https://api.govinfo.gov/collections/{coll}/{since}T00:00:00Z"
        params = {"pageSize": 10, "offsetMark": "*", "api_key": GOVINFO_API_KEY}
        data = fetch_json(client, url, params=params, label=f"govinfo-{coll}")

        if not data:
            continue

        count = data.get("count", 0)
        if count > 0:
            packages = data.get("packages", [])
            lead = Lead(
                source_scanner="govinfo",
                title=f"govinfo/{coll}: {count} updated packages",
                description=f"{count} packages updated since {since} in the {coll} collection.",
                data_url=f"https://api.govinfo.gov/collections/{coll}",
                organization="GPO / govinfo",
                format_types=["XML", "PDF", "JSON"],
                last_updated=datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                notes=f"Sample package IDs: {', '.join(p.get('packageId', '') for p in packages[:3])}",
            )
            leads.append(lead)

    logging.info(f"[govinfo] {len(leads)} collections with updates found.")
    return leads


def scan_state_portals(client: httpx.Client, since: str, rotation_index: int) -> list[Lead]:
    """Scan a rotating set of state Socrata portals for new datasets."""
    start = (rotation_index * PORTALS_PER_RUN) % len(STATE_PORTALS)
    batch = STATE_PORTALS[start:start + PORTALS_PER_RUN]
    # Wrap around if needed
    if len(batch) < PORTALS_PER_RUN:
        batch += STATE_PORTALS[:PORTALS_PER_RUN - len(batch)]

    logging.info(f"[State portals] Scanning: {', '.join(p['name'] for p in batch)}")

    leads = []
    for portal in batch:
        domain = portal["domain"]
        state = portal["name"]

        # Socrata discovery API — filter by this portal's domain
        url = f"https://{domain}/api/catalog/v1"
        params = {
            "order": "updatedAt",
            "limit": 20,
            "domains": domain,
        }

        data = fetch_json(client, url, params=params, label=f"state-{state}")
        if not data or "results" not in data:
            # Fallback: try the metadata endpoint
            url_alt = f"https://{domain}/api/views/metadata/v1"
            data_alt = fetch_json(client, url_alt, label=f"state-{state}-alt")
            if not data_alt:
                logging.warning(f"[State: {state}] Portal unreachable or non-Socrata.")
                continue
            # Metadata endpoint returns a list directly
            if isinstance(data_alt, list):
                for item in data_alt[:10]:
                    name = item.get("name", "Untitled")
                    desc = item.get("description", "") or ""
                    updated = item.get("updatedAt", "")
                    uid = item.get("id", "")
                    lead = Lead(
                        source_scanner=f"state_{state.lower()}",
                        title=f"[{state}] {name}",
                        description=desc[:500],
                        data_url=f"https://{domain}/d/{uid}" if uid else f"https://{domain}",
                        organization=f"{state} State Government",
                        format_types=["Socrata/CSV/JSON"],
                        last_updated=updated[:10] if updated else "",
                    )
                    leads.append(lead)
            continue

        results = data.get("results", [])
        for item in results:
            resource = item.get("resource", {})
            name = resource.get("name", "Untitled")
            desc = resource.get("description", "") or ""
            updated = resource.get("updatedAt", "") or resource.get("data_updated_at", "")
            uid = resource.get("id", "")
            link = item.get("link", f"https://{domain}/d/{uid}")
            col_count = resource.get("columns_field_name", [])

            lead = Lead(
                source_scanner=f"state_{state.lower()}",
                title=f"[{state}] {name}",
                description=desc[:500],
                data_url=link,
                organization=f"{state} State Government",
                format_types=["Socrata/CSV/JSON"],
                last_updated=updated[:10] if updated else "",
                notes=f"Columns: {len(col_count)}" if col_count else "",
            )
            leads.append(lead)

    logging.info(f"[State portals] {len(leads)} datasets found across {len(batch)} portals.")
    return leads


def scan_specialty_sources(client: httpx.Client) -> list[Lead]:
    """Ping specialty federal APIs to check for freshness / availability."""
    logging.info("[Specialty] Checking known federal API endpoints...")

    leads = []
    for src in SPECIALTY_SOURCES:
        url = src.get("check_url")
        if not url:
            continue

        name = src["name"]
        is_reserved = src.get("reserved", False)

        data = fetch_json(client, url, label=f"specialty-{name}")
        if data is None:
            lead = Lead(
                source_scanner="specialty",
                title=f"[DOWN/CHANGED] {name}",
                description=f"API endpoint returned error or is unreachable: {url}",
                data_url=url,
                organization=name.split()[0],
                is_reserved=is_reserved,
                notes="ENDPOINT UNREACHABLE — may have moved, may be new auth required.",
            )
            leads.append(lead)
        else:
            # Successfully hit — log as alive with timestamp
            lead = Lead(
                source_scanner="specialty",
                title=f"[ALIVE] {name}",
                description=f"API endpoint responding normally.",
                data_url=url,
                organization=name.split()[0],
                last_updated=datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                is_reserved=is_reserved,
                notes="Healthy. Check for schema changes or new endpoints separately.",
            )
            leads.append(lead)

    return leads


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def score_lead(lead: Lead, seen_titles: set[str]) -> Lead:
    """Auto-score a lead on 4 dimensions (1-5 each)."""
    desc_lower = f"{lead.title} {lead.description}".lower()

    # Entity count potential (heuristic from description keywords)
    entity_signals = ["records", "entries", "facilities", "permits", "inspections",
                      "transactions", "complaints", "incidents", "licenses", "cases",
                      "providers", "schools", "companies", "businesses", "properties"]
    entity_hits = sum(1 for s in entity_signals if s in desc_lower)
    lead.score_entity_potential = min(5, max(1, entity_hits + 1))

    # Format accessibility
    format_str = " ".join(lead.format_types).upper()
    if "API" in format_str or "JSON" in format_str:
        lead.score_format_accessibility = 5
    elif "CSV" in format_str or "SOCRATA" in format_str:
        lead.score_format_accessibility = 4
    elif "XML" in format_str:
        lead.score_format_accessibility = 3
    elif "regulation" in format_str.lower():
        lead.score_format_accessibility = 2  # not a dataset yet, just a signal
    else:
        lead.score_format_accessibility = 2

    # Topical relevance (does it match high-value verticals?)
    high_value_terms = ["safety", "recall", "inspection", "health", "violation",
                        "spending", "procurement", "license", "permit", "complaint",
                        "price", "cost", "salary", "outcome", "rating", "score",
                        "environmental", "pollution", "enforcement", "penalty"]
    relevance_hits = sum(1 for t in high_value_terms if t in desc_lower)
    lead.score_topical_relevance = min(5, max(1, relevance_hits))

    # Novelty
    if lead.title in seen_titles:
        lead.score_novelty = 1
    elif lead.source_scanner == "federal_register":
        lead.score_novelty = 4  # regulatory signals are forward-looking
    elif lead.last_updated:
        try:
            updated = datetime.strptime(lead.last_updated[:10], "%Y-%m-%d")
            days_old = (datetime.now() - updated).days
            if days_old <= 7:
                lead.score_novelty = 5
            elif days_old <= 30:
                lead.score_novelty = 4
            elif days_old <= 90:
                lead.score_novelty = 3
            else:
                lead.score_novelty = 2
        except ValueError:
            lead.score_novelty = 2
    else:
        lead.score_novelty = 2

    # Check if reserved
    for reserved_name in RESERVED_SOURCE_NAMES:
        if reserved_name in desc_lower:
            lead.is_reserved = True
            break

    # Composite
    lead.composite_score = round(
        (lead.score_entity_potential
         + lead.score_format_accessibility
         + lead.score_topical_relevance
         + lead.score_novelty) / 4,
        2,
    )

    return lead


# ---------------------------------------------------------------------------
# State management
# ---------------------------------------------------------------------------

def load_state(state_dir: Path) -> dict:
    state_file = state_dir / "scan_state.json"
    if state_file.exists():
        with open(state_file) as f:
            return json.load(f)
    return {}


def save_state(state_dir: Path, state: dict):
    state_dir.mkdir(parents=True, exist_ok=True)
    state_file = state_dir / "scan_state.json"
    with open(state_file, "w") as f:
        json.dump(state, f, indent=2)


def load_seen(state_dir: Path) -> set[str]:
    seen_file = state_dir / "seen_datasets.json"
    if seen_file.exists():
        with open(seen_file) as f:
            return set(json.load(f))
    return set()


def save_seen(state_dir: Path, seen: set[str]):
    state_dir.mkdir(parents=True, exist_ok=True)
    seen_file = state_dir / "seen_datasets.json"
    # Keep last 5000 to prevent unbounded growth
    seen_list = sorted(seen)[-5000:]
    with open(seen_file, "w") as f:
        json.dump(seen_list, f, indent=2)


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------

def generate_report(leads: list[Lead], since: str) -> str:
    """Generate a human-readable markdown report."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        f"# Watchlist Scanner Report",
        f"",
        f"**Scan date:** {now}",
        f"**Looking back to:** {since}",
        f"**Total leads found:** {len(leads)}",
        f"**Leads scoring ≥3.0:** {sum(1 for l in leads if l.composite_score >= 3.0)}",
        f"**Leads scoring ≥4.0:** {sum(1 for l in leads if l.composite_score >= 4.0)}",
        "",
        "---",
        "",
    ]

    # Top leads
    actionable = [l for l in leads if l.composite_score >= 3.0 and not l.is_reserved]
    reserved = [l for l in leads if l.is_reserved]

    if actionable:
        lines.append("## Top Leads (score ≥ 3.0, not reserved)")
        lines.append("")
        for i, lead in enumerate(actionable[:15], 1):
            lines.append(f"### {i}. {lead.title}")
            lines.append(f"- **Score:** {lead.composite_score} "
                         f"(entity={lead.score_entity_potential}, "
                         f"format={lead.score_format_accessibility}, "
                         f"relevance={lead.score_topical_relevance}, "
                         f"novelty={lead.score_novelty})")
            lines.append(f"- **Source scanner:** {lead.source_scanner}")
            lines.append(f"- **Organization:** {lead.organization}")
            lines.append(f"- **Formats:** {', '.join(lead.format_types)}")
            lines.append(f"- **Last updated:** {lead.last_updated or 'unknown'}")
            lines.append(f"- **URL:** {lead.data_url}")
            if lead.notes:
                lines.append(f"- **Notes:** {lead.notes}")
            if lead.description:
                desc = lead.description[:300]
                lines.append(f"- **Description:** {desc}...")
            lines.append("")
    else:
        lines.append("## No actionable leads scoring ≥ 3.0 this scan.")
        lines.append("")

    if reserved:
        lines.append("## Reserved Sources (already in portfolio)")
        lines.append("")
        for lead in reserved:
            lines.append(f"- {lead.title} — {lead.notes or 'status check'}")
        lines.append("")

    # Scanner summary
    scanners = {}
    for lead in leads:
        scanners[lead.source_scanner] = scanners.get(lead.source_scanner, 0) + 1
    lines.append("## Scanner Summary")
    lines.append("")
    for scanner, count in sorted(scanners.items()):
        lines.append(f"- **{scanner}:** {count} leads")
    lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Opportunity Discovery — Phase 0 Watchlist Scanner")
    parser.add_argument("--state-dir", type=str, default="./state", help="Directory for persistent state files")
    parser.add_argument("--output-dir", type=str, default="./output", help="Directory for output files")
    parser.add_argument("--lookback-days", type=int, default=30, help="Default lookback if no prior scan state")
    parser.add_argument("--verbose", action="store_true", help="Enable debug logging")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    state_dir = Path(args.state_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Load state
    state = load_state(state_dir)
    seen = load_seen(state_dir)

    last_scan = state.get("last_scan_date")
    if last_scan:
        since = last_scan
    else:
        since = (datetime.now(timezone.utc) - timedelta(days=args.lookback_days)).strftime("%Y-%m-%d")

    rotation_index = state.get("rotation_index", 0)

    logging.info(f"Starting watchlist scan. Looking back to: {since}")
    logging.info(f"State portal rotation index: {rotation_index}")

    all_leads: list[Lead] = []

    with httpx.Client(follow_redirects=True) as client:
        # 1. data.gov
        all_leads.extend(scan_datagov(client, since))

        # 2. Federal Register
        all_leads.extend(scan_federal_register(client, since))

        # 3. govinfo
        all_leads.extend(scan_govinfo(client, since))

        # 4. State portals (rotating)
        all_leads.extend(scan_state_portals(client, since, rotation_index))

        # 5. Specialty sources
        all_leads.extend(scan_specialty_sources(client))

    logging.info(f"Total raw leads: {len(all_leads)}")

    # Score all leads
    for lead in all_leads:
        score_lead(lead, seen)

    # Sort by composite score descending
    all_leads.sort(key=lambda l: l.composite_score, reverse=True)

    # Write outputs
    leads_data = [asdict(l) for l in all_leads]
    leads_file = output_dir / "watchlist_leads.json"
    with open(leads_file, "w") as f:
        json.dump(leads_data, f, indent=2)
    logging.info(f"Wrote {len(leads_data)} leads to {leads_file}")

    report = generate_report(all_leads, since)
    report_file = output_dir / "watchlist_report.md"
    with open(report_file, "w") as f:
        f.write(report)
    logging.info(f"Wrote report to {report_file}")

    # Update state
    new_state = {
        "last_scan_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "rotation_index": rotation_index + 1,
        "last_lead_count": len(all_leads),
        "last_actionable_count": sum(1 for l in all_leads if l.composite_score >= 3.0 and not l.is_reserved),
    }
    save_state(state_dir, new_state)

    # Update seen set
    for lead in all_leads:
        seen.add(lead.title)
    save_seen(state_dir, seen)

    # Summary
    actionable = sum(1 for l in all_leads if l.composite_score >= 3.0 and not l.is_reserved)
    high_value = sum(1 for l in all_leads if l.composite_score >= 4.0 and not l.is_reserved)
    logging.info(f"Done. {actionable} actionable leads (≥3.0), {high_value} high-value (≥4.0).")

    if high_value > 0:
        logging.info("HIGH-VALUE LEADS DETECTED — consider running the full discovery pipeline.")


if __name__ == "__main__":
    main()
