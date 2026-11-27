"""Email Notification Service.

Handles dispatch of user account credentials and invitations.
Supports SMTP when configured, and falls back to structured logging for local/dev runs.
"""

import logging
import secrets
import smtplib
import string
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any, Dict

from app.core.config import settings

logger = logging.getLogger(__name__)


def generate_random_password(length: int = 12) -> str:
    """Generate a secure, random temporary password containing letters, digits, and a symbol."""
    letters = string.ascii_letters
    digits = string.digits
    symbols = "@#$*&"

    # Ensure at least one uppercase, lowercase, digit, and symbol
    pwd = [
        secrets.choice(string.ascii_uppercase),
        secrets.choice(string.ascii_lowercase),
        secrets.choice(digits),
        secrets.choice(symbols),
    ]
    all_chars = letters + digits + symbols
    for _ in range(length - 4):
        pwd.append(secrets.choice(all_chars))

    secrets.SystemRandom().shuffle(pwd)
    return "".join(pwd)


def send_invitation_email(
    recipient_email: str,
    recipient_name: str,
    temp_password: str,
    hospital_name: str,
    role: str = "operator",
    login_url: str = "http://localhost:5173/login",
) -> Dict[str, Any]:
    """Send an invitation email containing login credentials (ID/Email and Password).

    Attempts real SMTP delivery if configured; otherwise logs the complete credential
    details safely and marks delivery as logged.
    """
    subject = f"Welcome to {hospital_name} - Your Staff Account Credentials"

    plain_content = (
        f"Hello {recipient_name},\n\n"
        f"You have been invited to join {hospital_name} on the Hospital Voice Platform.\n\n"
        f"Role: {role.title()}\n"
        f"Login Email / User ID: {recipient_email}\n"
        f"Temporary Password: {temp_password}\n"
        f"Login URL: {login_url}\n\n"
        f"Important: As an Operator, your account is configured with read-only access.\n"
        f"Please sign in and change your password upon first login.\n\n"
        f"Regards,\n"
        f"{hospital_name} Administration"
    )

    html_content = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Your Hospital Voice Agent Account</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b;">
  <div style="max-width: 560px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
    <div style="background: linear-gradient(135deg, #6d28d9, #9333ea); padding: 28px 24px; text-align: center; color: #ffffff;">
      <h1 style="margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.5px;">{hospital_name}</h1>
      <p style="margin: 6px 0 0 0; font-size: 13px; opacity: 0.9;">Staff Account Invitation</p>
    </div>
    <div style="padding: 28px 24px;">
      <p style="font-size: 15px; margin-top: 0;">Hello <strong>{recipient_name}</strong>,</p>
      <p style="font-size: 14px; line-height: 1.5; color: #475569;">
        You have been granted access to <strong>{hospital_name}</strong> as an <strong>{role.title()}</strong>.
      </p>

      <div style="background-color: #f1f5f9; border-left: 4px solid #7c3aed; padding: 16px; border-radius: 8px; margin: 20px 0;">
        <div style="font-size: 13px; color: #64748b; margin-bottom: 4px;">User ID / Login Email:</div>
        <div style="font-size: 15px; font-weight: 600; color: #0f172a; margin-bottom: 12px;">{recipient_email}</div>
        <div style="font-size: 13px; color: #64748b; margin-bottom: 4px;">Temporary Password:</div>
        <div style="font-size: 16px; font-family: monospace; font-weight: 700; color: #7c3aed; letter-spacing: 0.5px;">{temp_password}</div>
        <div style="font-size: 13px; color: #64748b; margin-top: 12px;">Assigned Role:</div>
        <div style="font-size: 14px; font-weight: 600; color: #0f172a;">{role.title()} ({'Read-Only Permissions' if role.lower() == 'operator' else 'Full Access'})</div>
      </div>

      <div style="text-align: center; margin: 28px 0;">
        <a href="{login_url}" style="display: inline-block; background-color: #7c3aed; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 10px; font-weight: 600; font-size: 14px;">Sign In to Workspace</a>
      </div>

      <p style="font-size: 12px; color: #94a3b8; line-height: 1.4; margin-bottom: 0;">
        Note: As an Operator, you have permission to view patient records, doctor shifts, and hospital status.
      </p>
    </div>
  </div>
</body>
</html>"""

    # Always log credential dispatch for audit and dev preview
    logger.info(
        "\n"
        + "=" * 60 + "\n"
        + f"[EMAIL DISPATCH] To: {recipient_email} ({recipient_name})\n"
        + f"Subject: {subject}\n"
        + f"Hospital: {hospital_name} | Role: {role}\n"
        + f"Credentials -> ID: {recipient_email} | Password: {temp_password}\n"
        + "=" * 60
    )

    if settings.SMTP_HOST and settings.SMTP_USER and settings.SMTP_PASSWORD:
        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = f"{settings.EMAILS_FROM_NAME} <{settings.EMAILS_FROM_EMAIL}>"
            msg["To"] = recipient_email

            msg.attach(MIMEText(plain_content, "plain"))
            msg.attach(MIMEText(html_content, "html"))

            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
                if settings.SMTP_TLS:
                    server.starttls()
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.sendmail(settings.EMAILS_FROM_EMAIL, [recipient_email], msg.as_string())

            logger.info("Email successfully sent via SMTP to %s", recipient_email)
            return {"sent": True, "method": "smtp", "recipient": recipient_email}
        except Exception as exc:
            logger.warning("SMTP delivery failed: %s. Handled via log fallback.", exc)
            return {"sent": False, "method": "log_fallback", "recipient": recipient_email, "error": str(exc)}

    # Local / Mock delivery
    return {"sent": True, "method": "mock_log", "recipient": recipient_email}
