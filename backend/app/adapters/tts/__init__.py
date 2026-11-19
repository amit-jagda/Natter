"""TTS Adapter Package."""

from app.adapters.tts.base import MockTTSAdapter, TTSProvider, TTSResult
from app.adapters.tts.factory import get_tts_provider, reset_tts_provider_cache
from app.adapters.tts.gtts import GTTSAdapter
from app.adapters.tts.piper import PiperTTSAdapter

__all__ = [
    "TTSProvider",
    "TTSResult",
    "MockTTSAdapter",
    "PiperTTSAdapter",
    "GTTSAdapter",
    "get_tts_provider",
    "reset_tts_provider_cache",
]

