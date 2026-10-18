"""Live statistics for the Evaluation page, scoped to one organization.

Only counts and scores leave this module: never resume text or hidden-finding text.
Pipelines use operators that both MongoDB and mongomock support; the risk histogram
is computed in Python from the most recent scans instead.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from .db import get_db

DAYS = 14
HISTOGRAM_SCANS = 1000
RECENT_FLAGGED = 8
VERDICTS = ("Clean", "Suspicious", "Poisoned")
DECISIONS = ("reject", "clear", "needs_review")


def _utc_iso(d: datetime | None) -> str | None:
    if d is None:
        return None
    if d.tzinfo is None:  # pymongo and mongomock return naive UTC datetimes
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _round(v, nd: int = 1):
    return None if v is None else round(v, nd)


def live(org_id: str, include_screening: bool = True) -> dict:
    d = get_db()
    org = {"org_id": org_id}
    now = datetime.now(timezone.utc)

    # Totals by verdict.
    by_verdict = {r["_id"]: r for r in d.scans.aggregate([
        {"$match": org},
        {"$group": {"_id": "$verdict", "n": {"$sum": 1}, "risk": {"$sum": "$risk_score"}}},
    ])}
    counts = {v: by_verdict.get(v, {}).get("n", 0) for v in VERDICTS}
    scans = sum(r["n"] for r in by_verdict.values())
    risk_total = sum(r["risk"] or 0 for r in by_verdict.values())
    flagged = counts["Suspicious"] + counts["Poisoned"]
    totals = {"scans": scans, "clean": counts["Clean"], "suspicious": counts["Suspicious"], "poisoned": counts["Poisoned"],
              "flag_rate": round(flagged / scans, 3) if scans else None,
              "avg_risk": round(risk_total / scans, 1) if scans else None}

    # Every review decision recorded, plus precision over flagged scans by their latest decision.
    decided = {r["_id"]: r["n"] for r in d.reviews.aggregate([
        {"$match": org}, {"$group": {"_id": "$decision", "n": {"$sum": 1}}},
    ])}
    latest = {r["_id"]: r["n"] for r in d.scans.aggregate([
        {"$match": {**org, "verdict": {"$ne": "Clean"}, "latest_decision": {"$in": ["reject", "clear"]}}},
        {"$group": {"_id": "$latest_decision", "n": {"$sum": 1}}},
    ])}
    rejects, clears = latest.get("reject", 0), latest.get("clear", 0)
    reviews = {**{k: decided.get(k, 0) for k in DECISIONS},
               "human_precision": round(rejects / (rejects + clears), 3) if rejects + clears else None}

    # Last 14 UTC days, oldest first, with empty days filled in.
    start = (now - timedelta(days=DAYS - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    per_day: dict[str, dict] = {}
    for r in d.scans.aggregate([
        {"$match": {**org, "created_at": {"$gte": start}}},
        {"$group": {"_id": {"day": {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at"}}, "verdict": "$verdict"},
                    "n": {"$sum": 1}}},
    ]):
        per_day.setdefault(r["_id"]["day"], {})[r["_id"]["verdict"]] = r["n"]
    daily = []
    for i in range(DAYS):
        day = (start + timedelta(days=i)).strftime("%Y-%m-%d")
        row = per_day.get(day, {})
        daily.append({"date": day, "clean": row.get("Clean", 0), "suspicious": row.get("Suspicious", 0),
                      "poisoned": row.get("Poisoned", 0)})

    # Findings per technique and per category (a finding can carry several techniques).
    techniques = [{"technique": r["_id"], "count": r["n"]} for r in d.scans.aggregate([
        {"$match": org}, {"$unwind": "$findings"}, {"$unwind": "$findings.techniques"},
        {"$group": {"_id": "$findings.techniques", "n": {"$sum": 1}}},
    ])]
    techniques.sort(key=lambda t: (-t["count"], t["technique"]))
    categories = [{"category": r["_id"] or "unclassified", "count": r["n"]} for r in d.scans.aggregate([
        {"$match": org}, {"$unwind": "$findings"},
        {"$group": {"_id": "$findings.category", "n": {"$sum": 1}}},
    ])]
    categories.sort(key=lambda c: (-c["count"], c["category"]))

    # Risk histogram over the latest scans: 0-9, 10-19, ..., 90-100.
    buckets = [0] * 10
    for s in d.scans.find(org, {"risk_score": 1, "_id": 0}).sort("created_at", -1).limit(HISTOGRAM_SCANS):
        risk = s.get("risk_score")
        if risk is not None:
            buckets[min(int(risk) // 10, 9)] += 1
    risk_histogram = [{"bucket": f"{i * 10}-{i * 10 + (10 if i == 9 else 9)}", "min": i * 10, "count": n}
                      for i, n in enumerate(buckets)]

    # Projection keeps finding text out entirely.
    recent = d.scans.find({**org, "verdict": {"$ne": "Clean"}},
                          {"file_name": 1, "verdict": 1, "risk_score": 1, "created_at": 1, "latest_decision": 1,
                           "findings.techniques": 1}).sort("created_at", -1).limit(RECENT_FLAGGED)
    recent_flagged = [{
        "id": s["_id"], "file_name": s.get("file_name"), "verdict": s.get("verdict"), "risk_score": s.get("risk_score"),
        "created_at": _utc_iso(s.get("created_at")),
        "techniques": sorted({t for f in s.get("findings", []) for t in f.get("techniques", [])}),
        "latest_decision": s.get("latest_decision"),
    } for s in recent]

    out = {"totals": totals, "reviews": reviews, "daily": daily, "techniques": techniques, "categories": categories,
           "risk_histogram": risk_histogram, "recent_flagged": recent_flagged, "generated_at": _utc_iso(now)}
    if include_screening:
        out["screening"] = _screening(d, org)
    return out


def _screening(d, org: dict) -> dict:
    """Naive vs protected averages over this org's screening runs ($avg skips nulls)."""
    sc = next(iter(d.scans.aggregate([
        {"$match": {**org, "screening": {"$exists": True}}},
        {"$group": {"_id": None, "n": {"$sum": 1}, "naive": {"$avg": "$screening.naive_score"},
                    "protected": {"$avg": "$screening.protected_score"},
                    "tripwire": {"$sum": {"$cond": ["$screening.tripwire", 1, 0]}}}},
    ])), None)
    return {"count": sc["n"] if sc else 0, "avg_naive_score": _round(sc and sc["naive"], 2),
            "avg_protected_score": _round(sc and sc["protected"], 2), "tripwire_count": sc["tripwire"] if sc else 0}


# ---------- Red-Team Lab scoreboard ----------
ROLLING_WINDOW = 10
ROLLING_RUNS = 1000
RECENT_RUNS = 10


def _rate(num: int, den: int):
    return round(num / den, 3) if den else None


def _breakdown(d, match: dict, field: str) -> list[dict]:
    rows = [{field: r["_id"], "attacks": r["n"], "detected": r["det"], "missed": r["n"] - r["det"]}
            for r in d.redteam_runs.aggregate([
                {"$match": match},
                {"$group": {"_id": f"${field}", "n": {"$sum": 1}, "det": {"$sum": {"$cond": ["$detected", 1, 0]}}}},
            ])]
    return sorted(rows, key=lambda r: (-r["attacks"], r[field] or ""))


def redteam(org_id: str) -> dict:
    """Scoreboard over this org's Lab attacks that were verified invisible (the ones that count)."""
    d = get_db()
    match = {"org_id": org_id, "counted": True}

    t = next(iter(d.redteam_runs.aggregate([
        {"$match": match},
        {"$group": {"_id": None, "n": {"$sum": 1},
                    "det": {"$sum": {"$cond": ["$detected", 1, 0]}},
                    "flag": {"$sum": {"$cond": ["$flagged", 1, 0]}},
                    "ident": {"$sum": {"$cond": ["$technique_identified", 1, 0]}}}},
    ])), None) or {"n": 0, "det": 0, "flag": 0, "ident": 0}
    totals = {"attacks": t["n"], "detected": t["det"], "detection_rate": _rate(t["det"], t["n"]),
              "flagged_rate": _rate(t["flag"], t["n"]), "technique_accuracy": _rate(t["ident"], t["n"])}

    # Screening ran only when naive_fooled was recorded.
    s = next(iter(d.redteam_runs.aggregate([
        {"$match": {**match, "naive_fooled": {"$ne": None}}},
        {"$group": {"_id": None, "n": {"$sum": 1},
                    "naive": {"$sum": {"$cond": ["$naive_fooled", 1, 0]}},
                    "prot": {"$sum": {"$cond": ["$protected_fooled", 1, 0]}}}},
    ])), None) or {"n": 0, "naive": 0, "prot": 0}
    screening = {"screened": s["n"], "naive_fooled_rate": _rate(s["naive"], s["n"]),
                 "protected_fooled_rate": _rate(s["prot"], s["n"])}

    # Sliding window over the latest runs, oldest first; the first points use the attacks so far.
    latest = list(d.redteam_runs.find(match, {"detected": 1, "_id": 0}).sort("created_at", -1).limit(ROLLING_RUNS))[::-1]
    offset = t["n"] - len(latest)  # attack numbers stay true when older runs fall outside the cap
    rolling = []
    for i in range(1, len(latest) + 1):
        window = latest[max(0, i - ROLLING_WINDOW):i]
        rolling.append({"n": offset + i, "detection_rate": _rate(sum(bool(r.get("detected")) for r in window), len(window))})

    recent = [{"created_at": _utc_iso(r.get("created_at")), **{k: r.get(k) for k in (
        "technique", "style", "goal", "detected", "verdict", "risk_score", "naive_fooled", "protected_fooled")}}
        for r in d.redteam_runs.find(match, {"_id": 0}).sort("created_at", -1).limit(RECENT_RUNS)]

    return {"totals": totals, "per_technique": _breakdown(d, match, "technique"), "per_style": _breakdown(d, match, "style"),
            "screening": screening, "rolling": rolling, "recent": recent, "generated_at": _utc_iso(datetime.now(timezone.utc))}
