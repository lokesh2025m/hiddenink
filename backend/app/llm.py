"""Thin wrapper around the OpenAI API.

All calls go through here so that: the key is read only from the environment,
failures degrade gracefully (the deterministic layers still work), every
response that should be JSON is validated against a strict schema, and token
usage is counted for the Red-Team Lab's cost cap.
"""
from __future__ import annotations

import json
import logging
import threading
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any, Callable

from . import config, spend

import hashlib
from collections import OrderedDict

log = logging.getLogger("hiddenink.llm")

_client = None
_lock = threading.Lock()
_tokens_used = 0
_cache: OrderedDict[str, dict] = OrderedDict()
CACHE_SIZE = 500  


class LLMUnavailable(RuntimeError):
    pass


def client():
    global _client
    if not config.openai_enabled():
        raise LLMUnavailable("OPENAI_API_KEY is not set.")
    with _lock:
        if _client is None:
            from openai import OpenAI
            _client = OpenAI(api_key=config.OPENAI_API_KEY, timeout=config.OPENAI_TIMEOUT, max_retries=2)
    return _client


def tokens_used() -> int:
    return _tokens_used


def _count(resp, model: str) -> None:
    global _tokens_used
    usage = getattr(resp, "usage", None)
    if usage is None:
        return
    with _lock:
        _tokens_used += int(getattr(usage, "total_tokens", 0) or 0)
        try:
            # Embeddings report prompt tokens only; reasoning tokens are already inside completion_tokens.
            spend.record(model, int(getattr(usage, "prompt_tokens", 0) or 0), int(getattr(usage, "completion_tokens", 0) or 0))
        except Exception:  # noqa: BLE001 - the spend tracker must never break an API call
            log.warning("Spend tracker failed", exc_info=True)


_minimal_rejected = False  # set once the API refuses reasoning_effort="minimal"; "low" is used from then on
_hard_stop_announced = False
REASONING_MODELS = ("gpt-5", "gpt-6", "o3", "o4")


def budget_blocked() -> bool:
    """True when the spend tracker's hard stop is reached. Prints one [spend] HARD STOP line when it first trips."""
    global _hard_stop_announced
    try:
        blocked = spend.hard_stop_reached()
    except Exception:  # noqa: BLE001 - a broken tracker must not block the API
        return False
    if blocked and not _hard_stop_announced:
        _hard_stop_announced = True
        s = spend.summary()
        print(f"[spend] HARD STOP ${s['total_usd']:.4f} / ${s['limit_usd']:.2f} used ({s['percent']:.1f}%): "
              f"OpenAI calls are blocked at {config.SPEND_HARD_STOP_PCT:g}% until `python -m app.spend reset`", flush=True)
    elif not blocked:
        _hard_stop_announced = False  # announce again if it trips after a reset
    return blocked


# Set for the duration of a trial request (see trial.ai_scope): called before each OpenAI call, False blocks it.
call_allowance: ContextVar[Callable[[], bool] | None] = ContextVar("call_allowance", default=None)


def _guard() -> None:
    if budget_blocked():
        raise LLMUnavailable("Budget limit reached")
    allow = call_allowance.get()
    if allow is not None and not allow():
        raise LLMUnavailable("Trial AI limit reached")


def _rejects_minimal(exc: Exception) -> bool:
    text = str(exc).lower()
    return getattr(exc, "status_code", None) == 400 and ("minimal" in text or "reasoning_effort" in text)


def json_call(system: str, user: Any, schema_name: str, schema: dict, model: str | None = None,
              max_tokens: int = 8000, reasoning_effort: str | None = None) -> dict:
    """Chat completion with a strict JSON schema. `user` may be a string or a content list (for images).

    Retries once with "low" if the API rejects reasoning_effort="minimal", and once with double the
    output limit if the answer was cut off or isn't valid JSON.
    """
    global _minimal_rejected
    _guard()
    model = model or config.OPENAI_TEXT_MODEL
    # Reasoning models accept an effort setting; older chat models reject it.
    effort = (reasoning_effort or config.OPENAI_REASONING_EFFORT) if model.startswith(REASONING_MODELS) else ""
    limit = max_tokens
    for _attempt in range(3):  # the first try, at most one effort fallback, at most one larger-limit retry
        if effort == "minimal" and _minimal_rejected:
            effort = "low"
        try:
            resp = client().chat.completions.create(
                model=model,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                response_format={"type": "json_schema", "json_schema": {"name": schema_name, "strict": True, "schema": schema}},
                max_completion_tokens=limit,
                **({"reasoning_effort": effort} if effort else {}),
            )
        except Exception as exc:  # noqa: BLE001
            if effort == "minimal" and not _minimal_rejected and _rejects_minimal(exc):
                _minimal_rejected = True
                log.warning("reasoning_effort=minimal was rejected for %s; using low from now on", model)
                continue
            raise
        _count(resp, model)
        choice = resp.choices[0]
        if getattr(choice.message, "refusal", None):
            raise RuntimeError(f"Model refused: {choice.message.refusal}")
        cut_off = getattr(choice, "finish_reason", None) == "length"
        if not cut_off:
            try:
                return json.loads(choice.message.content or "")
            except json.JSONDecodeError:
                pass
        if limit != max_tokens:
            raise RuntimeError("Model output was cut off." if cut_off else "Model returned invalid JSON.")
        limit = max_tokens * 2
    raise RuntimeError("Model call failed after retries.")


# ---------- reusable answers: in memory, backed by MongoDB (the in-memory database when MONGODB_URI is unset) ----------
def cache_key(*parts: Any) -> str:
    return hashlib.sha256(json.dumps(parts, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def cache_get(key: str) -> Any | None:
    with _lock:
        if key in _cache:
            _cache.move_to_end(key)
            return json.loads(json.dumps(_cache[key]))
    try:
        from .db import get_db
        doc = get_db().llm_cache.find_one({"_id": key}, {"value": 1})
    except Exception:  # noqa: BLE001 - a cache miss is always safe
        log.warning("llm cache read failed", exc_info=True)
        return None
    if not doc:
        return None
    value = json.loads(doc["value"])
    _remember(key, value)
    return json.loads(json.dumps(value))


def cache_put(key: str, value: Any) -> None:
    """Stores the model's output only (as JSON), never the request or the API key."""
    _remember(key, value)
    try:
        from .db import get_db
        get_db().llm_cache.update_one({"_id": key}, {"$set": {"value": json.dumps(value, ensure_ascii=False),
                                                              "created_at": datetime.now(timezone.utc)}}, upsert=True)
    except Exception:  # noqa: BLE001
        log.warning("llm cache write failed", exc_info=True)


def _remember(key: str, value: Any) -> None:
    with _lock:
        _cache[key] = json.loads(json.dumps(value))
        _cache.move_to_end(key)
        while len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)


def cached_json_call(system: str, user: Any, schema_name: str, schema: dict, **kw) -> dict:
    """json_call, but identical inputs return the identical answer (used by the scan layers).

    Models are not deterministic run to run, so without this the same file could get a
    different score each time it is scanned, and we would pay for it again. Not used where
    fresh output is wanted (the Red-Team payload writer).
    """
    key = cache_key(system, user, schema_name, kw.get("model") or config.OPENAI_TEXT_MODEL)
    hit = cache_get(key)
    if hit is not None:
        return hit
    out = json_call(system, user, schema_name, schema, **kw)
    cache_put(key, out)
    return json.loads(json.dumps(out))


def embed(texts: list[str]) -> list[list[float]]:
    _guard()
    resp = client().embeddings.create(model=config.OPENAI_EMBED_MODEL, input=[t[:4000] for t in texts])
    _count(resp, config.OPENAI_EMBED_MODEL)
    return [d.embedding for d in resp.data]


def obj(properties: dict, required: list[str] | None = None) -> dict:
    """Helper for strict JSON schemas: every property required, no extras."""
    return {"type": "object", "properties": properties, "required": required or list(properties),
            "additionalProperties": False}
