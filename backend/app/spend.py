"""Running OpenAI spend tracker, kept in a small JSON file (config.SPEND_FILE).

llm.py calls record() after every API call, under its own lock. The running total is loaded
once and re-read only if the file changed underneath us (e.g. `python -m app.spend reset`
while the server is running), so a reset takes effect without a restart.

Usage:
  python -m app.spend show     # print the running total
  python -m app.spend reset    # set the total back to 0 (e.g. after topping up)
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from . import config

_total: float | None = None
_seen: tuple[str, float | None] | None = None  # (path, mtime) of the file our total came from


def _path() -> Path:
    return Path(config.SPEND_FILE)


def _mtime(p: Path) -> float | None:
    try:
        return os.path.getmtime(p)
    except OSError:
        return None


def _read(p: Path) -> float:
    try:
        return float(json.loads(p.read_text(encoding="utf-8")).get("total_usd", 0.0))
    except (OSError, ValueError, TypeError, AttributeError):
        return 0.0  # missing or corrupt file: start again from zero


def _write(p: Path, total: float) -> None:
    global _seen
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"total_usd": round(total, 8), "limit_usd": config.SPEND_LIMIT_USD}, indent=2), encoding="utf-8")
    _seen = (str(p), _mtime(p))


def current() -> float:
    """The running total in USD, loading it the first time (or after the file changed)."""
    global _total, _seen
    p = _path()
    mtime = _mtime(p)
    if _total is None or _seen != (str(p), mtime):
        _total = _read(p)
        if mtime is None:
            _write(p, _total)  # create the file on first use
        else:
            _seen = (str(p), mtime)
    return _total


def price(model: str) -> tuple[dict[str, float], bool]:
    """(price per 1M tokens, known). Dated model ids like gpt-5-mini-2025-08-07 match their base name."""
    if model in config.PRICES:
        return config.PRICES[model], True
    for name in sorted(config.PRICES, key=len, reverse=True):
        if model.startswith(name + "-"):
            return config.PRICES[name], True
    return config.PRICES.get(config.DEFAULT_PRICE_MODEL, {"in": 0.25, "out": 2.00}), False


def record(model: str, tokens_in: int, tokens_out: int) -> tuple[float, float]:
    """Add one call's cost to the total, save it, and print one [spend] line. Returns (cost, total)."""
    global _total
    p, known = price(model)
    cost = tokens_in / 1e6 * p["in"] + tokens_out / 1e6 * p["out"]
    total = current() + cost
    _total = total
    _write(_path(), total)
    limit = config.SPEND_LIMIT_USD
    share = total / limit * 100 if limit > 0 else 0.0
    line = (f"[spend] ${cost:.4f} this call ({model}, {tokens_in} in / {tokens_out} out) | "
            f"${total:.4f} / ${limit:.2f} used ({share:.1f}%)")
    if not known:
        line += " (price unknown, estimated)"
    if limit > 0 and total > 0.8 * limit:
        line += " WARNING: over 80% of budget"
    print(line, flush=True)
    return cost, total


def hard_stop_reached() -> bool:
    """True once the tracked total is at or over SPEND_HARD_STOP_PCT of the limit."""
    limit = config.SPEND_LIMIT_USD
    return limit > 0 and current() >= limit * config.SPEND_HARD_STOP_PCT / 100


def summary() -> dict:
    total, limit = current(), config.SPEND_LIMIT_USD
    return {"total_usd": round(total, 6), "limit_usd": limit, "percent": round(total / limit * 100, 1) if limit > 0 else None}


def reset() -> None:
    global _total
    _total = 0.0
    _write(_path(), 0.0)


def main(argv: list[str] | None = None) -> None:
    cmd = (argv if argv is not None else sys.argv[1:]) or ["show"]
    if cmd[0] == "reset":
        reset()
        print(f"Spend reset to $0.0000 ({_path()})")
    elif cmd[0] == "show":
        s = summary()
        pct = "n/a" if s["percent"] is None else f"{s['percent']:.1f}%"
        print(f"${s['total_usd']:.4f} / ${s['limit_usd']:.2f} used ({pct})  [{_path()}]")
    else:
        sys.exit("Usage: python -m app.spend [show|reset]")


if __name__ == "__main__":
    main()
