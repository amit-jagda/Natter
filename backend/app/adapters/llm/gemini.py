"""Google Gemini LLM Gateway Adapter.

Implements multi-turn conversational reasoning using Google's Gemini models
via asynchronous REST calls with system instruction and streaming support.
"""

import json
import logging
import os
import re
from typing import Any, AsyncGenerator, Dict, List, Optional

from app.adapters.llm.base import LLMGateway, LLMMessage
from app.core.config import settings
from app.core.exceptions import (
    LLMGenerationError,
    ProviderConfigurationError,
    ProviderUnavailableError,
)


logger = logging.getLogger(__name__)


class GeminiLLMAdapter(LLMGateway):
    """Concrete LLM Gateway adapter powered by Google Gemini."""

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
    ) -> Dict[str, Any]:
        """Convert standard LLMMessages into the Google Gemini JSON structure."""
        system_prompts: List[str] = []
        conversation_contents: List[Dict[str, Any]] = []

        for msg in messages:
            if msg.role == "system":
                system_prompts.append(msg.content.strip())
            else:
                role = "model" if msg.role == "assistant" else "user"
                # Ensure no consecutive same-role entries if not permitted
                if (
                    conversation_contents
                    and conversation_contents[-1]["role"] == role
                ):
                    conversation_contents[-1]["parts"][0]["text"] += f"\n{msg.content.strip()}"
                else:
                    conversation_contents.append({
                        "role": role,
                        "parts": [{"text": msg.content.strip()}]
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
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> str:
        """Generate a complete text response from Google Gemini."""
        if not messages:
            raise LLMGenerationError("Message history cannot be empty.")

        api_key = self._resolve_api_key()
        if not api_key:
            raise ProviderConfigurationError(
                "Google API key not configured for LLM. Please set GOOGLE_API_KEY in .env."
            )

        payload = self._format_payload(messages, temperature, max_tokens)
        url = f"{self.base_url}/v1beta/models/{self.model}:generateContent"
        params = {"key": api_key}

        try:
            import httpx
        except ImportError as exc:
            raise ProviderUnavailableError(
                "The 'httpx' library is required for GeminiLLMAdapter. Run 'pip install httpx'."
            ) from exc

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(url, params=params, json=payload)
        except httpx.TimeoutException as exc:
            logger.error(f"Gemini LLM timed out after {self.timeout}s")
            raise LLMGenerationError(
                f"Gemini LLM request timed out after {self.timeout} seconds."
            ) from exc
        except httpx.RequestError as exc:
            logger.error(f"Gemini LLM network error: {exc}")
            raise LLMGenerationError(f"Network error during LLM generation: {exc}") from exc

        if response.status_code in (401, 403):
            err_msg = response.text[:250]
            logger.error(f"Gemini LLM authentication rejected ({response.status_code}): {err_msg}")
            raise ProviderConfigurationError(f"Google Gemini API key was rejected: {err_msg}")

        if response.is_error:
            err_msg = response.text[:300]
            logger.error(f"Gemini LLM returned HTTP {response.status_code}: {err_msg}")
            raise LLMGenerationError(
                f"Gemini LLM service error (HTTP {response.status_code}): {err_msg}"
            )

        try:
            data = response.json()
            candidates = data.get("candidates", [])
            if not candidates:
                raise LLMGenerationError("Gemini LLM returned no response candidates.")

            parts = candidates[0].get("content", {}).get("parts", [])
            raw_text = "".join(part.get("text", "") for part in parts)
            response_text = self._clean_response_text(raw_text)

        except (ValueError, KeyError, IndexError, TypeError) as exc:
            logger.error(f"Failed to parse Gemini LLM response: {exc}")
            raise LLMGenerationError(
                "Invalid response format received from Gemini LLM service."
            ) from exc

        if not response_text:
            raise LLMGenerationError("Gemini LLM produced an empty response.")

        return response_text

    async def stream(
        self,
        messages: List[LLMMessage],
        *,
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

        payload = self._format_payload(messages, temperature, max_tokens)
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
