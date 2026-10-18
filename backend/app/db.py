"""MongoDB access. Falls back to an in-memory database when MONGODB_URI is unset."""
from __future__ import annotations

import logging
import threading

from . import config

log = logging.getLogger("hiddenink.db")
_db = None
_lock = threading.Lock()
MODE = "memory"


def get_db():
    global _db, MODE
    with _lock:
        if _db is None:
            if config.MONGODB_URI:
                from pymongo import MongoClient
                _db = MongoClient(config.MONGODB_URI, serverSelectionTimeoutMS=8000)[config.MONGODB_DB]
                MODE = "mongodb"
            else:
                import mongomock
                _db = mongomock.MongoClient()[config.MONGODB_DB]
                MODE = "memory"
                log.warning("MONGODB_URI not set: using an in-memory database (data is lost on restart).")
            _ensure_indexes(_db)
    return _db


def _ensure_indexes(db) -> None:
    ttl = config.RETENTION_DAYS * 86400
    db.users.create_index("email", unique=True)
    db.scans.create_index([("org_id", 1), ("created_at", -1)])
    db.scans.create_index("created_at", expireAfterSeconds=ttl)
    db.reviews.create_index("scan_id")
    db.reviews.create_index("created_at", expireAfterSeconds=ttl)
    db.payloads.create_index("text_hash", unique=True)
    db.redteam_runs.create_index([("org_id", 1), ("created_at", -1)])
    db.redteam_runs.create_index("created_at", expireAfterSeconds=ttl)
    db.eval_runs.create_index([("created_at", -1)])  # benchmark history is kept: no TTL
    db.eval_runs.create_index("status")
    db.llm_cache.create_index("created_at", expireAfterSeconds=config.LLM_CACHE_DAYS * 86400)
    db.counters.create_index("created_at", expireAfterSeconds=2 * 86400)  # daily trial counters
    db.users.create_index("last_seen")  # trial idle purge
