#!/usr/bin/env python3
"""Generate idempotent SQL that imports Paydirt's legacy JSON artifacts into D1.

Usage:
    python scripts/import_legacy.py > .paydirt-legacy-import.sql
    npx wrangler d1 execute paydirt --local --file=.paydirt-legacy-import.sql

The importer never treats a legacy BUILD verdict as a human approval. Imported
opportunities remain SCORED; recommendations are preserved separately.
"""
from __future__ import annotations

import hashlib
import json
import uuid
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
NS = uuid.UUID("0b76ac19-b153-48b3-9ea8-f46cb3663cbc")


def uid(kind: str, value: str) -> str:
    return str(uuid.uuid5(NS, f"{kind}:{value.strip().lower()}"))


def q(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def load(path: str, default: Any) -> Any:
    p = ROOT / path
    if not p.exists():
        return default
    return json.loads(p.read_text())


def recommendation(value: str | None) -> str:
    raw = (value or "").upper()
    return {"BUILD": "BUILD_RECOMMENDED", "BACKLOG": "BACKLOG", "KILL": "KILL_RECOMMENDED"}.get(raw, "UNSCORED")


def emit(sql: str) -> None:
    print(sql.rstrip(";") + ";")


def source(name: str, kind: str, url: str | None = None) -> str:
    sid = uid("source", name)
    emit(f"INSERT OR IGNORE INTO sources (id,name,kind,url) VALUES ({q(sid)},{q(name)},{q(kind)},{q(url)})")
    return sid


def import_leads() -> None:
    payload = load("output/watchlist_leads.json", [])
    leads = payload if isinstance(payload, list) else payload.get("leads", [])
    for item in leads:
        source_name = item.get("source_scanner") or "legacy scanner"
        sid = source(source_name, "scanner")
        title = item.get("title") or "Untitled dataset"
        lid = uid("lead", f"{source_name}|{title}|{item.get('data_url','')}")
        formats = json.dumps(item.get("format_types") or [])
        emit(
            "INSERT OR IGNORE INTO leads "
            "(id,source_id,title,description,data_url,organization,formats_json,observed_at,entity_count_estimate,scanner_score,reserved,status,raw_json) VALUES "
            f"({q(lid)},{q(sid)},{q(title)},{q(item.get('description'))},{q(item.get('data_url'))},{q(item.get('organization'))},"
            f"{q(formats)},{q(item.get('last_updated'))},{q(item.get('entity_count_estimate'))},{q(item.get('composite_score'))},"
            f"{q(bool(item.get('is_reserved')))},{q('NEW')},{q(json.dumps(item, separators=(',',':')))})"
        )


def iter_pipeline_records():
    seen: set[str] = set()
    for path in ("pipeline.json", "output/pipeline.json"):
        payload = load(path, {})
        run_date = payload.get("run_timestamp_utc") or payload.get("run_date")
        run_id = uid("run", f"{path}:{run_date or 'unknown'}")
        emit(
            "INSERT OR IGNORE INTO runs (id,run_type,status,started_at,finished_at,summary_json) VALUES "
            f"({q(run_id)},{q('legacy_pipeline_import')},{q('complete')},{q(run_date)},{q(run_date)},{q(json.dumps({'source_path': path}))})"
        )
        records = list(payload.get("opportunities") or payload.get("candidates") or []) + list(payload.get("killed_in_phase2") or [])
        for item in records:
            input_data = item.get("input") or item
            name = input_data.get("name") or item.get("name")
            if not name:
                continue
            key = name.strip().lower()
            if key in seen:
                continue
            seen.add(key)
            yield path, run_id, item, input_data


def import_opportunities() -> dict[str, str]:
    name_to_id: dict[str, str] = {}
    for path, run_id, item, data in iter_pipeline_records():
        name = data.get("name") or item.get("name")
        oid = uid("opportunity", name)
        name_to_id[name.strip().lower()] = oid
        ds = data.get("data_source") or {}
        if isinstance(ds, str):
            ds = {"name": item.get("source_detail") or ds, "url": ds}
        score = item.get("score") or {}
        rec = recommendation(item.get("recommendation") or item.get("verdict"))
        emit(
            "INSERT OR IGNORE INTO opportunities "
            "(id,name,lifecycle_state,recommendation,primary_vertical,query_pattern,monetization_model,data_source_name,data_source_url,data_format,update_frequency,entity_count,licensing,build_notes) VALUES "
            f"({q(oid)},{q(name)},{q('SCORED')},{q(rec)},{q(data.get('primary_vertical'))},{q(data.get('query_pattern'))},{q(data.get('monetization_model'))},"
            f"{q(ds.get('name') or item.get('source_detail'))},{q(ds.get('url') or ds.get('sample_url'))},{q(ds.get('format'))},{q(ds.get('update_frequency'))},"
            f"{q(ds.get('entity_count'))},{q(ds.get('licensing'))},{q(data.get('build_notes'))})"
        )
        composite = score.get("composite") or score.get("COMPOSITE") or item.get("composite")
        if composite is not None:
            ssid = uid("score", f"{path}:{name}:{composite}")
            values = {
                "data_quality": score.get("data_quality") or item.get("score_data_quality") or 0,
                "search_demand": score.get("search_demand") or item.get("score_search_demand") or 0,
                "competition_gap": score.get("competition_gap") or item.get("score_competition_gap") or 0,
                "monetization_clarity": score.get("monetization_clarity") or item.get("score_monetization_clarity") or 0,
                "build_feasibility": score.get("build_feasibility") or item.get("score_build_feasibility") or 0,
                "defensibility": score.get("defensibility") or item.get("score_defensibility") or 0,
            }
            emit(
                "INSERT OR IGNORE INTO score_snapshots "
                "(id,opportunity_id,run_id,framework_version,data_quality,search_demand,competition_gap,monetization_clarity,build_feasibility,defensibility,composite,recommendation,rationale_json) VALUES "
                f"({q(ssid)},{q(oid)},{q(run_id)},{q('v2-legacy')},{q(values['data_quality'])},{q(values['search_demand'])},{q(values['competition_gap'])},"
                f"{q(values['monetization_clarity'])},{q(values['build_feasibility'])},{q(values['defensibility'])},{q(composite)},{q(rec if rec != 'UNSCORED' else 'BACKLOG')},"
                f"{q(json.dumps({'imported_from': path}))})"
            )
        for kind in ("phase2", "phase3"):
            if item.get(kind):
                eid = uid("evidence", f"{path}:{name}:{kind}")
                emit(
                    "INSERT OR IGNORE INTO evidence (id,opportunity_id,run_id,kind,label,value_json) VALUES "
                    f"({q(eid)},{q(oid)},{q(run_id)},{q(kind)},{q('Legacy validation evidence')},{q(json.dumps(item[kind], separators=(',',':')))})"
                )
        did = uid("decision", f"import:{path}:{name}")
        emit(
            "INSERT OR IGNORE INTO decisions (id,opportunity_id,action,from_state,to_state,actor,reason) VALUES "
            f"({q(did)},{q(oid)},{q('LEGACY_IMPORT')},NULL,{q('SCORED')},{q('migration')},{q('Imported without converting recommendation into approval')})"
        )
    return name_to_id


def import_products(name_to_id: dict[str, str]) -> None:
    portfolio = load("portfolio_state.json", {})
    for product in portfolio.get("products", []):
        name = product.get("name")
        if not name:
            continue
        pid = uid("product", name)
        ds = product.get("data_source") or {}
        oid = name_to_id.get(name.strip().lower())
        emit(
            "INSERT OR IGNORE INTO products "
            "(id,origin_opportunity_id,name,status,domain,repo,data_source_name,data_source_url,entity_count,update_frequency,monetization,monthly_traffic,monthly_revenue,launch_date,notes) VALUES "
            f"({q(pid)},{q(oid)},{q(name)},{q(product.get('status') or 'planning')},{q(product.get('domain'))},{q(product.get('repo'))},"
            f"{q(ds.get('name'))},{q(ds.get('url'))},{q(ds.get('entity_count'))},{q(ds.get('update_frequency'))},{q(product.get('monetization'))},"
            f"{q(product.get('monthly_traffic'))},{q(product.get('monthly_revenue'))},{q(product.get('launch_date'))},{q(product.get('notes'))})"
        )


def mark_import(path: str) -> None:
    p = ROOT / path
    if not p.exists():
        return
    digest = hashlib.sha256(p.read_bytes()).hexdigest()
    emit(f"INSERT OR REPLACE INTO legacy_imports (source_path,content_hash) VALUES ({q(path)},{q(digest)})")


def main() -> None:
    print("PRAGMA foreign_keys = ON;")
    print("BEGIN TRANSACTION;")
    import_leads()
    ids = import_opportunities()
    import_products(ids)
    for path in ("output/watchlist_leads.json", "pipeline.json", "output/pipeline.json", "portfolio_state.json"):
        mark_import(path)
    print("COMMIT;")


if __name__ == "__main__":
    main()
