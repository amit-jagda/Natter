"""Conversation State Representation.

Maintains rich conversational, healthcare, and verification state across multi-turn sessions.
Separates temporary conversational context from durable healthcare records stored in PostgreSQL.
"""

from dataclasses import asdict, dataclass, field
import time
from typing import Any, Dict, List, Optional
import uuid

from app.adapters.llm.base import LLMMessage, ToolCall, ToolResult


@dataclass
class ConversationState:
    """Rich conversational state tracked across multi-turn voice sessions."""

    session_id: str
    tenant_id: Optional[str] = None
    language: str = "en"

    # Conversational Lifecycle
    current_intent: Optional[str] = None  # e.g., "book_appointment", "check_availability", "cancel_appointment"
    current_stage: str = "greeting"  # "greeting", "intent_discovery", "patient_identification", "patient_verification", "slot_selection", "confirmation", "completed", "escalated"

    # Server-Controlled Patient Verification
    verified_patient_id: Optional[str] = None
    verified_patient_name: Optional[str] = None
    verification_status: str = "unverified"  # "unverified", "pending", "verified", "locked"
    verification_method: Optional[str] = None  # "demographic_name_match", "otp"
    verification_attempts: int = 0
    verification_locked_until: Optional[float] = None
    verified_at: Optional[float] = None

    # Caller / Contact Hints (Untrusted Metadata)
    caller_phone: Optional[str] = None
    candidate_patient_ids: List[str] = field(default_factory=list)

    # In-Progress Slot / Doctor Selections
    selected_doctor_id: Optional[str] = None
    selected_doctor_name: Optional[str] = None
    selected_date: Optional[str] = None
    selected_slot: Optional[str] = None
    preferred_time_window: Optional[str] = None
    pending_appointment_id: Optional[str] = None
    clarification_count: int = 0

    # External Calling Signals
    action_signal: Optional[str] = None  # "booking_confirmed", "transfer_to_human", "emergency_divert", "call_completed"
    action_payload: Optional[Dict[str, Any]] = None

    # History & Audit Logs
    tool_execution_history: List[Dict[str, Any]] = field(default_factory=list)
    messages: List[LLMMessage] = field(default_factory=list)

    # Timestamps
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def add_message(
        self,
        role: str,
        content: str,
        *,
        tool_calls: Optional[List[ToolCall]] = None,
        tool_result: Optional[ToolResult] = None,
    ) -> None:
        """Append a message and update last activity timestamp."""
        self.messages.append(
            LLMMessage(
                role=role,
                content=content,
                tool_calls=tool_calls,
                tool_result=tool_result,
            )
        )
        self.updated_at = time.time()

    def record_tool_execution(
        self,
        tool_name: str,
        arguments: Dict[str, Any],
        result: Dict[str, Any],
        *,
        is_error: bool = False,
    ) -> None:
        """Record structured tool execution outcome for internal auditing."""
        # Sanitize arguments to avoid logging sensitive data (like plain OTPs)
        safe_args = dict(arguments)
        if "otp" in safe_args:
            safe_args["otp"] = "***"
        if "password" in safe_args:
            safe_args["password"] = "***"

        self.tool_execution_history.append({
            "timestamp": time.time(),
            "tool_name": tool_name,
            "arguments": safe_args,
            "success": not is_error,
            "is_error": is_error,
        })
        self.updated_at = time.time()

    def is_verification_locked(self) -> bool:
        """Check if verification attempts are currently rate-limited/locked."""
        if self.verification_locked_until is None:
            return False
        if time.time() < self.verification_locked_until:
            return True
        # Lock expired; reset lock status
        self.verification_locked_until = None
        self.verification_status = "unverified"
        return False

    def is_verified(self, max_age_seconds: float = 1200) -> bool:
        """Check whether the active session holds a valid, non-expired verification."""
        if not self.verified_patient_id:
            return False
        if self.verification_status != "verified":
            return False
        if self.verified_at is None:
            return False
        if (time.time() - self.verified_at) > max_age_seconds:
            return False
        return True

    def set_verified(
        self,
        patient_id: str,
        verification_method: str = "demographic",
        patient_name: Optional[str] = None,
    ) -> None:
        """Mark the active session as verified for the given patient."""
        self.verified_patient_id = str(patient_id)
        if patient_name:
            self.verified_patient_name = patient_name
        self.verification_status = "verified"
        self.verification_method = verification_method
        self.verified_at = time.time()
        self.verification_attempts = 0
        self.updated_at = time.time()

    def build_session_memory_summary(self) -> str:
        """Build a compact server-controlled state summary to anchor LLM context across long calls."""
        lines = [
            f"- Conversation Stage: {self.current_stage}",
            f"- Verification Status: {self.verification_status}"
            + (
                f" (Verified Patient: {self.verified_patient_name or self.verified_patient_id}, id={self.verified_patient_id})"
                if self.is_verified()
                else ""
            ),
        ]
        if self.selected_doctor_name or self.selected_doctor_id:
            lines.append(
                f"- Selected Doctor: {self.selected_doctor_name or 'Doctor'} (id={self.selected_doctor_id})"
            )
        if self.selected_date:
            lines.append(f"- Target Date: {self.selected_date}")
        if self.selected_slot:
            lines.append(f"- Target Time Slot: {self.selected_slot}")
        if self.preferred_time_window:
            lines.append(f"- Time Preference: {self.preferred_time_window}")
        if self.pending_appointment_id:
            lines.append(f"- Active Appointment ID in Context: {self.pending_appointment_id}")
        if self.clarification_count > 0:
            lines.append(f"- Consecutive Unclear Inputs: {self.clarification_count} (offer human reception if >= 3)")
        return "\n".join(lines)

    def is_verified_for_patient(self, patient_id: str, max_age_seconds: float = 1200) -> bool:
        """Verify whether the active session holds a valid, non-expired verification token for patient_id."""
        if not patient_id or self.verified_patient_id != str(patient_id):
            return False
        if self.verification_status != "verified":
            return False
        if self.verified_at is None:
            return False
        if (time.time() - self.verified_at) > max_age_seconds:
            # Verification token expired
            return False
        return True

    def get_context_messages(
        self,
        system_prompt: str,
        max_turns: int = 10,
    ) -> List[LLMMessage]:
        """Construct the LLM context window with system prompt and recent turns."""
        conversation_msgs = [m for m in self.messages if m.role != "system"]
        limited_conv = conversation_msgs[-(max_turns * 2):]
        return [LLMMessage(role="system", content=system_prompt)] + limited_conv

    def to_dict(self) -> Dict[str, Any]:
        """Serialize state for Redis storage."""
        serialized_messages: List[Dict[str, Any]] = []
        for m in self.messages:
            msg_dict: Dict[str, Any] = {"role": m.role, "content": m.content}
            if m.tool_calls:
                msg_dict["tool_calls"] = [
                    {
                        "name": tc.name,
                        "arguments": tc.arguments,
                        "call_id": tc.call_id,
                        "thought_signature": tc.thought_signature,
                    }
                    for tc in m.tool_calls
                ]
            if m.tool_result:
                msg_dict["tool_result"] = {
                    "name": m.tool_result.name,
                    "result": m.tool_result.result,
                    "call_id": m.tool_result.call_id,
                    "is_error": m.tool_result.is_error,
                }
            serialized_messages.append(msg_dict)

        return {
            "session_id": self.session_id,
            "tenant_id": self.tenant_id,
            "language": self.language,
            "current_intent": self.current_intent,
            "current_stage": self.current_stage,
            "verified_patient_id": self.verified_patient_id,
            "verified_patient_name": self.verified_patient_name,
            "verification_status": self.verification_status,
            "verification_method": self.verification_method,
            "verification_attempts": self.verification_attempts,
            "verification_locked_until": self.verification_locked_until,
            "verified_at": self.verified_at,
            "caller_phone": self.caller_phone,
            "candidate_patient_ids": self.candidate_patient_ids,
            "selected_doctor_id": self.selected_doctor_id,
            "selected_doctor_name": self.selected_doctor_name,
            "selected_date": self.selected_date,
            "selected_slot": self.selected_slot,
            "preferred_time_window": self.preferred_time_window,
            "pending_appointment_id": self.pending_appointment_id,
            "clarification_count": self.clarification_count,
            "action_signal": self.action_signal,
            "action_payload": self.action_payload,
            "tool_execution_history": self.tool_execution_history,
            "messages": serialized_messages,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ConversationState":
        """Deserialize state from Redis dictionary representation."""
        raw_msgs = data.get("messages", [])
        deserialized_msgs: List[LLMMessage] = []
        for m in raw_msgs:
            t_calls = None
            if "tool_calls" in m and m["tool_calls"]:
                t_calls = [
                    ToolCall(
                        name=tc["name"],
                        arguments=tc.get("arguments", {}),
                        call_id=tc.get("call_id"),
                        thought_signature=tc.get("thought_signature"),
                    )
                    for tc in m["tool_calls"]
                ]
            t_res = None
            if "tool_result" in m and m["tool_result"]:
                tr_data = m["tool_result"]
                t_res = ToolResult(
                    name=tr_data["name"],
                    result=tr_data.get("result", {}),
                    call_id=tr_data.get("call_id"),
                    is_error=tr_data.get("is_error", False),
                )
            deserialized_msgs.append(
                LLMMessage(
                    role=m["role"],
                    content=m.get("content", ""),
                    tool_calls=t_calls,
                    tool_result=t_res,
                )
            )

        return cls(
            session_id=data["session_id"],
            tenant_id=data.get("tenant_id"),
            language=data.get("language", "en"),
            current_intent=data.get("current_intent"),
            current_stage=data.get("current_stage", "greeting"),
            verified_patient_id=data.get("verified_patient_id"),
            verified_patient_name=data.get("verified_patient_name"),
            verification_status=data.get("verification_status", "unverified"),
            verification_method=data.get("verification_method"),
            verification_attempts=data.get("verification_attempts", 0),
            verification_locked_until=data.get("verification_locked_until"),
            verified_at=data.get("verified_at"),
            caller_phone=data.get("caller_phone"),
            candidate_patient_ids=data.get("candidate_patient_ids", []),
            selected_doctor_id=data.get("selected_doctor_id"),
            selected_doctor_name=data.get("selected_doctor_name"),
            selected_date=data.get("selected_date"),
            selected_slot=data.get("selected_slot"),
            preferred_time_window=data.get("preferred_time_window"),
            pending_appointment_id=data.get("pending_appointment_id"),
            clarification_count=data.get("clarification_count", 0),
            action_signal=data.get("action_signal"),
            action_payload=data.get("action_payload"),
            tool_execution_history=data.get("tool_execution_history", []),
            messages=deserialized_msgs,
            created_at=data.get("created_at", time.time()),
            updated_at=data.get("updated_at", time.time()),
        )
