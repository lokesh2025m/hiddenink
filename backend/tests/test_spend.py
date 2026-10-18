"""The OpenAI spend tracker: cost per call, running total, the [spend] line and the reset CLI."""
import json
from types import SimpleNamespace

import pytest

from app import config, llm, spend


@pytest.fixture
def spend_file(tmp_path, monkeypatch):
    path = tmp_path / "spend.json"
    monkeypatch.setattr(config, "SPEND_FILE", path)
    monkeypatch.setattr(config, "SPEND_LIMIT_USD", 1.00)
    monkeypatch.setattr(spend, "_total", None)
    monkeypatch.setattr(spend, "_seen", None)
    return path


def _resp(prompt_tokens, completion_tokens=None):
    usage = SimpleNamespace(prompt_tokens=prompt_tokens, total_tokens=prompt_tokens + (completion_tokens or 0))
    if completion_tokens is not None:
        usage.completion_tokens = completion_tokens
    return SimpleNamespace(usage=usage)


def test_cost_accumulates_and_prints(spend_file, capsys):
    llm._count(_resp(1000, 500), "gpt-5-mini")
    out = capsys.readouterr().out
    assert out == "[spend] $0.0013 this call (gpt-5-mini, 1000 in / 500 out) | $0.0013 / $1.00 used (0.1%)\n"
    assert json.loads(spend_file.read_text())["total_usd"] == pytest.approx(0.00125)

    llm._count(_resp(1000, 500), "gpt-5-mini")
    assert spend.current() == pytest.approx(0.0025)
    assert json.loads(spend_file.read_text())["total_usd"] == pytest.approx(0.0025)

    cost, _ = spend.record("gpt-5-mini", 1000, 500)
    assert cost == pytest.approx(0.00125)


def test_embeddings_unknown_models_and_warning(spend_file, capsys):
    llm._count(_resp(50_000), "text-embedding-3-small")  # embeddings: prompt tokens only
    assert "(text-embedding-3-small, 50000 in / 0 out)" in capsys.readouterr().out
    assert spend.current() == pytest.approx(0.001)

    spend.record("some-new-model", 1000, 500)
    assert capsys.readouterr().out.rstrip().endswith("(price unknown, estimated)")
    spend.record("gpt-5-mini-2025-08-07", 1000, 0)  # dated ids use their base model's price
    assert "estimated" not in capsys.readouterr().out

    spend.record("gpt-5-mini", 0, 400_000)  # +$0.80
    assert capsys.readouterr().out.rstrip().endswith(" WARNING: over 80% of budget")


def test_corrupt_file_reset_and_tracker_failures(spend_file, capsys, monkeypatch):
    spend_file.write_text("{not json")
    assert spend.current() == 0.0
    spend.record("gpt-5-mini", 1000, 500)
    spend.main(["reset"])
    assert spend.current() == 0.0 and json.loads(spend_file.read_text())["total_usd"] == 0.0
    spend.main(["show"])
    assert "$0.0000 / $1.00 used (0.0%)" in capsys.readouterr().out

    # A broken tracker never breaks the API call that triggered it.
    monkeypatch.setattr(spend, "record", lambda *a: 1 / 0)
    before = llm.tokens_used()
    llm._count(_resp(10, 5), "gpt-5-mini")
    assert llm.tokens_used() == before + 15


def test_spend_endpoint_is_for_real_accounts(spend_file):
    from fastapi.testclient import TestClient
    from app.main import app
    client = TestClient(app)
    demo = client.post("/api/auth/demo").json()["token"]
    assert client.get("/api/spend", headers={"Authorization": f"Bearer {demo}"}).status_code == 403
    r = client.post("/api/auth/register", json={"email": "spend@acme.test", "password": "correct-horse-9", "org_name": "Acme"})
    spend.record("gpt-5-mini", 1000, 500)
    s = client.get("/api/spend", headers={"Authorization": f"Bearer {r.json()['token']}"}).json()
    assert s == {"total_usd": 0.00125, "limit_usd": 1.0, "percent": 0.1}
