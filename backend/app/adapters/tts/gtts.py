"""Google Text-to-Speech (gTTS) Adapter.

Lightweight fallback TTS adapter utilizing the gTTS library. Generates MP3 audio.
"""

import io
import logging
from typing import Optional

from app.adapters.tts.base import TTSProvider, TTSResult
from app.core.exceptions import (
    ProviderUnavailableError,
    TextToSpeechError,
)

logger = logging.getLogger(__name__)

LANG_MAP = {
    "en": "en",
    "english": "en",
    "hi": "hi",
    "hindi": "hi",
    "es": "es",
    "fr": "fr",
}


class GTTSAdapter(TTSProvider):
    """Fallback TTS provider using Google Text-to-Speech (gTTS)."""

    name = "gtts"

    def __init__(self, default_lang: str = "en") -> None:
        self.default_lang = default_lang

    def is_available(self) -> bool:
        """Verify if gTTS package is installed."""
        try:
            import gtts  # noqa: F401
            return True
        except ImportError:
            return False

    async def synthesize(
        self,
        text: str,
        *,
        language: Optional[str] = None,
        voice: Optional[str] = None,
        **kwargs,
    ) -> TTSResult:
        """Synthesize text to MP3 audio using gTTS."""
        if not text or not text.strip():
            raise TextToSpeechError("Text cannot be empty for synthesis.")

        try:
            from gtts import gTTS
        except ImportError as exc:
            raise ProviderUnavailableError(
                "gTTS library is not installed. Run 'pip install gTTS' or set TTS_PROVIDER=mock in .env."
            ) from exc

        target_lang = LANG_MAP.get((language or self.default_lang).lower(), "en")

        try:
            tts = gTTS(text=text.strip(), lang=target_lang)
            buf = io.BytesIO()
            tts.write_to_fp(buf)
            audio_bytes = buf.getvalue()

            return TTSResult(
                audio=audio_bytes,
                content_type="audio/mpeg",
                format="mp3",
                language=target_lang,
            )
        except Exception as exc:
            logger.error(f"gTTS synthesis failed: {exc}")
            raise TextToSpeechError(f"gTTS synthesis error: {exc}") from exc

