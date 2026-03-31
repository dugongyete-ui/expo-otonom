"""
Email Service for Dzeck AI Agent.

Sends email via SMTP when EMAIL_HOST is configured.
If EMAIL_HOST is not set, all operations are no-ops and return False gracefully.

Environment variables:
  EMAIL_HOST      — SMTP hostname (required to enable email)
  EMAIL_PORT      — SMTP port (default 587 for STARTTLS, 465 for SSL)
  EMAIL_USER      — SMTP username / sender address
  EMAIL_PASSWORD  — SMTP password
  EMAIL_FROM      — From address override (defaults to EMAIL_USER)
  EMAIL_USE_TLS   — "true" to use STARTTLS (default), "ssl" for SMTPS
"""
import logging
import os
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import List, Optional

logger = logging.getLogger(__name__)


def _is_email_enabled() -> bool:
    return bool(os.environ.get("EMAIL_HOST", "").strip())


def _get_smtp_config() -> dict:
    user = (
        os.environ.get("EMAIL_USER", "")
        or os.environ.get("EMAIL_USERNAME", "")
    ).strip()
    return {
        "host": os.environ.get("EMAIL_HOST", "").strip(),
        "port": int(os.environ.get("EMAIL_PORT", "587")),
        "user": user,
        "password": os.environ.get("EMAIL_PASSWORD", ""),
        "from_addr": os.environ.get("EMAIL_FROM", user).strip(),
        "use_tls": os.environ.get("EMAIL_USE_TLS", "true").strip().lower(),
    }


def send_email(
    to: List[str] | str,
    subject: str,
    body: str,
    html_body: Optional[str] = None,
    cc: Optional[List[str]] = None,
    reply_to: Optional[str] = None,
) -> bool:
    """
    Send an email. Returns True on success, False if email is not configured or fails.

    Args:
        to: Recipient address(es) — string or list of strings.
        subject: Email subject line.
        body: Plain-text body.
        html_body: Optional HTML body (added as alternative part).
        cc: Optional CC address(es).
        reply_to: Optional Reply-To address.

    Returns:
        True if sent successfully, False otherwise.
    """
    if not _is_email_enabled():
        logger.debug("[EmailService] EMAIL_HOST not set — email disabled, skipping send.")
        return False

    cfg = _get_smtp_config()
    if not cfg["host"]:
        return False

    recipients: List[str] = [to] if isinstance(to, str) else list(to)
    if not recipients:
        logger.warning("[EmailService] No recipients specified.")
        return False

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = cfg["from_addr"] or cfg["user"]
    msg["To"] = ", ".join(recipients)
    if cc:
        msg["Cc"] = ", ".join(cc)
    if reply_to:
        msg["Reply-To"] = reply_to

    msg.attach(MIMEText(body, "plain", "utf-8"))
    if html_body:
        msg.attach(MIMEText(html_body, "html", "utf-8"))

    all_recipients = recipients + (cc or [])

    try:
        use_tls = cfg["use_tls"]
        host = cfg["host"]
        port = cfg["port"]
        user = cfg["user"]
        password = cfg["password"]

        if use_tls == "ssl":
            ctx = ssl.create_default_context()
            with smtplib.SMTP_SSL(host, port, context=ctx, timeout=30) as smtp:
                if user and password:
                    smtp.login(user, password)
                smtp.sendmail(msg["From"], all_recipients, msg.as_string())
        else:
            with smtplib.SMTP(host, port, timeout=30) as smtp:
                smtp.ehlo()
                if use_tls in ("true", "starttls", "1"):
                    ctx = ssl.create_default_context()
                    smtp.starttls(context=ctx)
                    smtp.ehlo()
                if user and password:
                    smtp.login(user, password)
                smtp.sendmail(msg["From"], all_recipients, msg.as_string())

        logger.info("[EmailService] Email sent to %s — subject: %s", recipients, subject)
        return True

    except smtplib.SMTPAuthenticationError as exc:
        logger.error("[EmailService] SMTP authentication failed: %s", exc)
    except smtplib.SMTPConnectError as exc:
        logger.error("[EmailService] SMTP connection failed to %s:%s — %s", host, port, exc)
    except smtplib.SMTPException as exc:
        logger.error("[EmailService] SMTP error: %s", exc)
    except OSError as exc:
        logger.error("[EmailService] Network error sending email: %s", exc)
    except Exception as exc:
        logger.exception("[EmailService] Unexpected error sending email: %s", exc)

    return False


async def send_email_async(
    to: List[str] | str,
    subject: str,
    body: str,
    html_body: Optional[str] = None,
    cc: Optional[List[str]] = None,
    reply_to: Optional[str] = None,
) -> bool:
    """Async wrapper for send_email — runs the SMTP call in an executor thread."""
    import asyncio
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None,
        lambda: send_email(
            to=to,
            subject=subject,
            body=body,
            html_body=html_body,
            cc=cc,
            reply_to=reply_to,
        ),
    )


def email_enabled() -> bool:
    """Return True if email is configured and ready to send."""
    return _is_email_enabled()
