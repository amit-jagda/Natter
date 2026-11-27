"""Analytics Dashboard and SQL Aggregation Service.

Executes high-performance SQL queries across call sessions, analyses,
and demand requests to power the Hospital Business Intelligence dashboard.
"""

from collections import Counter
from datetime import datetime, timedelta, timezone
import logging
import math
import re
from typing import Any, Dict, List, Optional, Tuple
import uuid

from sqlalchemy import case, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.analytics import CallAnalysis, CallRequest, CallSession
from app.models.doctor import Doctor, DoctorAvailability
from app.models.patient import Patient
from app.schemas.analytics import (
    CallDetailResponse,
    CallListItemSchema,
    CallListResponse,
    DashboardMetricsResponse,
    DistributionItem,
    DoctorDemandMetric,
    SlotDemandMetric,
    TopIssueMetric,
    UnfulfilledDemandMetric,
)

logger = logging.getLogger(__name__)


def _get_date_range_bounds(
    time_range: Optional[str] = "all",
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> Tuple[Optional[datetime], Optional[datetime], str]:
    """Calculate UTC start and end bounds and human-readable label for filtering."""
    now = datetime.now(timezone.utc)

    # 1. Custom Date Range takes precedence if provided
    if start_date or end_date:
        start_bound: Optional[datetime] = None
        end_bound: Optional[datetime] = None

        if start_date and start_date.strip():
            try:
                clean_s = start_date.strip()
                if "T" in clean_s:
                    start_bound = datetime.fromisoformat(clean_s).astimezone(timezone.utc)
                else:
                    parts = [int(p) for p in clean_s.split("-")]
                    start_bound = datetime(parts[0], parts[1], parts[2], 0, 0, 0, tzinfo=timezone.utc)
            except Exception as e:
                logger.warning(f"Failed to parse custom start_date '{start_date}': {e}")

        if end_date and end_date.strip():
            try:
                clean_e = end_date.strip()
                if "T" in clean_e:
                    end_bound = datetime.fromisoformat(clean_e).astimezone(timezone.utc)
                else:
                    parts = [int(p) for p in clean_e.split("-")]
                    end_bound = datetime(parts[0], parts[1], parts[2], 23, 59, 59, 999999, tzinfo=timezone.utc)
            except Exception as e:
                logger.warning(f"Failed to parse custom end_date '{end_date}': {e}")

        if start_date and end_date:
            label = f"{start_date} to {end_date}"
        elif start_date:
            label = f"From {start_date}"
        else:
            label = f"Up to {end_date}"

        return start_bound, end_bound, label

    # 2. Preset Time Range
    tr = (time_range or "all").strip().lower()
    if tr == "today":
        start_bound = datetime(now.year, now.month, now.day, 0, 0, 0, tzinfo=timezone.utc)
        return start_bound, None, "Today"
    elif tr == "7d":
        start_bound = now - timedelta(days=7)
        return start_bound, None, "Last 7 Days"
    elif tr == "30d":
        start_bound = now - timedelta(days=30)
        return start_bound, None, "Last 30 Days"

    return None, None, "All Time"


def _normalize_doctor_name(raw: Optional[str]) -> str:
    """Normalize multilingual doctor names into a single consistent display name."""
    if not raw or not raw.strip():
        return "General Physician"
    clean = raw.strip()
    lower = clean.lower()
    if "rohit" in lower or "રોહિત" in clean or "रोहित" in clean:
        return "Dr. Rohit"
    if "sharma" in lower or "priya" in lower or "શર્મા" in clean or "शर्मा" in clean:
        return "Dr. Priya Sharma"
    if "mehta" in lower or "મહેતા" in clean or "मेहता" in clean:
        return "Dr. Mehta"
    if "patel" in lower or "પટેલ" in clean or "पटेल" in clean:
        return "Dr. Patel"
    if not clean.lower().startswith("dr.") and not clean.lower().startswith("dr "):
        return f"Dr. {clean.capitalize()}"
    return clean


class DashboardAnalyticsService:
    """Provides SQL aggregations for Voice Agent BI and Call Performance."""

    async def get_dashboard_metrics(
        self,
        db: AsyncSession,
        tenant_id: uuid.UUID,
        time_range: Optional[str] = "all",
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> DashboardMetricsResponse:
        """Calculate aggregated KPI metrics across calls for the tenant filtered by time/date range."""
        start_bound, end_bound, date_range_label = _get_date_range_bounds(
            time_range=time_range,
            start_date=start_date,
            end_date=end_date,
        )

        # 1. Total Call Sessions and Status Counts
        total_stmt = select(func.count(CallSession.id)).where(CallSession.tenant_id == tenant_id)
        completed_stmt = (
            select(func.count(CallSession.id))
            .where(CallSession.tenant_id == tenant_id)
            .where(CallSession.analysis_status == "completed")
        )
        pending_stmt = (
            select(func.count(CallSession.id))
            .where(CallSession.tenant_id == tenant_id)
            .where(CallSession.analysis_status == "pending")
        )
        dur_stmt = select(func.avg(CallSession.duration_seconds)).where(CallSession.tenant_id == tenant_id)

        if start_bound:
            total_stmt = total_stmt.where(CallSession.started_at >= start_bound)
            completed_stmt = completed_stmt.where(CallSession.started_at >= start_bound)
            pending_stmt = pending_stmt.where(CallSession.started_at >= start_bound)
            dur_stmt = dur_stmt.where(CallSession.started_at >= start_bound)
        if end_bound:
            total_stmt = total_stmt.where(CallSession.started_at <= end_bound)
            completed_stmt = completed_stmt.where(CallSession.started_at <= end_bound)
            pending_stmt = pending_stmt.where(CallSession.started_at <= end_bound)
            dur_stmt = dur_stmt.where(CallSession.started_at <= end_bound)

        total_calls = (await db.execute(total_stmt)).scalar() or 0
        completed_analyses = (await db.execute(completed_stmt)).scalar() or 0
        pending_analyses = (await db.execute(pending_stmt)).scalar() or 0
        avg_duration = (await db.execute(dur_stmt)).scalar() or 0.0

        # 2. Call Analyses Metrics
        analysis_base = select(CallAnalysis).where(CallAnalysis.tenant_id == tenant_id)
        if start_bound:
            analysis_base = analysis_base.where(CallAnalysis.analyzed_at >= start_bound)
        if end_bound:
            analysis_base = analysis_base.where(CallAnalysis.analyzed_at <= end_bound)

        analyses_res = await db.execute(analysis_base)
        all_analyses: List[CallAnalysis] = analyses_res.scalars().all()

        if all_analyses:
            resolved_count = sum(1 for a in all_analyses if a.resolution_status == "resolved")
            resolution_rate = round((resolved_count / len(all_analyses)) * 100, 1)
            avg_score = round(sum(a.agent_score for a in all_analyses) / len(all_analyses), 1)

            # Sub-score averages
            score_cats = ["correctness", "intent_understanding", "communication", "tool_usage", "policy_compliance", "overall"]
            cat_totals = {c: 0.0 for c in score_cats}
            cat_counts = {c: 0 for c in score_cats}

            for a in all_analyses:
                if isinstance(a.scores, dict):
                    for c in score_cats:
                        if c in a.scores and a.scores[c] is not None:
                            cat_totals[c] += float(a.scores[c])
                            cat_counts[c] += 1

            quality_scores = {
                c: round(cat_totals[c] / cat_counts[c], 1) if cat_counts[c] > 0 else 0.0
                for c in score_cats
            }

            # Languages
            lang_counts = Counter(a.language for a in all_analyses if a.language)
            lang_dist = [
                DistributionItem(
                    name=k,
                    count=v,
                    percentage=round((v / len(all_analyses)) * 100, 1),
                )
                for k, v in lang_counts.most_common()
            ]

            # Sentiments
            sent_counts = Counter(a.sentiment for a in all_analyses if a.sentiment)
            sent_dist = [
                DistributionItem(
                    name=k.capitalize(),
                    count=v,
                    percentage=round((v / len(all_analyses)) * 100, 1),
                )
                for k, v in sent_counts.most_common()
            ]

            # Issues aggregation
            issues_list: List[TopIssueMetric] = []
            issue_tracker = Counter()
            issue_meta = {}
            for a in all_analyses:
                if isinstance(a.issues, list):
                    for iss in a.issues:
                        if isinstance(iss, dict) and "description" in iss:
                            desc_key = iss["description"].strip()
                            issue_tracker[desc_key] += 1
                            if desc_key not in issue_meta:
                                issue_meta[desc_key] = {
                                    "category": iss.get("category", "clarity"),
                                    "severity": iss.get("severity", "low"),
                                }

            for desc_text, count in issue_tracker.most_common(6):
                issues_list.append(
                    TopIssueMetric(
                        category=issue_meta[desc_text]["category"],
                        severity=issue_meta[desc_text]["severity"],
                        description=desc_text,
                        count=count,
                    )
                )

            # Improvements aggregation
            all_improvements = []
            for a in all_analyses:
                if isinstance(a.improvements, list):
                    for imp in a.improvements:
                        if isinstance(imp, str) and imp.strip() and imp not in all_improvements:
                            all_improvements.append(imp.strip())
            top_improvements = all_improvements[:6]

        else:
            resolution_rate = 0.0
            avg_score = 0.0
            quality_scores = {}
            lang_dist = []
            sent_dist = []
            issues_list = []
            top_improvements = []

        # 3. Doctor Inquiries & Capacity Aggregations
        # First: Query all registered doctors for this hospital tenant to get true roster and capacity
        doc_query = (
            select(Doctor)
            .options(selectinload(Doctor.user), selectinload(Doctor.availabilities))
            .where(Doctor.tenant_id == tenant_id)
        )
        reg_docs_res = await db.execute(doc_query)
        registered_docs = reg_docs_res.scalars().all()

        # Build dictionary of registered doctors
        doctor_capacity_map: Dict[str, Dict[str, Any]] = {}
        for d in registered_docs:
            raw_name = d.user.full_name if d.user and d.user.full_name else "Doctor"
            norm_name = _normalize_doctor_name(raw_name)
            weekly_slots = len(d.availabilities) if d.availabilities else 6  # fallback default shift count
            doctor_capacity_map[norm_name] = {
                "specialty": d.specialization or "General Physician",
                "weekly_capacity": weekly_slots,
                "requests": 0,
                "fulfilled": 0,
                "is_active": d.is_active,
            }

        # Query call requests for doctor demand
        doc_req_stmt = (
            select(
                CallRequest.requested_doctor_name,
                CallRequest.fulfilled,
            )
            .where(CallRequest.tenant_id == tenant_id)
            .where(CallRequest.requested_doctor_name.isnot(None))
        )
        if start_bound:
            doc_req_stmt = doc_req_stmt.where(CallRequest.created_at >= start_bound)
        if end_bound:
            doc_req_stmt = doc_req_stmt.where(CallRequest.created_at <= end_bound)

        doc_req_res = await db.execute(doc_req_stmt)
        for row in doc_req_res.all():
            norm_name = _normalize_doctor_name(row[0])
            is_fulfilled = bool(row[1])

            if norm_name not in doctor_capacity_map:
                # Add inquiry doctor if not in hospital registered roster
                doctor_capacity_map[norm_name] = {
                    "specialty": "Specialist",
                    "weekly_capacity": 6,
                    "requests": 0,
                    "fulfilled": 0,
                    "is_active": True,
                }

            doctor_capacity_map[norm_name]["requests"] += 1
            if is_fulfilled:
                doctor_capacity_map[norm_name]["fulfilled"] += 1

        # Sort doctors: most requested first, then by capacity
        sorted_docs = sorted(
            doctor_capacity_map.items(),
            key=lambda x: (x[1]["requests"], x[1]["weekly_capacity"]),
            reverse=True,
        )[:6]

        top_doctors = [
            DoctorDemandMetric(
                name=name,
                specialty=data["specialty"],
                requests=data["requests"],
                fulfilled_count=data["fulfilled"],
                fulfillment_rate=(
                    round((data["fulfilled"] / data["requests"]) * 100, 1)
                    if data["requests"] > 0
                    else 0.0
                ),
                weekly_capacity=data["weekly_capacity"],
                utilization_rate=(
                    round((data["requests"] / data["weekly_capacity"]) * 100, 1)
                    if data["weekly_capacity"] > 0
                    else 0.0
                ),
            )
            for name, data in sorted_docs
        ]

        # 4. Slot Demands
        slot_stmt = (
            select(
                CallRequest.requested_time_slot,
                func.count(CallRequest.id).label("slot_count"),
            )
            .where(CallRequest.tenant_id == tenant_id)
            .where(CallRequest.requested_time_slot.isnot(None))
        )
        if start_bound:
            slot_stmt = slot_stmt.where(CallRequest.created_at >= start_bound)
        if end_bound:
            slot_stmt = slot_stmt.where(CallRequest.created_at <= end_bound)

        slot_stmt = slot_stmt.group_by(CallRequest.requested_time_slot).order_by(desc("slot_count")).limit(6)
        slot_res = await db.execute(slot_stmt)
        slot_demands = [
            SlotDemandMetric(slot=row[0], count=int(row[1]))
            for row in slot_res.all()
        ]

        # 5. Unfulfilled Demands
        unfulf_stmt = (
            select(
                CallRequest.requested_doctor_name,
                CallRequest.requested_date,
                CallRequest.requested_time_slot,
                CallRequest.failure_reason,
                func.count(CallRequest.id).label("unfulf_count"),
            )
            .where(CallRequest.tenant_id == tenant_id)
            .where(CallRequest.fulfilled == False)
        )
        if start_bound:
            unfulf_stmt = unfulf_stmt.where(CallRequest.created_at >= start_bound)
        if end_bound:
            unfulf_stmt = unfulf_stmt.where(CallRequest.created_at <= end_bound)

        unfulf_stmt = unfulf_stmt.group_by(
            CallRequest.requested_doctor_name,
            CallRequest.requested_date,
            CallRequest.requested_time_slot,
            CallRequest.failure_reason,
        ).order_by(desc("unfulf_count")).limit(6)

        unfulf_res = await db.execute(unfulf_stmt)
        unfulfilled_demands = [
            UnfulfilledDemandMetric(
                requested_doctor_name=row[0],
                requested_date=row[1],
                requested_time_slot=row[2],
                failure_reason=row[3] or "slot_unavailable",
                count=int(row[4]),
            )
            for row in unfulf_res.all()
        ]

        # 6. Finalized Executive Summary Synthesizer (Point-wise items)
        if total_calls == 0:
            summary_points = [
                f"No call sessions were recorded during the selected period ({date_range_label}).",
                "Voice AI telephone lines are on standby and ready for inbound callers.",
                "Clinical intelligence points and demand metrics will appear as calls are received.",
            ]
            summary_highlights = [
                f"Scope: {date_range_label}",
                "0 inbound calls recorded",
                "Hospital lines active and ready",
            ]
        elif completed_analyses == 0:
            summary_points = [
                f"A total of {total_calls} call session(s) were logged during {date_range_label}.",
                f"{pending_analyses} call(s) are currently awaiting AI evaluation.",
                "Click 'Analyze Pending Calls' to run background analysis and extract clinical insights.",
            ]
            summary_highlights = [
                f"Scope: {date_range_label}",
                f"{total_calls} call(s) pending evaluation",
                "Trigger background analysis to view metrics",
            ]
        else:
            dominant_lang = lang_dist[0].name if lang_dist else "English"
            lang_pct = f"{lang_dist[0].percentage}%" if lang_dist else "100%"
            primary_sentiment = sent_dist[0].name if sent_dist else "Neutral"

            doc_point = "General Inquiries: Requests handled across standard hospital outpatient departments."
            top_doc_label = "General Outpatient"
            if top_doctors and top_doctors[0].requests > 0:
                lead_doc = top_doctors[0]
                top_doc_label = lead_doc.name
                doc_point = f"Doctor & Specialty Demand: High demand for {lead_doc.name} ({lead_doc.specialty}) with {lead_doc.requests} patient inquiries and a {lead_doc.fulfillment_rate}% fulfillment rate."

            friction_point = "Operational Integrity: Zero clinical inaccuracies, policy violations, or tool execution issues detected."
            if issues_list:
                friction_point = f"Improvement Opportunity: {issues_list[0].description}"
            elif unfulfilled_demands:
                uf = unfulfilled_demands[0]
                friction_point = f"Scheduling Bottleneck: {uf.failure_reason} for {uf.requested_doctor_name or 'appointments'}."

            summary_points = [
                f"Autonomous Resolution: Successfully resolved {resolution_rate}% of patient inquiries autonomously across {total_calls} calls (average turnaround: {round(avg_duration)}s).",
                doc_point,
                f"Quality Rating: Agent scored an average rating of {avg_score} / 10 across medical accuracy, communication, and hospital protocols.",
                f"Languages & Tone: Predominantly conducted in {dominant_lang} ({lang_pct}) with an overall {primary_sentiment.lower()} patient sentiment.",
                friction_point,
            ]

            summary_highlights = [
                f"{resolution_rate}% Autonomous Resolution ({completed_analyses} calls evaluated)",
                f"Top Demand: {top_doc_label} ({top_doctors[0].requests if (top_doctors and top_doctors[0].requests > 0) else 0} calls)",
                f"Quality Rating: {avg_score}/10 • Avg Duration: {round(avg_duration)}s",
                f"Primary Channel: {dominant_lang} ({primary_sentiment} Tone)",
            ]

        executive_summary = "\n• " + "\n• ".join(summary_points)

        return DashboardMetricsResponse(
            total_calls=total_calls,
            completed_analyses=completed_analyses,
            pending_analyses=pending_analyses,
            resolution_rate=resolution_rate,
            avg_agent_score=avg_score,
            avg_duration_seconds=round(float(avg_duration), 1),
            executive_summary=executive_summary,
            summary_points=summary_points,
            summary_highlights=summary_highlights,
            date_range_label=date_range_label,
            top_doctors=top_doctors,
            slot_demands=slot_demands,
            unfulfilled_demands=unfulfilled_demands,
            agent_quality_scores=quality_scores,
            top_issues=issues_list,
            top_improvements=top_improvements,
            language_distribution=lang_dist,
            sentiment_distribution=sent_dist,
        )

    async def get_call_sessions(
        self,
        db: AsyncSession,
        tenant_id: uuid.UUID,
        page: int = 1,
        size: int = 10,
        analysis_status: Optional[str] = None,
        search: Optional[str] = None,
        time_range: Optional[str] = "all",
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> CallListResponse:
        """List call sessions with search, time filter, and pagination."""
        start_bound, end_bound, _ = _get_date_range_bounds(
            time_range=time_range,
            start_date=start_date,
            end_date=end_date,
        )

        query = (
            select(CallSession)
            .options(selectinload(CallSession.analysis))
            .where(CallSession.tenant_id == tenant_id)
        )

        if start_bound:
            query = query.where(CallSession.started_at >= start_bound)
        if end_bound:
            query = query.where(CallSession.started_at <= end_bound)

        if analysis_status and analysis_status != "all":
            query = query.where(CallSession.analysis_status == analysis_status)

        if search and search.strip():
            term = f"%{search.strip()}%"
            query = query.outerjoin(CallSession.analysis).where(
                (CallSession.session_id.ilike(term))
                | (CallSession.caller_phone.ilike(term))
                | (CallSession.transcript.ilike(term))
                | (CallAnalysis.primary_intent.ilike(term))
                | (CallAnalysis.language.ilike(term))
            )

        # Count total
        count_stmt = select(func.count()).select_from(query.subquery())
        total = (await db.execute(count_stmt)).scalar() or 0

        # Calculate total pages
        total_pages = max(1, math.ceil(total / size)) if size > 0 else 1

        # Paginate
        offset = (page - 1) * size
        query = query.order_by(desc(CallSession.started_at)).offset(offset).limit(size)
        res = await db.execute(query)
        sessions = res.scalars().all()

        # Build lookup of registered patients in this hospital by normalized phone
        patient_by_phone: Dict[str, str] = {}
        try:
            pat_stmt = select(Patient.name, Patient.phone).where(Patient.tenant_id == tenant_id)
            pat_res = await db.execute(pat_stmt)
            for p_name, p_phone in pat_res.all():
                if p_phone and p_name:
                    digits = "".join(ch for ch in str(p_phone) if ch.isdigit())[-10:]
                    if digits:
                        patient_by_phone[digits] = p_name.strip()
        except Exception as e:
            logger.warning(f"Failed to load patient lookup: {e}")

        items = []
        for s in sessions:
            preview = (s.transcript[:100] + "...") if len(s.transcript) > 100 else s.transcript
            analysis = s.analysis

            # Resolve patient name
            resolved_patient_name: Optional[str] = None
            if s.caller_phone:
                caller_digits = "".join(ch for ch in str(s.caller_phone) if ch.isdigit())[-10:]
                if caller_digits in patient_by_phone:
                    resolved_patient_name = patient_by_phone[caller_digits]

            if not resolved_patient_name and s.call_metadata:
                resolved_patient_name = s.call_metadata.get("patient_name") or s.call_metadata.get("caller_name")

            if not resolved_patient_name and analysis and isinstance(analysis.raw_analysis, dict):
                resolved_patient_name = analysis.raw_analysis.get("patient_name")

            if not resolved_patient_name and s.transcript:
                # Heuristic regex check for introduction
                name_match = re.search(
                    r"(?:my name is|patient name is)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)",
                    s.transcript,
                    re.IGNORECASE,
                )
                if name_match:
                    candidate = name_match.group(1).split("\n")[0].strip()
                    blacklist = {"doctor", "dr", "assistant", "calling", "interested", "looking", "here", "doing", "well", "fine", "good", "sorry", "available", "ready"}
                    if candidate.lower() not in blacklist and not any(w in blacklist for w in candidate.lower().split()):
                        resolved_patient_name = candidate.title()

            if not resolved_patient_name:
                resolved_patient_name = "Patient" if s.caller_phone else "Unknown Caller"

            items.append(
                CallListItemSchema(
                    id=s.id,
                    session_id=s.session_id,
                    caller_phone=s.caller_phone,
                    patient_name=resolved_patient_name,
                    channel=s.channel,
                    duration_seconds=s.duration_seconds,
                    started_at=s.started_at,
                    status=s.status,
                    analysis_status=s.analysis_status,
                    transcript_preview=preview or "",
                    language=analysis.language if analysis else None,
                    sentiment=analysis.sentiment if analysis else None,
                    resolution_status=analysis.resolution_status if analysis else None,
                    agent_score=analysis.agent_score if analysis else None,
                    primary_intent=analysis.primary_intent if analysis else None,
                )
            )

        return CallListResponse(
            items=items,
            total=total,
            page=page,
            size=size,
            total_pages=total_pages,
        )

    async def get_call_detail(
        self,
        db: AsyncSession,
        tenant_id: uuid.UUID,
        call_id: uuid.UUID,
    ) -> Optional[CallDetailResponse]:
        """Fetch full call details, analysis breakdown, and customer demand requests."""
        stmt = (
            select(CallSession)
            .options(
                selectinload(CallSession.analysis),
                selectinload(CallSession.requests),
            )
            .where(CallSession.id == call_id)
            .where(CallSession.tenant_id == tenant_id)
        )
        res = await db.execute(stmt)
        session = res.scalar_one_or_none()
        if not session:
            return None

        return CallDetailResponse(
            session=session,  # type: ignore
            analysis=session.analysis,  # type: ignore
            requests=session.requests,  # type: ignore
        )


# Global singleton dashboard service
dashboard_analytics_service = DashboardAnalyticsService()
