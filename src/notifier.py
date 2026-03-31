"""
Web and email notifications.
Stores notifications in-memory for the web dashboard to display,
and optionally sends emails.
"""

import logging
import smtplib
import ssl
import time
from collections import deque
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

logger = logging.getLogger(__name__)

_settings = {}

# In-memory notification feed — web UI polls this
_notifications = deque(maxlen=50)
_notification_id = 0


def load_settings(settings: dict):
    global _settings
    _settings = settings


def get_web_notifications(since_id: int = 0) -> list:
    """Get notifications newer than since_id for the web dashboard."""
    return [n for n in _notifications if n['id'] > since_id]


def _add_web_notification(title: str, message: str, category: str = 'info'):
    """Add a notification to the in-memory feed for the web UI."""
    global _notification_id
    _notification_id += 1
    _notifications.append({
        'id': _notification_id,
        'title': title,
        'message': message,
        'category': category,
        'timestamp': time.time(),
    })


# ─────────────────────────────────────────────────────────
# DESKTOP NOTIFICATION (Windows toast)
# ─────────────────────────────────────────────────────────

def notify_desktop(title: str, message: str, app_id: str = 'JobApplicationBot'):
    """
    Send a notification — primarily to the web dashboard.
    Falls back to OS-level toast if available, but the web UI is the main channel.
    """
    # Always add to web notification feed
    _add_web_notification(title, message, 'info')

    # Optionally try OS-level toast (best-effort, non-blocking)
    try:
        from win10toast import ToastNotifier
        toaster = ToastNotifier()
        toaster.show_toast(title, message[:200], icon_path=None, duration=5, threaded=True)
        return True
    except Exception:
        pass

    try:
        from plyer import notification
        notification.notify(title=title, message=message[:200], app_name=app_id, timeout=5)
        return True
    except Exception:
        pass

    return False


# ─────────────────────────────────────────────────────────
# EMAIL NOTIFICATION
# ─────────────────────────────────────────────────────────

def send_email(subject: str, body: str, to_email: str = None):
    """Send email notification to Randy."""
    smtp_host = _settings.get('smtp_host', '')
    smtp_port = int(_settings.get('smtp_port', 587))
    smtp_user = _settings.get('smtp_user', '')
    smtp_pass = _settings.get('smtp_pass', '')
    from_email = smtp_user or 'randy.walker@live.com'
    to = to_email or 'randy.walker@live.com'

    if not smtp_host or not smtp_user or not smtp_pass:
        logger.info("Email not configured – skipping email notification")
        return False

    try:
        msg = MIMEMultipart('alternative')
        msg['Subject'] = f'[JobBot] {subject}'
        msg['From'] = from_email
        msg['To'] = to

        html_body = f"""
        <html><body style="font-family: Arial, sans-serif; padding: 20px;">
        <h2 style="color: #2c5282;">🤖 Job Application Bot</h2>
        <p>{body.replace(chr(10), '<br>')}</p>
        <hr>
        <p style="color: #718096; font-size: 12px;">
            <a href="http://localhost:5000">Open Dashboard</a>
        </p>
        </body></html>
        """
        msg.attach(MIMEText(body, 'plain'))
        msg.attach(MIMEText(html_body, 'html'))

        context = ssl.create_default_context()
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.ehlo()
            server.starttls(context=context)
            server.login(smtp_user, smtp_pass)
            server.sendmail(from_email, to, msg.as_string())

        logger.info(f"Email sent: {subject}")
        return True

    except Exception as e:
        logger.error(f"Failed to send email: {e}")
        return False


# ─────────────────────────────────────────────────────────
# COMBINED NOTIFY
# ─────────────────────────────────────────────────────────

def notify(title: str, message: str, send_mail: bool = True):
    """Send both desktop and email notifications."""
    notify_desktop(title, message)
    if send_mail and _settings.get('email_notifications', 'true').lower() == 'true':
        send_email(title, message)


# ─────────────────────────────────────────────────────────
# SPECIFIC NOTIFICATIONS
# ─────────────────────────────────────────────────────────

def notify_jobs_found(count: int, platform: str):
    _add_web_notification(
        "New Jobs Found",
        f"Found {count} new qualifying job(s) on {platform}.",
        'success'
    )
    # Email only — web notification already added above
    if _settings.get('email_notifications', 'true').lower() == 'true':
        send_email("New Jobs Found",
                   f"Found {count} new qualifying job(s) on {platform}.\n"
                   f"Open the dashboard to review and queue applications.")


def notify_applied(title: str, company: str):
    _add_web_notification(
        "Application Submitted",
        f"Applied to: {title} at {company}",
        'success'
    )
    if _settings.get('email_notifications', 'true').lower() == 'true':
        send_email("Application Submitted",
                   f"Successfully applied to: {title}\nCompany: {company}")


def notify_failed(title: str, company: str, reason: str):
    _add_web_notification(
        "Application Failed",
        f"Could not apply to: {title} at {company} — {reason}",
        'error'
    )
    if _settings.get('email_notifications', 'true').lower() == 'true':
        send_email("Application Failed",
                   f"Could not apply to: {title}\nCompany: {company}\nReason: {reason}")


def notify_needs_input(question: str, job_title: str):
    """Called when Claude needs input via clipboard method."""
    _add_web_notification(
        "Action Required",
        f"Application for {job_title} needs your answer. Go to the Answer page.",
        'warning'
    )
    notify(
        "Action Required – Answer Needed",
        f"Job: {job_title}\n\nQuestion: {question[:150]}\n\n"
        f"Go to the Answer page to paste your response."
    )


def notify_question_ready(job_title: str):
    """Notify that a pending question is ready for clipboard method."""
    _add_web_notification(
        "Answer Needed",
        f"Prompt copied to clipboard for: {job_title}. Paste into Claude.ai, then go to Answer page.",
        'warning'
    )


def notify_config_warning(title: str, message: str):
    """Configuration warning — shown on web dashboard instead of system tray."""
    _add_web_notification(title, message, 'warning')
