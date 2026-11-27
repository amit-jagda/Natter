"""Call Analytics and Business Intelligence API Endpoints.

Provides aggregated KPI metrics, demand trends, agent quality evaluations,
and manual 'Run Analysis' / 'Analyze Pending Calls' execution triggers.
"""

import asyncio
import logging
import uuid
from typing import Optional

from app.api.deps import get_current_tenant
from app.database.session import get_db
from app.models.analytics import CallSession
from app.models.tenant import Tenant
from app.schemas.analytics import (
    AnalyzePendingResponse,
    CallDetailResponse,
    CallListResponse,
    DashboardMetricsResponse,
)
from app.services.analytics.call_analyzer import (
    call_analyzer_service,
    run_background_batch_analysis,
)
from app.services.analytics.dashboard_service import dashboard_analytics_service
from app.services.analytics.session_logger import record_or_update_session
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analytics", tags=["Call Analytics & BI"])


@router.get(
    "/dashboard",
    response_model=DashboardMetricsResponse,
    summary="Get aggregated Voice AI performance and demand analytics",
)
async def get_dashboard_metrics(
    time_range: Optional[str] = Query("all", description="today, 7d, 30d, all"),
    start_date: Optional[str] = Query(None, description="Custom start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="Custom end date (YYYY-MM-DD)"),
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
) -> DashboardMetricsResponse:
    """Returns aggregated high-level business intelligence, agent scores, demand trends, and friction points."""
    return await dashboard_analytics_service.get_dashboard_metrics(
        db, tenant.id, time_range=time_range, start_date=start_date, end_date=end_date
    )


@router.get(
    "/calls",
    response_model=CallListResponse,
    summary="List calls with analysis status badges and summary previews",
)
async def list_calls(
    page: int = Query(1, ge=1, description="Page number"),
    size: int = Query(10, ge=1, le=100, description="Items per page"),
    analysis_status: Optional[str] = Query("all", description="Filter by pending, completed, or failed"),
    search: Optional[str] = Query(None, description="Search session_id, phone, or transcript"),
    time_range: Optional[str] = Query("all", description="today, 7d, 30d, all"),
    start_date: Optional[str] = Query(None, description="Custom start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="Custom end date (YYYY-MM-DD)"),
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
) -> CallListResponse:
    """Lists call sessions with pagination, search, and status filtering."""
    return await dashboard_analytics_service.get_call_sessions(
        db=db,
        tenant_id=tenant.id,
        page=page,
        size=size,
        analysis_status=analysis_status,
        search=search,
        time_range=time_range,
        start_date=start_date,
        end_date=end_date,
    )


@router.get(
    "/calls/{call_id}",
    response_model=CallDetailResponse,
    summary="Get full deep-dive analysis, transcript, and requests for a call",
)
async def get_call_detail(
    call_id: uuid.UUID,
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
) -> CallDetailResponse:
    """Fetches complete call transcript, agent evaluation subscores, detected issues, and demands."""
    detail = await dashboard_analytics_service.get_call_detail(db, tenant.id, call_id)
    if not detail:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Call session '{call_id}' not found.",
        )
    return detail


@router.post(
    "/analyze/{call_id}",
    response_model=CallDetailResponse,
    summary="Trigger on-demand analysis for an individual call session",
)
async def analyze_single_call(
    call_id: uuid.UUID,
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
) -> CallDetailResponse:
    """Analyzes or re-analyzes a single call session using structured LLM evaluation."""
    stmt = select(CallSession).where(CallSession.id == call_id).where(CallSession.tenant_id == tenant.id)
    res = await db.execute(stmt)
    session_record = res.scalar_one_or_none()
    if not session_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Call session '{call_id}' not found.",
        )

    await call_analyzer_service.process_call_session(db, session_record)

    detail = await dashboard_analytics_service.get_call_detail(db, tenant.id, call_id)
    if not detail:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve analysis after processing.",
        )
    return detail


@router.post(
    "/analyze-pending",
    response_model=AnalyzePendingResponse,
    summary="Analyze all pending calls in the background without blocking main thread",
)
async def analyze_pending_calls(
    limit: int = Query(50, ge=1, le=100, description="Max calls to analyze in this batch"),
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
) -> AnalyzePendingResponse:
    """Dispatches background analysis workers without freezing the main server thread."""
    stmt = (
        select(func.count(CallSession.id))
        .where(CallSession.tenant_id == tenant.id)
        .where(CallSession.analysis_status == "pending")
    )
    total_found = (await db.execute(stmt)).scalar() or 0

    if total_found == 0:
        return AnalyzePendingResponse(
            total_pending_found=0,
            analyzed_count=0,
            failed_count=0,
            status="completed",
            message="No pending calls found to analyze. All calls are up to date!",
        )

    # Spawn background worker asynchronously without blocking main thread
    asyncio.create_task(run_background_batch_analysis(tenant.id, limit=limit))

    logger.info(
        f"[ANALYSIS_DISPATCH] Successfully dispatched background batch analysis for {total_found} "
        f"pending calls (tenant: {tenant.id}, batch limit={limit}). HTTP response returned immediately."
    )

    return AnalyzePendingResponse(
        total_pending_found=total_found,
        analyzed_count=0,
        failed_count=0,
        status="processing",
        message=f"Background analysis started for {total_found} call(s). Check logs for real-time progress.",
    )


@router.post(
    "/seed-demo-calls",
    response_model=AnalyzePendingResponse,
    summary="Seed realistic multilingual sample calls for BI demonstration",
)
async def seed_demo_calls(
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
) -> AnalyzePendingResponse:
    """Populates realistic English, Hindi, and Gujarati call sessions for immediate dashboard preview."""
    demo_transcripts = [
        {
            "session_id": f"call_en_{uuid.uuid4().hex[:8]}",
            "caller_phone": "+91 98765 43210",
            "duration": 48,
            "channel": "voice_playground",
            "status": "completed",
            "transcript": (
                "Caller: Hello, I would like to book an appointment with Dr. Rohit for cardiology checkup.\n"
                "Assistant: Welcome to Apollo Metro Hospital! Dr. Rohit is available this Friday at 10:00 AM and 11:30 AM. Which slot works best for you?\n"
                "Caller: 10:00 AM on Friday works great.\n"
                "Assistant: Perfect, I have scheduled your appointment with Dr. Rohit on Friday at 10:00 AM. Your consultation fee will be ₹500. Is there anything else I can help you with?\n"
                "Caller: No that is all, thank you very much!"
            ),
        },
        {
            "session_id": f"call_hi_{uuid.uuid4().hex[:8]}",
            "caller_phone": "+91 98220 11223",
            "duration": 55,
            "channel": "telephony",
            "status": "completed",
            "transcript": (
                "Caller: नमस्ते, मुझे डॉ. रोहित से मिलना है, क्या आज या कल कोई स्लॉट उपलब्ध है?\n"
                "Assistant: नमस्ते! अपोलो मेट्रो हॉस्पिटल में आपका स्वागत है। डॉ. रोहित आज उपलब्ध नहीं हैं, लेकिन कल सुबह 10:00 AM पर स्लॉट उपलब्ध है। क्या मैं आपका अपॉइंटमेंट बुक कर दूँ?\n"
                "Caller: हाँ, कल सुबह 10:00 AM बुक कर दीजिए।\n"
                "Assistant: आपका अपॉइंटमेंट कल सुबह 10:00 AM पर डॉ. रोहित के साथ सफलतापूर्वक बुक कर दिया गया है। कृपया समय पर पहुँचें।\n"
                "Caller: बहुत-बहुत धन्यवाद।"
            ),
        },
        {
            "session_id": f"call_gu_{uuid.uuid4().hex[:8]}",
            "caller_phone": "+91 93282 91692",
            "duration": 62,
            "channel": "voice_playground",
            "status": "completed",
            "transcript": (
                "Caller: કેમ છો, મારે ડોક્ટર રોહિત સાથે એપોઈન્ટમેન્ટ જોઈએ છે, કયા સમયે મળશે?\n"
                "Assistant: નમસ્તે! અપોલો મેટ્રો હોસ્પિટલમાં તમારું સ્વાગત છે. ડૉ. રોહિત શુક્રવારે સવારે 10:00 AM અને 11:30 AM વાગ્યે ઉપલબ્ધ છે. તમારે કયો સમય અનુકૂળ રહેશે?\n"
                "Caller: સવારે 10:00 AM રાખો.\n"
                "Assistant: બરાબર, તમારું એપોઇન્ટમેન્ટ શુક્રવારે સવારે 10:00 AM વાગ્યે ડૉ. રોહિત સાથે બુક કરવામાં આવ્યું છે. કન્સલ્ટેશન ફી ₹500 છે. બીજું કંઈ મદદ કરી શકું?\n"
                "Caller: ના, આભાર."
            ),
        },
        {
            "session_id": f"call_unfulf_{uuid.uuid4().hex[:8]}",
            "caller_phone": "+91 94112 33445",
            "duration": 34,
            "channel": "inbound_phone",
            "status": "completed",
            "transcript": (
                "Caller: Hi, can I get an appointment with the dermatologist today at 7:00 PM in the evening?\n"
                "Assistant: I apologize, our dermatology clinic closes at 5:00 PM today and 7:00 PM is outside our operating hours. We have slots available tomorrow morning at 10:00 AM.\n"
                "Caller: Oh I cannot make it tomorrow morning. I will call back later. Thanks."
            ),
        },
        {
            "session_id": f"call_ped_{uuid.uuid4().hex[:8]}",
            "caller_phone": "+91 91234 56789",
            "duration": 42,
            "channel": "voice_playground",
            "status": "completed",
            "transcript": (
                "Caller: Good morning, does the hospital have a pediatrician available for a child fever consultation?\n"
                "Assistant: Good morning! Yes, Dr. Priya Sharma in Pediatrics is available today between 2:00 PM and 4:30 PM. Would you like to reserve a 2:30 PM slot?\n"
                "Caller: Yes please, 2:30 PM is perfect.\n"
                "Assistant: I have reserved the 2:30 PM consultation with Dr. Priya Sharma. Please bring the child's previous vaccination records if available."
            ),
        },
    ]

    count = 0
    for demo in demo_transcripts:
        await record_or_update_session(
            db=db,
            session_id=demo["session_id"],
            tenant_id=str(tenant.id),
            transcript=demo["transcript"],
            caller_phone=demo["caller_phone"],
            channel=demo["channel"],
            duration_seconds=demo["duration"],
            status=demo["status"],
        )
        count += 1

    return AnalyzePendingResponse(
        total_pending_found=count,
        analyzed_count=0,
        failed_count=0,
        message=f"Seeded {count} realistic multilingual call sessions with analysis_status='pending'. Click 'Analyze Pending Calls' to run structured intelligence extraction!",
    )
