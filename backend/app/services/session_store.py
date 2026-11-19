"""In-Memory Conversation Session Store.

Provides isolated, thread-safe in-memory session storage for multi-turn voice conversations.
Prototype storage: ephemeral and reset upon application restart.
"""

import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from app.adapters.llm.base import LLMMessage

DEFAULT_VOICE_SYSTEM_PROMPT = (
    "You are a friendly, natural, and helpful AI voice assistant. "
    "Respond in plain, spoken conversational language suitable for a phone call. "
    "Keep responses concise (1 to 3 sentences maximum). "
    "Never use markdown formatting, bolding, bullet points, asterisks, or emojis. "
    "If the user speaks Hindi or Hinglish, respond naturally in Hinglish or Hindi."
)


@dataclass
class ConversationSession:
    """Represents an active multi-turn conversation session."""

    session_id: str
    messages: List[LLMMessage] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def add_message(self, role: str, content: str) -> None:
        """Append a message and update last activity timestamp."""
        self.messages.append(LLMMessage(role=role, content=content))
        self.updated_at = time.time()

    def get_context_messages(self, max_turns: int = 10) -> List[LLMMessage]:
        """Return system prompt followed by the most recent conversation turns."""
        system_msgs = [m for m in self.messages if m.role == "system"]
        conversation_msgs = [m for m in self.messages if m.role != "system"]

        # Keep the latest N turns (each turn has user + assistant, so max_turns * 2)
        limited_conv = conversation_msgs[-(max_turns * 2):]

        if not system_msgs:
            return [LLMMessage(role="system", content=DEFAULT_VOICE_SYSTEM_PROMPT)] + limited_conv

        return system_msgs + limited_conv


class InMemorySessionStore:
    """Thread-safe in-memory session manager for voice turns."""

    def __init__(self, max_history_turns: int = 10, ttl_seconds: int = 7200) -> None:
        self._sessions: Dict[str, ConversationSession] = {}
        self._lock = threading.Lock()
        self.max_history_turns = max_history_turns
        self.ttl_seconds = ttl_seconds

    def get_or_create_session(
        self,
        session_id: Optional[str] = None,
        system_prompt: Optional[str] = None,
    ) -> ConversationSession:
        """Retrieve an existing session or initialize a new one."""
        with self._lock:
            # Clean expired sessions lazily
            now = time.time()
            expired = [
                sid for sid, s in self._sessions.items()
                if (now - s.updated_at) > self.ttl_seconds
            ]
            for sid in expired:
                del self._sessions[sid]

            sid = session_id.strip() if session_id and session_id.strip() else str(uuid.uuid4())

            if sid in self._sessions:
                return self._sessions[sid]

            new_session = ConversationSession(session_id=sid)
            prompt = system_prompt or DEFAULT_VOICE_SYSTEM_PROMPT
            new_session.add_message("system", prompt)
            self._sessions[sid] = new_session
            return new_session

    def reset_session(self, session_id: str) -> bool:
        """Reset conversation context for a session, keeping the system prompt."""
        with self._lock:
            if session_id in self._sessions:
                session = self._sessions[session_id]
                system_msgs = [m for m in session.messages if m.role == "system"]
                session.messages = system_msgs if system_msgs else [
                    LLMMessage(role="system", content=DEFAULT_VOICE_SYSTEM_PROMPT)
                ]
                session.updated_at = time.time()
                return True
            return False

    def get_session(self, session_id: str) -> Optional[ConversationSession]:
        """Get session without creating."""
        with self._lock:
            return self._sessions.get(session_id)

    def count_active_sessions(self) -> int:
        """Return the number of active in-memory sessions."""
        with self._lock:
            return len(self._sessions)


# Global singleton instance
session_store = InMemorySessionStore()

