"""Large Language Model (LLM) Gateway Interface.

Decouples reasoning models (Gemini, OpenAI, Anthropic, Ollama) from business orchestration.
Reuses proven prompt-streaming and role-mapping patterns from virtual-buddy-backend.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import AsyncGenerator, List, Optional

from app.core.exceptions import LLMGenerationError


@dataclass(frozen=True)
class LLMMessage:
    """Standardized conversational message representation."""
    role: str  # "system", "user", or "assistant"
    content: str


class LLMGateway(ABC):
    """Abstract interface for multi-provider LLM gateways."""

    name: str

    @abstractmethod
    async def complete(
        self,
        messages: List[LLMMessage],
        *,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> str:
        """Generate a complete text response."""
        pass

    @abstractmethod
    async def stream(
        self,
        messages: List[LLMMessage],
        *,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> AsyncGenerator[str, None]:
        """Stream response tokens asynchronously as they are generated."""
        pass


class MockLLMAdapter(LLMGateway):
    """Mock LLM gateway for tests and offline development."""

    name = "mock"

    async def complete(
        self,
        messages: List[LLMMessage],
        *,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> str:
        if not messages:
            raise LLMGenerationError("Message list cannot be empty.")
        return "Thank you for answering. We have updated your appointment."

    async def stream(
        self,
        messages: List[LLMMessage],
        *,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> AsyncGenerator[str, None]:
        if not messages:
            raise LLMGenerationError("Message list cannot be empty.")
        chunks = ["Thank you ", "for answering. ", "We have updated ", "your appointment."]
        for chunk in chunks:
            yield chunk

