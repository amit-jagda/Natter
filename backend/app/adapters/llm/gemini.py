"""Google Gemini LLM Gateway Adapter.

Implements multi-turn conversational reasoning using Google's Gemini models
via asynchronous REST calls with system instruction and streaming support.
"""

import asyncio
import json
import logging
import os
import re
from typing import Any, AsyncGenerator, Dict, List, Optional

from app.adapters.llm.base import (
    LLMGateway,
    LLMMessage,
    LLMResponse,
    ToolCall,
    ToolDefinition,
    ToolResult,
)
from app.core.config import settings
from app.core.exceptions import (
    LLMGenerationError,
    ProviderConfigurationError,
    ProviderUnavailableError,
)


logger = logging.getLogger(__name__)


def _convert_schema_to_gemini(schema: Dict[str, Any]) -> Dict[str, Any]:
    """Recursively convert JSON schema data types to Google Gemini uppercase type keywords."""
    type_mapping = {
        "string": "STRING",
        "number": "NUMBER",
        "integer": "INTEGER",
        "boolean": "BOOLEAN",
        "array": "ARRAY",
        "object": "OBJECT",
    }
    result: Dict[str, Any] = {}
    for key, value in schema.items():
        if key == "type" and isinstance(value, str):
            result[key] = type_mapping.get(value.lower(), value.upper())
        elif isinstance(value, dict):
            result[key] = _convert_schema_to_gemini(value)
        elif isinstance(value, list):
            result[key] = [
                _convert_schema_to_gemini(item) if isinstance(item, dict) else item
                for item in value
            ]
        else:
            result[key] = value
    return result


class GeminiLLMAdapter(LLMGateway):
    """Concrete LLM Gateway adapter powered by Google Gemini with tool/function calling support."""

    name = "gemini"

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        base_url: str = "https://generativelanguage.googleapis.com",
        timeout: float = 30.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model or getattr(settings, "GEMINI_LLM_MODEL", "gemini-3.5-flash-lite")
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

    def _format_payload(
        self,
        messages: List[LLMMessage],
        temperature: float,
        max_tokens: int,
        tools: Optional[List[ToolDefinition]] = None,
    ) -> Dict[str, Any]:
        """Convert standard LLMMessages and tool definitions into the Google Gemini REST JSON structure."""
        system_prompts: List[str] = []
        conversation_contents: List[Dict[str, Any]] = []

        for msg in messages:
            if msg.role == "system":
                if msg.content.strip():
                    system_prompts.append(msg.content.strip())
            elif msg.role == "tool" and msg.tool_result:
                # Format function execution output returned to model
                tr = msg.tool_result
                conversation_contents.append({
                    "role": "user",
                    "parts": [
                        {
                            "functionResponse": {
                                "name": tr.name,
                                "response": {
                                    "name": tr.name,
                                    "content": tr.result or {},
                                    "is_error": tr.is_error,
                                },
                            }
                        }
                    ],
                })
            elif msg.role == "assistant":
                # Model turn, either text, tool calls, or both
                parts: List[Dict[str, Any]] = []
                if msg.content and msg.content.strip():
                    parts.append({"text": msg.content.strip()})
                if msg.tool_calls:
                    for tc in msg.tool_calls:
                        fc_part: Dict[str, Any] = {
                            "functionCall": {
                                "name": tc.name,
                                "args": tc.arguments or {},
                            }
                        }
                        if tc.thought_signature:
                            fc_part["thoughtSignature"] = tc.thought_signature
                        parts.append(fc_part)
                if not parts:
                    parts.append({"text": ""})
                conversation_contents.append({"role": "model", "parts": parts})
            else:
                # User turn
                text_content = msg.content.strip() if msg.content else "Hello"
                # Consolidate consecutive user turns if they contain only text
                if (
                    conversation_contents
                    and conversation_contents[-1]["role"] == "user"
                    and "text" in conversation_contents[-1]["parts"][0]
                ):
                    conversation_contents[-1]["parts"][0]["text"] += f"\n{text_content}"
                else:
                    conversation_contents.append({
                        "role": "user",
                        "parts": [{"text": text_content}],
                    })

        # Gemini expects the first turn to be from "user"
        if not conversation_contents:
            conversation_contents = [{"role": "user", "parts": [{"text": "Hello"}]}]
        elif conversation_contents[0]["role"] == "model":
            conversation_contents.insert(0, {"role": "user", "parts": [{"text": "Hi"}]})

        payload: Dict[str, Any] = {
            "contents": conversation_contents,
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_tokens,
            },
        }

        if system_prompts:
            payload["systemInstruction"] = {
                "parts": [{"text": "\n\n".join(system_prompts)}]
            }

        # Format registered backend tools for Gemini functionDeclarations
        if tools:
            func_decls: List[Dict[str, Any]] = []
            for tool_def in tools:
                gemini_params = _convert_schema_to_gemini(tool_def.parameters)
                func_decls.append({
                    "name": tool_def.name,
                    "description": tool_def.description,
                    "parameters": gemini_params,
                })
            payload["tools"] = [{"functionDeclarations": func_decls}]

        return payload

    def _clean_response_text(self, text: str) -> str:
        """Remove private thought/reasoning tags and strip clean."""
        # Strip <thought>...</thought> blocks
        cleaned = re.sub(r"<thought>.*?</thought>", "", text, flags=re.DOTALL)
        # Strip <state>...</state> blocks if any
        cleaned = re.sub(r"<state>.*?</state>", "", cleaned, flags=re.DOTALL)
        return cleaned.strip()

    async def complete(
        self,
        messages: List[LLMMessage],
        *,
        tools: Optional[List[ToolDefinition]] = None,
        temperature: float = 0.3,
        max_tokens: int = 1024,
    ) -> LLMResponse:
        """Generate a complete text response and/or tool calls from Google Gemini."""
        if not messages:
            raise LLMGenerationError("Message history cannot be empty.")

        api_key = self._resolve_api_key()
        if not api_key:
            raise ProviderConfigurationError(
                "Google API key not configured for LLM. Please set GOOGLE_API_KEY in .env."
            )

        payload = self._format_payload(messages, temperature, max_tokens, tools=tools)
        url = f"{self.base_url}/v1beta/models/{self.model}:generateContent"
        params = {"key": api_key}

        try:
            import httpx
        except ImportError as exc:
            raise ProviderUnavailableError(
                "The 'httpx' library is required for GeminiLLMAdapter. Run 'pip install httpx'."
            ) from exc

        max_attempts = 3
        response = None
        last_exc: Optional[Exception] = None

        for attempt in range(max_attempts):
            try:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    response = await client.post(url, params=params, json=payload)
            except httpx.TimeoutException as exc:
                last_exc = LLMGenerationError(
                    f"Gemini LLM request timed out after {self.timeout} seconds."
                )
                logger.warning(
                    "Gemini LLM timed out after %ss (attempt %d/%d)",
                    self.timeout,
                    attempt + 1,
                    max_attempts,
                )
                if attempt < max_attempts - 1:
                    await asyncio.sleep(0.8 * (attempt + 1))
                    continue
                raise last_exc from exc
            except httpx.RequestError as exc:
                last_exc = LLMGenerationError(f"Network error during LLM generation: {exc}")
                logger.warning(
                    "Gemini LLM network error (attempt %d/%d): %s",
                    attempt + 1,
                    max_attempts,
                    exc,
                )
                if attempt < max_attempts - 1:
                    await asyncio.sleep(0.8 * (attempt + 1))
                    continue
                raise last_exc from exc

            if response.status_code in (401, 403):
                err_msg = response.text[:250]
                logger.error(f"Gemini LLM authentication rejected ({response.status_code}): {err_msg}")
                raise ProviderConfigurationError(f"Google Gemini API key was rejected: {err_msg}")

            if response.status_code in (429, 500, 502, 503, 504) and attempt < max_attempts - 1:
                logger.warning(
                    "Gemini LLM transient HTTP %s (attempt %d/%d): %s",
                    response.status_code,
                    attempt + 1,
                    max_attempts,
                    response.text[:160],
                )
                await asyncio.sleep(0.8 * (attempt + 1))
                continue

            if response.is_error:
                err_msg = response.text[:300]
                logger.error(f"Gemini LLM returned HTTP {response.status_code}: {err_msg}")
                raise LLMGenerationError(
                    f"Gemini LLM service error (HTTP {response.status_code}): {err_msg}"
                )
            break

        assert response is not None

        try:
            data = response.json()
            candidates = data.get("candidates", [])
            if not candidates:
                raise LLMGenerationError("Gemini LLM returned no response candidates.")

            first_candidate = candidates[0]
            content_obj = first_candidate.get("content", {})
            parts = content_obj.get("parts", [])
            finish_reason = first_candidate.get("finishReason")

            tool_calls: List[ToolCall] = []
            text_parts: List[str] = []

            for part in parts:
                if "functionCall" in part:
                    fc = part["functionCall"]
                    tool_calls.append(ToolCall(
                        name=fc.get("name", ""),
                        arguments=fc.get("args", {}) or {},
                        thought_signature=part.get("thoughtSignature") or part.get("thought_signature"),
                    ))
                if "text" in part:
                    text_parts.append(part["text"])

            raw_text = "".join(text_parts)
            response_text = self._clean_response_text(raw_text)

        except (ValueError, KeyError, IndexError, TypeError) as exc:
            logger.error(f"Failed to parse Gemini LLM response: {exc}")
            raise LLMGenerationError(
                "Invalid response format received from Gemini LLM service."
            ) from exc

        # If model called tools, response_text is allowed to be empty
        if not response_text and not tool_calls:
            raise LLMGenerationError("Gemini LLM produced an empty response.")

        return LLMResponse(content=response_text, tool_calls=tool_calls, finish_reason=finish_reason)

    async def stream(
        self,
        messages: List[LLMMessage],
        *,
        tools: Optional[List[ToolDefinition]] = None,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> AsyncGenerator[str, None]:
        """Stream response tokens asynchronously from Google Gemini."""
        if not messages:
            raise LLMGenerationError("Message history cannot be empty.")

        api_key = self._resolve_api_key()
        if not api_key:
            raise ProviderConfigurationError(
                "Google API key not configured for LLM. Please set GOOGLE_API_KEY in .env."
            )

        payload = self._format_payload(messages, temperature, max_tokens, tools=tools)
        url = f"{self.base_url}/v1beta/models/{self.model}:streamGenerateContent"
        params = {"key": api_key, "alt": "sse"}

        try:
            import httpx
        except ImportError as exc:
            raise ProviderUnavailableError(
                "The 'httpx' library is required for GeminiLLMAdapter streaming. Run 'pip install httpx'."
            ) from exc

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                async with client.stream("POST", url, params=params, json=payload) as response:
                    if response.status_code in (401, 403):
                        body = await response.aread()
                        raise ProviderConfigurationError(
                            f"Google Gemini API key was rejected: {body.decode()[:250]}"
                        )
                    if response.is_error:
                        body = await response.aread()
                        raise LLMGenerationError(
                            f"Gemini streaming error (HTTP {response.status_code}): {body.decode()[:250]}"
                        )

                    async for line in response.aiter_lines():
                        if not line or not line.startswith("data: "):
                            continue
                        data_str = line[6:].strip()
                        if not data_str or data_str == "[DONE]":
                            continue
                        try:
                            chunk_data = json.loads(data_str)
                            candidates = chunk_data.get("candidates", [])
                            if candidates:
                                parts = candidates[0].get("content", {}).get("parts", [])
                                for part in parts:
                                    token = part.get("text", "")
                                    if token:
                                        # Scrub thought tags if inline
                                        clean_token = re.sub(r"<thought>.*?</thought>", "", token)
                                        if clean_token:
                                            yield clean_token
                        except json.JSONDecodeError:
                            continue
        except httpx.TimeoutException as exc:
            raise LLMGenerationError(f"Gemini streaming timed out: {exc}") from exc
        except httpx.RequestError as exc:
            raise LLMGenerationError(f"Network error during Gemini streaming: {exc}") from exc
