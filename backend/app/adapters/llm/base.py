"""Large Language Model (LLM) Gateway Interface.

Decouples reasoning models (Gemini, OpenAI, Anthropic, Ollama) from business orchestration.
Provides provider-independent message, tool definition, and tool calling representations.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator, Dict, List, Optional

from app.core.exceptions import LLMGenerationError


@dataclass
class ToolDefinition:
    """Standardized representation of a backend tool/function available to the LLM."""
    name: str
    description: str
    parameters: Dict[str, Any]  # JSON schema object describing input arguments


@dataclass
class ToolCall:
    """Represents a model-generated request to execute a registered tool."""
    name: str
    arguments: Dict[str, Any] = field(default_factory=dict)
    call_id: Optional[str] = None
    thought_signature: Optional[str] = None


@dataclass
class ToolResult:
    """Result of a tool execution to be returned to the language model."""
    name: str
    result: Dict[str, Any] = field(default_factory=dict)
    call_id: Optional[str] = None
    is_error: bool = False


@dataclass
class LLMMessage:
    """Standardized conversational message representation across turns."""
    role: str  # "system", "user", "assistant", or "tool"
    content: str = ""
    tool_calls: Optional[List[ToolCall]] = None
    tool_result: Optional[ToolResult] = None


class LLMResponse(str):
    """String subclass representing model output, preserving backward compatibility while carrying tool calls."""

    content: str
    tool_calls: List[ToolCall]
    finish_reason: Optional[str]

    def __new__(
        cls,
        content: str = "",
        tool_calls: Optional[List[ToolCall]] = None,
        finish_reason: Optional[str] = None,
    ):
        obj = super().__new__(cls, content)
        obj.content = content
        obj.tool_calls = tool_calls or []
        obj.finish_reason = finish_reason
        return obj

    @property
    def has_tool_calls(self) -> bool:
        """Return True if the model requested one or more tool calls."""
        return len(self.tool_calls) > 0


class LLMGateway(ABC):
    """Abstract interface for multi-provider LLM gateways."""

    name: str

    @abstractmethod
    async def complete(
        self,
        messages: List[LLMMessage],
        *,
        tools: Optional[List[ToolDefinition]] = None,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> LLMResponse:
        """Generate a complete response, potentially containing text, tool calls, or both."""
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
    """Mock LLM gateway for tests and offline development with tool-calling simulation."""

    name = "mock"

    def __init__(
        self,
        canned_response: Optional[str] = None,
        tool_call_sequence: Optional[List[ToolCall]] = None,
    ) -> None:
        # Safe default response that does NOT claim false booking success while maintaining test compatibility
        self.default_response = (
            canned_response
            or "Thank you for reaching out. I can help you check doctor availability and schedule an appointment."
        )
        self.tool_call_sequence: List[ToolCall] = list(tool_call_sequence or [])
        self.call_history: List[List[LLMMessage]] = []

    async def complete(
        self,
        messages: List[LLMMessage],
        *,
        tools: Optional[List[ToolDefinition]] = None,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> LLMResponse:
        if not messages:
            raise LLMGenerationError("Message list cannot be empty.")

        self.call_history.append(list(messages))

        # If a tool call sequence is queued, emit the next tool call
        if self.tool_call_sequence:
            next_tool_call = self.tool_call_sequence.pop(0)
            return LLMResponse(content="", tool_calls=[next_tool_call], finish_reason="tool_calls")

        # If the last message is a tool result confirming appointment booking, return verified success
        last_msg = messages[-1]
        if last_msg.role == "tool" and last_msg.tool_result:
            tr = last_msg.tool_result
            if tr.name == "confirm_appointment" and tr.result.get("success"):
                apt_id = tr.result.get("appointment_id", "APT-1001")
                return LLMResponse(
                    content=f"Your appointment has been successfully confirmed. Reference ID is {apt_id}."
                )
            if tr.is_error or not tr.result.get("success", True):
                error_msg = tr.result.get("error") or tr.result.get("message", "An error occurred with your request.")
                return LLMResponse(content=f"I was unable to complete that action: {error_msg}")

        return LLMResponse(content=self.default_response, finish_reason="stop")

    async def stream(
        self,
        messages: List[LLMMessage],
        *,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> AsyncGenerator[str, None]:
        if not messages:
            raise LLMGenerationError("Message list cannot be empty.")
        chunks = [
            "I can help you ",
            "check doctor availability ",
            "and schedule an appointment. ",
            "How can I assist you today?",
        ]
        for chunk in chunks:
            yield chunk


