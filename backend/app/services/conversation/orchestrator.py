"""Healthcare Conversation Orchestrator.

Manages conversational turns, context reconstruction, structured tool calling loop,
and state transitions for hospital patient interactions.
"""

from dataclasses import dataclass, field
from datetime import date
import logging
import re
import time
from typing import Any, AsyncGenerator, Awaitable, Callable, Dict, List, Optional
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.llm.base import (
    LLMGateway,
    LLMMessage,
    LLMResponse,
    ToolCall,
    ToolDefinition,
    ToolResult,
)
from app.adapters.llm.factory import get_llm_gateway
from app.core.exceptions import LLMGenerationError
from app.services.conversation.prompts import HEALTHCARE_SYSTEM_PROMPT
from app.services.conversation.session_store import (
    ConversationSessionStore,
    conversation_session_store,
)
from app.services.conversation.state import ConversationState
from app.utils.audio_processing import sanitize_text_for_tts

logger = logging.getLogger(__name__)

# Maximum tool-call iterations per turn to prevent infinite loops
DEFAULT_MAX_TOOL_ITERATIONS = 5


def detect_query_language(text: str) -> str:
    """Identify script if native Unicode characters are present, else 'auto' for LLM detection."""
    if not text or not text.strip():
        return "auto"
    if any("\u0A80" <= ch <= "\u0AFF" for ch in text):
        return "gu"
    if any("\u0900" <= ch <= "\u097F" for ch in text):
        return "hi"
    return "auto"


def get_language_directive(
    effective_language: Optional[str] = "auto",
    query_sample: Optional[str] = None,
) -> str:
    """Generate explicit language and script instructions for the conversational LLM.

    Empowers the LLM to autonomously detect the user's language and colloquial dialect
    (including Romanized Hinglish or Gujlish) without relying on brittle keyword dictionaries.
    """
    clean = (effective_language or "auto").strip().lower()
    prefix = clean.split("-")[0].split("_")[0]

    sample_ctx = f" (Caller asked: '{query_sample}')" if query_sample else ""

    if prefix == "gu":
        return (
            "LANGUAGE DIRECTIVE (GUJARATI):\n"
            f"- The caller is communicating in GUJARATI{sample_ctx}.\n"
            "- You MUST write your entire response in pure, fluent GUJARATI using standard GUJARATI SCRIPT (ગુજરાતી લિપિ).\n"
            "- Example: 'નમસ્તે! Apollo Metro હોસ્પિટલમાં તમારું સ્વાગત છે. હું તમારી શું સહાયતા કરી શકું?'\n"
            "- Keep doctor names, times, and fees clear (e.g. 'ડૉ. રોહિત', 'સવારે 10:00 AM', '₹500').\n"
            "- NEVER reply in English or Latin-script Gujlish. Native Gujarati script is strictly required so Text-to-Speech audio synthesizes naturally."
        )
    elif prefix == "hi":
        return (
            "LANGUAGE DIRECTIVE (HINDI):\n"
            f"- The caller is communicating in HINDI{sample_ctx}.\n"
            "- You MUST write your entire response in pure, polite, natural HINDI using standard DEVANAGARI SCRIPT (देवनागरी लिपि).\n"
            "- Example: 'नमस्ते! अपोलो मेट्रो हॉस्पिटल में आपका स्वागत है। मैं आपकी क्या सहायता कर सकती हूँ?'\n"
            "- Keep doctor names, times, and fees clear (e.g. 'डॉ. रोहित', 'सुबह 10:00 AM', '₹500').\n"
            "- NEVER reply in English or Latin-script Hinglish. Native Devanagari script is strictly required so Text-to-Speech audio synthesizes naturally."
        )
    elif prefix == "en":
        return (
            "LANGUAGE DIRECTIVE (ENGLISH):\n"
            f"- The caller is communicating in ENGLISH{sample_ctx}.\n"
            "- You MUST write your response in clear, polite, professional spoken ENGLISH.\n"
            "- Example: 'Yes, we have specialists available across various departments today. How may I assist you with your booking?'"
        )
    else:
        # Autonomous LLM Multi-Lingual Mirroring mode - 100% LLM Driven
        return (
            "CRITICAL LLM AUTONOMOUS MULTI-LINGUAL MIRRORING RULE:\n"
            "You MUST automatically detect the language and phrasing of the caller's message and mirror it:\n"
            "1. HINDI / HINGLISH: If the caller's inquiry is in Hindi or Romanized Hinglish (e.g. 'kaise ho aap', 'mujhe doctor se milna hai', 'kya appointment milega', etc.):\n"
            "   - You MUST formulate your response in natural, polite HINDI.\n"
            "   - You MUST write your response strictly using DEVANAGARI SCRIPT (देवनागरी लिपि).\n"
            "   - NEVER write in Latin/English alphabet when the caller spoke Hindi.\n"
            "2. GUJARATI / GUJLISH: If the caller's inquiry is in Gujarati or Romanized Gujlish (e.g. 'doctor av che', 'kem chho', 'mane appointment joiye', etc.):\n"
            "   - You MUST formulate your response in natural, polite GUJARATI.\n"
            "   - You MUST write your response strictly using GUJARATI SCRIPT (ગુજરાતી લિપિ).\n"
            "   - NEVER write in Latin/English alphabet when the caller spoke Gujarati.\n"
            "3. ENGLISH: If the caller's inquiry is in English:\n"
            "   - Formulate your response in clear, polite spoken English.\n"
            "4. DYNAMIC SWITCHING: If the caller changes languages mid-conversation, immediately match their new language in its native script.\n"
            "5. SCRIPT REQUIREMENT: Standard native script (Devanagari for Hindi, Gujarati script for Gujarati) is strictly mandatory so neural Text-to-Speech produces authentic spoken voice."
        )


@dataclass
class ConversationTurnResult:
    """Standardized output of a completed conversational turn."""

    session_id: str
    response_text: str
    conversation_status: str  # "in_progress", "completed", "escalated"
    action_signal: Optional[str] = None  # "booking_confirmed", "transfer_to_human", "emergency_divert", "call_completed"
    action_payload: Optional[Dict[str, Any]] = None
    current_stage: str = "greeting"
    verified_patient_id: Optional[str] = None
    tool_executions: List[Dict[str, Any]] = field(default_factory=list)


# Type signature for async tool dispatcher callback
ToolExecutorType = Callable[
    [str, Dict[str, Any], ConversationState],
    Awaitable[Dict[str, Any]],
]


class ConversationOrchestrator:
    """Coordinates conversational turn reasoning, LLM tool execution, and session state."""

    def __init__(
        self,
        llm_gateway: Optional[LLMGateway] = None,
        session_store: Optional[ConversationSessionStore] = None,
        system_prompt: Optional[str] = None,
        max_tool_iterations: int = DEFAULT_MAX_TOOL_ITERATIONS,
    ) -> None:
        self._llm = llm_gateway
        self._session_store = session_store or conversation_session_store
        self._system_prompt = system_prompt or HEALTHCARE_SYSTEM_PROMPT
        self.max_tool_iterations = max_tool_iterations

    def _get_llm(self) -> LLMGateway:
        return self._llm or get_llm_gateway()

    async def execute_turn(
        self,
        transcript: str,
        *,
        session_id: Optional[str] = None,
        tenant_id: Optional[str] = None,
        caller_number: Optional[str] = None,
        language: str = "en",
        tools: Optional[List[ToolDefinition]] = None,
        tool_executor: Optional[ToolExecutorType] = None,
        tool_registry: Optional[Any] = None,
        db: Optional[AsyncSession] = None,
    ) -> ConversationTurnResult:
        """Execute a full conversational turn with state preservation and tool iteration.

        Args:
            transcript: User's spoken transcript or chat input.
            session_id: Unique conversation identifier.
            tenant_id: Authoritatively resolved hospital tenant ID.
            caller_number: Untrusted telephony caller number hint.
            language: Language hint ('en', 'hi', etc.).
            tools: Registered tool definitions available for the turn.
            tool_executor: Async callable that dispatches tool execution.
            tool_registry: Optional ToolRegistry instance to auto-provide definitions and execution.
            db: Optional database session for tool execution.

        Returns:
            ConversationTurnResult containing assistant speech and structured action signals.
        """
        clean_input = transcript.strip() if transcript else ""
        if not clean_input:
            clean_input = "Hello"

        # Wire tool_registry if provided
        if tool_registry is not None:
            if tools is None:
                tools = tool_registry.get_definitions()
            if tool_executor is None:
                async def _registry_tool_dispatcher(
                    t_name: str, t_args: Dict[str, Any], t_state: ConversationState
                ) -> Dict[str, Any]:
                    raw_tid = t_state.tenant_id or tenant_id
                    parsed_tid = uuid.UUID(raw_tid) if raw_tid else None
                    return await tool_registry.execute_tool(
                        name=t_name,
                        arguments=t_args,
                        tenant_id=parsed_tid,
                        db=db,
                        session_state=t_state,
                    )
                tool_executor = _registry_tool_dispatcher

        # 1. Load or initialize server-controlled conversation state
        state = await self._session_store.get_or_create_session_async(
            session_id=session_id,
            tenant_id=tenant_id,
            language=language,
            caller_phone=caller_number,
        )

        # 2. Check if verification lockout is active
        if state.is_verification_locked():
            lock_response = (
                "For your security, verification attempts have been temporarily locked due to multiple "
                "unsuccessful entries. Please hold while I connect you to our hospital reception."
            )
            state.action_signal = "transfer_to_human"
            state.current_stage = "escalated"
            state.add_message("user", clean_input)
            state.add_message("assistant", lock_response)
            await self._session_store.save_session_async(state)

            return ConversationTurnResult(
                session_id=state.session_id,
                response_text=lock_response,
                conversation_status="escalated",
                action_signal="transfer_to_human",
                current_stage="escalated",
            )

        # 3. Append user message to conversation history
        state.add_message("user", clean_input)

        llm = self._get_llm()
        tools_list = tools or []
        turn_tool_executions: List[Dict[str, Any]] = []
        final_assistant_text = ""

        # 4. Multi-step reasoning loop (model -> tool execution -> model -> answer)
        # Autonomous LLM Multi-Lingual Mirroring: No keyword dictionaries used.
        effective_turn_lang = language.lower() if (language and language.lower() not in ("auto", "none", "")) else "auto"
        lang_directive = get_language_directive(effective_turn_lang, query_sample=clean_input[:60])
        effective_system_prompt = (
            f"{self._system_prompt}\n\n"
            f"CURRENT DATE CONTEXT:\n- Today's date is {date.today().strftime('%A, %Y-%m-%d')}.\n\n"
            f"{lang_directive}"
        )
        for iteration in range(self.max_tool_iterations):
            context_messages = state.get_context_messages(effective_system_prompt)

            try:
                llm_response: LLMResponse = await llm.complete(
                    context_messages,
                    tools=tools_list if tools_list else None,
                )
            except Exception as exc:
                logger.error("LLM reasoning error during turn %s: %s", state.session_id, exc)
                # Graceful degradation response
                final_assistant_text = (
                    "I am having trouble connecting to our booking service. "
                    "Please let me know if you would like to hold or speak with a receptionist."
                )
                break

            # Scenario A: Model requested tool calls
            if llm_response.has_tool_calls:
                # Add assistant turn containing tool calls to context
                state.add_message(
                    "assistant",
                    llm_response.content,
                    tool_calls=llm_response.tool_calls,
                )

                # Execute each requested tool
                for tc in llm_response.tool_calls:
                    exec_record: Dict[str, Any] = {
                        "tool_name": tc.name,
                        "arguments": tc.arguments,
                    }

                    if tool_executor is None:
                        tool_result_data = {
                            "success": False,
                            "error": f"Tool '{tc.name}' cannot be executed: No tool executor registered.",
                        }
                        is_error = True
                    else:
                        try:
                            tool_result_data = await tool_executor(tc.name, tc.arguments, state)
                            is_error = not tool_result_data.get("success", True)
                        except Exception as tool_exc:
                            logger.error("Tool execution failed for '%s': %s", tc.name, tool_exc)
                            tool_result_data = {
                                "success": False,
                                "error": f"Internal execution failure in tool '{tc.name}'.",
                            }
                            is_error = True

                    exec_record["result"] = tool_result_data
                    exec_record["success"] = not is_error
                    turn_tool_executions.append(exec_record)

                    # Update internal audit record in state
                    state.record_tool_execution(
                        tc.name,
                        tc.arguments,
                        tool_result_data,
                        is_error=is_error,
                    )

                    # Inspect tool result for external action signals
                    if "action_signal" in tool_result_data and tool_result_data["action_signal"]:
                        state.action_signal = tool_result_data["action_signal"]
                    if "action_payload" in tool_result_data and tool_result_data["action_payload"]:
                        state.action_payload = tool_result_data["action_payload"]
                    if "stage" in tool_result_data and tool_result_data["stage"]:
                        state.current_stage = tool_result_data["stage"]

                    # Append tool result back into context
                    state.add_message(
                        "tool",
                        "",
                        tool_result=ToolResult(
                            name=tc.name,
                            result=tool_result_data,
                            call_id=tc.call_id,
                            is_error=is_error,
                        ),
                    )

                # Continue next iteration to let model consume tool results
                continue

            # Scenario B: Model formulated final conversational response
            final_assistant_text = llm_response.content
            break

        # Fallback if loop exceeded max iterations without a final text response
        if not final_assistant_text:
            final_assistant_text = (
                "I have gathered the latest information. How else may I assist you with your appointment?"
            )

        # 5. Sanitize text for clear spoken delivery (scrub markdown, symbols, emojis)
        spoken_text = sanitize_text_for_tts(final_assistant_text)

        # 6. Append final assistant response to persistent state
        state.add_message("assistant", spoken_text)

        # Determine overall conversation status
        status = "in_progress"
        if state.action_signal in ("transfer_to_human", "emergency_divert"):
            status = "escalated"
        elif state.action_signal == "call_completed":
            status = "completed"

        # 7. Persist updated session state
        await self._session_store.save_session_async(state)

        return ConversationTurnResult(
            session_id=state.session_id,
            response_text=spoken_text,
            conversation_status=status,
            action_signal=state.action_signal,
            action_payload=state.action_payload,
            current_stage=state.current_stage,
            verified_patient_id=state.verified_patient_id,
            tool_executions=turn_tool_executions,
        )

    async def execute_turn_stream(
        self,
        transcript: str,
        *,
        session_id: Optional[str] = None,
        tenant_id: Optional[str] = None,
        caller_number: Optional[str] = None,
        language: str = "en",
        tools: Optional[List[ToolDefinition]] = None,
        tool_executor: Optional[ToolExecutorType] = None,
        tool_registry: Optional[Any] = None,
        db: Optional[AsyncSession] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Execute a conversational turn and stream spoken sentences as soon as they form."""
        clean_input = transcript.strip() if transcript else ""
        if not clean_input:
            clean_input = "Hello"

        if tool_registry is not None:
            if tools is None:
                tools = tool_registry.get_definitions()
            if tool_executor is None:
                async def _registry_tool_dispatcher(
                    t_name: str, t_args: Dict[str, Any], t_state: ConversationState
                ) -> Dict[str, Any]:
                    raw_tid = t_state.tenant_id or tenant_id
                    parsed_tid = uuid.UUID(raw_tid) if raw_tid else None
                    return await tool_registry.execute_tool(
                        name=t_name,
                        arguments=t_args,
                        tenant_id=parsed_tid,
                        db=db,
                        session_state=t_state,
                    )
                tool_executor = _registry_tool_dispatcher

        state = await self._session_store.get_or_create_session_async(
            session_id=session_id,
            tenant_id=tenant_id,
            language=language,
            caller_phone=caller_number,
        )

        if state.is_verification_locked():
            lock_response = (
                "For your security, verification attempts have been temporarily locked due to multiple "
                "unsuccessful entries. Please hold while I connect you to our hospital reception."
            )
            state.action_signal = "transfer_to_human"
            state.current_stage = "escalated"
            state.add_message("user", clean_input)
            state.add_message("assistant", lock_response)
            await self._session_store.save_session_async(state)
            yield {"type": "sentence", "text": lock_response}
            yield {"type": "complete", "response_text": lock_response, "action_signal": "transfer_to_human"}
            return

        state.add_message("user", clean_input)
        llm = self._get_llm()
        tools_list = tools or []

        # Autonomous LLM Multi-Lingual Mirroring: No keyword dictionaries used.
        effective_turn_lang = language.lower() if (language and language.lower() not in ("auto", "none", "")) else "auto"
        lang_directive = get_language_directive(effective_turn_lang, query_sample=clean_input[:60])
        effective_system_prompt = (
            f"{self._system_prompt}\n\n"
            f"CURRENT DATE CONTEXT:\n- Today's date is {date.today().strftime('%A, %Y-%m-%d')}.\n\n"
            f"{lang_directive}"
        )

        final_assistant_text = ""
        executed_tools_in_turn = False

        for iteration in range(self.max_tool_iterations):
            context_messages = state.get_context_messages(effective_system_prompt)

            # After tools have executed, stream the final spoken answer token-by-token!
            if executed_tools_in_turn and hasattr(llm, "stream"):
                buffer = ""
                full_chunks: List[str] = []
                streamed_any_sentence = False
                try:
                    async for token in llm.stream(
                        context_messages,
                        tools=tools_list if tools_list else None,
                    ):
                        buffer += token
                        full_chunks.append(token)
                        # Split out complete sentences as soon as punctuation + space arrives
                        match = re.search(r"^(.*?[.!?])\s+(.*)$", buffer, re.DOTALL)
                        if match and len(match.group(1).strip()) >= 12:
                            sentence = sanitize_text_for_tts(match.group(1).strip())
                            if sentence:
                                streamed_any_sentence = True
                                yield {"type": "sentence", "text": sentence}
                            buffer = match.group(2)

                    if buffer.strip():
                        tail = sanitize_text_for_tts(buffer.strip())
                        if tail:
                            streamed_any_sentence = True
                            yield {"type": "sentence", "text": tail}

                    candidate_text = sanitize_text_for_tts("".join(full_chunks))
                    if candidate_text:
                        final_assistant_text = candidate_text
                        break
                    # If stream returned empty text, fall through to complete()
                    if not streamed_any_sentence:
                        logger.warning("LLM stream returned empty text; falling back to complete().")
                except Exception as stream_exc:
                    logger.warning("Streaming fallback to complete() due to: %s", stream_exc)
                    if streamed_any_sentence and full_chunks:
                        final_assistant_text = sanitize_text_for_tts("".join(full_chunks))
                        break

            # Non-streaming tool-call check
            try:
                llm_response: LLMResponse = await llm.complete(
                    context_messages,
                    tools=tools_list if tools_list else None,
                )
            except Exception as exc:
                logger.error("LLM reasoning error during turn %s: %s", state.session_id, exc)
                fallback = (
                    "I am having trouble connecting to our booking service. "
                    "Please let me know if you would like to hold or spx`eak with a receptionist."
                )
                yield {"type": "sentence", "text": fallback}
                final_assistant_text = fallback
                break

            if llm_response.has_tool_calls:
                executed_tools_in_turn = True
                state.add_message("assistant", llm_response.content, tool_calls=llm_response.tool_calls)

                for tc in llm_response.tool_calls:
                    if tool_executor is None:
                        tool_result_data = {"success": False, "error": f"No tool executor for '{tc.name}'."}
                        is_error = True
                    else:
                        try:
                            tool_result_data = await tool_executor(tc.name, tc.arguments, state)
                            is_error = not tool_result_data.get("success", True)
                        except Exception as tool_exc:
                            logger.error("Tool execution failed for '%s': %s", tc.name, tool_exc)
                            tool_result_data = {"success": False, "error": f"Internal execution failure in '{tc.name}'."}
                            is_error = True

                    state.record_tool_execution(tc.name, tc.arguments, tool_result_data, is_error=is_error)
                    if tool_result_data.get("action_signal"):
                        state.action_signal = tool_result_data["action_signal"]
                    if tool_result_data.get("action_payload"):
                        state.action_payload = tool_result_data["action_payload"]
                    if tool_result_data.get("stage"):
                        state.current_stage = tool_result_data["stage"]

                    state.add_message(
                        "tool",
                        "",
                        tool_result=ToolResult(
                            name=tc.name,
                            result=tool_result_data,
                            call_id=tc.call_id,
                            is_error=is_error,
                        ),
                    )
                continue

            # Model responded directly without needing tools
            final_assistant_text = sanitize_text_for_tts(llm_response.content)
            if final_assistant_text:
                sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", final_assistant_text) if s.strip()]
                for s in sentences:
                    yield {"type": "sentence", "text": s}
            break

        if not final_assistant_text:
            final_assistant_text = "I have gathered the latest information. How else may I assist you?"
            yield {"type": "sentence", "text": final_assistant_text}

        state.add_message("assistant", final_assistant_text)
        await self._session_store.save_session_async(state)
        yield {
            "type": "complete",
            "response_text": final_assistant_text,
            "action_signal": state.action_signal,
        }


# Global singleton conversation orchestrator instance
conversation_orchestrator = ConversationOrchestrator()
