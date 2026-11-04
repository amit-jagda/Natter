"""Telephony Provider Adapter Interface.

Decouples SIP/carrier gateways (Exotel, Plivo, Twilio) from campaign and call management.
Enables swapping telephony carriers without rewriting business workflows.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict, Optional


class CallDirection(str, Enum):
    """Direction of the phone call."""
    OUTBOUND = "outbound"
    INBOUND = "inbound"


class CallStatus(str, Enum):
    """Standardized call lifecycle status across telephony providers."""
    QUEUED = "queued"
    INITIATED = "initiated"
    RINGING = "ringing"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    BUSY = "busy"
    NO_ANSWER = "no_answer"
    FAILED = "failed"
    CANCELED = "canceled"


@dataclass
class CallSession:
    """Telephony session representation."""
    provider_call_id: str
    direction: CallDirection
    from_number: str
    to_number: str
    status: CallStatus
    metadata: Dict[str, Any]


class TelephonyProvider(ABC):
    """Abstract interface for telephony providers (Exotel, Plivo, Twilio)."""

    name: str

    @abstractmethod
    async def initiate_call(
        self,
        *,
        from_number: str,
        to_number: str,
        stream_webhook_url: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> CallSession:
        """Initiate an outbound telephone call connected to a media stream."""
        pass

    @abstractmethod
    async def terminate_call(self, provider_call_id: str) -> bool:
        """Hang up or terminate an active call session."""
        pass


class MockTelephonyAdapter(TelephonyProvider):
    """Mock telephony provider for testing call lifecycle transitions."""

    name = "mock"

    async def initiate_call(
        self,
        *,
        from_number: str,
        to_number: str,
        stream_webhook_url: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> CallSession:
        return CallSession(
            provider_call_id="mock-call-12345",
            direction=CallDirection.OUTBOUND,
            from_number=from_number,
            to_number=to_number,
            status=CallStatus.INITIATED,
            metadata=metadata or {},
        )

    async def terminate_call(self, provider_call_id: str) -> bool:
        return True

