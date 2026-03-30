"""
JobApplicationBot – Main Entry Point
Starts the Flask web server, system tray, and background scheduler.
"""

import json
import logging
import os
import sys
import threading
import time
import webbrowser
from pathlib import Path

# ── Setup Logging ──────────────────────────────────────────
LOG_DIR = Path(__file__).parent / 'logs'
LOG_DIR.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    handlers=[
        logging.FileHandler(str(LOG_DIR / 'jobbot.log'), encoding='utf-8'),
        logging.StreamHandler(sys.stdout),
    ]
)
logger = logging.getLogger('jobbot')

APP_ROOT = Path(__file__).parent
sys.path.insert(0, str(APP_ROOT))

# ── Imports ────────────────────────────────────────────────
from src import database as db
from src import notifier
from src import claude_helper
from src import email_monitor
from web.app import create_app

FLASK_PORT = 5000
FLASK_HOST = '0.0.0.0'  # Bind to all interfaces so other PCs on the network can access

# ── Load Settings ──────────────────────────────────────────

def load_settings() -> dict:
    path = APP_ROOT / 'config' / 'settings.json'
    if path.exists():
        with open(path) as f:
            return json.load(f)
    return {}


# ── Background Scheduler ───────────────────────────────────

def _scheduler_loop(settings: dict):
    """Background thread: auto-search and email monitoring."""
    interval_hours = float(settings.get('search_interval_hours', 6))
    if interval_hours <= 0:
        logger.info("Auto-search disabled")
        return

    logger.info(f"Auto-search scheduler started (every {interval_hours}h)")
    while True:
        time.sleep(interval_hours * 3600)
        try:
            _run_auto_search(settings)
        except Exception as e:
            logger.error(f"Auto-search error: {e}")


def _run_auto_search(settings: dict):
    """Run a scheduled job search."""
    import asyncio
    from src.job_searcher import search_linkedin, search_indeed
    from src.job_pipeline import process_job_batch

    keywords = settings.get('default_keywords', [
        'IT Director', 'VP of IT', 'Head of Cloud',
        'Director of Infrastructure', 'IT Manager', 'Cloud Manager',
    ])
    location = settings.get('default_location', 'Austin, TX')

    loop = asyncio.new_event_loop()
    all_jobs = []

    try:
        li_jobs = loop.run_until_complete(
            search_linkedin(keywords, location,
                            li_session_cookie=settings.get('linkedin_session_cookie', ''))
        )
        all_jobs.extend(li_jobs)

        indeed_jobs = loop.run_until_complete(search_indeed(keywords, location))
        all_jobs.extend(indeed_jobs)
    finally:
        loop.close()

    new_count = process_job_batch(all_jobs)

    if new_count > 0:
        notifier.notify_jobs_found(new_count, 'LinkedIn/Indeed')
    logger.info(f"Auto-search complete: {new_count} new qualifying jobs")


def _email_alert_callback(urls: list):
    """Called when email monitor finds job alert URLs."""
    import asyncio
    from src.job_searcher import fetch_job_from_url
    from src.job_pipeline import process_job

    loop = asyncio.new_event_loop()
    new_count = 0

    try:
        for url in urls:
            if db.is_duplicate(url):
                continue
            job_data = loop.run_until_complete(fetch_job_from_url(url))
            if not job_data:
                continue
            if process_job(job_data):
                new_count += 1
    finally:
        loop.close()

    if new_count > 0:
        notifier.notify_jobs_found(new_count, 'email alerts')


# ── System Tray ────────────────────────────────────────────

def _start_system_tray():
    """Start Windows system tray icon (optional, silently fails if pystray not installed)."""
    try:
        import pystray
        from PIL import Image, ImageDraw

        # Create a simple icon
        img = Image.new('RGB', (64, 64), color='#1a365d')
        draw = ImageDraw.Draw(img)
        draw.ellipse([16, 16, 48, 48], fill='#4299e1')
        draw.text((24, 22), '🤖', fill='white')

        def on_open(icon, item):
            webbrowser.open(f'http://{FLASK_HOST}:{FLASK_PORT}')

        def on_quit(icon, item):
            icon.stop()
            os._exit(0)

        menu = pystray.Menu(
            pystray.MenuItem('Open Dashboard', on_open),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem('Quit JobBot', on_quit),
        )
        icon = pystray.Icon('JobBot', img, 'JobApplicationBot', menu)
        icon.run()
    except Exception as e:
        logger.debug(f"System tray not available: {e}")


# ── Flask Server ───────────────────────────────────────────

def _start_flask():
    """Start the Flask web server."""
    flask_app = create_app()
    flask_app.run(
        host=FLASK_HOST,
        port=FLASK_PORT,
        debug=False,
        use_reloader=False,
        threaded=True,
    )


# ── Main ───────────────────────────────────────────────────

def main():
    logger.info("=" * 60)
    logger.info("JobApplicationBot starting up...")
    logger.info("=" * 60)

    # Initialize DB
    db.init_db()

    # Load settings
    settings = load_settings()

    # Init modules
    notifier.load_settings(settings)
    claude_helper.load_settings(settings)
    email_monitor.load_settings(settings)

    # Check Claude CLI
    cli_status = claude_helper.check_claude_cli()
    if cli_status['available']:
        logger.info(f"✅ Claude CLI available ({cli_status['version']}) – full automation enabled")
    else:
        logger.info("⚠️  Claude CLI not found – clipboard mode will be used for Q&A")

    # Start email monitor if configured
    if settings.get('imap_host') and settings.get('imap_user'):
        email_monitor.start_monitor(_email_alert_callback, interval_minutes=30)
        logger.info("Email monitor started")

    # Start auto-search scheduler in background
    if float(settings.get('search_interval_hours', 0)) > 0:
        threading.Thread(
            target=_scheduler_loop, args=(settings,),
            daemon=True, name='Scheduler'
        ).start()

    # Start Flask in background thread
    flask_thread = threading.Thread(target=_start_flask, daemon=True, name='Flask')
    flask_thread.start()
    logger.info(f"Dashboard running at http://{FLASK_HOST}:{FLASK_PORT}")

    # Open browser after a short delay
    def open_browser():
        time.sleep(1.5)
        webbrowser.open(f'http://{FLASK_HOST}:{FLASK_PORT}')
    threading.Thread(target=open_browser, daemon=True).start()

    # Show startup notification
    notifier.notify_desktop(
        "JobApplicationBot Started",
        f"Dashboard: http://{FLASK_HOST}:{FLASK_PORT}"
    )

    # Start system tray in background (non-blocking)
    tray_thread = threading.Thread(target=_start_system_tray, daemon=True, name='Tray')
    tray_thread.start()

    # Keep the main thread alive — handle Ctrl+C and also support /api/shutdown
    logger.info("Running. Press Ctrl+C or visit /api/shutdown to stop.")
    import signal
    stop_event = threading.Event()

    def _signal_handler(sig, frame):
        logger.info("Shutting down (Ctrl+C)...")
        stop_event.set()

    signal.signal(signal.SIGINT, _signal_handler)
    signal.signal(signal.SIGTERM, _signal_handler)

    # Wait until signaled to stop
    stop_event.wait()
    email_monitor.stop_monitor()
    logger.info("JobApplicationBot stopped.")
    os._exit(0)


if __name__ == '__main__':
    main()
