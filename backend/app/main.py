"""HiddenInk API."""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from . import auth, benchmark, config, db, live_stats, llm, payload_library, scanner, screen, spend, trial
from .auth import User, current_user
from .redteam import lab

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("hiddenink")

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="HiddenInk API", version="1.0.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_credentials=False,
                   allow_methods=["GET", "POST"], allow_headers=["Authorization", "Content-Type"])

# Document text needed for screening is held in memory for a short time only and never written to the database.
_CTX_TTL = 15 * 60
_ctx: dict[str, tuple[float, str, dict]] = {}
_ctx_lock = threading.Lock()


def _put_ctx(scan_id: str, org_id: str, ctx: dict) -> None:
    now = time.time()
    with _ctx_lock:
        for k in [k for k, v in _ctx.items() if now - v[0] > _CTX_TTL]:
            del _ctx[k]
        _ctx[scan_id] = (now, org_id, ctx)


def _get_ctx(scan_id: str, org_id: str) -> dict:
    with _ctx_lock:
        item = _ctx.get(scan_id)
    if not item or item[1] != org_id or time.time() - item[0] > _CTX_TTL:
        raise HTTPException(410, "This scan's document is no longer in memory (we keep it for 15 minutes). Please scan it again.")
    return item[2]


async def _read_upload(file: UploadFile) -> bytes:
    limit = int(config.MAX_FILE_MB * 1024 * 1024)
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, f"File is larger than {config.MAX_FILE_MB:g} MB.")
    return data


# ---------- health & auth ----------
@app.get("/api/health")
def health():
    db.get_db()
    return {"status": "ok", "openai": config.openai_enabled(), "database": db.MODE,
            "text_model": config.OPENAI_TEXT_MODEL, "vision_model": config.OPENAI_VISION_MODEL,
            "demo_enabled": config.ENABLE_DEMO_ACCOUNT, "retention_days": config.RETENTION_DAYS}


@app.post("/api/auth/register")
@limiter.limit("5/minute")
def register(request: Request, body: auth.RegisterIn):
    return auth.register(body)


@app.post("/api/auth/login")
@limiter.limit("10/minute")
def login(request: Request, body: auth.LoginIn):
    return auth.login(body)


@app.post("/api/auth/demo")
@limiter.limit(config.RATE_LIMIT_DEMO)
def demo(request: Request):
    return auth.demo()


@app.post("/api/auth/demo/upgrade")
@limiter.limit("5/minute")
def demo_upgrade(request: Request, body: auth.UpgradeIn, user: User = Depends(current_user)):
    """Turn the trial into a real account; its review log, scans and Lab runs are kept."""
    return auth.upgrade(user, body)


@app.post("/api/auth/demo/end")
def demo_end(user: User = Depends(current_user)):
    if not user.is_demo:
        raise HTTPException(403, "Only demo sessions can be ended.")
    auth.purge_org(user.org_id)
    with _ctx_lock:
        for k in [k for k, v in _ctx.items() if v[1] == user.org_id]:
            del _ctx[k]
    return {"ok": True}


@app.get("/api/spend")
def get_spend(user: User = Depends(auth.full_account)):
    return spend.summary()


@app.get("/api/auth/me")
def me(user: User = Depends(current_user)):
    return user


# ---------- scanning ----------
@app.post("/api/scan")
@limiter.limit(config.RATE_LIMIT_SCAN)
async def scan(request: Request, file: UploadFile = File(...), user: User = Depends(current_user)):
    data = await _read_upload(file)
    use_ai, capped, claimed = _trial_ai_allowed(user)
    try:
        with trial.ai_scope(user.is_demo):
            report, ctx = scanner.scan(file.filename or "upload", data, use_ai=use_ai)
    except ValueError as exc:
        if claimed:
            trial.refund(user.id, "ai_scans")  # a rejected file shouldn't use up an AI scan
        raise HTTPException(400, str(exc)) from None
    if capped:
        report.warnings.append(trial.LIMIT_MESSAGE)
    _store_scan(user, report, ctx)
    return report


def _trial_ai_allowed(user: User) -> tuple[bool, bool, bool]:
    """(use_ai, capped, claimed). Trials get DEMO_AI_SCANS AI-backed scans, within a global daily cap on trial AI calls."""
    if not user.is_demo or not config.openai_enabled():
        return True, False, False
    if trial.daily_cap_reached() or not trial.claim(user.id, "ai_scans", config.DEMO_AI_SCANS):
        return False, True, False
    return True, False, True


def _store_scan(user: User, report, ctx: dict) -> None:
    _put_ctx(report.scan_id, user.org_id, ctx)
    db.get_db().scans.insert_one({
        "_id": report.scan_id, "org_id": user.org_id, "user_id": user.id, "file_name": report.file_name,
        "file_hash": report.file_hash, "file_type": report.file_type, "risk_score": report.risk_score,
        "verdict": report.verdict, "ai_layers": report.ai_layers,
        # Only hidden-content findings are stored, never the resume itself.
        "findings": [f.model_dump(exclude={"bbox"}) for f in report.findings],
        "created_at": datetime.now(timezone.utc),
    })


# ---------- trial sample resumes ----------
@app.get("/api/demo/samples")
def demo_samples(user: User = Depends(current_user)):
    _require_trial(user)
    return {"samples": trial.sample_list()}


@app.post("/api/demo/samples/{sample_id}/scan")
@limiter.limit(config.RATE_LIMIT_SCAN)
def demo_sample_scan(request: Request, sample_id: str, user: User = Depends(current_user)):
    """Scans a built-in sample. The result is cached, so it never uses the trial's AI allowance."""
    _require_trial(user)
    out = trial.sample_scan(sample_id)
    if out is None:
        raise HTTPException(404, "Unknown sample.")
    report, ctx = out
    _store_scan(user, report, ctx)
    return report


def _require_trial(user: User) -> None:
    if not user.is_demo:
        raise HTTPException(403, "Sample resumes are part of the free trial.")


class ScreenIn(BaseModel):
    scan_id: str
    job_description: str = Field(min_length=20, max_length=6000)


@app.post("/api/screen")
@limiter.limit(config.RATE_LIMIT_SCAN)
def run_screen(request: Request, body: ScreenIn, user: User = Depends(current_user)):
    with trial.ai_scope(user.is_demo):
        return _run_screen(body, user)


def _run_screen(body: ScreenIn, user: User) -> dict:
    if not config.openai_enabled():
        raise HTTPException(503, "Screening needs an OpenAI API key on the server.")
    ctx = _get_ctx(body.scan_id, user.org_id)
    out: dict = {}
    # The undefended screener only exists to demonstrate the attack, so real accounts don't pay for it.
    if user.is_demo:
        try:
            out["naive"] = screen.naive(body.job_description, ctx["machine_text"]).model_dump()
        except Exception as exc:  # noqa: BLE001
            out["naive_error"] = f"Naive screener failed ({type(exc).__name__})."
    try:
        out["protected"] = screen.protected(body.job_description, ctx["sanitized_text"], ctx["hidden_texts"]).model_dump()
    except Exception as exc:  # noqa: BLE001
        out["protected_error"] = f"Protected screener failed ({type(exc).__name__})."
    db.get_db().scans.update_one({"_id": body.scan_id, "org_id": user.org_id}, {"$set": {
        "screening": {"naive_score": out.get("naive", {}).get("score"),
                      "protected_score": out.get("protected", {}).get("overall_score"),
                      "tripwire": bool(out.get("protected", {}).get("tripwire"))}}})
    return out


# ---------- human review & audit log ----------
class ReviewIn(BaseModel):
    decision: Literal["reject", "clear", "needs_review"]
    reason: str = Field(min_length=3, max_length=500)
    candidate_ref: Optional[str] = Field(default=None, max_length=60)


@app.post("/api/scans/{scan_id}/review")
def review(scan_id: str, body: ReviewIn, user: User = Depends(current_user)):
    d = db.get_db()
    s = d.scans.find_one({"_id": scan_id, "org_id": user.org_id})
    if not s:
        raise HTTPException(404, "Scan not found.")
    d.reviews.insert_one({"scan_id": scan_id, "org_id": user.org_id, "reviewer_id": user.id,
                          "reviewer_email": user.email, "decision": body.decision, "reason": body.reason.strip(),
                          "candidate_ref": (body.candidate_ref or "").strip() or None,
                          "created_at": datetime.now(timezone.utc)})
    d.scans.update_one({"_id": scan_id, "org_id": user.org_id}, {"$set": {"latest_decision": body.decision}})
    added = 0
    # Demo decisions stay in the demo org and never reach the shared library.
    if body.decision == "reject" and not user.is_demo:
        # Only the attack text joins the shared library; never names, files or resume content.
        for f in s.get("findings", []):
            if f.get("category") in ("prompt_injection", "data_exfiltration"):
                added += payload_library.add([f["text"]], "+".join(f.get("techniques", [])), f["category"],
                                             use_embeddings=config.openai_enabled())
    return {"ok": True, "payloads_added": added}


@app.get("/api/scans")
def list_scans(user: User = Depends(current_user)):
    d = db.get_db()
    scans = list(d.scans.find({"org_id": user.org_id}).sort("created_at", -1).limit(200))
    reviews: dict[str, list] = {}
    for r in d.reviews.find({"org_id": user.org_id, "scan_id": {"$in": [s["_id"] for s in scans]}}).sort("created_at", -1):
        r.pop("_id", None)
        reviews.setdefault(r["scan_id"], []).append(r)
    for s in scans:
        s["id"] = s.pop("_id")
        s["reviews"] = reviews.get(s["id"], [])
    return {"scans": scans, "retention_days": config.RETENTION_DAYS}


@app.get("/api/stats")
def stats(user: User = Depends(current_user)):
    d = db.get_db()
    q = {"org_id": user.org_id}
    return {
        "scans": d.scans.count_documents(q),
        "poisoned": d.scans.count_documents({**q, "verdict": "Poisoned"}),
        "suspicious": d.scans.count_documents({**q, "verdict": "Suspicious"}),
        "false_positives": d.reviews.count_documents({**q, "decision": "clear"}),
        "library": payload_library.stats(),
    }


# ---------- Red-Team Lab ----------
@app.get("/api/redteam/options")
def redteam_options(user: User = Depends(current_user)):
    return lab.options()


class RedTeamIn(BaseModel):
    sample_id: str = "random"
    technique: str = "random"
    goal: str = "random"
    style: str = "random"
    seed: Optional[int] = None
    job_description: Optional[str] = Field(default=None, max_length=6000)
    screen: bool = False


@app.post("/api/redteam/attack")
@limiter.limit(config.RATE_LIMIT_REDTEAM)
def redteam_attack(request: Request, body: RedTeamIn, user: User = Depends(current_user)):
    if user.is_demo and not trial.claim(user.id, "redteam_attacks", config.DEMO_REDTEAM_ATTACKS):
        raise HTTPException(429, trial.lab_limit_message())
    try:
        with trial.ai_scope(user.is_demo):
            out = lab.attack_and_test(body.sample_id, body.technique, body.goal, body.style, body.seed,
                                      screen_job=body.job_description if body.screen else None)
    except ValueError as exc:
        if user.is_demo:
            trial.refund(user.id, "redteam_attacks")
        raise HTTPException(400, str(exc)) from None
    _record_redteam_run(user, out)
    return out


def _record_redteam_run(user: User, out: dict) -> None:
    """Keep the outcome for the live scoreboard: labels and results only, never the payload or the file."""
    key, sc = out["answer_key"], out.get("screening") or {}
    try:
        db.get_db().redteam_runs.insert_one({
            "org_id": user.org_id, "user_id": user.id, "created_at": datetime.now(timezone.utc),
            "sample_id": key["sample_id"], "technique": key["technique"], "style": key["style"], "goal": key["goal"],
            "file_type": key["file_type"], "counted": bool(key["invisible"]),
            "detected": bool(out["detected"]), "technique_identified": bool(out["technique_identified"]),
            "flagged": bool(out["flagged"]), "verdict": out["verdict"], "risk_score": out["risk_score"],
            "naive_fooled": sc.get("naive_fooled"), "protected_fooled": sc.get("protected_fooled"),
        })
    except Exception:  # noqa: BLE001
        log.exception("Could not record Red-Team run")


# ---------- evaluation ----------
@app.get("/api/eval")
def eval_results(user: User = Depends(current_user)):
    # Shared benchmark results; demo users can read them but not start runs.
    return {**benchmark.overview(user.org_id), "tokens_used_this_process": llm.tokens_used()}


class EvalRunIn(BaseModel):
    mode: Literal["quick", "full"] = "quick"


@app.post("/api/eval/run")
@limiter.limit("6/hour")
def eval_run(request: Request, body: EvalRunIn, user: User = Depends(auth.full_account)):
    use_ai = body.mode == "full"
    if use_ai and not config.openai_enabled():
        raise HTTPException(400, "A full run needs an OpenAI API key on the server. Use a quick run instead.")
    try:
        run_id = benchmark.start(body.mode, use_ai, user.email, user.org_id)
    except benchmark.RunConflict:
        raise HTTPException(409, "A benchmark run is already in progress. Wait for it to finish.") from None
    return {"run_id": run_id}


@app.get("/api/eval/run/{run_id}")
def eval_run_status(run_id: str, user: User = Depends(current_user)):
    run = benchmark.get(run_id, user.org_id)
    if not run:
        raise HTTPException(404, "Run not found.")
    return run


@app.get("/api/eval/live")
def eval_live(user: User = Depends(current_user)):
    # Open to demo users: they only ever see their own temporary org. The naive-vs-protected screening
    # comparison is a demo feature (real accounts never run the naive screener), so only demos get it.
    return live_stats.live(user.org_id, include_screening=user.is_demo)


@app.get("/api/eval/redteam")
def eval_redteam(user: User = Depends(current_user)):
    # Open to demo users: they only ever see their own temporary org.
    return live_stats.redteam(user.org_id)
