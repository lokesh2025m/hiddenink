"""Free trial: sample resumes, idle expiry, converting to a real account and the trial AI caps."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import config, llm, main, scanner, trial
from app.db import get_db
from app.main import app
from app.redteam import lab

main.app.state.limiter.enabled = False
client = TestClient(app)


def _trial():
    r = client.post("/api/auth/demo")
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}, r.json()["user"]


def _real(email, org="Acme"):
    r = client.post("/api/auth/register", json={"email": email, "password": "correct-horse-9", "org_name": org})
    return {"Authorization": f"Bearer {r.json()['token']}"}


# ---------- sample resumes ----------
def test_sample_resumes_scan_instantly_and_are_cached(monkeypatch):
    h, u = _trial()
    listed = client.get("/api/demo/samples", headers=h).json()["samples"]
    assert [s["id"] for s in listed] == ["clean", "white-text", "unicode"]
    assert [s["title"] for s in listed] == ["Clean resume", "Resume with invisible white text", "Resume with hidden Unicode instructions"]

    reports = {s["id"]: client.post(f"/api/demo/samples/{s['id']}/scan", headers=h).json() for s in listed}
    assert reports["clean"]["verdict"] == "Clean" and reports["clean"]["findings"] == []
    assert reports["white-text"]["verdict"] != "Clean"
    assert any("low_contrast" in f["techniques"] for f in reports["white-text"]["findings"])
    assert reports["unicode"]["verdict"] != "Clean"
    assert any("unicode_tags" in f["techniques"] for f in reports["unicode"]["findings"])

    # Repeat clicks reuse the cached report (no new scan, no API credit) but are separate scans in the log.
    calls = []
    monkeypatch.setattr(trial.scanner, "scan", lambda *a, **k: calls.append(1) or pytest.fail("should be cached"))
    again = client.post("/api/demo/samples/white-text/scan", headers=h).json()
    assert calls == [] and again["scan_id"] != reports["white-text"]["scan_id"]
    assert (again["verdict"], again["risk_score"]) == (reports["white-text"]["verdict"], reports["white-text"]["risk_score"])
    assert len(client.get("/api/scans", headers=h).json()["scans"]) == 4

    # Sample scans don't use the trial's AI allowance, and a review can be saved on them.
    assert "ai_scans" not in get_db().users.find_one({"_id": u["id"]})
    assert client.post(f"/api/scans/{again['scan_id']}/review", headers=h, json={"decision": "reject", "reason": "Hidden text"}).status_code == 200

    assert client.post("/api/demo/samples/nope/scan", headers=h).status_code == 404
    real = _real("samples@acme.test")
    assert client.get("/api/demo/samples", headers=real).status_code == 403


# ---------- idle expiry ----------
def test_idle_trial_expires_and_is_deleted():
    h, u = _trial()
    client.post("/api/demo/samples/clean/scan", headers=h)
    users = get_db().users
    assert client.get("/api/auth/me", headers=h).status_code == 200

    users.update_one({"_id": u["id"]}, {"$set": {"last_seen": datetime.now(timezone.utc) - timedelta(minutes=119)}})
    assert client.get("/api/auth/me", headers=h).status_code == 200  # still within 2 hours, and refreshed
    assert datetime.now(timezone.utc) - users.find_one({"_id": u["id"]})["last_seen"].replace(tzinfo=timezone.utc) < timedelta(minutes=1)

    users.update_one({"_id": u["id"]}, {"$set": {"last_seen": datetime.now(timezone.utc) - timedelta(hours=3)}})
    r = client.get("/api/scans", headers=h)
    assert r.status_code == 401 and "without activity" in r.json()["detail"]
    assert get_db().orgs.find_one({"_id": u["org_id"]}) is None
    assert get_db().scans.count_documents({"org_id": u["org_id"]}) == 0
    assert users.find_one({"_id": u["id"]}) is None

    # A closed tab is cleaned up too, the next time anyone starts a trial.
    h2, u2 = _trial()
    client.post("/api/demo/samples/clean/scan", headers=h2)
    users.update_one({"_id": u2["id"]}, {"$set": {"last_seen": datetime.now(timezone.utc) - timedelta(hours=3)}})
    _trial()
    assert get_db().orgs.find_one({"_id": u2["org_id"]}) is None


# ---------- converting to a real account ----------
def test_upgrade_keeps_the_trial_data():
    h, u = _trial()
    rep = client.post("/api/demo/samples/white-text/scan", headers=h).json()
    client.post(f"/api/scans/{rep['scan_id']}/review", headers=h, json={"decision": "needs_review", "reason": "Check it"})

    r = client.post("/api/auth/demo/upgrade", headers=h, json={"email": "Recruiter@Initech.test", "password": "correct-horse-9", "org_name": "Initech HR"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user"]["is_demo"] is False and body["user"]["email"] == "recruiter@initech.test"
    assert body["user"]["org_id"] == u["org_id"] and body["user"]["org_name"] == "Initech HR"
    new = {"Authorization": f"Bearer {body['token']}"}

    scans = client.get("/api/scans", headers=new).json()["scans"]
    assert [s["id"] for s in scans] == [rep["scan_id"]] and scans[0]["reviews"][0]["reviewer_email"] == "recruiter@initech.test"
    org = get_db().orgs.find_one({"_id": u["org_id"]})
    assert org["is_demo_org"] is False and org["name"] == "Initech HR"
    assert client.get("/api/auth/demo/upgrade", headers=h).status_code in (401, 405)
    assert client.get("/api/auth/me", headers=h).status_code == 401  # the trial login is gone

    # It's a normal account now: password sign-in works, no purge, no trial limits.
    assert client.post("/api/auth/login", json={"email": "recruiter@initech.test", "password": "correct-horse-9"}).status_code == 200
    get_db().orgs.update_one({"_id": u["org_id"]}, {"$set": {"created_at": datetime.now(timezone.utc) - timedelta(days=3)}})
    _trial()  # runs the stale-trial purge
    assert get_db().orgs.find_one({"_id": u["org_id"]}) is not None
    assert client.get("/api/demo/samples", headers=new).status_code == 403


def test_upgrade_rejects_taken_emails_and_real_accounts():
    _real("taken@acme.test")
    h, _ = _trial()
    r = client.post("/api/auth/demo/upgrade", headers=h, json={"email": "taken@acme.test", "password": "correct-horse-9"})
    assert r.status_code == 409
    assert client.get("/api/auth/me", headers=h).status_code == 200  # the trial carries on
    assert client.post("/api/auth/demo/upgrade", headers=h, json={"email": "not-an-email", "password": "correct-horse-9"}).status_code == 400
    assert client.post("/api/auth/demo/upgrade", headers=h, json={"email": "short@acme.test", "password": "short"}).status_code == 422
    real = _real("already-real@acme.test")
    assert client.post("/api/auth/demo/upgrade", headers=real, json={"email": "x@acme.test", "password": "correct-horse-9"}).status_code == 403


# ---------- global daily cap on trial AI calls ----------
def test_daily_cap_falls_back_to_deterministic(monkeypatch):
    monkeypatch.setattr(config, "OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(config, "DEMO_DAILY_AI_CALLS", 3)
    get_db().counters.delete_many({})
    seen = []
    real_scan = scanner.scan
    monkeypatch.setattr(main.scanner, "scan", lambda name, data, use_ai=True: seen.append(use_ai) or real_scan(name, data, use_ai=False))
    atk = lab.generate_attack(sample_id="data-analyst", technique="tiny_font", seed=5, use_ai=False)
    files = {"file": (atk["file_name"], atk["data"], "application/pdf")}

    h, _ = _trial()
    assert client.post("/api/scan", headers=h, files=files).json()["warnings"].count(trial.LIMIT_MESSAGE) == 0
    get_db().counters.update_one({"_id": trial._today_key()}, {"$set": {"n": 3}}, upsert=True)  # today's cap used up
    warnings = client.post("/api/scan", headers=_trial()[0], files=files).json()["warnings"]
    assert seen == [True, False] and trial.LIMIT_MESSAGE in warnings

    # Real accounts aren't affected by the trial cap.
    seen.clear()
    client.post("/api/scan", headers=_real("daily@acme.test"), files=files)
    assert seen == [True]


def test_trial_ai_calls_are_counted_and_blocked(monkeypatch):
    monkeypatch.setattr(config, "DEMO_DAILY_AI_CALLS", 2)
    get_db().counters.delete_many({})
    monkeypatch.setattr(llm, "budget_blocked", lambda: False)
    with trial.ai_scope(is_demo=True):
        llm._guard()
        llm._guard()
        with pytest.raises(llm.LLMUnavailable, match="Trial AI limit reached"):
            llm._guard()
    assert trial.daily_calls() == 2
    llm._guard()  # outside a trial request there is no trial cap
    with trial.ai_scope(is_demo=False):
        llm._guard()


def test_new_trials_are_rate_limited_per_ip():
    route = next(r for r in app.routes if getattr(r, "path", "") == "/api/auth/demo")
    limits = [str(l.limit) for l in main.limiter._route_limits.get(f"{route.endpoint.__module__}.{route.endpoint.__name__}", [])]
    assert config.RATE_LIMIT_DEMO == "5/hour" and any("5 per 1 hour" in l for l in limits), limits
