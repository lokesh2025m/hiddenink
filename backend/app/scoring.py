"""Layer 4: an explainable risk score from 0 to 100."""
from __future__ import annotations

TECHNIQUE_POINTS = {
    "unicode_tags": 35, "invisible_render": 25, "low_contrast": 25, "docx_hidden_run": 25,
    "off_page": 20, "covered": 20, "zero_width": 20, "visibility_gap": 20,
    "tiny_font": 15, "embedded_file": 15, "annotation": 10, "form_field": 10,
    "bidi_override": 10, "metadata": 5, "docx_comment": 5,
}
CATEGORY_MULT = {"prompt_injection": 1.6, "data_exfiltration": 1.6, "keyword_stuffing": 1.0,
                 "unclassified": 0.8, "benign_hidden": 0.25}
SEVERITY_MULT = {"high": 1.25, "medium": 1.0, "low": 0.6}
# Judgement-call techniques: a vision model reading the text is real evidence it may be visible.
# Every other technique is a physical fact about the file, so the vision read cannot discount it.
SOFT_TECHNIQUES = {"low_contrast", "tiny_font"}
ATTACKS = ("prompt_injection", "data_exfiltration")


def _points(f: dict, category: str, severity: str) -> tuple[float, int]:
    base = max((TECHNIQUE_POINTS.get(t, 10) for t in f["techniques"]), default=10)
    return base * CATEGORY_MULT.get(category, 1.0) * SEVERITY_MULT.get(severity, 1.0), base


def _discounted(f: dict) -> bool:
    """Vision saw it, every technique is a judgement call, and no instruction pattern was found."""
    return bool(f.get("vision_seen")) and set(f["techniques"]) <= SOFT_TECHNIQUES and not f.get("regex_hits")


def score(findings: list[dict]) -> tuple[int, str, list[dict]]:
    breakdown: list[dict] = []
    total = 0.0
    for f in findings:
        # The deterministic label is a floor: the LLM label can raise the points, never lower them,
        # so the same file gets the same minimum score whatever the model says on a given run.
        det_cat, det_sev = f.get("det_category", f["category"]), f.get("det_severity", f["severity"])
        det_pts, base = _points(f, det_cat, det_sev)
        llm_pts, _ = _points(f, f["category"], f["severity"])
        pts = max(det_pts, llm_pts)
        cat, sev = (f["category"], f["severity"]) if llm_pts >= det_pts else (det_cat, det_sev)
        reasons = [f"{'+'.join(f['techniques'])} ({base})", f"{cat} x{CATEGORY_MULT.get(cat, 1.0)}",
                   f"{sev} x{SEVERITY_MULT.get(sev, 1.0)}"]
        bonus = min(20, 5 * len(f.get("regex_hits", [])))
        if bonus:
            reasons.append(f"+{bonus} instruction patterns")
        if f.get("payload_matches"):
            bonus += 10
            reasons.append("+10 matches confirmed attacks")
        if _discounted(f):
            pts *= 0.5
            reasons.append("x0.5 vision model could see it")
        pts += bonus
        total += pts
        breakdown.append({"finding_id": f["id"], "points": round(pts, 1), "reasons": reasons})

    risk = int(min(100, round(total)))
    has_attack = any(((f["category"] in ATTACKS and f["severity"] == "high")
                      or (f.get("det_category") in ATTACKS and f.get("det_severity") == "high"))
                     and not _discounted(f) for f in findings)
    # Any substantial hidden text that is not known to be harmless deserves a human look.
    # Uses the deterministic label, so an LLM calling it "benign" cannot drop a hidden payload to Clean.
    needs_look = any(f.get("det_category", f["category"]) != "benign_hidden" and len(f["text"]) >= 20
                     and not _discounted(f) for f in findings)
    if risk >= 60 or has_attack:
        verdict = "Poisoned"
        risk = max(risk, 60)
    elif risk >= 15 or needs_look:
        risk = max(risk, 15)
        verdict = "Suspicious"
    else:
        verdict = "Clean"
    return risk, verdict, breakdown