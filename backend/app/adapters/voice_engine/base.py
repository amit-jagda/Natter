"""Voice Engine Framework Adapter Interface.

Allows plugging in custom WebSockets, LiveKit Agents, or Pipecat runtimes
without altering business orchestration or campaign logic.
"""

from abc import ABC, abstractmethod
from typing import Any, AsyncGenerator, Dict, Optional
from app.adapters.llm.base import LLMGateway
from app.adapters.stt.base import STTProvider
from app.adapters.tts.base import TTSProvider


class VoiceEngineSession(ABC):
    """Abstract interface for managing an active bidirectional voice session."""

    @abstractmethod
    async def start(
        self,
        *,
        stt_provider: STTProvider,
        tts_provider: TTSProvider,
        llm_gateway: LLMGateway,
        system_prompt: str,
        initial_greeting: Optional[str] = None,
        context: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Initialize and start the conversational voice session."""
        pass

    @abstractmethod
    async def stop(self) -> None:
        """Gracefully stop the voice session."""
        pass

