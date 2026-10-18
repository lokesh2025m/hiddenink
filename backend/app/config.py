"""Runtime configuration, read from environment variables only.

Secrets (OpenAI key, JWT secret, MongoDB URI) are never hard-coded or logged.
"""
import os
import secrets
from pathlib import Path


def _load_dotenv() -> None:
    """Read backend/.env for local development. Real environment variables always win."""
    path = Path(__file__).resolve().parent.parent / ".env"
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()


def _bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).lower() in {"1", "true", "yes"}


OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_TEXT_MODEL = os.getenv("OPENAI_TEXT_MODEL", "gpt-5.4-mini")
OPENAI_VISION_MODEL = os.getenv("OPENAI_VISION_MODEL", "gpt-5.4")
OPENAI_EMBED_MODEL = os.getenv("OPENAI_EMBED_MODEL", "text-embedding-3-small")
OPENAI_REASONING_EFFORT = os.getenv("OPENAI_REASONING_EFFORT", "low")  # set empty for non-reasoning models
OPENAI_TIMEOUT = float(os.getenv("OPENAI_TIMEOUT", "60"))
# Cheaper model for tasks where quality barely matters: the classifier (its regex floor still wins) and the
# Red-Team payload writer. The screeners keep OPENAI_TEXT_MODEL; transcription keeps OPENAI_VISION_MODEL.
OPENAI_CHEAP_MODEL = os.getenv("OPENAI_CHEAP_MODEL", "gpt-5.4-nano")

# Reasoning effort per task (reasoning models only). "minimal" falls back to "low" if the API rejects it.
REASONING_VISION = os.getenv("REASONING_VISION", "minimal")
REASONING_CLASSIFY = os.getenv("REASONING_CLASSIFY", "minimal")
REASONING_SCREEN = os.getenv("REASONING_SCREEN", "low")
REASONING_PAYLOAD = os.getenv("REASONING_PAYLOAD", "minimal")

# Output token caps per task. A response cut off at the cap is retried once with double the cap.
MAX_TOKENS_VISION = int(os.getenv("MAX_TOKENS_VISION", "4000"))
MAX_TOKENS_CLASSIFY = int(os.getenv("MAX_TOKENS_CLASSIFY", "2000"))
MAX_TOKENS_SCREEN = int(os.getenv("MAX_TOKENS_SCREEN", "2500"))
MAX_TOKENS_PAYLOAD = int(os.getenv("MAX_TOKENS_PAYLOAD", "1500"))

# Model answers that can be reused (classifier, Red-Team baselines) are cached in MongoDB for this long.
LLM_CACHE_DAYS = int(os.getenv("LLM_CACHE_DAYS", "30"))

# If MONGODB_URI is empty, an in-memory database is used (fine for local demos).
MONGODB_URI = os.getenv("MONGODB_URI", "")
MONGODB_DB = os.getenv("MONGODB_DB", "hiddenink")

# A random secret is generated per process if none is set: tokens then expire on restart.
JWT_SECRET = os.getenv("JWT_SECRET") or secrets.token_urlsafe(48)
JWT_TTL_HOURS = int(os.getenv("JWT_TTL_HOURS", "12"))

CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]

MAX_FILE_MB = float(os.getenv("MAX_FILE_MB", "10"))
MAX_PAGES = int(os.getenv("MAX_PAGES", "5"))
RETENTION_DAYS = int(os.getenv("RETENTION_DAYS", "30"))
RATE_LIMIT_SCAN = os.getenv("RATE_LIMIT_SCAN", "10/minute")
RATE_LIMIT_REDTEAM = os.getenv("RATE_LIMIT_REDTEAM", "5/minute")

# Red-Team Lab cost caps per fuzz round.
FUZZ_MAX_ATTACKS = int(os.getenv("FUZZ_MAX_ATTACKS", "30"))
FUZZ_TOKEN_BUDGET = int(os.getenv("FUZZ_TOKEN_BUDGET", "200000"))

ENABLE_DEMO_ACCOUNT = _bool("ENABLE_DEMO_ACCOUNT", True)
# Free trial (demo) limits. Per trial session: AI-backed scans (later scans run deterministic checks only)
# and Red-Team attacks. Across all trials: OpenAI calls per UTC day. New trials per IP address.
DEMO_AI_SCANS = int(os.getenv("DEMO_AI_SCANS", "10"))
DEMO_REDTEAM_ATTACKS = int(os.getenv("DEMO_REDTEAM_ATTACKS", "5"))
DEMO_DAILY_AI_CALLS = int(os.getenv("DEMO_DAILY_AI_CALLS", "200"))
DEMO_IDLE_HOURS = float(os.getenv("DEMO_IDLE_HOURS", "2"))
RATE_LIMIT_DEMO = os.getenv("RATE_LIMIT_DEMO", "5/hour")

# OpenAI spend tracker (see app/spend.py). Prices are USD per 1M tokens.
SPEND_LIMIT_USD = float(os.getenv("SPEND_LIMIT_USD", "1.00"))
SPEND_FILE = Path(os.getenv("SPEND_FILE") or Path(__file__).resolve().parent.parent / "eval" / "results" / "spend.json")
SPEND_HARD_STOP_PCT = float(os.getenv("SPEND_HARD_STOP_PCT", "95"))  # block OpenAI calls at this share of the limit
DEFAULT_PRICE_MODEL = "gpt-5-mini"  # used, and flagged as an estimate, for models not listed in PRICES
PRICES: dict[str, dict[str, float]] = {
    "gpt-5-mini": {"in": 0.25, "out": 2.00},
    "gpt-5.4-nano": {"in": 0.05, "out": 0.40},
    "gpt-4o-mini": {"in": 0.15, "out": 0.60},
    "text-embedding-3-small": {"in": 0.02, "out": 0},
}
if os.getenv("PRICES_JSON"):
    import json as _json
    PRICES = _json.loads(os.environ["PRICES_JSON"])


def openai_enabled() -> bool:
    return bool(OPENAI_API_KEY)
