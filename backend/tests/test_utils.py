"""Audio Processing Utilities Unit Tests."""

from app.utils.audio_processing import (
    StreamingThoughtScrubber,
    extract_complete_sentences,
    sanitize_text_for_tts,
)


def test_sentence_chunking_with_abbreviations():
    """Verify sentence extractor does not prematurely split on abbreviations or decimals."""
    text = "Hello Dr. Sharma! Your appointment fee is 3.14 dollars. Are you coming"
    sentences, tail = extract_complete_sentences(text, flush_all=False)

    assert len(sentences) == 2
    assert sentences[0] == "Hello Dr. Sharma!"
    assert sentences[1] == "Your appointment fee is 3.14 dollars."
    assert tail.strip() == "Are you coming"


def test_sentence_chunking_flush_all():
    """Verify flush_all yields trailing incomplete sentences."""
    text = "This is sentence one. Trailing text without punctuation"
    sentences, tail = extract_complete_sentences(text, flush_all=True)

    assert len(sentences) == 2
    assert sentences[0] == "This is sentence one."
    assert sentences[1] == "Trailing text without punctuation"
    assert tail == ""


def test_streaming_thought_scrubber():
    """Verify scrubber removes <thought> blocks across streaming token chunks."""
    scrubber = StreamingThoughtScrubber()
    chunks = [
        "Hello! ",
        "<thought>User seems ",
        "happy and ready.</thought>",
        "How can I assist ",
        "you today?",
    ]

    emitted = "".join(scrubber.process(c) for c in chunks) + scrubber.flush()
    assert "<thought>" not in emitted
    assert "happy and ready" not in emitted
    assert "Hello! How can I assist you today?" in emitted


def test_sanitize_text_for_tts():
    """Verify markdown and emojis are stripped for clean speech synthesis."""
    raw = (
        "### Hello!\n"
        "Here is **important** news: [Click Here](https://example.com).\n"
        "| Day | Time |\n| Monday | 10am |\n"
        "Have a great day! 😊🎉"
    )
    cleaned = sanitize_text_for_tts(raw)

    assert "###" not in cleaned
    assert "**" not in cleaned
    assert "Click Here" in cleaned
    assert "https://example.com" not in cleaned
    assert "😊" not in cleaned
    assert "🎉" not in cleaned
    assert "Have a great day!" in cleaned

