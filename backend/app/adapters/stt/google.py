"""Google Gemini Speech-to-Text (STT) Adapter.

Uses Google Gemini REST API (generateContent) with inline audio data for high-accuracy
transcription of Hindi, English, and Hinglish speech.
"""

import base64
import logging
import os
import re
from typing import Any, Dict, Optional

from app.adapters.stt.base import STTProvider, STTResult
from app.core.config import settings
from app.core.exceptions import (
    ProviderConfigurationError,
    ProviderUnavailableError,
    SpeechToTextError,
)


logger = logging.getLogger(__name__)

TRANSCRIPTION_SYSTEM_PROMPT = (
    "Transcribe the audio verbatim. Output ONLY the exact transcribed speech "
    "in the original spoken language (Hindi, English, or Hinglish). Do NOT reply to "
    "the speaker, do NOT add commentary, notes, translation, or introductory text."
)

SUPPORTED_AUDIO_MIMES = {
    "audio/wav",
    "audio/x-wav",
    "audio/webm",
    "audio/ogg",
    "audio/mp3",
    "audio/mpeg",
    "audio/flac",
    "audio/m4a",
    "audio/aac",
}


class GoogleSTTAdapter(STTProvider):
    """Concrete STT adapter powered by Google Gemini generative audio transcription."""

    name = "google"

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        base_url: str = "https://generativelanguage.googleapis.com",
        timeout: float = 30.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model or getattr(settings, "GOOGLE_STT_MODEL", "gemini-3.5-flash-lite")
        self.timeout = timeout
        self._explicit_api_key = api_key

    def _resolve_api_key(self) -> Optional[str]:
        """Resolve Google API key from explicit injection, settings, or environment."""
        candidates = [
            self._explicit_api_key,
            getattr(settings, "GOOGLE_API_KEY", None),
            os.environ.get("GOOGLE_API_KEY"),
            os.environ.get("GEMINI_API_KEY"),
        ]
        for key in candidates:
            if key and not key.strip().startswith("your_") and len(key.strip()) > 15:
                return key.strip()
        return None

    def is_configured(self) -> bool:
        """Check whether a valid API key is present."""
        return self._resolve_api_key() is not None

    def _normalize_mime(self, content_type: Optional[str]) -> str:
        """Strip parameters (such as ;codecs=opus) and normalize audio MIME type."""
        if not content_type:
            return "audio/wav"

        # Strip codec suffix e.g. "audio/webm;codecs=opus" -> "audio/webm"
        clean = content_type.split(";")[0].strip().lower()

        if clean in ("audio/x-wav", "audio/wave"):
            return "audio/wav"
        if clean in ("audio/mp3", "audio/mpeg3"):
            return "audio/mpeg"

        if clean in SUPPORTED_AUDIO_MIMES:
            return clean

        # Default fallback
        return "audio/wav"

    def _build_payload(
        self,
        audio: bytes,
        clean_mime: str,
        language: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Build request payload for the Gemini generateContent endpoint."""
        prompt = TRANSCRIPTION_SYSTEM_PROMPT
        if language:
            prompt += f" The primary language is {language}."

        encoded_audio = base64.b64encode(audio).decode("ascii")

        return {
            "contents": [
                {
                    "parts": [
                        {
                            "inlineData": {
                                "mimeType": clean_mime,
                                "data": encoded_audio,
                            }
                        },
                        {"text": prompt},
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0.0,
                "maxOutputTokens": 1024,
            },
        }

    async def transcribe(
        self,
        audio: bytes,
        *,
        content_type: str = "audio/wav",
        language: Optional[str] = None,
    ) -> STTResult:
        """Transcribe audio bytes using Google Gemini API."""
        if not audio or len(audio) < 100:
            raise SpeechToTextError(
                "Audio data is empty or too short (< 100 bytes) for transcription."
            )

        api_key = self._resolve_api_key()
        if not api_key:
            raise ProviderConfigurationError(
                "Google API key not configured for STT. Please set GOOGLE_API_KEY in .env."
            )

        clean_mime = self._normalize_mime(content_type)
        payload = self._build_payload(audio, clean_mime, language)

        url = f"{self.base_url}/v1beta/models/{self.model}:generateContent"
        params = {"key": api_key}

        try:
            import httpx
        except ImportError as exc:
            raise ProviderUnavailableError(
                "The 'httpx' library is required for GoogleSTTAdapter. Run 'pip install httpx'."
            ) from exc

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(url, params=params, json=payload)
        except httpx.TimeoutException as exc:
            logger.error(f"Google STT timed out after {self.timeout}s")
            raise SpeechToTextError(
                f"Google STT request timed out after {self.timeout} seconds."
            ) from exc
        except httpx.RequestError as exc:
            logger.error(f"Google STT network error: {exc}")
            raise SpeechToTextError(f"Network error during speech transcription: {exc}") from exc

        if response.status_code in (401, 403):
            err_msg = response.text[:250]
            logger.error(f"Google STT authentication rejected ({response.status_code}): {err_msg}")
            raise ProviderConfigurationError(
                f"Google STT API key was rejected: {err_msg}"
            )

        if response.is_error:
            err_msg = response.text[:300]
            logger.error(f"Google STT returned HTTP {response.status_code}: {err_msg}")
            raise SpeechToTextError(
                f"Google STT service error (HTTP {response.status_code}): {err_msg}"
            )

        try:
            data = response.json()
            candidates = data.get("candidates", [])
            if not candidates:
                raise SpeechToTextError("Google STT returned no transcription candidates.")

            parts = candidates[0].get("content", {}).get("parts", [])
            raw_text = "".join(part.get("text", "") for part in parts).strip()

            # Scrub any internal thoughts or tags
            transcript = re.sub(r"<thought>.*?</thought>", "", raw_text, flags=re.DOTALL).strip()
            # Remove enclosing quotes if returned
            if transcript.startswith('"') and transcript.endswith('"') and len(transcript) > 1:
                transcript = transcript[1:-1].strip()

        except (ValueError, KeyError, IndexError, TypeError) as exc:
            logger.error(f"Failed to parse Google STT response: {exc}")
            raise SpeechToTextError(
                "Invalid response format received from Google STT service."
            ) from exc

        if not transcript:
            raise SpeechToTextError("Google STT produced an empty transcription.")

        return STTResult(
            transcript=transcript,
            language=language or "en",
            confidence=0.95,
        )
