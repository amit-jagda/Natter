"""Pydantic Schemas for Call Analytics and Business Intelligence."""

from datetime import datetime
from typing import Any, Dict, List, Optional
import uuid
from pydantic import BaseModel, Field


class AgentScoresSchema(BaseModel):
    correctness: float = Field(8.0, ge=0.0, le=10.0)
    intent_understanding: float = Field(8.0, ge=0.0, le=10.0)
    communication: float = Field(8.0, ge=0.0, le=10.0)
    tool_usage: float = Field(8.0, ge=0.0, le=10.0)
    policy_compliance: float = Field(8.0, ge=0.0, le=10.0)
    overall: float = Field(8.0, ge=0.0, le=10.0)


class AgentIssueSchema(BaseModel):
    category: str = Field(..., description="e.g. clarity, misunderstanding, tool_misuse, policy_violation, unhelpful")
    severity: str = Field(..., description="low, medium, high, critical")
    description: str = Field(..., description="Explanation of what the agent did or missed")
    evidence: str = Field("", description="Exact or paraphrased dialogue snippet")
    recommendation: str = Field("", description="How the agent or prompt should be adjusted")


class CustomerRequestItem(BaseModel):
    request_type: str = Field("appointment_booking", description="appointment_booking, doctor_availability, timing_inquiry, fee_inquiry, general_info")
    requested_doctor_name: Optional[str] = None
    requested_department: Optional[str] = None
    requested_date: Optional[str] = None
    requested_time_slot: Optional[str] = None
    fulfilled: bool = True
    failure_reason: Optional[str] = None


class CallAnalysisStructuredOutput(BaseModel):
    summary: str
    patient_name: Optional[str] = Field(None, description="Patient full name if stated or introduced in conversation")
    primary_intent: str
    secondary_intents: List[str] = Field(default_factory=list)
    sentiment: str = Field("neutral", description="positive, neutral, negative, frustrated")
    resolution_status: str = Field("resolved", description="resolved, partially_resolved, unresolved, escalated")
    language: str = Field("English", description="English, Hindi, Gujarati")
    scores: AgentScoresSchema = Field(default_factory=AgentScoresSchema)
    customer_satisfaction: float = Field(8.0, ge=0.0, le=10.0)
    escalation_required: bool = False
    customer_requests: List[CustomerRequestItem] = Field(default_factory=list)
    issues: List[AgentIssueSchema] = Field(default_factory=list)
    improvements: List[str] = Field(default_factory=list)


class CallSessionSchema(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    session_id: str
    caller_phone: Optional[str] = None
    dialed_number: Optional[str] = None
    channel: str
    started_at: datetime
    ended_at: Optional[datetime] = None
    duration_seconds: int
    status: str
    analysis_status: str
    transcript: str
    created_at: datetime

    class Config:
        from_attributes = True


class CallAnalysisSchema(BaseModel):
    id: uuid.UUID
    call_id: uuid.UUID
    summary: str
    primary_intent: str
    secondary_intents: List[str]
    sentiment: str
    resolution_status: str
    agent_score: float
    scores: Dict[str, float]
    customer_satisfaction: float
    language: str
    escalation_required: bool
    issues: List[Dict[str, Any]]
    improvements: List[str]
    analyzed_at: datetime

    class Config:
        from_attributes = True


class CallRequestSchema(BaseModel):
    id: uuid.UUID
    call_id: uuid.UUID
    request_type: str
    requested_doctor_name: Optional[str] = None
    requested_department: Optional[str] = None
    requested_date: Optional[str] = None
    requested_time_slot: Optional[str] = None
    fulfilled: bool
    failure_reason: Optional[str] = None
    booking_id: Optional[uuid.UUID] = None
    created_at: datetime

    class Config:
        from_attributes = True


class CallListItemSchema(BaseModel):
    id: uuid.UUID
    session_id: str
    caller_phone: Optional[str] = None
    patient_name: Optional[str] = None
    channel: str
    duration_seconds: int
    started_at: datetime
    status: str
    analysis_status: str
    transcript_preview: str
    language: Optional[str] = None
    sentiment: Optional[str] = None
    resolution_status: Optional[str] = None
    agent_score: Optional[float] = None
    primary_intent: Optional[str] = None


class CallDetailResponse(BaseModel):
    session: CallSessionSchema
    analysis: Optional[CallAnalysisSchema] = None
    requests: List[CallRequestSchema] = Field(default_factory=list)


class CallListResponse(BaseModel):
    items: List[CallListItemSchema]
    total: int
    page: int
    size: int
    total_pages: int = 1


class DoctorDemandMetric(BaseModel):
    name: str
    specialty: Optional[str] = "General Physician"
    requests: int
    fulfilled_count: int
    fulfillment_rate: float
    weekly_capacity: int = 0
    utilization_rate: float = 0.0


class SlotDemandMetric(BaseModel):
    slot: str
    count: int


class UnfulfilledDemandMetric(BaseModel):
    requested_doctor_name: Optional[str] = None
    requested_date: Optional[str] = None
    requested_time_slot: Optional[str] = None
    failure_reason: Optional[str] = None
    count: int


class TopIssueMetric(BaseModel):
    category: str
    severity: str
    description: str
    count: int


class DistributionItem(BaseModel):
    name: str
    count: int
    percentage: float


class DashboardMetricsResponse(BaseModel):
    total_calls: int
    completed_analyses: int
    pending_analyses: int
    resolution_rate: float
    avg_agent_score: float
    avg_duration_seconds: float
    executive_summary: str = Field(
        "Executive AI summary will be generated once calls are analyzed.",
        description="Comprehensive synthesized executive summary for the selected date range",
    )
    summary_points: List[str] = Field(
        default_factory=list,
        description="Point-wise executive summary bullets for hospital management",
    )
    summary_highlights: List[str] = Field(
        default_factory=list,
        description="Strategic highlights and operational metrics",
    )
    date_range_label: str = Field("All Time", description="Human-readable active date range label")
    top_doctors: List[DoctorDemandMetric]
    slot_demands: List[SlotDemandMetric]
    unfulfilled_demands: List[UnfulfilledDemandMetric]
    agent_quality_scores: Dict[str, float]
    top_issues: List[TopIssueMetric]
    top_improvements: List[str]
    language_distribution: List[DistributionItem]
    sentiment_distribution: List[DistributionItem]


class AnalyzePendingResponse(BaseModel):
    total_pending_found: int
    analyzed_count: int
    failed_count: int
    status: str = Field("completed", description="completed or processing")
    message: str
