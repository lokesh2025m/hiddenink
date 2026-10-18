"""Layer 1 forensics for PDF files.

Every text span is read from PyMuPDF's text trace (which, unlike plain text
extraction, also returns off-page text and render-mode information), then
checked against the page as it is actually rendered.
"""
from __future__ import annotations

import base64
from dataclasses import dataclass, field

import numpy as np
import pymupdf

from . import unicode as uni
from .unicode import meta_worth_reporting as _meta_worth_reporting

RENDER_DPI = 110
TINY_FONT_PT = 4.0
MIN_CONTRAST = 1.6  # WCAG contrast ratio; below this text is effectively invisible
COVER_SHARE = 0.8  # share of a span's area hidden by a later-drawn shape or image
INK_DELTA = 40  # per-channel difference from the background that counts as visible ink
MIN_INK = 0.002  # a readable span with less ink than this is not actually visible


@dataclass
class Span:
    page: int
    seqno: int
    text: str
    bbox: tuple[float, float, float, float]
    size: float
    rgb: tuple[float, float, float]
    opacity: float
    render_type: int  # 0 fill, 1 stroke, 2 fill+stroke, 3 invisible
    techniques: list[str] = field(default_factory=list)
    details: list[str] = field(default_factory=list)

    @property
    def hidden(self) -> bool:
        return bool(self.techniques)


@dataclass
class PdfAnalysis:
    spans: list[Span]
    doc_findings: list[dict]  # metadata, annotations, form fields, embedded files, unicode
    pages: list[dict]  # index, width, height, image_b64
    page_texts: list[str]


def _to_rgb(color, n: int) -> tuple[float, float, float]:
    if not color:
        return (0.0, 0.0, 0.0)
    if n == 1:
        g = float(color[0])
        return (g, g, g)
    if n == 4:
        c, m, y, k = (float(v) for v in color[:4])
        return ((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k))
    r, g, b = (float(v) for v in color[:3])
    return (r, g, b)


def _luminance(rgb) -> float:
    def ch(c):
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(float(v)) for v in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(a, b) -> float:
    la, lb = _luminance(a), _luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def _area(r) -> float:
    return max(0.0, r[2] - r[0]) * max(0.0, r[3] - r[1])


def _intersect(a, b):
    return (max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3]))


def _background(pix_arr: np.ndarray, bbox, scale: float, page_rect):
    """Most common colour in the rendered area of a span (the glyphs themselves are a minority),
    plus the share of pixels that differ visibly from it ("ink")."""
    clip = _intersect(bbox, (page_rect.x0, page_rect.y0, page_rect.x1, page_rect.y1))
    if _area(clip) <= 0:
        return None, 0.0
    x0, y0 = int(clip[0] * scale), int(clip[1] * scale)
    x1, y1 = max(x0 + 1, int(clip[2] * scale)), max(y0 + 1, int(clip[3] * scale))
    region = pix_arr[y0:y1, x0:x1, :3]
    if region.size == 0:
        return None, 0.0
    flat = (region.reshape(-1, 3) // 8).astype(np.int32)  # quantise, then take the mode
    keys = flat[:, 0] * 1024 + flat[:, 1] * 32 + flat[:, 2]
    vals, counts = np.unique(keys, return_counts=True)
    k = int(vals[counts.argmax()])
    bg = (((k // 1024) * 8 + 4) / 255, (((k // 32) % 32) * 8 + 4) / 255, ((k % 32) * 8 + 4) / 255)
    diff = np.abs(region.reshape(-1, 3).astype(np.int32) - np.array([c * 255 for c in bg])).max(axis=1)
    return bg, float((diff > INK_DELTA).mean())


def analyse_pdf(data: bytes, max_pages: int) -> PdfAnalysis:
    doc = pymupdf.open(stream=data, filetype="pdf")
    if doc.needs_pass:
        raise ValueError("Password-protected PDFs are not supported.")
    if doc.page_count > max_pages:
        raise ValueError(f"PDF has {doc.page_count} pages; the limit is {max_pages}.")

    spans: list[Span] = []
    pages: list[dict] = []
    page_texts: list[str] = []
    doc_findings: list[dict] = []
    scale = RENDER_DPI / 72

    for pno, page in enumerate(doc):
        prect = page.rect
        pix = page.get_pixmap(dpi=RENDER_DPI, alpha=False)
        arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
        pages.append({
            "index": pno,
            "width": prect.width,
            "height": prect.height,
            "image_b64": base64.b64encode(pix.tobytes("png")).decode(),
        })
        bboxlog = page.get_bboxlog()
        page_spans: list[Span] = []

        for tr in page.get_texttrace():
            text = "".join(chr(c[0]) for c in tr["chars"])
            if not text.strip():
                continue
            s = Span(
                page=pno,
                seqno=tr.get("seqno", -1),
                text=text,
                bbox=tuple(tr["bbox"]),
                size=float(tr["size"]),
                rgb=_to_rgb(tr.get("color"), tr.get("colorspace", 3)),
                opacity=float(tr.get("opacity", 1.0) or 0.0),
                render_type=int(tr.get("type", 0)),
            )
            _check_span(s, prect, arr, scale, bboxlog)
            page_spans.append(s)

        spans.extend(page_spans)
        page_texts.append(_join_spans(page_spans))

        for annot in page.annots() or []:
            info = annot.info or {}
            content = " ".join(v for v in (info.get("content"), info.get("title"), info.get("subject")) if v)
            if content.strip():
                doc_findings.append({
                    "technique": "annotation", "page": pno, "bbox": list(annot.rect),
                    "text": content.strip(), "detail": f"{annot.type[1]} annotation (not part of the printed page).",
                })
        for w in page.widgets() or []:
            val = " ".join(str(v) for v in (w.field_value, w.field_label, w.field_name) if v)
            if val.strip():
                doc_findings.append({
                    "technique": "form_field", "page": pno, "bbox": list(w.rect),
                    "text": val.strip(), "detail": "Form field content.",
                })

    meta = doc.metadata or {}
    # Only free-text fields; producer/creator strings like "Microsoft Word" are normal.
    meta_text = " | ".join(f"{k}: {v}" for k, v in meta.items() if v and k in ("title", "subject", "keywords"))
    xmp = doc.get_xml_metadata() or ""
    if _meta_worth_reporting(meta_text):
        doc_findings.append({"technique": "metadata", "page": None, "bbox": None, "text": meta_text,
                             "detail": "Document information fields (not shown on the page)."})
    if len(xmp) > 0 and any(w in xmp.lower() for w in ("ignore", "instruction", "rate", "candidate", "system")):
        doc_findings.append({"technique": "metadata", "page": None, "bbox": None, "text": _strip_xml(xmp)[:2000],
                             "detail": "XMP metadata contains instruction-like text."})
    for name in doc.embfile_names():
        doc_findings.append({"technique": "embedded_file", "page": None, "bbox": None, "text": name,
                             "detail": "File embedded inside the PDF."})

    full = "\n".join(page_texts)
    for u in uni.analyse(full):
        doc_findings.append({"page": None, "bbox": None, **u})

    doc.close()
    return PdfAnalysis(spans=spans, doc_findings=doc_findings, pages=pages, page_texts=page_texts)


def _check_span(s: Span, prect, arr, scale, bboxlog) -> None:
    page_box = (prect.x0, prect.y0, prect.x1, prect.y1)
    area = _area(s.bbox) or 1e-6
    inside = _area(_intersect(s.bbox, page_box)) / area

    if s.render_type == 3 or s.opacity < 0.1:
        s.techniques.append("invisible_render")
        s.details.append("Text is drawn with invisible render mode or zero opacity.")
    if inside < 0.5:
        s.techniques.append("off_page")
        s.details.append("Text is positioned outside the visible page area.")
    if s.size < TINY_FONT_PT:
        s.techniques.append("tiny_font")
        s.details.append(f"Font size {s.size:.1f}pt is too small to read.")
    if s.techniques:
        return

    bg, ink = _background(arr, s.bbox, scale, prect)
    if bg is None:
        return
    ratio = contrast_ratio(s.rgb, bg)
    if ratio >= MIN_CONTRAST and ink < MIN_INK and len(s.text.strip()) >= 3:
        # The text should be clearly visible, but nothing shows on the rendered page.
        if _covered_by_later(s, bboxlog):
            s.techniques.append("covered")
            s.details.append("Text is covered by a shape or image drawn on top of it.")
        return
    if ratio < MIN_CONTRAST:
        if _covered_by_later(s, bboxlog):
            s.techniques.append("covered")
            s.details.append("Text is covered by a shape or image drawn on top of it.")
        else:
            s.techniques.append("low_contrast")
            s.details.append(f"Text colour has contrast {ratio:.2f}:1 against its background (needs at least {MIN_CONTRAST}:1).")


def _covered_by_later(s: Span, bboxlog) -> bool:
    if s.seqno < 0:
        return False
    area = _area(s.bbox) or 1e-6
    for kind, box in bboxlog[s.seqno + 1:]:
        if kind in ("fill-path", "fill-image", "fill-imgmask", "fill-shade"):
            if _area(_intersect(s.bbox, box)) / area >= COVER_SHARE:
                return True
    return False


def _join_spans(spans: list[Span]) -> str:
    """Join spans in reading order: top-to-bottom lines, left-to-right within a line."""
    ordered = sorted(spans, key=lambda s: (round(s.bbox[3] / 3), s.bbox[0]))
    lines: list[str] = []
    last_y = None
    for s in ordered:
        y = round(s.bbox[3] / 3)
        if last_y is not None and y == last_y:
            lines[-1] += " " + s.text.strip()
        else:
            lines.append(s.text.strip())
        last_y = y
    return "\n".join(lines)


def visible_text(spans: list[Span]) -> str:
    by_page: dict[int, list[Span]] = {}
    for s in spans:
        if not s.hidden:
            by_page.setdefault(s.page, []).append(s)
    return "\n\n".join(uni.strip_invisible(_join_spans(v)) for _, v in sorted(by_page.items()))


def _strip_xml(x: str) -> str:
    import re
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", x)).strip()
