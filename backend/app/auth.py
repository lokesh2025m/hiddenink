"""Accounts and organizations, with bcrypt password hashes and short-lived JWTs."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from . import config
from .db import get_db

bearer = HTTPBearer(auto_error=False)
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
DEMO_MAX_AGE_HOURS = 24
LAST_SEEN_EVERY = timedelta(seconds=60)  # how often a trial session's activity time is written


class RegisterIn(BaseModel):
    email: str = Field(max_length=200)
    password: str = Field(min_length=8, max_length=200)
    org_name: str = Field(min_length=2, max_length=100)


class LoginIn(BaseModel):
    email: str = Field(max_length=200)
    password: str = Field(max_length=200)


class UpgradeIn(BaseModel):
    email: str = Field(max_length=200)
    password: str = Field(min_length=8, max_length=200)
    org_name: str | None = Field(default=None, min_length=2, max_length=100)


class User(BaseModel):
    id: str
    email: str
    org_id: str
    org_name: str
    is_demo: bool = False


def _token(user: dict) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=config.JWT_TTL_HOURS)
    return jwt.encode({"sub": user["_id"], "org": user["org_id"], "exp": exp}, config.JWT_SECRET, algorithm="HS256")


def _public(user: dict) -> dict:
    return User(id=user["_id"], email=user["email"], org_id=user["org_id"], org_name=user["org_name"],
                is_demo=user.get("is_demo", False)).model_dump()


def register(body: RegisterIn) -> dict:
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "Enter a valid email address.")
    db = get_db()
    if db.users.find_one({"email": email}):
        raise HTTPException(409, "An account with this email already exists.")
    org_id = uuid.uuid4().hex
    db.orgs.insert_one({"_id": org_id, "name": body.org_name.strip(), "created_at": datetime.now(timezone.utc)})
    user = {"_id": uuid.uuid4().hex, "email": email, "org_id": org_id, "org_name": body.org_name.strip(),
            "password_hash": bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode(),
            "created_at": datetime.now(timezone.utc)}
    db.users.insert_one(user)
    return {"token": _token(user), "user": _public(user)}


def login(body: LoginIn) -> dict:
    user = get_db().users.find_one({"email": body.email.strip().lower()})
    if not user or user.get("is_demo") or not bcrypt.checkpw(body.password.encode(), user["password_hash"].encode()):
        raise HTTPException(401, "Incorrect email or password.")
    return {"token": _token(user), "user": _public(user)}


def purge_org(org_id: str) -> None:
    """Delete an organization and everything in it. Only ever called for demo orgs."""
    db = get_db()
    db.reviews.delete_many({"org_id": org_id})
    db.scans.delete_many({"org_id": org_id})
    db.redteam_runs.delete_many({"org_id": org_id})
    db.users.delete_many({"org_id": org_id})
    db.orgs.delete_one({"_id": org_id})


def purge_stale_demos() -> None:
    """Remove trial orgs nobody signed out of (e.g. a closed tab): a day old, or idle for DEMO_IDLE_HOURS."""
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=DEMO_MAX_AGE_HOURS)
    db = get_db()
    # "demo-org" is the old shared demo organization, which has no is_demo_org flag.
    stale = {"$or": [{"is_demo_org": True, "created_at": {"$lt": cutoff}}, {"_id": "demo-org"}]}
    for org in db.orgs.find(stale, {"_id": 1}):
        purge_org(org["_id"])
    idle = now - timedelta(hours=config.DEMO_IDLE_HOURS)
    for u in db.users.find({"is_demo": True, "last_seen": {"$lt": idle}}, {"org_id": 1}):
        _purge_demo_org(u["org_id"])


def _purge_demo_org(org_id: str) -> None:
    if get_db().orgs.find_one({"_id": org_id, "is_demo_org": True}, {"_id": 1}):
        purge_org(org_id)


def _aware(d: datetime | None) -> datetime | None:
    return d.replace(tzinfo=timezone.utc) if d is not None and d.tzinfo is None else d


def demo() -> dict:
    """Each demo sign-in gets its own throwaway organization, so demo logs are never shared."""
    if not config.ENABLE_DEMO_ACCOUNT:
        raise HTTPException(403, "The demo account is disabled.")
    purge_stale_demos()
    db = get_db()
    now = datetime.now(timezone.utc)
    org_id = uuid.uuid4().hex
    db.orgs.insert_one({"_id": org_id, "name": "Demo Recruiting Co", "is_demo_org": True, "created_at": now})
    user = {"_id": uuid.uuid4().hex, "email": f"demo-{org_id[:10]}@hiddenink.app", "org_id": org_id,
            "org_name": "Demo Recruiting Co", "password_hash": "!", "is_demo": True, "created_at": now, "last_seen": now}
    db.users.insert_one(user)
    return {"token": _token(user), "user": _public(user)}


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> User:
    if creds is None:
        raise HTTPException(401, "Sign in required.")
    try:
        claims = jwt.decode(creds.credentials, config.JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Session expired. Please sign in again.") from None
    user = get_db().users.find_one({"_id": claims.get("sub")})
    if not user:
        raise HTTPException(401, "Account not found.")
    if user.get("is_demo"):
        _touch_trial(user)
    return User(**_public(user))


def _touch_trial(user: dict) -> None:
    """Trial sessions end after DEMO_IDLE_HOURS without activity, and their data is deleted like on sign-out."""
    now = datetime.now(timezone.utc)
    last = _aware(user.get("last_seen") or user.get("created_at")) or now
    if now - last > timedelta(hours=config.DEMO_IDLE_HOURS):
        _purge_demo_org(user["org_id"])
        get_db().users.delete_one({"_id": user["_id"]})  # in case the org was already gone
        raise HTTPException(401, f"Your trial ended after {config.DEMO_IDLE_HOURS:g} hours without activity, "
                                 "and its data was deleted. Start a new trial from the sign-in page.")
    if now - last > LAST_SEEN_EVERY:
        get_db().users.update_one({"_id": user["_id"]}, {"$set": {"last_seen": now}})


def upgrade(user: User, body: UpgradeIn) -> dict:
    """Turn a trial into a real account, keeping its organization and everything in it."""
    if not user.is_demo:
        raise HTTPException(403, "Only trial sessions can be converted.")
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "Enter a valid email address.")
    db = get_db()
    if db.users.find_one({"email": email}, {"_id": 1}):
        raise HTTPException(409, "An account with this email already exists. Sign in instead.")
    now = datetime.now(timezone.utc)
    org_name = (body.org_name or "").strip() or user.org_name
    new = {"_id": uuid.uuid4().hex, "email": email, "org_id": user.org_id, "org_name": org_name,
           "password_hash": bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode(), "created_at": now}
    try:
        db.users.insert_one(new)
    except Exception as exc:  # noqa: BLE001 - two requests racing for the same email
        if "Duplicate" in type(exc).__name__:
            raise HTTPException(409, "An account with this email already exists. Sign in instead.") from None
        raise
    # The org stops being a trial org, so the 24-hour and idle purges no longer apply to it.
    db.orgs.update_one({"_id": user.org_id}, {"$set": {"name": org_name, "is_demo_org": False, "upgraded_at": now}})
    db.scans.update_many({"org_id": user.org_id, "user_id": user.id}, {"$set": {"user_id": new["_id"]}})
    db.reviews.update_many({"org_id": user.org_id, "reviewer_id": user.id},
                           {"$set": {"reviewer_id": new["_id"], "reviewer_email": email}})
    db.redteam_runs.update_many({"org_id": user.org_id, "user_id": user.id}, {"$set": {"user_id": new["_id"]}})
    db.users.delete_one({"_id": user.id})  # the trial login stops working
    return {"token": _token(new), "user": _public(new)}


def full_account(user: User = Depends(current_user)) -> User:
    """For features that are not part of the demo preview."""
    if user.is_demo:
        raise HTTPException(403, "Create an account to use this feature.")
    return user
