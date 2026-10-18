"""Held-out benchmark runs started from the Evaluation page.

The set and the scoring come from eval/run_eval.py. Runs are shared across organizations
(it is the same benchmark for everyone), so the starter's email is shown only to their own org.
"""
from __future__ import annotations

import json
import logging
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from eval import run_eval

from .db import get_db

log = logging.getLogger("hiddenink.benchmark")
STALE_AFTER = timedelta(minutes=20)
ROWS_LIMIT = 200  # per-file rows are dropped from responses above this
_start_lock = threading.Lock()


class RunConflict(Exception):
    pass


def _aware(d: datetime | None) -> datetime | None:
    return d.replace(tzinfo=timezone.utc) if d is not None and d.tzinfo is None else d


def _iso(d: datetime | None) -> str | None:
    d = _aware(d)
    return d.isoformat(timespec="seconds").replace("+00:00", "Z") if d else None


def _expire_stale() -> None:
    cutoff = datetime.now(timezone.utc) - STALE_AFTER
    get_db().eval_runs.update_many(
        {"status": "running", "created_at": {"$lt": cutoff}},
        {"$set": {"status": "error", "finished_at": datetime.now(timezone.utc),
                  "error": "The run did not finish within 20 minutes (it may have stopped when the server restarted)."}})


def start(mode: str, use_ai: bool, email: str, org_id: str) -> str:
    with _start_lock:  # one run at a time, checked and claimed atomically within this process
        _expire_stale()
        if get_db().eval_runs.find_one({"status": "running"}, {"_id": 1}):
            raise RunConflict
        run_id = uuid.uuid4().hex
        get_db().eval_runs.insert_one({
            "_id": run_id, "status": "running", "mode": mode, "started_by": email, "started_by_org": org_id,
            "created_at": datetime.now(timezone.utc), "finished_at": None,
            "progress": {"done": 0, "total": 0, "label": "Building the held-out set"}, "result": None, "error": None})
    threading.Thread(target=_job, args=(run_id, use_ai), daemon=True, name=f"eval-{run_id[:8]}").start()
    return run_id


def _job(run_id: str, use_ai: bool) -> None:
    runs = get_db().eval_runs
    still_running = {"_id": run_id, "status": "running"}  # never overwrite a run already marked stale
    try:
        attacks, clean = run_eval.build_heldout_in_memory()

        def progress(done: int, total: int, label: str) -> None:
            runs.update_one(still_running, {"$set": {"progress": {"done": done, "total": total, "label": label}}})

        progress(0, len(attacks) + len(clean), "Starting")
        result = run_eval.evaluate_set(attacks, clean, use_ai=use_ai, progress_cb=progress)
        runs.update_one(still_running, {"$set": {"status": "done", "finished_at": datetime.now(timezone.utc), "result": result}})
    except Exception as exc:  # noqa: BLE001
        log.exception("Benchmark run %s failed", run_id)
        runs.update_one(still_running, {"$set": {"status": "error", "finished_at": datetime.now(timezone.utc),
                                                 "error": f"The benchmark failed ({type(exc).__name__})."}})


def _safe_result(result: dict | None) -> dict | None:
    """Counts and labels only: false positives keep file name and verdict, never the hidden-finding text."""
    if not result:
        return result
    out = {k: v for k, v in result.items() if not (k == "rows" and len(v or []) > ROWS_LIMIT)}
    out["false_positives"] = [{"file": f.get("file"), "verdict": f.get("verdict")} for f in result.get("false_positives", [])]
    return out


def public(doc: dict, viewer_org: str) -> dict:
    out = {k: v for k, v in doc.items() if k not in ("_id", "started_by_org")}
    out["run_id"] = doc["_id"]
    out["created_at"], out["finished_at"] = _iso(doc.get("created_at")), _iso(doc.get("finished_at"))
    if doc.get("started_by_org") != viewer_org:
        out["started_by"] = None
    out["result"] = _safe_result(out.get("result"))
    return out


def get(run_id: str, viewer_org: str) -> dict | None:
    _expire_stale()
    doc = get_db().eval_runs.find_one({"_id": run_id})
    return public(doc, viewer_org) if doc else None


def overview(viewer_org: str) -> dict:
    _expire_stale()
    runs = get_db().eval_runs
    running = runs.find_one({"status": "running"}, {"result": 0})
    newest = next(iter(runs.find({"status": "done"}).sort("created_at", -1).limit(1)), None)
    if newest is None:
        return {**_file_results(), "running": public(running, viewer_org) if running else None}

    run = public(newest, viewer_org)
    latest = {**run["result"], "run_id": run["run_id"], "mode": run["mode"], "created_at": run["created_at"],
              "started_by": run["started_by"], "source": "run"}
    metrics = ("detection_rate", "false_positive_rate", "technique_accuracy", "avg_risk_attacks", "avg_risk_clean")
    history = [{"run_id": h["_id"], "created_at": _iso(h["created_at"]), "mode": h["mode"],
                **{m: (h.get("result") or {}).get(m) for m in metrics}}
               for h in runs.find({"status": "done"}, {"mode": 1, "created_at": 1, **{f"result.{m}": 1 for m in metrics}})
               .sort("created_at", 1)]
    return {"latest": latest, "history": history, "running": public(running, viewer_org) if running else None}


def _file_results() -> dict:
    """Results written by the CLI (python -m eval.run_eval run ...), used until a run exists in the database."""
    latest = run_eval.RESULTS / "latest.json"
    history = run_eval.RESULTS / "history.json"
    return {"latest": _safe_result(_read(latest)), "history": _read(history) or []}


def _read(path: Path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
