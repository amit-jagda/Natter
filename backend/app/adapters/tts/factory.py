"""TTS Provider Factory.

Dynamically resolves, configures, and caches Text-to-Speech provider instances.
"""

import logging
from typing import Dict, Optional

from app.adapters.tts.base import MockTTSAdapter, TTSProvider
from app.adapters.tts.gtts import GTTSAdapter
from app.adapters.tts.piper import PiperTTSAdapter
from app.core.config import settings
from app.core.exceptions import ProviderConfigurationError

logger = logging.getLogger(__name__)

_PROVIDER_CACHE: Dict[str, TTSProvider] = {}


def get_tts_provider(provider_name: Optional[str] = None) -> TTSProvider:
    """Resolve and return a TTS provider instance based on settings or explicit name.

    Args:
        provider_name: Optional provider identifier ("piper", "gtts", "mock").
                      Defaults to settings.TTS_PROVIDER.

    Returns:
        Configured TTSProvider instance.

    Raises:
        ProviderConfigurationError: If an unsupported provider is requested.
    """
    target = (provider_name or settings.TTS_PROVIDER or "mock").strip().lower()

    if target in _PROVIDER_CACHE:
        return _PROVIDER_CACHE[target]

    if target == "piper":
        provider = PiperTTSAdapter()
        _PROVIDER_CACHE[target] = provider
        logger.info(f"Initialized PiperTTSAdapter (default_voice='{provider.default_voice}')")
        return provider

    if target == "gtts":
        provider = GTTSAdapter()
        _PROVIDER_CACHE[target] = provider
        logger.info("Initialized GTTSAdapter")
        return provider

    if target == "mock":
        provider = MockTTSAdapter()
        _PROVIDER_CACHE[target] = provider
        logger.info("Initialized MockTTSAdapter")
        return provider

    raise ProviderConfigurationError(
        f"Unsupported TTS provider '{target}'. Supported providers: 'piper', 'gtts', 'mock'."
    )


def reset_tts_provider_cache() -> None:
    """Clear cached TTS provider instances (useful for testing)."""
    _PROVIDER_CACHE.clear()

