"""Audio and Text Processing Utilities.

Reuses proven real-time streaming components from virtual-buddy-backend:
1. Sentence boundary detection with abbreviation & decimal guards.
2. Real-time thought scrubber for LLM token streams.
3. Spoken text sanitizer removing markdown, links, and emojis for clean TTS audio.
"""

import re
from typing import List, Optional, Tuple

_SENTENCE_END_RE = re.compile(r'[.!?।]+[\s"\')\]]*')
_ABBREV_GUARD = re.compile(r'(?:^|\s)(\w{1,2})$')
_KNOWN_ABBREVIATIONS = {
    "dr", "mr", "mrs", "ms", "prof", "rev", "etc", "vs", "no", "st",
    "mt", "jr", "sr", "vol", "fig", "dept", "ltd", "inc", "co",
}

_OPEN_TAG_RE = re.compile(r"<thought(?:s)?>|<state>", re.IGNORECASE)
_CLOSE_TAG_RE = re.compile(r"</thought(?:s)?>|</state>", re.IGNORECASE)
_NUMBERED_META_LINE_RE = re.compile(
    r"(?m)^\s*\d+\.\s*(?:User Emotion|State|Past Memory|Memory|Tone|Language|Strategy):.*$\n?",
    re.IGNORECASE,
)
_RESIDUAL_THOUGHT_TAG_RE = re.compile(r"</?thought(?:s)?>|</?state>", re.IGNORECASE)

_EMOJI_PATTERN = re.compile(
    r"[\U00010000-\U0010ffff"
    r"\u2600-\u27bf"
    r"\u2300-\u23ff"
    r"\u2b50-\u2b55"
    r"\u200d"
    r"\ufe0f"
    r"]+",
    flags=re.UNICODE,
)


def extract_complete_sentences(buffer: str, flush_all: bool = False) -> Tuple[List[str], str]:
    """Split a streaming text buffer into complete sentences, holding back incomplete tails.

    Guards against premature splits on decimal numbers (e.g., "3.14") and common
    abbreviations (e.g., "Dr.", "Mr.").

    Args:
        buffer: Accumulated text seen so far.
        flush_all: When True, treats any trailing remainder as a completed sentence.

    Returns:
        Tuple of (list_of_completed_sentences, remaining_incomplete_tail)
    """
    sentences: List[str] = []
    last_end = 0

    for m in _SENTENCE_END_RE.finditer(buffer):
        end = m.end()
        candidate = buffer[last_end:end].strip()
        if len(candidate) < 2:
            continue
        # Guard against decimal numbers: e.g. "3.14"
        if buffer[m.start()] == "." and m.start() + 1 < len(buffer) and buffer[m.start() + 1].isdigit():
            continue
        # Guard against abbreviations: e.g. "Dr. Patel"
        prefix = buffer[last_end:m.start()]
        abbrev = _ABBREV_GUARD.search(prefix)
        if abbrev and buffer[m.start()] == "." and abbrev.group(1).lower() in _KNOWN_ABBREVIATIONS:
            continue

        sentences.append(candidate)
        last_end = end

    remainder = buffer[last_end:]
    if flush_all and remainder.strip():
        sentences.append(remainder.strip())
        remainder = ""

    return sentences, remainder


class StreamingThoughtScrubber:
    """Strips inner-monologue tags (<thought>...</thought>, <state>...</state>) in-flight.

    Streaming-safe: holds back up to 18 characters across chunk boundaries to ensure
    split tags (e.g., chunk 1: '<tho', chunk 2: 'ught>') are recognized whole.
    """

    _HOLD = 18

    def __init__(self) -> None:
        self.in_block = False
        self._tail = ""

    def process(self, chunk: Optional[str]) -> str:
        """Process an incoming token chunk and return clean, thought-stripped text."""
        if not chunk:
            return ""
        text = self._tail + chunk
        self._tail = ""
        emitted, self.in_block, self._tail = self._scan(text, self._HOLD)
        return emitted

    def flush(self) -> str:
        """Flush any held-back trailing characters once the stream terminates."""
        if not self._tail:
            return ""
        emitted, _, _ = self._scan(self._tail, 0)
        self._tail = ""
        self.in_block = False
        return _RESIDUAL_THOUGHT_TAG_RE.sub("", _NUMBERED_META_LINE_RE.sub("", emitted))

    def _scan(self, text: str, hold: int) -> Tuple[str, bool, str]:
        out: List[str] = []
        pos = 0
        in_block = self.in_block

        while True:
            boundary = max(len(text) - hold, pos)
            if in_block:
                close = _CLOSE_TAG_RE.search(text, pos)
                if close is None:
                    return "".join(out), True, text[boundary:]
                in_block = False
                pos = close.end()
                continue

            open_hit = _OPEN_TAG_RE.search(text, pos)
            if open_hit is None:
                if boundary > pos:
                    out.append(_NUMBERED_META_LINE_RE.sub("", text[pos:boundary]))
                return "".join(out), False, text[boundary:]

            if open_hit.start() >= boundary:
                if boundary > pos:
                    out.append(_NUMBERED_META_LINE_RE.sub("", text[pos:boundary]))
                return "".join(out), True, text[boundary:]

            if open_hit.start() > pos:
                out.append(_NUMBERED_META_LINE_RE.sub("", text[pos:open_hit.start()]))

            return "".join(out), True, text[open_hit.start():]


def sanitize_text_for_tts(text: Optional[str]) -> str:
    """Convert LLM markdown into plain, natural speech for Text-to-Speech synthesis.

    Strips code fences, heading symbols, markdown links, bullet markers, and emojis
    so neural voices speak naturally without vocalizing markdown artifacts.
    """
    if not text:
        return ""

    # 1. Remove code blocks and un-wrap inline code
    text = re.sub(r"```.*?```", " ", text, flags=re.DOTALL)
    text = re.sub(r"`([^`]+)`", r"\1", text)

    # 2. Remove markdown headings (#, ##, ###)
    text = re.sub(r"(?m)^\s{0,3}#{1,6}\s*", "", text)

    # 3. Unwrap markdown links: [Label](url) -> Label
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)

    # 4. Flatten table rows into readable lines
    lines = []
    for raw_line in text.split("\n"):
        line = raw_line.strip()
        if "|" in line:
            cells = [c.strip() for c in line.strip("|").split("|")]
            if cells and not all(re.fullmatch(r"[\s\-:]+", c) for c in cells):
                line = " ".join(c for c in cells if c)
            else:
                continue
        lines.append(line)
    text = "\n".join(lines)

    # 5. Remove bold and italic emphasis markers
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"__(.+?)__", r"\1", text, flags=re.DOTALL)

    # 6. Remove list markers (*, -, •)
    text = re.sub(r"(?m)^\s*[-*•]\s+", "", text)

    # 7. Remove emojis and stray non-target-script model artifacts (e.g. Arabic/CJK glitches)
    text = _EMOJI_PATTERN.sub("", text)
    text = re.sub(r"-?[\u0600-\u06FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]+", "", text)

    # 8. Normalize spacing
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()

