"""Unit tests for Large Language Model (LLM) Adapters and Gateway Factory."""

import pytest
from app.adapters.llm.base import LLMMessage, MockLLMAdapter
from app.adapters.llm.factory import get_llm_gateway, reset_llm_gateway_cache
from app.adapters.llm.gemini import GeminiLLMAdapter
from app.core.exceptions import (
    LLMGenerationError,
    ProviderConfigurationError,
)


@pytest.mark.asyncio
async def test_mock_llm_complete():
    """Test MockLLMAdapter complete generates response text."""
    gateway = MockLLMAdapter()
    messages = [
        LLMMessage(role="system", content="You are a helpful assistant."),
        LLMMessage(role="user", content="Hello, can you help me?"),
    ]
    response = await gateway.complete(messages)
    assert isinstance(response, str)
    assert len(response) > 5


@pytest.mark.asyncio
async def test_mock_llm_stream():
    """Test MockLLMAdapter stream yields token chunks."""
    gateway = MockLLMAdapter()
    messages = [LLMMessage(role="user", content="Hi")]
    chunks = []
    async for chunk in gateway.stream(messages):
        chunks.append(chunk)

    full_text = "".join(chunks)
    assert "Thank you" in full_text


@pytest.mark.asyncio
async def test_mock_llm_empty_messages():
    """Test MockLLMAdapter raises LLMGenerationError when messages are empty."""
    gateway = MockLLMAdapter()
    with pytest.raises(LLMGenerationError):
        await gateway.complete([])


def test_gemini_llm_thought_scrubbing():
    """Test that internal thought and state tags are scrubbed from LLM responses."""
    adapter = GeminiLLMAdapter(api_key="valid-dummy-test-key-32charslong")

    raw_output = "<thought>The user wants to reschedule. I will check tomorrow.</thought>Sure, I can help you with that!"
    cleaned = adapter._clean_response_text(raw_output)
    assert cleaned == "Sure, I can help you with that!"
    assert "<thought>" not in cleaned

    with_state = "<state>emotion: neutral</state>Good morning!"
    assert adapter._clean_response_text(with_state) == "Good morning!"


def test_gemini_llm_payload_formatting():
    """Test Gemini message formatting correctly maps system instructions and turns."""
    adapter = GeminiLLMAdapter()
    messages = [
        LLMMessage(role="system", content="You are a voice agent."),
        LLMMessage(role="user", content="Hello!"),
        LLMMessage(role="assistant", content="Hi! How can I help?"),
        LLMMessage(role="user", content="Book a slot."),
    ]
    payload = adapter._format_payload(messages, temperature=0.7, max_tokens=500)

    assert "systemInstruction" in payload
    assert payload["systemInstruction"]["parts"][0]["text"] == "You are a voice agent."

    contents = payload["contents"]
    assert len(contents) == 3
    assert contents[0]["role"] == "user"
    assert contents[1]["role"] == "model"
    assert contents[2]["role"] == "user"


@pytest.mark.asyncio
async def test_gemini_missing_api_key():
    """Test GeminiLLMAdapter raises ProviderConfigurationError when API key is missing."""
    adapter = GeminiLLMAdapter(api_key=None)
    adapter._explicit_api_key = None
    adapter._resolve_api_key = lambda: None

    with pytest.raises(ProviderConfigurationError, match="Google API key not configured"):
        await adapter.complete([LLMMessage(role="user", content="Hello")])


def test_llm_factory():
    """Test LLM gateway factory resolves mock and rejects unsupported names."""
    reset_llm_gateway_cache()
    mock_g = get_llm_gateway("mock")
    assert isinstance(mock_g, MockLLMAdapter)
    assert mock_g.name == "mock"

    assert get_llm_gateway("mock") is mock_g

    with pytest.raises(ProviderConfigurationError, match="Unsupported LLM provider"):
        get_llm_gateway("unsupported_llm_provider")
    reset_llm_gateway_cache()

