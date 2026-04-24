import smtplib
from email.message import EmailMessage

from flask import request, session

from utils.config import Config


def bug_report_email_enabled() -> bool:
    return all([
        Config.SMTP_HOST,
        Config.BUG_REPORT_TO_EMAIL,
        Config.BUG_REPORT_FROM_EMAIL,
    ])


def send_bug_report_email(subject: str, description: str, reporter_email: str) -> None:
    if not bug_report_email_enabled():
        raise RuntimeError("Bug report email is not configured")

    username = session.get("username", "anonymous")
    remote_addr = request.headers.get("X-Forwarded-For", request.remote_addr or "")
    user_agent = request.user_agent.string if request.user_agent else ""

    message = EmailMessage()
    message["Subject"] = f"[Forager's Assistant] Bug report: {subject}"
    message["From"] = Config.BUG_REPORT_FROM_EMAIL
    message["To"] = Config.BUG_REPORT_TO_EMAIL
    if reporter_email:
        message["Reply-To"] = reporter_email

    message.set_content(
        "\n".join([
            f"Subject: {subject}",
            f"Reported by username: {username}",
            f"Reporter email: {reporter_email or 'not provided'}",
            f"Remote address: {remote_addr or 'unknown'}",
            f"User agent: {user_agent or 'unknown'}",
            "",
            "Description:",
            description,
        ])
    )

    if Config.SMTP_USE_SSL:
        with smtplib.SMTP_SSL(Config.SMTP_HOST, Config.SMTP_PORT, timeout=20) as server:
            if Config.SMTP_USERNAME:
                server.login(Config.SMTP_USERNAME, Config.SMTP_PASSWORD)
            server.send_message(message)
        return

    with smtplib.SMTP(Config.SMTP_HOST, Config.SMTP_PORT, timeout=20) as server:
        if Config.SMTP_USE_TLS:
            server.starttls()
        if Config.SMTP_USERNAME:
            server.login(Config.SMTP_USERNAME, Config.SMTP_PASSWORD)
        server.send_message(message)


def send_abuse_report_email(*,
                            reporter_username: str,
                            post_id: str,
                            reason: str,
                            uploader_username: str,
                            image_name: str,
                            tags: list[str],
                            uploaded_at: str,
                            location_label: str) -> None:
    if not bug_report_email_enabled():
        raise RuntimeError("Bug report email is not configured")

    remote_addr = request.headers.get("X-Forwarded-For", request.remote_addr or "")
    user_agent = request.user_agent.string if request.user_agent else ""

    message = EmailMessage()
    message["Subject"] = f"[Forager's Assistant] Abuse report for post {post_id}"
    message["From"] = Config.BUG_REPORT_FROM_EMAIL
    message["To"] = Config.BUG_REPORT_TO_EMAIL

    message.set_content(
        "\n".join([
            f"Reporter username: {reporter_username}",
            f"Post ID: {post_id}",
            f"Uploader username: {uploader_username or 'unknown'}",
            f"Image filename: {image_name or 'unknown'}",
            f"Tags: {', '.join(tags) if tags else 'none'}",
            f"Uploaded at: {uploaded_at or 'unknown'}",
            f"Location label: {location_label or 'not provided'}",
            f"Remote address: {remote_addr or 'unknown'}",
            f"User agent: {user_agent or 'unknown'}",
            "",
            "Reporter reason:",
            reason,
        ])
    )

    if Config.SMTP_USE_SSL:
        with smtplib.SMTP_SSL(Config.SMTP_HOST, Config.SMTP_PORT, timeout=20) as server:
            if Config.SMTP_USERNAME:
                server.login(Config.SMTP_USERNAME, Config.SMTP_PASSWORD)
            server.send_message(message)
        return

    with smtplib.SMTP(Config.SMTP_HOST, Config.SMTP_PORT, timeout=20) as server:
        if Config.SMTP_USE_TLS:
            server.starttls()
        if Config.SMTP_USERNAME:
            server.login(Config.SMTP_USERNAME, Config.SMTP_PASSWORD)
        server.send_message(message)
