"""Unit tests for In-Memory Conversation Session Store."""

import time
from app.services.session_store import ConversationSession, InMemorySessionStore


def test_session_creation_and_isolation():
    """Test session creation and isolation between different session IDs."""
    store = InMemorySessionStore()

    session_a = store.get_or_create_session("session-123")
    session_b = store.get_or_create_session("session-456")

    assert session_a.session_id == "session-123"
    assert session_b.session_id == "session-456"
    assert session_a is not session_b

    session_a.add_message("user", "Hello from A")
    session_b.add_message("user", "Hello from B")

    assert len(session_a.messages) == 2  # system + user
    assert len(session_b.messages) == 2
    assert session_a.messages[1].content == "Hello from A"
    assert session_b.messages[1].content == "Hello from B"


def test_session_reset():
    """Test resetting conversation context retains system prompt."""
    store = InMemorySessionStore()
    session = store.get_or_create_session("session-reset-test")

    session.add_message("user", "Message 1")
    session.add_message("assistant", "Reply 1")
    session.add_message("user", "Message 2")

    assert len(session.messages) == 4

    success = store.reset_session("session-reset-test")
    assert success is True

    reset_session = store.get_session("session-reset-test")
    assert reset_session is not None
    assert len(reset_session.messages) == 1
    assert reset_session.messages[0].role == "system"


def test_session_turn_limiting():
    """Test get_context_messages bounds history length to max_turns."""
    session = ConversationSession(session_id="turn-limit-test")
    session.add_message("system", "System prompt")

    for i in range(15):
        session.add_message("user", f"User {i}")
        session.add_message("assistant", f"Assistant {i}")

    # Total 1 system + 30 turns = 31 messages
    assert len(session.messages) == 31

    # Requesting max 5 turns should return system + 10 messages (5 user + 5 assistant)
    context = session.get_context_messages(max_turns=5)
    assert len(context) == 11
    assert context[0].role == "system"
    assert context[1].content == "User 10"
    assert context[-1].content == "Assistant 14"

