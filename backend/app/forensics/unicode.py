"""Detection of invisible and deceptive Unicode characters."""
from __future__ import annotations

import re

ZERO_WIDTH = {
    "\u200b": "ZERO WIDTH SPACE",
    "\u200c": "ZERO WIDTH NON-JOINER",
    "\u200d": "ZERO WIDTH JOINER",
    "\u2060": "WORD JOINER",
    "\u2061": "FUNCTION APPLICATION",
    "\u2062": "INVISIBLE TIMES",
    "\u2063": "INVISIBLE SEPARATOR",
    "\u2064": "INVISIBLE PLUS",
    "\ufeff": "ZERO WIDTH NO-BREAK SPACE",
    "\u180e": "MONGOLIAN VOWEL SEPARATOR",
}
BIDI = {
    "\u202a", "\u202b", "\u202c", "\u202d", "\u202e",
    "\u2066", "\u2067", "\u2068", "\u2069",
}
TAG_RANGE = (0xE0000, 0xE007F)

_INVISIBLE_RE = re.compile(
    "[" + "".join(ZERO_WIDTH) + "".join(BIDI) + "\U000e0000-\U000e007f" + "]"
)


def is_tag(ch: str) -> bool:
    return TAG_RANGE[0] <= ord(ch) <= TAG_RANGE[1]


def decode_tags(text: str) -> str:
    """Unicode tag characters mirror ASCII (U+E0041 = 'A'); decode the hidden message."""
    return "".join(chr(ord(c) - 0xE0000) for c in text if is_tag(c) and 0x20 <= ord(c) - 0xE0000 <= 0x7E)


def strip_invisible(text: str) -> str:
    return _INVISIBLE_RE.sub("", text)


def analyse(text: str) -> list[dict]:
    """Return one finding dict per kind of invisible-character abuse found in `text`."""
    out: list[dict] = []
    zw = [c for c in text if c in ZERO_WIDTH]
    tags = [c for c in text if is_tag(c)]
    bidi = [c for c in text if c in BIDI]

    if tags:
        decoded = decode_tags(text)
        out.append({
            "technique": "unicode_tags",
            "text": decoded or "(undecodable tag characters)",
            "detail": f"{len(tags)} invisible Unicode tag characters encode hidden ASCII text.",
        })
    if zw:
        # Zero-width characters are sometimes used to smuggle binary-encoded text,
        # or to break up keywords so filters miss them. A handful is normal (e.g. from Word).
        hidden = _decode_zero_width_binary(text)
        if len(zw) >= 8 or hidden:
            out.append({
                "technique": "zero_width",
                "text": hidden or f"{len(zw)} zero-width characters",
                "detail": f"{len(zw)} zero-width characters ({', '.join(sorted({ZERO_WIDTH[c] for c in zw}))}).",
            })
    if bidi:
        out.append({
            "technique": "bidi_override",
            "text": f"{len(bidi)} bidirectional control characters",
            "detail": "Bidirectional overrides can make displayed text differ from the stored text.",
        })
    return out


def _decode_zero_width_binary(text: str) -> str:
    """Decode the common ZWSP=0 / ZWNJ=1 binary smuggling scheme, if present."""
    bits = "".join("0" if c == "\u200b" else "1" for c in text if c in ("\u200b", "\u200c"))
    if len(bits) < 16:
        return ""
    raw = bytes(int(bits[i:i + 8], 2) for i in range(0, len(bits) - 7, 8))
    try:
        decoded = raw.decode("utf-8")
    except UnicodeDecodeError:
        return ""
    if not decoded or any(ord(c) < 32 and c not in "\n\t" for c in decoded):
        return ""
    return decoded if len(decoded) >= 2 else ""


def encode_zero_width_binary(message: str) -> str:
    """Inverse of _decode_zero_width_binary (used by the Red-Team Lab)."""
    return "".join("\u200b" if b == "0" else "\u200c" for byte in message.encode("utf-8") for b in format(byte, "08b"))


def encode_tags(message: str) -> str:
    return "".join(chr(0xE0000 + ord(c)) for c in message if 0x20 <= ord(c) <= 0x7E)


def meta_worth_reporting(text: str) -> bool:
    """Short titles like "Resume" are normal metadata; long or sentence-like text, or text in a
    different script from a typical title, is worth showing to the classifier."""
    if not text:
        return False
    from ..classify import regex_hits  # local import avoids a cycle
    value = re.sub(r"^\w+:\s*", "", text)
    if len(value) >= 40 or regex_hits(value):
        return True
    non_latin = sum(1 for c in value if ord(c) > 0x2E80)
    return non_latin >= 4 or len(value.split()) >= 7
