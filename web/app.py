"""
Flask web dashboard for JobApplicationBot.
Runs on http://localhost:5000
"""

import asyncio
import json
import logging
import os
import sys
import threading
from pathlib import Path

from flask import Flask, render_template, request, jsonify, redirect, url_for, flash

# Add parent to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from src import database as db
from src import job_analyzer
from src import notifier
from src import claude_helper
from src.job_pipeline import process_job, process_job_batch
from src.resume_profile import CONTACT

logger = logging.getLogger(__name__)

app = Flask(__name__)
app.secret_key = os.environ.get('FLASK_SECRET_KEY', os.urandom(24).hex())

APP_ROOT = Path(__file__).parent.parent


# ─────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────

def _run_async(coro):
    """Run an async coroutine from a sync Flask route."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _load_settings() -> dict:
    settings_path = APP_ROOT / 'config' / 'settings.json'
    if settings_path.exists():
        with open(settings_path) as f:
            return json.load(f)
    return {}


def _save_settings(settings: dict):
    settings_path = APP_ROOT / 'config' / 'settings.json'
    settings_path.parent.mkdir(exist_ok=True)
    with open(settings_path, 'w') as f:
        json.dump(settings, f, indent=2)


# ─────────────────────────────────────────────────────────
# ROUTES – Dashboard
# ─────────────────────────────────────────────────────────

@app.route('/')
def dashboard():
    stats = db.get_stats()
    recent_applied = db.get_jobs(status='applied', limit=5)
    recent_new = db.get_jobs(status='new', limit=5)
    claude_status = claude_helper.check_claude_cli()
    return render_template('dashboard.html',
                           stats=stats,
                           recent_applied=recent_applied,
                           recent_new=recent_new,
                           claude_status=claude_status,
                           contact=CONTACT)


# ─────────────────────────────────────────────────────────
# ROUTES – Jobs
# ─────────────────────────────────────────────────────────

@app.route('/jobs')
def jobs():
    status = request.args.get('status', '')
    page = int(request.args.get('page', 1))
    per_page = 20
    offset = (page - 1) * per_page

    # Default view hides skipped/failed — user can still click those tabs to see them
    if status:
        all_jobs = db.get_jobs(status=status, limit=per_page, offset=offset)
    else:
        all_jobs = db.get_jobs(exclude_statuses=['skipped'], limit=per_page, offset=offset)
    stats = db.get_stats()

    # Parse matched_skills JSON
    for j in all_jobs:
        try:
            j['matched_skills'] = json.loads(j.get('matched_skills') or '[]')
        except:
            j['matched_skills'] = []

    return render_template('jobs.html',
                           jobs=all_jobs,
                           stats=stats,
                           current_status=status,
                           page=page)


@app.route('/jobs/<int:job_id>')
def job_detail(job_id):
    job = db.get_job_by_id(job_id)
    if not job:
        return 'Job not found', 404
    try:
        job['matched_skills'] = json.loads(job.get('matched_skills') or '[]')
        job['qa_pairs'] = json.loads(job.get('qa_pairs') or '[]')
    except:
        pass
    return render_template('job_detail.html', job=job)


@app.route('/jobs/<int:job_id>/queue', methods=['POST'])
def queue_job(job_id):
    db.update_job_status(job_id, 'queued')
    flash('Job queued for application!', 'success')
    return redirect(url_for('jobs'))


@app.route('/jobs/<int:job_id>/skip', methods=['POST'])
def skip_job(job_id):
    reason = request.form.get('reason', '')
    db.update_job_status(job_id, 'skipped', reason)
    return jsonify({'ok': True})


@app.route('/jobs/<int:job_id>/apply', methods=['POST'])
def apply_job(job_id):
    """Trigger immediate application for a single job."""
    job = db.get_job_by_id(job_id)
    if not job:
        return jsonify({'error': 'Job not found'}), 404

    db.update_job_status(job_id, 'applying')

    def run_application():
        from src.applicator import apply_to_job
        settings = _load_settings()
        result = _run_async(apply_to_job(job, settings))

        if result['success']:
            db.update_job_status(job_id, 'applied')
            if result.get('qa_pairs'):
                db.save_qa_pairs(job_id, result['qa_pairs'])
            notifier.notify_applied(job['title'], job['company'])
        else:
            db.update_job_status(job_id, 'failed', result.get('error', ''))
            notifier.notify_failed(job['title'], job['company'], result.get('error', ''))

    threading.Thread(target=run_application, daemon=True).start()
    return jsonify({'ok': True, 'message': f"Applying to {job['title']} at {job['company']}..."})


# ─────────────────────────────────────────────────────────
# ROUTES – Job Ingestion
# ─────────────────────────────────────────────────────────

@app.route('/add-url', methods=['GET', 'POST'])
def add_url():
    """Manually add a job URL."""
    if request.method == 'POST':
        url = request.form.get('url', '').strip()
        if not url:
            flash('Please enter a URL', 'error')
            return redirect(url_for('add_url'))

        if db.is_duplicate(url):
            flash('This job URL has already been added', 'warning')
            return redirect(url_for('jobs'))

        def fetch_and_add():
            from src.job_searcher import fetch_job_from_url
            job_data = _run_async(fetch_job_from_url(url))
            if job_data:
                process_job(job_data)

        threading.Thread(target=fetch_and_add, daemon=True).start()
        flash(f'Job URL submitted for processing: {url}', 'success')
        return redirect(url_for('jobs'))

    return render_template('add_url.html')


@app.route('/search', methods=['GET', 'POST'])
def search():
    """Trigger a job search on LinkedIn and/or Indeed."""
    settings = _load_settings()

    if request.method == 'POST':
        # Textarea sends one string with newlines — split into individual keywords
        raw_keywords = request.form.get('keywords', '')
        keywords = [k.strip() for k in raw_keywords.splitlines() if k.strip()]
        location = request.form.get('location', settings.get('default_location', 'Austin, TX'))
        platforms = request.form.getlist('platforms')

        if not keywords:
            keywords = settings.get('default_keywords', [
                'IT Director', 'VP of IT', 'Head of Cloud', 'Director of Infrastructure',
                'IT Manager', 'Cloud Manager', 'Director of Technology'
            ])

        def run_search():
            from src.job_searcher import search_linkedin, search_indeed
            all_jobs = []
            seen_urls = set()

            # Search each keyword individually to get better results
            for keyword in keywords:
                logger.info(f"Searching for: {keyword}")

                if 'linkedin' in platforms:
                    try:
                        li_jobs = _run_async(search_linkedin(
                            [keyword], location,
                            li_session_cookie=settings.get('linkedin_session_cookie', '')
                        ))
                        for job in li_jobs:
                            if job['url'] not in seen_urls:
                                seen_urls.add(job['url'])
                                all_jobs.append(job)
                        logger.info(f"  LinkedIn '{keyword}': {len(li_jobs)} jobs")
                    except Exception as e:
                        logger.error(f"  LinkedIn '{keyword}' failed: {e}")

                if 'indeed' in platforms:
                    try:
                        indeed_jobs = _run_async(search_indeed([keyword], location))
                        for job in indeed_jobs:
                            if job['url'] not in seen_urls:
                                seen_urls.add(job['url'])
                                all_jobs.append(job)
                        logger.info(f"  Indeed '{keyword}': {len(indeed_jobs)} jobs")
                    except Exception as e:
                        logger.error(f"  Indeed '{keyword}' failed: {e}")

            logger.info(f"Total unique jobs found: {len(all_jobs)}")

            # Fetch full descriptions for jobs that don't have them
            for job_data in all_jobs:
                if db.is_duplicate(job_data.get('url', '')):
                    continue
                description = job_data.get('description', '')
                if not description:
                    try:
                        if job_data['platform'] == 'linkedin':
                            from src.job_searcher import fetch_linkedin_description
                            description = _run_async(fetch_linkedin_description(
                                job_data['url'],
                                settings.get('linkedin_session_cookie', '')
                            ))
                        elif job_data['platform'] == 'indeed':
                            from src.job_searcher import fetch_indeed_description
                            description = _run_async(fetch_indeed_description(job_data['url']))
                        job_data['description'] = description
                    except Exception as e:
                        logger.error(f"Failed to fetch description for {job_data['url']}: {e}")

            new_count = process_job_batch(all_jobs)
            logger.info(f"Search complete: {len(all_jobs)} total, {new_count} new qualifying jobs")

            if new_count > 0:
                notifier.notify_jobs_found(new_count, ', '.join(platforms))

        threading.Thread(target=run_search, daemon=True).start()
        flash(f"Search started for: {', '.join(keywords[:3])}... Results will appear in the jobs list.", 'success')
        return redirect(url_for('jobs'))

    default_keywords = settings.get('default_keywords', [
        'IT Director', 'VP of IT', 'Head of Cloud', 'Director of Infrastructure',
        'Cloud Manager', 'Director of Technology', 'VP of Technology'
    ])
    return render_template('search.html',
                           default_keywords=default_keywords,
                           settings=settings)


# ─────────────────────────────────────────────────────────
# ROUTES – Answer submission (clipboard mode)
# ─────────────────────────────────────────────────────────

@app.route('/answer', methods=['GET', 'POST'])
def answer():
    """Page for Randy to paste Claude.ai answers when in clipboard mode."""
    pending_path = APP_ROOT / 'data' / 'pending_question.json'
    pending = {}
    if pending_path.exists():
        with open(pending_path) as f:
            pending = json.load(f)

    if request.method == 'POST':
        q_hash = request.form.get('hash', '')
        answer_text = request.form.get('answer', '').strip()
        if q_hash and answer_text:
            answer_path = APP_ROOT / 'data' / f'answer_{q_hash}.txt'
            answer_path.write_text(answer_text, encoding='utf-8')
            flash('Answer submitted! The application will continue.', 'success')
        return redirect(url_for('answer'))

    return render_template('answer.html', pending=pending)


# ─────────────────────────────────────────────────────────
# ROUTES – Settings
# ─────────────────────────────────────────────────────────

@app.route('/settings', methods=['GET', 'POST'])
def settings():
    if request.method == 'POST':
        new_settings = {
            # Search
            'default_location':   request.form.get('default_location', 'Austin, TX'),
            'default_keywords':   [k.strip() for k in request.form.get('default_keywords', '').split('\n') if k.strip()],
            'min_match_score':    request.form.get('min_match_score', '50'),
            'search_interval_hours': request.form.get('search_interval_hours', '6'),

            # Salary
            'salary_expectation': request.form.get('salary_expectation', '180000'),
            'salary_min':         request.form.get('salary_min', '150000'),

            # Email (SMTP)
            'imap_host':  request.form.get('imap_host', ''),
            'imap_user':  request.form.get('imap_user', ''),
            'imap_pass':  request.form.get('imap_pass', ''),
            'smtp_host':  request.form.get('smtp_host', ''),
            'smtp_port':  request.form.get('smtp_port', '587'),
            'smtp_user':  request.form.get('smtp_user', ''),
            'smtp_pass':  request.form.get('smtp_pass', ''),
            'email_notifications': request.form.get('email_notifications', 'true'),

            # LinkedIn
            'linkedin_session_cookie': request.form.get('linkedin_session_cookie', ''),

            # Claude
            'anthropic_api_key': request.form.get('anthropic_api_key', ''),
            'use_claude_cli':    request.form.get('use_claude_cli', 'true'),

            # Automation
            'auto_apply':        request.form.get('auto_apply', 'false'),
            'auto_search':       request.form.get('auto_search', 'false'),
        }
        _save_settings(new_settings)
        notifier.load_settings(new_settings)
        claude_helper.load_settings(new_settings)
        flash('Settings saved!', 'success')
        return redirect(url_for('settings'))

    current = _load_settings()
    if isinstance(current.get('default_keywords'), list):
        current['default_keywords_text'] = '\n'.join(current['default_keywords'])
    claude_status = claude_helper.check_claude_cli()
    email_presets = {
        'Outlook/Live': {'imap_host': 'outlook.office365.com', 'smtp_host': 'smtp.office365.com', 'smtp_port': 587},
        'Gmail': {'imap_host': 'imap.gmail.com', 'smtp_host': 'smtp.gmail.com', 'smtp_port': 587},
    }
    return render_template('settings.html', settings=current,
                           claude_status=claude_status, email_presets=email_presets)


# ─────────────────────────────────────────────────────────
# ROUTES – API endpoints (used by JS)
# ─────────────────────────────────────────────────────────

@app.route('/api/stats')
def api_stats():
    return jsonify(db.get_stats())


@app.route('/api/jobs')
def api_jobs():
    status = request.args.get('status')
    jobs = db.get_jobs(status=status)
    return jsonify(jobs)


@app.route('/api/job/<int:job_id>/status', methods=['POST'])
def api_update_status(job_id):
    data = request.get_json()
    status = data.get('status')
    notes = data.get('notes', '')
    db.update_job_status(job_id, status, notes)
    return jsonify({'ok': True})


@app.route('/api/run-queue', methods=['POST'])
def api_run_queue():
    """Apply to all queued jobs."""
    queued = db.get_jobs(status='queued', limit=50)
    if not queued:
        return jsonify({'message': 'No queued jobs'})

    def run_all():
        from src.applicator import apply_to_job
        settings = _load_settings()
        for job in queued:
            db.update_job_status(job['id'], 'applying')
            result = _run_async(apply_to_job(job, settings))
            if result['success']:
                db.update_job_status(job['id'], 'applied')
                if result.get('qa_pairs'):
                    db.save_qa_pairs(job['id'], result['qa_pairs'])
                notifier.notify_applied(job['title'], job['company'])
            else:
                db.update_job_status(job['id'], 'failed', result.get('error', ''))

    threading.Thread(target=run_all, daemon=True).start()
    return jsonify({'message': f"Processing {len(queued)} queued applications..."})


@app.route('/api/shutdown', methods=['POST', 'GET'])
def api_shutdown():
    """Gracefully shut down the application."""
    import signal, os
    logger.info("Shutdown requested via web UI")
    # Send SIGTERM to self to trigger clean shutdown
    os.kill(os.getpid(), signal.SIGTERM)
    return jsonify({'message': 'Shutting down...'})


# ─────────────────────────────────────────────────────────
# APP STARTUP
# ─────────────────────────────────────────────────────────

def create_app():
    db.init_db()
    settings = _load_settings()
    notifier.load_settings(settings)
    claude_helper.load_settings(settings)
    return app


if __name__ == '__main__':
    create_app().run(debug=False, host='127.0.0.1', port=5000)
