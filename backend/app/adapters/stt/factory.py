"""STT Provider Factory.

Dynamically resolves, configures, and caches Speech-to-Text provider instances.
"""

import logging
from typing import Dict, Optional

from app.adapters.stt.base import MockSTTAdapter, STTProvider
from app.adapters.stt.google import GoogleSTTAdapter
from app.core.config import settings
from app.core.exceptions import ProviderConfigurationError

logger = logging.getLogger(__name__)

_PROVIDER_CACHE: Dict[str, STTProvider] = {}


def get_stt_provider(provider_name: Optional[str] = None) -> STTProvider:
    """Resolve and return an STT provider instance based on settings or explicit name.

    Args:
        provider_name: Optional provider identifier ("google", "mock").
                      Defaults to settings.STT_PROVIDER.

    Returns:
        Configured STTProvider instance.

    Raises:
        ProviderConfigurationError: If an unsupported provider is requested.
    """
    target = (provider_name or settings.STT_PROVIDER or "mock").strip().lower()

    if target in _PROVIDER_CACHE:
        return _PROVIDER_CACHE[target]

    if target == "google":
        provider = GoogleSTTAdapter()
        _PROVIDER_CACHE[target] = provider
        logger.info(f"Initialized GoogleSTTAdapter with model '{provider.model}'")
        return provider

    if target == "mock":
        provider = MockSTTAdapter()
        _PROVIDER_CACHE[target] = provider
        logger.info("Initialized MockSTTAdapter")
        return provider

    raise ProviderConfigurationError(
        f"Unsupported STT provider '{target}'. Supported providers: 'google', 'mock'."
    )


def reset_stt_provider_cache() -> None:
    """Clear cached STT provider instances (useful for testing)."""
    _PROVIDER_CACHE.clear()

