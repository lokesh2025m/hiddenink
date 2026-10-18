"""Library of confirmed attack payloads (attack text only, no personal data).

When a reviewer rejects a flagged document, its injection payloads are added
here. New hidden text is matched against the library with OpenAI embeddings
(cosine similarity), or fuzzy string matching when no key is configured.
"""
from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone

import numpy as np
from rapidfuzz import fuzz

from . import llm
from .db import get_db

EMBED_THRESHOLD = 0.82
FUZZY_THRESHOLD = 85

_PII = [
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "[email]"),
    (re.compile(r"\+?\d[\d\s().-]{7,}\d"), "[phone]"),
    (re.compile(r"https?://\S+"), "[url]"),
]


def scrub(text: str) -> str:
    for rx, rep in _PII:
        text = rx.sub(rep, text)
    return re.sub(r"\s+", " ", text).strip()[:1500]


def add(texts: list[str], technique: str, category: str, use_embeddings: bool) -> int:
    db = get_db()
    added = 0
    clean = [scrub(t) for t in texts if len(t.strip()) >= 12]
    if not clean:
        return 0
    vectors: list[list[float] | None] = [None] * len(clean)
    if use_embeddings:
        try:
            vectors = llm.embed(clean)
        except Exception:  # noqa: BLE001
            pass
    now = datetime.now(timezone.utc)
    for text, vec in zip(clean, vectors):
        h = hashlib.sha256(text.lower().encode()).hexdigest()
        res = db.payloads.update_one(
            {"text_hash": h},
            {"$inc": {"confirmed_count": 1},
             "$setOnInsert": {"text": text, "text_hash": h, "technique": technique, "category": category,
                              "embedding": vec, "created_at": now}},
            upsert=True,
        )
        added += 1 if res.upserted_id else 0
    return added


def match(texts: list[str], use_embeddings: bool) -> tuple[list[int], str]:
    """For each text, how many confirmed library payloads it resembles."""
    lib = list(get_db().payloads.find({}, {"text": 1, "embedding": 1, "confirmed_count": 1}).limit(5000))
    if not lib or not texts:
        return [0] * len(texts), "fuzzy"
    with_vec = [p for p in lib if p.get("embedding")]
    if use_embeddings and with_vec:
        try:
            q = np.array(llm.embed([scrub(t) for t in texts]), dtype=np.float32)
            m = np.array([p["embedding"] for p in with_vec], dtype=np.float32)
            q /= np.linalg.norm(q, axis=1, keepdims=True) + 1e-9
            m /= np.linalg.norm(m, axis=1, keepdims=True) + 1e-9
            sims = q @ m.T
            return [int((row >= EMBED_THRESHOLD).sum()) for row in sims], "embeddings"
        except Exception:  # noqa: BLE001
            pass
    out = []
    for t in texts:
        s = scrub(t).lower()
        out.append(sum(1 for p in lib if fuzz.token_set_ratio(s, p["text"].lower()) >= FUZZY_THRESHOLD))
    return out, "fuzzy"


def stats() -> dict:
    db = get_db()
    return {"payloads": db.payloads.count_documents({}),
            "top": [{"text": p["text"][:160], "confirmed_count": p.get("confirmed_count", 1), "technique": p.get("technique")}
                    for p in db.payloads.find({}, {"text": 1, "confirmed_count": 1, "technique": 1})
                    .sort("confirmed_count", -1).limit(10)]}
