"""LLM Gateway Provider Factory.

Dynamically resolves, configures, and caches LLM gateway provider instances.
"""

import logging
from typing import Dict, Optional

from app.adapters.llm.base import LLMGateway, MockLLMAdapter
from app.adapters.llm.gemini import GeminiLLMAdapter
from app.core.config import settings
from app.core.exceptions import ProviderConfigurationError

logger = logging.getLogger(__name__)

_PROVIDER_CACHE: Dict[str, LLMGateway] = {}


def get_llm_gateway(provider_name: Optional[str] = None) -> LLMGateway:
    """Resolve and return an LLM Gateway instance based on settings or explicit name.

    Args:
        provider_name: Optional provider identifier ("gemini", "mock").
                      Defaults to settings.LLM_PROVIDER.

    Returns:
        Configured LLMGateway instance.

    Raises:
        ProviderConfigurationError: If an unsupported provider is requested.
    """
    target = (provider_name or settings.LLM_PROVIDER or "mock").strip().lower()

    if target in _PROVIDER_CACHE:
        return _PROVIDER_CACHE[target]

    if target == "gemini":
        provider = GeminiLLMAdapter()
        _PROVIDER_CACHE[target] = provider
        logger.info(f"Initialized GeminiLLMAdapter with model '{provider.model}'")
        return provider

    if target == "mock":
        provider = MockLLMAdapter()
        _PROVIDER_CACHE[target] = provider
        logger.info("Initialized MockLLMAdapter")
        return provider

    raise ProviderConfigurationError(
        f"Unsupported LLM provider '{target}'. Supported providers: 'gemini', 'mock'."
    )


def reset_llm_gateway_cache() -> None:
    """Clear cached LLM gateway instances (useful for testing)."""
    _PROVIDER_CACHE.clear()

