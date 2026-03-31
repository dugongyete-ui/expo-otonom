"""
Email tool for Dzeck AI Agent.
Wraps the email_service to allow the agent to send emails.
"""
import logging
from typing import Optional

from server.agent.models.tool_result import ToolResult
from server.agent.tools.base import BaseTool, tool

logger = logging.getLogger(__name__)


class EmailTool(BaseTool):
    """Tool for sending emails via SMTP."""

    @tool(
        name="send_email",
        description=(
            "Send an email to one or more recipients. "
            "Requires EMAIL_HOST, EMAIL_USER, and EMAIL_PASSWORD to be configured in the server environment. "
            "Returns success status and message ID if sent successfully."
        ),
        parameters={
            "to": {
                "type": "string",
                "description": "Recipient email address (or comma-separated list for multiple recipients)",
            },
            "subject": {
                "type": "string",
                "description": "Email subject line",
            },
            "body": {
                "type": "string",
                "description": "Email body (plain text or HTML)",
            },
            "html": {
                "type": "boolean",
                "description": "If true, body is treated as HTML. Default: false (plain text)",
            },
            "cc": {
                "type": "string",
                "description": "CC recipient(s) — comma-separated email addresses",
            },
        },
        required=["to", "subject", "body"],
    )
    def send_email(
        self,
        to: str,
        subject: str,
        body: str,
        html: bool = False,
        cc: Optional[str] = None,
    ) -> ToolResult:
        import os
        import asyncio

        # Check email configuration upfront and return clear actionable error
        if not os.environ.get("EMAIL_HOST", "").strip():
            return ToolResult(
                success=False,
                message=(
                    "Email tidak dikonfigurasi — set EMAIL_HOST, EMAIL_USER, EMAIL_PASSWORD di .env "
                    "(dan opsional EMAIL_PORT, EMAIL_FROM) lalu restart server."
                ),
            )

        async def _send():
            try:
                from server.agent.services.email_service import send_email_async
                to_list = [addr.strip() for addr in to.split(",") if addr.strip()]
                cc_list = [addr.strip() for addr in cc.split(",") if addr.strip()] if cc else None
                ok = await send_email_async(
                    to=to_list[0] if len(to_list) == 1 else to_list,
                    subject=subject,
                    body=body,
                    html_body=body if html else None,
                    cc=cc_list,
                )
                return ok
            except Exception as e:
                logger.error("[EmailTool] send_email error: %s", e)
                return False

        try:
            try:
                asyncio.get_running_loop()
                # Called from within a running event loop — run coroutine in a thread
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as pool:
                    fut = pool.submit(asyncio.run, _send())
                    ok = fut.result(timeout=60)
            except RuntimeError:
                # No running event loop — safe to use asyncio.run()
                ok = asyncio.run(_send())
        except Exception as e:
            return ToolResult(
                success=False,
                message=f"Email sending failed: {e}",
            )

        if ok:
            return ToolResult(
                success=True,
                message=f"Email sent successfully to {to}",
                data={"to": to, "subject": subject},
            )
        return ToolResult(
            success=False,
            message=(
                "Email gagal dikirim. Periksa konfigurasi SMTP: "
                "EMAIL_HOST, EMAIL_USER, EMAIL_PASSWORD, EMAIL_PORT di .env. "
                "Pastikan kredensial SMTP benar dan server SMTP dapat dijangkau."
            ),
        )


_email_tool = EmailTool()


def send_email(
    to: str,
    subject: str,
    body: str,
    html: bool = False,
    cc: Optional[str] = None,
) -> ToolResult:
    return _email_tool.send_email(to=to, subject=subject, body=body, html=html, cc=cc)
