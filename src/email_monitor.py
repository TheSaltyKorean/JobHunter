"""
Email monitor for job alert emails.
Watches an IMAP mailbox for emails from LinkedIn, Indeed, and other job boards.
Extracts job URLs and queues them for processing.
"""

import email
import imaplib
import logging
import re
import threading
import time
from email.header import decode_header

logger = logging.getLogger(__name__)

_settings = {}
_running = False
_monitor_thread = None


def load_settings(settings: dict):
    global _settings
    _settings = settings


# ─────────────────────────────────────────────────────────
# JOB ALERT EMAIL DETECTION
# ─────────────────────────────────────────────────────────

JOB_ALERT_SENDERS = [
    'jobalerts-noreply@linkedin.com',
    'jobs-listings@linkedin.com',
    'alert@indeed.com',
    'noreply@indeed.com',
    'no-reply@ziprecruiter.com',
    'noreply@glassdoor.com',
    'noreply@dice.com',
    'jobalert@monster.com',
    'jobs@builtinaustin.com',
    'jobs@builtin.com',
]

JOB_ALERT_SUBJECTS = [
    'job alert', 'new jobs for', 'jobs matching', 'recommended jobs',
    'job recommendations', 'jobs you might like', 'new job matches',
    'jobs near', r'\d+ new jobs', 'apply now',
]


def _is_job_alert(from_addr: str, subject: str) -> bool:
    from_lower = from_addr.lower()
    subject_lower = subject.lower()

    for sender in JOB_ALERT_SENDERS:
        if sender in from_lower:
            return True

    for pattern in JOB_ALERT_SUBJECTS:
        if re.search(pattern, subject_lower):
            return True

    return False


def _decode_header_value(value) -> str:
    if value is None:
        return ''
    parts = decode_header(value)
    decoded = []
    for part, charset in parts:
        if isinstance(part, bytes):
            decoded.append(part.decode(charset or 'utf-8', errors='replace'))
        else:
            decoded.append(part)
    return ' '.join(decoded)


def _extract_body(msg) -> str:
    """Extract plain text body from email message."""
    body = ''
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == 'text/plain':
                charset = part.get_content_charset() or 'utf-8'
                body += part.get_payload(decode=True).decode(charset, errors='replace')
            elif ct == 'text/html' and not body:
                # Fallback: use HTML, strip tags
                charset = part.get_content_charset() or 'utf-8'
                html = part.get_payload(decode=True).decode(charset, errors='replace')
                # Strip HTML tags
                body += re.sub(r'<[^>]+>', ' ', html)
    else:
        charset = msg.get_content_charset() or 'utf-8'
        body = msg.get_payload(decode=True).decode(charset, errors='replace')
    return body


def _extract_urls(body: str) -> list:
    """Extract job URLs from email body."""
    from .job_searcher import parse_job_alert_email
    return parse_job_alert_email('', body)


# ─────────────────────────────────────────────────────────
# IMAP CONNECTOR
# ─────────────────────────────────────────────────────────

def check_email_once() -> list:
    """
    Connect to IMAP, find unread job alert emails, extract URLs.
    Returns list of job URLs found.
    """
    imap_host = _settings.get('imap_host', '')
    imap_user = _settings.get('imap_user', '')
    imap_pass = _settings.get('imap_pass', '')

    if not imap_host or not imap_user or not imap_pass:
        logger.debug("IMAP not configured")
        return []

    found_urls = []

    try:
        imap = imaplib.IMAP4_SSL(imap_host, 993)
        imap.login(imap_user, imap_pass)
        imap.select('INBOX')

        # Search for unread job alert emails
        _, msg_ids = imap.search(None, '(UNSEEN)')
        if not msg_ids or not msg_ids[0]:
            imap.logout()
            return []

        ids = msg_ids[0].split()
        logger.info(f"Found {len(ids)} unread emails")

        for msg_id in ids[-50:]:  # Process at most 50 at a time
            try:
                _, data = imap.fetch(msg_id, '(RFC822)')
                raw = data[0][1]
                msg = email.message_from_bytes(raw)

                from_addr = _decode_header_value(msg.get('From', ''))
                subject = _decode_header_value(msg.get('Subject', ''))

                if not _is_job_alert(from_addr, subject):
                    continue

                logger.info(f"Processing job alert: {subject[:60]} from {from_addr[:40]}")

                body = _extract_body(msg)
                urls = _extract_urls(body)

                if urls:
                    found_urls.extend(urls)
                    logger.info(f"Found {len(urls)} job URLs in email: {subject[:40]}")

                    # Mark as read so we don't process again
                    imap.store(msg_id, '+FLAGS', '\\Seen')

            except Exception as e:
                logger.error(f"Error processing email {msg_id}: {e}")

        imap.logout()

    except imaplib.IMAP4.error as e:
        logger.error(f"IMAP login failed: {e}")
    except Exception as e:
        logger.error(f"Email monitor error: {e}")

    return list(set(found_urls))  # Deduplicate


# ─────────────────────────────────────────────────────────
# BACKGROUND MONITOR THREAD
# ─────────────────────────────────────────────────────────

def _monitor_loop(callback, interval_minutes: int = 30):
    """
    Background thread that checks email every N minutes.
    callback(urls: list) is called when new job URLs are found.
    """
    global _running
    while _running:
        try:
            urls = check_email_once()
            if urls:
                logger.info(f"Email monitor found {len(urls)} job URLs")
                callback(urls)
        except Exception as e:
            logger.error(f"Email monitor loop error: {e}")

        # Sleep in 1-second increments so we can stop cleanly
        for _ in range(interval_minutes * 60):
            if not _running:
                break
            time.sleep(1)


def start_monitor(callback, interval_minutes: int = 30):
    """Start background email monitoring thread."""
    global _running, _monitor_thread
    if _running:
        return
    _running = True
    _monitor_thread = threading.Thread(
        target=_monitor_loop,
        args=(callback, interval_minutes),
        daemon=True,
        name='EmailMonitor'
    )
    _monitor_thread.start()
    logger.info(f"Email monitor started (interval: {interval_minutes} min)")


def stop_monitor():
    """Stop the email monitor thread."""
    global _running
    _running = False
    logger.info("Email monitor stopped")


# ─────────────────────────────────────────────────────────
# KNOWN EMAIL CONFIGS
# ─────────────────────────────────────────────────────────

EMAIL_PRESETS = {
    'outlook_live': {
        'imap_host': 'outlook.office365.com',
        'smtp_host': 'smtp.office365.com',
        'smtp_port': 587,
    },
    'gmail': {
        'imap_host': 'imap.gmail.com',
        'smtp_host': 'smtp.gmail.com',
        'smtp_port': 587,
    },
    'yahoo': {
        'imap_host': 'imap.mail.yahoo.com',
        'smtp_host': 'smtp.mail.yahoo.com',
        'smtp_port': 587,
    },
}
